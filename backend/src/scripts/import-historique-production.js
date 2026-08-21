#!/usr/bin/env node
/**
 * REPRISE D'ANCIENNETÉ — FEUILLES DE PRODUCTION (atelier de tri)
 * ─────────────────────────────────────────────────────────────────────────────
 * Importe le tableau de suivi quotidien de la production (une ligne par jour
 * travaillé) dans l'historique des feuilles de production — la page
 * /production et son tableau de bord.
 *
 * CE QUI EST REPRIS, colonne par colonne :
 *   Date · Encadrant atelier · Contrôle tri · Signature
 *   Effectif Tri / CP / Formation / Absences        → compteurs de la feuille
 *   Objectifs entrée, recyclage, réutilisation, CSR → objectifs du jour
 *   Total entrée ligne · Total recyclage N°3        → tonnages
 *   Pesées détaillées de chariots (« 248/241 »)     → table production_chariots
 *   Consigne · Commentaire · réserves de lecture    → texte de la feuille
 *
 * CE QUI N'EST PAS INVENTÉ :
 *   - Les colonnes C1/C2 marquent qu'un poste a été TENU, jamais PAR QUI. Dans
 *     l'application les postes viennent du planning nominatif : créer des
 *     affectations reviendrait à inventer des noms. Arbitrage client du
 *     21/08/2026 : ces colonnes sont résumées en clair dans le commentaire de
 *     la journée. D'autant que leur sens VARIE d'un formulaire à l'autre —
 *     les réserves de lecture du tableau signalent que C1/C2 désigne tantôt
 *     « chaîne 1 / chaîne 2 », tantôt « matin / après-midi » ; le résumé
 *     reproduit donc le formulaire sans trancher.
 *   - Recyclage R4 : aucune colonne dans le tableau → écrit à NULL, jamais 0.
 *     Attention, `production_daily` porte des valeurs PAR DÉFAUT en base
 *     (entrée R4 à 0, objectifs R3/R4 à 1300 et 900 kg) : ne pas citer ces
 *     colonnes dans l'INSERT les ferait fabriquer par PostgreSQL. Elles sont
 *     donc écrites explicitement à NULL, à l'insertion comme à la mise à jour.
 *   - Un objectif absent du tableau reste vide (l'application, elle, applique
 *     ses valeurs par défaut à la saisie — l'import n'en met aucune).
 *   - Récupération et arrêt maladie : absents du tableau → vides.
 *
 * COHÉRENCE DES PESÉES : les totaux du tableau FONT FOI. Le détail chariot par
 * chariot est reconstitué à titre consultable ; quand sa somme diffère du total
 * déclaré (transcription de formulaires manuscrits), l'écart est LISTÉ au
 * récapitulatif au lieu d'être corrigé en douce.
 *
 * TRANSACTIONNEL et IDEMPOTENT : re-jouer le même fichier reconstruit le même
 * état. Rien n'est écrit sans --apply.
 *
 * USAGE (dans le conteneur backend) :
 *   node src/scripts/import-historique-production.js --file=/tmp/production.xlsx
 *   node src/scripts/import-historique-production.js --file=… --apply
 *   node src/scripts/import-historique-production.js --file=… --completer --apply
 *        # ne remplace pas les feuilles déjà saisies dans l'application
 */

const fs = require('fs');
const ExcelJS = require('exceljs');
const pool = require('../config/database');
const { cellValue } = require('./import-historique-collectes');

/** Colonnes du tableau (1-indexées), telles que produites par la transcription. */
const COL = {
  date: 1, jour: 2, semaine: 3,
  encadrant: 4, controleur: 5, signature: 6,
  effectifTri: 7, cp: 8, formation: 9, abs: 10,
  objEntree: 11, objRecyclage: 12, objReutilisation: 13, objCsr: 14,
  saisieLigne: 35, saisieR3: 36,
  totalLigne: 41, totalR3: 42, totalGeneral: 43,
  consigne: 44, commentaire: 45, notes: 46, fichier: 47, page: 48,
};

/** Postes du formulaire : libellé + colonnes C1 / C2. */
const POSTES = [
  ['Craquage', 15, 16],
  ['Recyclage N°1', 17, 18],
  ['Recyclage N°2', 19, 20],
  ['Recyclage N°3', 21, 22],
  ['Réutilisation', 23, 24],
  ['Homme VAK/BTQ', 25, 26],
  ['Femme VAK/BTQ', 27, 28],
  ['Layette VAK/BTQ', 29, 30],
  ['Accessoire', 31, 32],
  ['Chiffon', 33, 34],
];

/**
 * Liste de pesées depuis une saisie libre (fonction PURE, exportée pour les
 * tests). Les formulaires séparent les chariots par « . », « / » ou un espace,
 * sans règle constante : on extrait les nombres, sans jamais en fabriquer.
 */
function parsePesees(saisie) {
  if (saisie === null || saisie === undefined || saisie === '') return [];
  return String(saisie).match(/\d+/g)?.map(Number).filter((n) => n > 0) || [];
}

/**
 * Objectif d'entrée en KILOS depuis « 1,5T », « 1,5 », « 0,9t », « 900 »
 * (fonction PURE, exportée pour les tests). Le tableau mêle les deux unités :
 * un objectif quotidien se compte en tonnes (1,5 T) ou en kilos (900 kg), et
 * jamais entre les deux — sous 50, la valeur est donc lue en tonnes.
 */
const SEUIL_TONNES = 50;
function parseObjectifPoids(brut) {
  if (brut === null || brut === undefined || brut === '') return null;
  const s = String(brut).replace(',', '.');
  const m = s.match(/[\d.]+/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n < SEUIL_TONNES ? n * 1000 : n);
}

/** Pourcentage depuis « 70% » / « 70 » (fonction PURE, exportée pour les tests). */
function parsePct(brut) {
  if (brut === null || brut === undefined || brut === '') return null;
  const m = String(brut).replace(',', '.').match(/[\d.]+/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/** Entier positif ou null (fonction PURE, exportée pour les tests). */
function parseEntier(brut) {
  if (brut === null || brut === undefined || brut === '') return null;
  const n = Number(String(brut).match(/-?\d+/)?.[0]);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Résumé en clair des postes tenus (fonction PURE, exportée pour les tests).
 * Reproduit le formulaire SANS trancher le sens de C1/C2, qui varie d'une
 * semaine à l'autre — la réserve de lecture du jour, quand elle existe, dit
 * lequel des deux sens s'applique.
 */
function resumePostes(lire) {
  const tenus = [];
  for (const [libelle, c1, c2] of POSTES) {
    const a = lire(c1); const b = lire(c2);
    const marques = [];
    if (a !== null && a !== undefined && a !== '') marques.push('C1');
    if (b !== null && b !== undefined && b !== '') marques.push('C2');
    if (marques.length) tenus.push(`${libelle} (${marques.join(', ')})`);
  }
  return tenus.length ? `Postes tenus : ${tenus.join(' · ')}` : null;
}

/**
 * Assemble le commentaire de la feuille (fonction PURE, exportée pour les
 * tests) : le commentaire du formulaire, le résumé des postes, la réserve de
 * lecture, puis la référence au document scanné — pour qu'une valeur puisse
 * toujours être remontée jusqu'à sa source papier.
 */
function composerCommentaire({ commentaire, postes, notes, fichier, page }) {
  const blocs = [];
  if (commentaire) blocs.push(String(commentaire).trim());
  if (postes) blocs.push(postes);
  if (notes) blocs.push(`Réserve de lecture : ${String(notes).trim()}`);
  if (fichier) blocs.push(`Source : ${String(fichier).trim()}${page ? `, page ${page}` : ''}`);
  return blocs.length ? blocs.join('\n') : null;
}

/**
 * Lit les feuilles du classeur (aucune DB, exportée pour les tests).
 * Une ligne sans date n'est pas une journée : elle est ignorée.
 */
function lireFeuilles(ws) {
  const feuilles = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const lire = (c) => cellValue(row.getCell(c));
    const d = lire(COL.date);
    if (!(d instanceof Date)) continue;

    const ligneKg = parseEntier(lire(COL.totalLigne));
    const r3Kg = parseEntier(lire(COL.totalR3));
    const totalKg = parseEntier(lire(COL.totalGeneral));
    const effectifTri = parseEntier(lire(COL.effectifTri));
    const peseesLigne = parsePesees(lire(COL.saisieLigne));
    const peseesR3 = parsePesees(lire(COL.saisieR3));

    feuilles.push({
      ligne: r,
      date: d.toISOString().slice(0, 10),
      encadrant: lire(COL.encadrant) || null,
      controleur: lire(COL.controleur) || null,
      signature: lire(COL.signature) || null,
      effectifTri,
      cp: parseEntier(lire(COL.cp)),
      formation: parseEntier(lire(COL.formation)),
      abs: parseEntier(lire(COL.abs)),
      objEntree: parseObjectifPoids(lire(COL.objEntree)),
      objRecyclage: parsePct(lire(COL.objRecyclage)),
      objReutilisation: parsePct(lire(COL.objReutilisation)),
      objCsr: lire(COL.objCsr) ? String(lire(COL.objCsr)).trim() : null,
      ligneKg,
      r3Kg,
      totalKg,
      peseesLigne,
      peseesR3,
      consigne: lire(COL.consigne) || null,
      commentaire: composerCommentaire({
        commentaire: lire(COL.commentaire),
        postes: resumePostes(lire),
        notes: lire(COL.notes),
        fichier: lire(COL.fichier),
        page: lire(COL.page),
      }),
    });
  }
  return feuilles;
}

/**
 * Écarts entre la somme des pesées et le total déclaré (fonction PURE, exportée
 * pour les tests). Le total du tableau fait foi ; l'écart est SIGNALÉ, jamais
 * corrigé en douce — c'est au client de retourner au formulaire d'origine.
 */
function ecartsPesees(feuilles) {
  const out = [];
  for (const f of feuilles) {
    for (const [pesees, total, libelle] of [
      [f.peseesLigne, f.ligneKg, 'entrée ligne'],
      [f.peseesR3, f.r3Kg, 'recyclage N°3'],
    ]) {
      if (pesees.length && total !== null) {
        const somme = pesees.reduce((a, b) => a + b, 0);
        if (somme !== total) out.push({ date: f.date, libelle, somme, total, ecart: somme - total });
      }
    }
  }
  return out;
}

/** Lecture PURE des arguments (exportée pour les tests). */
function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const completer = argv.includes('--completer');
  let file = null;
  for (const a of argv) {
    if (a.startsWith('--file=')) {
      file = a.slice('--file='.length).trim();
      if (!file) throw new Error('--file attend un chemin de fichier .xlsx');
    }
  }
  if (!file) throw new Error('--file=<chemin.xlsx> est obligatoire.');
  return { apply, file, completer };
}

// ══════════════════════════════════════════════════════════════

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

  if (!fs.existsSync(args.file)) {
    console.error(`ERREUR : fichier introuvable — ${args.file}`);
    console.error('');
    console.error('Le script s\'exécute DANS le conteneur backend : le fichier doit y avoir été');
    console.error('copié au préalable. Depuis le serveur, à la racine du projet :');
    console.error('  docker compose -f docker-compose.prod.yml cp <fichier.xlsx> backend:/tmp/prod.xlsx');
    console.error('  docker compose -f docker-compose.prod.yml exec backend \\');
    console.error('    node src/scripts/import-historique-production.js --file=/tmp/prod.xlsx');
    process.exitCode = 1;
    await pool.end().catch(() => {});
    return;
  }

  const client = await pool.connect();
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(args.file);
    const ws = wb.worksheets[0];
    const feuilles = lireFeuilles(ws);

    console.log(`Fichier : ${args.file}`);
    console.log(`Feuille « ${ws.name} » — ${feuilles.length} journée(s) lue(s).`);
    if (!feuilles.length) { console.log('\nRien à importer.'); process.exitCode = 0; return; }

    const dates = feuilles.map((f) => f.date).sort();
    const avecTonnage = feuilles.filter((f) => f.totalKg !== null);
    const totalKg = avecTonnage.reduce((s, f) => s + f.totalKg, 0);
    const nbPesees = feuilles.reduce((s, f) => s + f.peseesLigne.length + f.peseesR3.length, 0);

    console.log(`Période : ${dates[0]} → ${dates[dates.length - 1]}`);
    console.log(`Tonnage repris : ${totalKg.toLocaleString('fr-FR')} kg sur ${avecTonnage.length} journée(s)`);
    console.log(`  (${feuilles.length - avecTonnage.length} journée(s) sans total — journées sans tri, `
      + 'formulaire incomplet : la feuille est créée, les tonnages restent vides)');
    console.log(`Pesées de chariots reconstituées : ${nbPesees}`);

    const ecarts = ecartsPesees(feuilles);
    if (ecarts.length) {
      console.log(`\n⚠ ${ecarts.length} écart(s) entre la somme des pesées et le total déclaré.`);
      console.log('  Le TOTAL DU TABLEAU fait foi ; le détail est importé tel quel, à vérifier');
      console.log('  sur les formulaires d\'origine :');
      for (const e of ecarts) {
        console.log(`    ${e.date} · ${e.libelle} : somme ${e.somme} vs total ${e.total} (${e.ecart > 0 ? '+' : ''}${e.ecart} kg)`);
      }
    }

    const existantes = (await client.query(
      'SELECT COUNT(*)::int AS n FROM production_daily WHERE date = ANY($1::date[])', [dates]
    )).rows[0].n;
    console.log('\n── Écritures prévues ──');
    if (args.completer) {
      console.log(`  ${existantes} feuille(s) déjà en base sur ces dates : CONSERVÉES telles quelles.`);
      console.log(`  ${feuilles.length - existantes} feuille(s) créée(s).`);
    } else {
      console.log(`  ${existantes} feuille(s) déjà en base sur ces dates : REMPLACÉES par le tableau.`);
      console.log(`  ${feuilles.length} feuille(s) écrites au total.`);
    }
    console.log(`  Pesées de chariots : ${nbPesees} ligne(s) (les pesées existantes de ces dates sont remplacées).`);

    if (!args.apply) {
      console.log('\nMODE SIMULATION (aucune écriture) — relancer avec --apply.');
      process.exitCode = 0;
      return;
    }

    await client.query('BEGIN');
    let ecrites = 0; let ignorees = 0; let chariots = 0;
    for (const f of feuilles) {
      if (args.completer) {
        const deja = await client.query('SELECT 1 FROM production_daily WHERE date = $1', [f.date]);
        if (deja.rowCount) { ignorees++; continue; }
      }
      // effectif_reel = tri + récupération (règle de la feuille, cf. Production.jsx) ;
      // le tableau ne connaît pas la récupération, l'effectif réel est donc celui du tri.
      const effectifReel = f.effectifTri;
      const totalAtelier = (f.ligneKg || 0) + (f.r3Kg || 0);
      await client.query(
        `INSERT INTO production_daily (
           date, encadrant_atelier, controleur_tri, signature_encadrant,
           effectif_tri, effectif_reel, effectif_cp, effectif_formation, effectif_abs_injustifiee,
           objectif_entree_ligne_kg, objectif_recyclage_pct, objectif_reutilisation_pct, objectif_csr_pct,
           entree_ligne_kg, entree_recyclage_r3_kg, total_jour_t, productivite_kg_per,
           consigne, commentaire,
           entree_recyclage_r4_kg, objectif_entree_r3_kg, objectif_entree_r4_kg
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                   NULL, NULL, NULL)
         ON CONFLICT (date) DO UPDATE SET
           encadrant_atelier=$2, controleur_tri=$3, signature_encadrant=$4,
           effectif_tri=$5, effectif_reel=$6, effectif_cp=$7, effectif_formation=$8,
           effectif_abs_injustifiee=$9,
           objectif_entree_ligne_kg=$10, objectif_recyclage_pct=$11,
           objectif_reutilisation_pct=$12, objectif_csr_pct=$13,
           entree_ligne_kg=$14, entree_recyclage_r3_kg=$15, total_jour_t=$16,
           productivite_kg_per=$17, consigne=$18, commentaire=$19,
           entree_recyclage_r4_kg=NULL, objectif_entree_r3_kg=NULL, objectif_entree_r4_kg=NULL,
           updated_at=NOW()`,
        [
          f.date, f.encadrant, f.controleur, f.signature,
          f.effectifTri, effectifReel, f.cp, f.formation, f.abs,
          f.objEntree, f.objRecyclage, f.objReutilisation, f.objCsr,
          f.ligneKg, f.r3Kg,
          f.totalKg === null ? null : f.totalKg / 1000,
          effectifReel > 0 && totalAtelier > 0 ? Math.round(totalAtelier / effectifReel) : null,
          f.consigne, f.commentaire,
        ]
      );
      ecrites++;

      await client.query('DELETE FROM production_chariots WHERE production_date = $1', [f.date]);
      for (const [pesees, ligneCode] of [[f.peseesLigne, 'r1r2'], [f.peseesR3, 'r3']]) {
        let numero = 1;
        for (const poids of pesees) {
          await client.query(
            `INSERT INTO production_chariots (production_date, ligne, numero, poids_kg)
             VALUES ($1, $2, $3, $4)`, [f.date, ligneCode, numero++, poids]
          );
          chariots++;
        }
      }
    }

    await client.query(
      `INSERT INTO rgpd_audit_log (user_id, action, entity_type, details)
       VALUES (NULL, 'PRODUCTION_REPRISE_IMPORT', 'production_daily', $1)`,
      [JSON.stringify({
        fichier: String(args.file).split('/').pop(),
        periode: [dates[0], dates[dates.length - 1]],
        feuilles_ecrites: ecrites, feuilles_ignorees: ignorees, chariots,
        ecarts_pesees: ecarts.length,
        mode: args.completer ? 'completer' : 'fichier_fait_foi',
        script: 'import-historique-production.js',
      })]
    ).catch((err) => console.warn(`  journal rgpd_audit_log ignoré : ${err.message}`));
    await client.query('COMMIT');

    console.log(`\nImport appliqué : ${ecrites} feuille(s) de production, ${chariots} pesée(s) de chariot.`);
    if (ignorees) console.log(`${ignorees} feuille(s) déjà saisie(s) conservée(s) (--completer).`);
    console.log('Consultable sur /production, en sélectionnant une date de la période.');
    process.exitCode = 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERREUR import historique de production :', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

module.exports = {
  parseArgs, parsePesees, parseObjectifPoids, parsePct, parseEntier,
  resumePostes, composerCommentaire, lireFeuilles, ecartsPesees, COL, POSTES,
};

if (require.main === module) {
  main();
}
