#!/usr/bin/env node
/**
 * SEED DES MODÈLES DE TOURNÉES — feuille de collecte du 21/08/2026
 * ─────────────────────────────────────────────────────────────────────────────
 * Crée dans le moteur de modèles (`standard_routes` + `standard_route_cav`)
 * les 19 tournées modèles de la feuille de collecte historique (fichier
 * Feuille_de_collecte.xlsm, feuille « Listes » : une colonne = une tournée,
 * une ligne = un CAV). Les données sont versionnées dans
 * `backend/src/data/modeles-tournees.json` (307 points, 4 libellés arbitrés
 * avec le client le 21/08/2026 — champ `source_label` quand le libellé du
 * fichier différait du nom en base).
 *
 * RAPPROCHEMENT : chaque `cav_name` est rapproché de `cav.name` par NOM
 * NORMALISÉ (casse, accents, espaces insécables, apostrophes typographiques,
 * tirets, ponctuation). Un point sans correspondance est SIGNALÉ et ignoré
 * (jamais de CAV inventé) ; le modèle est quand même créé avec les points
 * rapprochés.
 *
 * SÉMANTIQUE (transactionnel, ré-exécutable) :
 *   - modèle absent            → créé (composition ordonnée + jour dans la
 *                                 description + estimation best-effort) ;
 *   - modèle existant, même    → « inchangé », rien n'est touché (re-run
 *     composition                 après déploiement = 0 écriture) ;
 *   - modèle existant, compo   → NON modifié par défaut (les retouches faites
 *     différente                  dans /route-templates priment) ; `--force`
 *                                 remplace la composition par celle du fichier.
 *
 * L'estimation durée/distance est calculée en best-effort avec le moteur de
 * temps partagé (véhicule générique, comme le CRUD /tours/routes) ; un échec
 * laisse les colonnes à NULL (jamais de valeur inventée) — l'estimation est
 * recalculée à la première édition du modèle dans /route-templates.
 *
 * USAGE (dans le conteneur backend) :
 *   node src/scripts/seed-route-templates.js            # simulation (dry-run)
 *   node src/scripts/seed-route-templates.js --apply    # crée les modèles absents
 *   node src/scripts/seed-route-templates.js --apply --force  # remplace aussi les compositions divergentes
 */

const pool = require('../config/database');

/**
 * Normalisation PURE d'un nom de CAV pour le rapprochement (exportée pour les
 * tests) : minuscules, accents retirés, espaces insécables et apostrophes
 * typographiques ramenés aux formes simples, tirets/ponctuation → espace,
 * espaces multiples repliés. « FONTAINE-LE-BOURG » ≡ « FONTAINE LE BOURG ».
 */
function normalizeCavName(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/\u00a0/g, ' ')            // espace insécable
    .replace(/[\u2019\u2018]/g, "'")   // apostrophes typographiques
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')  // diacritiques combinants (accents)
    .toLowerCase()
    .replace(/[-–—_/]/g, ' ')
    .replace(/[^a-z0-9' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Rapprochement PUR d'une liste de modèles contre le référentiel CAV chargé
 * (exporté pour les tests). Retourne, par modèle, les points rapprochés
 * (cav_id, position) et les libellés restés sans correspondance. Un nom
 * normalisé porté par PLUSIEURS CAV en base est ambigu → non rapproché
 * (signalé), on ne choisit jamais au hasard.
 */
function matchModeles(modeles, cavRows) {
  const byNorm = new Map();
  for (const row of cavRows) {
    const key = normalizeCavName(row.name);
    if (!byNorm.has(key)) byNorm.set(key, []);
    byNorm.get(key).push(row);
  }
  return modeles.map((m) => {
    const points = [];
    const nonRapproches = [];
    const seen = new Set();
    for (const p of m.points) {
      const cands = byNorm.get(normalizeCavName(p.cav_name)) || [];
      if (cands.length === 1) {
        const cavId = Number(cands[0].id);
        if (seen.has(cavId)) continue; // UNIQUE(route_id, cav_id)
        seen.add(cavId);
        points.push({ cav_id: cavId, cav_name: cands[0].name, source: p.cav_name });
      } else {
        nonRapproches.push({
          label: p.cav_name,
          raison: cands.length === 0 ? 'aucun CAV de ce nom en base' : `${cands.length} CAV portent ce nom (ambigu)`,
        });
      }
    }
    return { name: m.name, jour: m.jour || null, points, nonRapproches };
  });
}

/** Description standard d'un modèle seedé (le jour de tournée y est conservé). */
function routeDescription(jour) {
  const j = jour ? `Tournée du ${jour.toLowerCase()}` : 'Tournée';
  return `${j} — feuille de collecte (import du 21/08/2026)`;
}

/**
 * Cœur du seed, réutilisable — utilisé par le script en ligne de commande ET
 * par `init-db.js` (auto-seed au premier démarrage, cf. SEED_LOCK_KEY).
 *
 * @param client  client pg DÉJÀ acquis ; la transaction est gérée par l'appelant
 *                (le script ouvre BEGIN/COMMIT, init-db s'insère dans la sienne).
 * @param options apply    écrire (sinon simulation : aucune requête d'écriture) ;
 *                force    remplacer une composition existante divergente ;
 *                estimate calculer durée/distance (coûteux : OSRM/haversine sur
 *                         chaque segment) — désactivé pour l'auto-seed afin de
 *                         ne pas ralentir le démarrage du backend ; les colonnes
 *                         restent NULL et sont complétées au prochain passage du
 *                         script (ou à la première édition du modèle) ;
 *                log      collecteur de messages (console.log par défaut).
 * @returns {{crees:number, inchanges:number, divergents:number, remplaces:number,
 *            estimationsCompletees:number, nonRapproches:Array}}
 */
async function seedRouteTemplates(client, { apply = false, force = false, estimate: withEstimate = true, log = console.log } = {}) {
  const data = require('../data/modeles-tournees.json');
  const cavRows = (await client.query('SELECT id, name FROM cav')).rows;
  log(`Référentiel : ${cavRows.length} CAV en base — fichier : ${data.modeles.length} modèles, `
    + `${data.modeles.reduce((n, m) => n + m.points.length, 0)} points.`);

  const matched = matchModeles(data.modeles, cavRows);

  // Estimation best-effort partagée avec le CRUD des modèles (véhicule
  // générique 3500 kg). Chargée paresseusement : si le module échoue à se
  // charger, on seed sans estimation plutôt que d'échouer le déploiement.
  let estimateFixedRoute = null;
  if (withEstimate) {
    try {
      ({ estimateFixedRoute } = require('../routes/tours/smart-tour'));
    } catch (err) {
      log(`Estimation indisponible (${err.message}) — durées/distances laissées à NULL.`);
    }
  }
  const GENERIC_VEHICLE = { id: null, name: 'Véhicule générique', max_capacity_kg: 3500 };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });

  async function estimate(points) {
    if (!estimateFixedRoute || points.length === 0) return null;
    try {
      const full = (await client.query(
        `SELECT id, name, address, commune, latitude, longitude, nb_containers
           FROM cav WHERE id = ANY($1)`, [points.map((p) => p.cav_id)]
      )).rows;
      const byId = new Map(full.map((r) => [Number(r.id), r]));
      const ordered = points.map((p) => ({ ...byId.get(p.cav_id), type: 'cav' })).filter((p) => p.id);
      const { estimation } = await estimateFixedRoute({ vehicle: GENERIC_VEHICLE, points: ordered, date: today });
      return estimation || null;
    } catch (err) {
      log(`  estimation ignorée : ${err.message}`);
      return null;
    }
  }

  const bilan = { crees: 0, inchanges: 0, divergents: 0, remplaces: 0, estimationsCompletees: 0, nonRapproches: [] };

  for (const m of matched) {
    const tag = `${m.name} (${m.jour || 'jour inconnu'}, ${m.points.length} points rapprochés)`;
    for (const nr of m.nonRapproches) {
      log(`  ⚠ ${m.name} : point NON rapproché — « ${nr.label} » (${nr.raison})`);
      bilan.nonRapproches.push({ modele: m.name, ...nr });
    }

    const existing = (await client.query(
      'SELECT id, estimated_duration_minutes FROM standard_routes WHERE name = $1 ORDER BY id', [m.name]
    )).rows;
    if (existing.length > 1) {
      log(`  ⚠ ${m.name} : ${existing.length} modèles homonymes en base — non touché (à dédoublonner dans /route-templates).`);
      bilan.divergents++;
      continue;
    }

    if (existing.length === 1) {
      const routeId = existing[0].id;
      const current = (await client.query(
        'SELECT cav_id FROM standard_route_cav WHERE route_id = $1 ORDER BY position', [routeId]
      )).rows.map((r) => Number(r.cav_id));
      const target = m.points.map((p) => p.cav_id);
      if (current.length === target.length && current.every((v, i) => v === target[i])) {
        // Composition identique : on ne touche à rien SAUF pour COMPLÉTER une
        // estimation manquante (cas de l'auto-seed au démarrage, qui crée les
        // modèles sans estimation). On ne remplace jamais une estimation
        // existante — seulement le NULL.
        if (existing[0].estimated_duration_minutes === null && estimateFixedRoute) {
          const estim = await estimate(m.points);
          if (estim) {
            log(`  ~ ${tag} : estimation manquante complétée (${estim.duree_travail_min} min).`);
            if (apply) {
              await client.query(
                'UPDATE standard_routes SET estimated_duration_minutes = $2, estimated_distance_km = $3 WHERE id = $1',
                [routeId, estim.duree_travail_min, estim.distance_km]
              );
            }
            bilan.estimationsCompletees++;
            continue;
          }
        }
        log(`  = ${tag} : déjà en base, composition identique — inchangé.`);
        bilan.inchanges++;
      } else if (!force) {
        log(`  ≠ ${tag} : existe avec une composition DIFFÉRENTE (${current.length} points en base) — `
          + 'non modifié (les retouches de /route-templates priment ; --force pour remplacer).');
        bilan.divergents++;
      } else {
        log(`  ↻ ${tag} : composition remplacée (--force, ${current.length} → ${m.points.length} points).`);
        if (apply) {
          await client.query('DELETE FROM standard_route_cav WHERE route_id = $1', [routeId]);
          let position = 1;
          for (const p of m.points) {
            await client.query(
              'INSERT INTO standard_route_cav (route_id, cav_id, position) VALUES ($1, $2, $3)',
              [routeId, p.cav_id, position++]
            );
          }
          const estim = await estimate(m.points);
          await client.query(
            'UPDATE standard_routes SET description = $2, estimated_duration_minutes = $3, estimated_distance_km = $4 WHERE id = $1',
            [routeId, routeDescription(m.jour), estim ? estim.duree_travail_min : null, estim ? estim.distance_km : null]
          );
        }
        bilan.remplaces++;
      }
      continue;
    }

    // Un modèle SANS aucun point rapproché n'est pas créé : une coquille vide
    // ne rend aucun service et masquerait le vrai problème (référentiel CAV
    // absent au moment du seed — cas d'une base neuve).
    if (m.points.length === 0) {
      log(`  ⨯ ${m.name} : aucun point rapproché — modèle NON créé.`);
      bilan.divergents++;
      continue;
    }

    log(`  + ${tag} : à créer.`);
    if (apply) {
      const estim = await estimate(m.points);
      const inserted = await client.query(
        `INSERT INTO standard_routes (name, description, estimated_duration_minutes, estimated_distance_km, is_active)
         VALUES ($1, $2, $3, $4, true) RETURNING id`,
        [m.name, routeDescription(m.jour), estim ? estim.duree_travail_min : null, estim ? estim.distance_km : null]
      );
      const routeId = inserted.rows[0].id;
      let position = 1;
      for (const p of m.points) {
        await client.query(
          'INSERT INTO standard_route_cav (route_id, cav_id, position) VALUES ($1, $2, $3)',
          [routeId, p.cav_id, position++]
        );
      }
    }
    bilan.crees++;
  }

  return bilan;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');

  const client = await pool.connect();
  try {
    if (!apply) console.log('MODE SIMULATION (aucune écriture) — relancer avec --apply pour créer.\n');
    await client.query('BEGIN');
    const bilan = await seedRouteTemplates(client, { apply, force, estimate: true });
    if (apply) await client.query('COMMIT');
    else await client.query('ROLLBACK');

    console.log(`\nBilan : ${bilan.crees} à créer${apply ? ' (créés)' : ''}, ${bilan.inchanges} inchangés, `
      + `${bilan.divergents} divergents non touchés, ${bilan.remplaces} remplacés, `
      + `${bilan.estimationsCompletees} estimation(s) complétée(s), ${bilan.nonRapproches.length} points non rapprochés.`);
    if (!apply) console.log('Aucune écriture (simulation). Relancer avec --apply.');
    process.exitCode = 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERREUR seed modèles de tournées :', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

// Clé de verrou de l'auto-seed au démarrage (init-db.js) : posée UNE fois,
// quand au moins un modèle a réellement été créé. Une suppression volontaire
// d'un modèle dans /route-templates n'est donc jamais annulée au redémarrage.
const SEED_LOCK_KEY = 'collecte.modeles_tournees_seed';

module.exports = { normalizeCavName, matchModeles, routeDescription, seedRouteTemplates, SEED_LOCK_KEY };

if (require.main === module) {
  main();
}
