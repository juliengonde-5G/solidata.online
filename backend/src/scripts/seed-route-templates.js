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

async function main() {
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');
  const data = require('../data/modeles-tournees.json');

  const client = await pool.connect();
  try {
    const cavRows = (await client.query('SELECT id, name FROM cav')).rows;
    console.log(`Référentiel : ${cavRows.length} CAV en base — fichier : ${data.modeles.length} modèles, `
      + `${data.modeles.reduce((n, m) => n + m.points.length, 0)} points.`);
    if (!apply) console.log('MODE SIMULATION (aucune écriture) — relancer avec --apply pour créer.\n');

    const matched = matchModeles(data.modeles, cavRows);

    // Estimation best-effort partagée avec le CRUD des modèles (véhicule
    // générique 3500 kg). Chargée paresseusement : si le module échoue à se
    // charger, on seed sans estimation plutôt que d'échouer le déploiement.
    let estimateFixedRoute = null;
    try {
      ({ estimateFixedRoute } = require('../routes/tours/smart-tour'));
    } catch (err) {
      console.warn(`Estimation indisponible (${err.message}) — durées/distances laissées à NULL.`);
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
        console.warn(`  estimation ignorée : ${err.message}`);
        return null;
      }
    }

    await client.query('BEGIN');
    let crees = 0; let inchanges = 0; let divergents = 0; let remplaces = 0; let totalNonRapproches = 0;

    for (const m of matched) {
      const tag = `${m.name} (${m.jour || 'jour inconnu'}, ${m.points.length} points rapprochés)`;
      for (const nr of m.nonRapproches) {
        console.log(`  ⚠ ${m.name} : point NON rapproché — « ${nr.label} » (${nr.raison})`);
      }
      totalNonRapproches += m.nonRapproches.length;

      const existing = (await client.query(
        'SELECT id FROM standard_routes WHERE name = $1 ORDER BY id', [m.name]
      )).rows;
      if (existing.length > 1) {
        console.log(`  ⚠ ${m.name} : ${existing.length} modèles homonymes en base — non touché (à dédoublonner dans /route-templates).`);
        divergents++;
        continue;
      }

      if (existing.length === 1) {
        const routeId = existing[0].id;
        const current = (await client.query(
          'SELECT cav_id FROM standard_route_cav WHERE route_id = $1 ORDER BY position', [routeId]
        )).rows.map((r) => Number(r.cav_id));
        const target = m.points.map((p) => p.cav_id);
        if (current.length === target.length && current.every((v, i) => v === target[i])) {
          console.log(`  = ${tag} : déjà en base, composition identique — inchangé.`);
          inchanges++;
        } else if (!force) {
          console.log(`  ≠ ${tag} : existe avec une composition DIFFÉRENTE (${current.length} points en base) — `
            + 'non modifié (les retouches de /route-templates priment ; --force pour remplacer).');
          divergents++;
        } else {
          console.log(`  ↻ ${tag} : composition remplacée (--force, ${current.length} → ${m.points.length} points).`);
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
          remplaces++;
        }
        continue;
      }

      console.log(`  + ${tag} : à créer.`);
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
      crees++;
    }

    if (apply) {
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }
    console.log(`\nBilan : ${crees} à créer${apply ? ' (créés)' : ''}, ${inchanges} inchangés, `
      + `${divergents} divergents non touchés, ${remplaces} remplacés, ${totalNonRapproches} points non rapprochés.`);
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

// Fonctions PURES exportées pour les tests (aucune DB dedans).
module.exports = { normalizeCavName, matchModeles, routeDescription };

if (require.main === module) {
  main();
}
