#!/usr/bin/env node
/**
 * REPRISE D'ANCIENNETÉ — HISTORIQUE DES COLLECTES
 * ─────────────────────────────────────────────────────────────────────────────
 * Importe le tableau de suivi annuel des collectes (« Gestion des PAV », une
 * ligne par PAV, une colonne par jour, le poids collecté en cellule) pour
 * donner au moteur prédictif une base de départ au lieu de repartir de rien.
 *
 * CE QUI EST CRÉÉ :
 *   1. Un véhicule support « REPRISE HISTORIQUE » en statut HORS SERVICE.
 *      `tours.vehicle_id` est obligatoire en base : une tournée ne peut pas
 *      exister sans véhicule. Ce véhicule n'est pas un camion, c'est un
 *      marqueur — hors service, il reste hors du planning, des propositions
 *      et du parc disponible. Il sert aussi de CLÉ D'IDEMPOTENCE : les
 *      tournées de reprise sont exactement celles qui lui sont rattachées.
 *   2. Une tournée `completed` PAR JOUR de collecte, sans chauffeur ni horaires
 *      (arbitrage client : « on fera abstraction de l'équipage et du
 *      véhicule »). Une journée réelle comportait plusieurs tournées ; le
 *      fichier ne permet pas de les séparer, la tournée du jour les regroupe.
 *   3. Un point de passage `collected` par PAV collecté ce jour-là. L'ordre du
 *      fichier fait foi : il n'y a pas d'ordre de passage connu, et inventer un
 *      itinéraire serait inventer une donnée.
 *   4. Une ligne de `tonnage_history` par pesée — C'EST CE QUE LIT LE MOTEUR
 *      PRÉDICTIF (poids moyen par collecte, cadence réelle entre passages,
 *      facteurs saisonniers et météo).
 *
 * CE QUI N'EST PAS INVENTÉ : ni heure de départ ou d'arrivée, ni durée, ni
 * distance, ni taux de remplissage, ni chauffeur. Le fichier ne les contient
 * pas ; ces colonnes restent nulles.
 *
 * RAPPROCHEMENT DES PAV : par nom normalisé (casse, accents, espaces
 * insécables, apostrophes typographiques, tirets ≡ espaces), avec le MÊME
 * normaliseur que les modèles de tournées — un seul dialecte dans le projet.
 * Un nom porté par plusieurs CAV est AMBIGU donc jamais tranché au hasard ;
 * un nom sans correspondance est signalé et ignoré (« jamais de CAV inventé »).
 * Les écarts de libellé déjà arbitrés avec le client sont repris tels quels.
 *
 * TRANSACTIONNEL et IDEMPOTENT : re-jouer le même fichier reconstruit le même
 * état. Rien n'est écrit sans --apply ; le récapitulatif détaille d'abord ce
 * qui sera supprimé et créé.
 *
 * USAGE (dans le conteneur backend) :
 *   node src/scripts/import-historique-collectes.js --file=/chemin/tournees.xlsx
 *   node src/scripts/import-historique-collectes.js --file=… --apply
 *   node src/scripts/import-historique-collectes.js --file=… --completer --apply
 *        # n'écrase pas les tonnages déjà en base (par défaut le fichier fait foi)
 *   node src/scripts/import-historique-collectes.js --supprimer --apply
 *        # retire la reprise (tournées + véhicule support) ; les tonnages restent
 */

const ExcelJS = require('exceljs');
const pool = require('../config/database');
const { normalizeCavName } = require('./seed-route-templates');
const MODELES = require('../data/modeles-tournees.json');
const { RESET_SETTINGS_KEY } = require('../utils/fill-factors');

/** Véhicule support des tournées de reprise (voir en-tête). */
const VEHICULE = {
  registration: 'REPRISE-HISTORIQUE',
  name: 'REPRISE HISTORIQUE (reprise d\'ancienneté)',
  status: 'out_of_service',
};

/**
 * Écarts de libellé entre le fichier et la base, ARBITRÉS AVEC LE CLIENT le
 * 21/08/2026 — jamais des déductions du script.
 *
 * Les deux bornes ci-dessous portent dans le fichier un préfixe « 1 »/« 2 » qui
 * est une numérotation de tableur, pas un numéro de rue : le complément
 * d'adresse est identique de part et d'autre, et la troisième borne du même
 * hôpital (« entrée des urgences ») figure séparément dans le fichier comme en
 * base — les trois se correspondent une à une.
 */
const ARBITRAGES_CLIENT = {
  'SAINT-AUBIN-LÈS-ELBEUF - 1 Rue du Docteur Villers (CHI - Parking usagers)':
    'SAINT-AUBIN-LÈS-ELBEUF - Rue du Docteur Villers (CHI - Parking usagers)',
  'SAINT-AUBIN-LÈS-ELBEUF - 2 Rue du Docteur Villers (Entrée EHPAD)':
    'SAINT-AUBIN-LÈS-ELBEUF - Rue du Docteur Villers (Entrée EHPAD)',
};

/**
 * Table d'arbitrage complète (fonction PURE, exportée pour les tests) : les
 * écarts déjà tranchés lors du chargement des modèles de tournées (v2.26.3,
 * champ `source_label`) PLUS ceux arbitrés pour cet import. Réutiliser les
 * premiers évite de reposer au client une question déjà tranchée, et évite
 * surtout que les deux imports rattachent le même libellé à deux CAV différents.
 * Clés et valeurs sont normalisées : la table se consulte avec `normalizeCavName`.
 */
function buildArbitrages(modeles = MODELES, supplementaires = ARBITRAGES_CLIENT) {
  const liste = Array.isArray(modeles) ? modeles : (modeles && modeles.modeles) || [];
  const map = new Map();
  for (const m of liste) {
    for (const p of m.points || []) {
      if (p.source_label && p.cav_name) {
        map.set(normalizeCavName(p.source_label), normalizeCavName(p.cav_name));
      }
    }
  }
  for (const [source, cible] of Object.entries(supplementaires || {})) {
    map.set(normalizeCavName(source), normalizeCavName(cible));
  }
  return map;
}

/**
 * Déballe une cellule exceljs (fonction PURE, exportée pour les tests).
 * Le classeur mêle valeurs brutes, formules et texte enrichi ; sans ce
 * déballage une formule ressort en « [object Object] » et TOUT le rapprochement
 * échoue silencieusement.
 */
function cellValue(cell) {
  let v = cell && cell.value;
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('result' in v) v = v.result;
    else if ('richText' in v) v = v.richText.map((t) => t.text).join('');
    else if ('text' in v) v = v.text;
    else return null;
  }
  return v === undefined ? null : v;
}

/**
 * Localise la grille dans la feuille (fonction PURE au sens « aucune DB »,
 * exportée pour les tests). On ne code en dur ni le numéro de ligne des dates
 * ni la borne des colonnes : on prend la ligne de l'en-tête qui porte le plus
 * de dates. Un onglet remanié reste lisible tant que la structure « une colonne
 * = un jour » tient.
 */
function localiserGrille(ws, { colonnePav = 2, premiereLigne = 6 } = {}) {
  let ligneDates = null; let meilleur = 0;
  for (let r = 1; r <= Math.min(12, ws.rowCount); r++) {
    let n = 0;
    for (let c = 1; c <= ws.columnCount; c++) {
      if (cellValue(ws.getRow(r).getCell(c)) instanceof Date) n++;
    }
    if (n > meilleur) { meilleur = n; ligneDates = r; }
  }
  if (!ligneDates || meilleur < 30) {
    throw new Error('Aucune ligne de dates trouvée : ce fichier n\'a pas la forme attendue '
      + '(une colonne par jour, la date en en-tête).');
  }
  const colonnes = [];
  for (let c = 1; c <= ws.columnCount; c++) {
    const v = cellValue(ws.getRow(ligneDates).getCell(c));
    if (v instanceof Date) {
      // Date lue en UTC par exceljs : on garde le jour civil tel qu'il est écrit.
      colonnes.push({ col: c, date: v.toISOString().slice(0, 10) });
    }
  }
  return { ligneDates, colonnes, colonnePav, premiereLigne };
}

/**
 * Lit les PAV et leurs pesées (aucune DB, exportée pour les tests).
 * Une cellule vide = pas de passage. Une cellule à 0 = un passage SANS collecte,
 * saisi explicitement : on la conserve, c'est une information (la borne était
 * vide), pas une absence de donnée.
 */
function lireClasseur(ws, options = {}) {
  const grille = localiserGrille(ws, options);
  const pavs = [];
  for (let r = grille.premiereLigne; r <= ws.rowCount; r++) {
    const brut = cellValue(ws.getRow(r).getCell(grille.colonnePav));
    const nom = brut == null ? '' : String(brut).trim();
    if (!nom) continue;
    const row = ws.getRow(r);
    const collectes = [];
    for (const { col, date } of grille.colonnes) {
      const v = cellValue(row.getCell(col));
      if (typeof v === 'number' && Number.isFinite(v)) collectes.push({ date, kg: v });
    }
    pavs.push({ ligne: r, nom, norm: normalizeCavName(nom), collectes });
  }
  return { grille, pavs };
}

/**
 * Rapproche les PAV du fichier et les CAV de la base (aucune DB, exportée pour
 * les tests). Trois issues, jamais de quatrième : rapproché, ambigu (plusieurs
 * CAV portent ce nom — on ne tranche pas), absent (aucun CAV — on n'en crée pas).
 */
function rapprocher(pavs, cavs, arbitrages = buildArbitrages()) {
  const index = new Map();
  for (const c of cavs) {
    const k = normalizeCavName(c.name);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(c);
  }
  const ok = []; const ambigus = []; const absents = [];
  for (const p of pavs) {
    const cible = arbitrages.get(p.norm) || p.norm;
    const m = index.get(cible) || [];
    if (m.length === 1) ok.push({ ...p, cav: m[0], arbitre: cible !== p.norm });
    else if (m.length > 1) ambigus.push({ ...p, candidats: m });
    else absents.push(p);
  }
  return { ok, ambigus, absents };
}

/**
 * Regroupe les pesées par jour (aucune DB, exportée pour les tests).
 * L'ordre des points d'une journée est celui du fichier : aucun ordre de
 * passage n'est connu, en inventer un serait inventer une donnée.
 */
function grouperParJour(rapproches) {
  const jours = new Map();
  for (const p of rapproches) {
    for (const { date, kg } of p.collectes) {
      if (!jours.has(date)) jours.set(date, []);
      jours.get(date).push({ cavId: p.cav.id, nom: p.cav.name, kg });
    }
  }
  return [...jours.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, points]) => ({
      date,
      points,
      totalKg: points.reduce((s, p) => s + p.kg, 0),
    }));
}

/** Lecture PURE des arguments (exportée pour les tests). */
function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const completer = argv.includes('--completer');
  const supprimer = argv.includes('--supprimer');
  let file = null;
  for (const a of argv) {
    if (a.startsWith('--file=')) {
      file = a.slice('--file='.length).trim();
      if (!file) throw new Error('--file attend un chemin de fichier .xlsx');
    }
  }
  if (!file && !supprimer) {
    throw new Error('--file=<chemin.xlsx> est obligatoire (ou --supprimer pour retirer la reprise).');
  }
  return { apply, file, completer, supprimer };
}

// ══════════════════════════════════════════════════════════════
// Exécution
// ══════════════════════════════════════════════════════════════

async function trouverVehicule(client) {
  const r = await client.query('SELECT id FROM vehicles WHERE registration = $1', [VEHICULE.registration]);
  return r.rows[0]?.id || null;
}

async function assurerVehicule(client) {
  const existant = await trouverVehicule(client);
  if (existant) return existant;
  const r = await client.query(
    `INSERT INTO vehicles (registration, name, status, type, max_capacity_kg)
     VALUES ($1, $2, $3, 'utilitaire', 3500) RETURNING id`,
    [VEHICULE.registration, VEHICULE.name, VEHICULE.status]
  );
  return r.rows[0].id;
}

async function supprimerReprise(client, apply) {
  const vId = await trouverVehicule(client);
  if (!vId) { console.log('Aucune reprise en place (véhicule support absent).'); return; }
  const n = (await client.query('SELECT COUNT(*)::int AS n FROM tours WHERE vehicle_id = $1', [vId])).rows[0].n;
  console.log(`Reprise en place : ${n} tournée(s) rattachée(s) au véhicule « ${VEHICULE.name} ».`);
  console.log('Les lignes de tonnage NE SONT PAS supprimées (elles alimentent le prédictif et les KPI).');
  console.log('Pour les retirer aussi : node src/scripts/reset-remplissage-cav.js --purger-historique');
  if (!apply) { console.log('\nMODE SIMULATION — relancer avec --supprimer --apply.'); return; }
  await client.query('BEGIN');
  await client.query('DELETE FROM tours WHERE vehicle_id = $1', [vId]);
  await client.query('DELETE FROM vehicles WHERE id = $1', [vId]);
  await client.query('COMMIT');
  console.log(`\nReprise retirée : ${n} tournée(s) et le véhicule support supprimés.`);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`ERREUR : ${err.message}`);
    process.exitCode = 1;
    await pool.end().catch(() => {});
    return;
  }

  const client = await pool.connect();
  try {
    if (args.supprimer) { await supprimerReprise(client, args.apply); process.exitCode = 0; return; }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(args.file);
    const ws = wb.worksheets[0];
    const { grille, pavs } = lireClasseur(ws);
    const annees = [...new Set(grille.colonnes.map((c) => c.date.slice(0, 4)))];

    console.log(`Fichier : ${args.file}`);
    console.log(`Feuille « ${ws.name} » — ${grille.colonnes.length} jour(s) en colonnes, ${pavs.length} PAV en lignes.`);
    console.log(`Année(s) couverte(s) : ${annees.join(', ')}\n`);

    const { rows: cavs } = await client.query('SELECT id, name FROM cav');
    const { ok, ambigus, absents } = rapprocher(pavs, cavs);
    const pesees = (l) => l.reduce((s, p) => s + p.collectes.length, 0);
    const kg = (l) => l.reduce((s, p) => s + p.collectes.reduce((a, c) => a + c.kg, 0), 0);

    console.log('── Rapprochement des points de collecte ──');
    console.log(`  ✓ ${ok.length} PAV rapprochés (dont ${ok.filter((p) => p.arbitre).length} par arbitrage validé)`);
    console.log(`  ? ${ambigus.length} ambigus (plusieurs CAV de même nom — jamais tranché au hasard)`);
    console.log(`  ✗ ${absents.length} introuvables en base`);
    for (const p of ambigus) {
      console.log(`      L${p.ligne} · ${p.nom} → ids ${p.candidats.map((c) => c.id).join(', ')}`);
    }
    for (const p of absents) {
      console.log(`      L${p.ligne} · ${p.nom} [${p.collectes.length} pesée(s), ${kg([p])} kg IGNORÉS]`);
    }
    const jours = grouperParJour(ok);
    console.log(`\n  Pesées reprises : ${pesees(ok)} (${kg(ok).toLocaleString('fr-FR')} kg) sur ${jours.length} journée(s)`);
    if (ambigus.length + absents.length) {
      console.log(`  Pesées NON reprises : ${pesees([...ambigus, ...absents])} `
        + `(${kg([...ambigus, ...absents]).toLocaleString('fr-FR')} kg)`);
    }
    if (jours.length) {
      console.log(`  Période : ${jours[0].date} → ${jours[jours.length - 1].date}`);
      const t = jours.map((j) => j.points.length).sort((a, b) => a - b);
      console.log(`  Points par journée : min ${t[0]} · médiane ${t[Math.floor(t.length / 2)]} · max ${t[t.length - 1]}`);
    }
    if (!jours.length) { console.log('\nRien à importer.'); process.exitCode = 0; return; }

    // Ce qui sera remplacé.
    const vIdExistant = await trouverVehicule(client);
    const toursExistantes = vIdExistant
      ? (await client.query('SELECT COUNT(*)::int AS n FROM tours WHERE vehicle_id = $1', [vIdExistant])).rows[0].n
      : 0;
    const tonnagesExistants = (await client.query(
      `SELECT COUNT(*)::int AS n FROM tonnage_history WHERE to_char(date, 'YYYY') = ANY($1)`, [annees]
    )).rows[0].n;

    console.log('\n── Écritures prévues ──');
    console.log(`  Véhicule support « ${VEHICULE.name} » (hors service) : `
      + (vIdExistant ? `déjà présent (#${vIdExistant})` : 'à créer'));
    console.log(`  Tournées de reprise existantes remplacées : ${toursExistantes}`);
    console.log(`  Tournées créées : ${jours.length} (une par journée, statut « réalisée », sans chauffeur ni horaires)`);
    console.log(`  Points de passage créés : ${pesees(ok)}`);
    if (args.completer) {
      console.log(`  Tonnage : COMPLÉTÉ — les ${tonnagesExistants} ligne(s) déjà en base sur `
        + `${annees.join('/')} sont conservées, seules les dates absentes sont ajoutées.`);
    } else {
      console.log(`  Tonnage : le FICHIER FAIT FOI — les ${tonnagesExistants} ligne(s) existantes sur `
        + `${annees.join('/')} sont supprimées puis remplacées par ${pesees(ok)} pesée(s).`);
    }

    // Le jalon de remise à zéro rendrait cet import invisible du moteur.
    const jalon = (await client.query('SELECT value FROM settings WHERE key = $1', [RESET_SETTINGS_KEY])).rows[0]?.value;
    if (jalon) {
      console.log(`\n  ⚠ ATTENTION — un jalon de remise à zéro est posé au ${String(jalon).slice(0, 10)}.`);
      console.log('    Tant qu\'il est en place, le moteur prédictif considère TOUS les CAV comme');
      console.log('    vides à cette date et IGNORE l\'historique antérieur : la reprise que vous');
      console.log('    importez ne servirait à rien. Retirez-le avec :');
      console.log('      node src/scripts/reset-remplissage-cav.js --annuler --apply');
    }

    if (!args.apply) {
      console.log('\nMODE SIMULATION (aucune écriture) — relancer avec --apply.');
      process.exitCode = 0;
      return;
    }

    await client.query('BEGIN');
    const vId = await assurerVehicule(client);
    await client.query('DELETE FROM tours WHERE vehicle_id = $1', [vId]);
    if (!args.completer) {
      await client.query(`DELETE FROM tonnage_history WHERE to_char(date, 'YYYY') = ANY($1)`, [annees]);
    }

    const note = `Reprise d'ancienneté — import du fichier « ${String(args.file).split('/').pop() }». `
      + 'Équipage, véhicule et horaires non renseignés (absents du fichier).';
    let nbPoints = 0; let nbTonnages = 0;
    for (const j of jours) {
      const t = await client.query(
        `INSERT INTO tours (vehicle_id, date, status, mode, collection_type, nb_cav, total_weight_kg, notes)
         VALUES ($1, $2, 'completed', 'manual', 'pav', $3, $4, $5) RETURNING id`,
        [vId, j.date, j.points.length, j.totalKg, note]
      );
      const tourId = t.rows[0].id;
      let position = 1;
      for (const p of j.points) {
        await client.query(
          `INSERT INTO tour_cav (tour_id, cav_id, position, status) VALUES ($1, $2, $3, 'collected')`,
          [tourId, p.cavId, position++]
        );
        nbPoints++;
        const ins = await client.query(
          args.completer
            ? `INSERT INTO tonnage_history (cav_id, date, weight_kg, source)
               SELECT $1, $2::date, $3, 'import'
                WHERE NOT EXISTS (SELECT 1 FROM tonnage_history WHERE cav_id = $1 AND date = $2::date)`
            : `INSERT INTO tonnage_history (cav_id, date, weight_kg, source) VALUES ($1, $2::date, $3, 'import')`,
          [p.cavId, j.date, p.kg]
        );
        nbTonnages += ins.rowCount;
      }
    }

    await client.query(
      `INSERT INTO rgpd_audit_log (user_id, action, entity_type, details)
       VALUES (NULL, 'COLLECTES_REPRISE_IMPORT', 'tours', $1)`,
      [JSON.stringify({
        fichier: String(args.file).split('/').pop(),
        annees, tournees: jours.length, points: nbPoints, tonnages: nbTonnages,
        pav_rapproches: ok.length, pav_ambigus: ambigus.length, pav_absents: absents.length,
        mode_tonnage: args.completer ? 'completer' : 'fichier_fait_foi',
        script: 'import-historique-collectes.js',
      })]
    ).catch((err) => console.warn(`  journal rgpd_audit_log ignoré : ${err.message}`));
    await client.query('COMMIT');

    console.log(`\nImport appliqué : ${jours.length} tournée(s), ${nbPoints} point(s) de passage, `
      + `${nbTonnages} ligne(s) de tonnage.`);
    console.log('Étape suivante : recalculer le moteur prédictif —');
    console.log('  node src/scripts/recalculer-predictif.js');
    process.exitCode = 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERREUR import historique des collectes :', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

module.exports = {
  parseArgs, cellValue, localiserGrille, lireClasseur, rapprocher, grouperParJour,
  buildArbitrages, VEHICULE, ARBITRAGES_CLIENT,
};

if (require.main === module) {
  main();
}
