const express = require('express');
const { isoDate, aujourdhuiParis } = require('../utils/date-iso');
const router = express.Router();
const ExcelJS = require('exceljs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { neutraliserFormule, nomGenerateur, escCsv } = require('../utils/export-csv');
const { requireMfa } = require('../middleware/mfa');
const { query } = require('express-validator');
const { validate } = require('../middleware/validate');
const { monthBounds } = require('../utils/month-range');
const { freinColumns } = require('./insertion/freins-registry');
const { freinsExportColumns, rowToCells, computeCompletude } = require('../utils/insertion-freins-export');

// Double authentification (2.43.0) : pour les rôles soumis (settings
// « securite.mfa_roles », défaut ADMIN/RH/DPO), la session doit avoir
// franchi le défi TOTP. No-op intégral pour les autres rôles.
router.use(authenticate, requireMfa, authorize('ADMIN', 'RH'));

// GET /api/exports/collecte — Export Excel collecte
router.get('/collecte', async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    const result = await pool.query(`
      SELECT t.date, v.registration, e.first_name || ' ' || e.last_name as chauffeur,
       t.total_weight_kg, t.mode, t.status,
       (SELECT COUNT(*) FROM tour_cav tc WHERE tc.tour_id = t.id) as nb_cav
      FROM tours t
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN employees e ON t.driver_employee_id = e.id
      WHERE t.date BETWEEN $1 AND $2
      ORDER BY t.date
    `, [date_from || '2020-01-01', date_to || '2030-12-31']);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Collecte');
    sheet.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Véhicule', key: 'registration', width: 12 },
      { header: 'Chauffeur', key: 'chauffeur', width: 25 },
      { header: 'Poids (kg)', key: 'total_weight_kg', width: 12 },
      { header: 'Mode', key: 'mode', width: 12 },
      { header: 'Statut', key: 'status', width: 12 },
      { header: 'Nb CAV', key: 'nb_cav', width: 8 },
    ];
    sheet.addRows(result.rows);

    // Style header
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8BC540' } };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=collecte_${date_from}_${date_to}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[EXPORTS] Erreur export collecte :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/exports/production — Export Excel production
router.get('/production', async (req, res) => {
  try {
    // Mois civil de PARIS par défaut (et non le mois UTC) : un export tiré le
    // 1er janvier à 00 h 30 sortait sinon le mois de décembre. Dernière
    // occurrence de cette conversion dans `exports.js`.
    const month = req.query.month || aujourdhuiParis().slice(0, 7);
    const result = await pool.query(
      'SELECT * FROM production_daily WHERE date BETWEEN $1 AND $2 ORDER BY date',
      monthBounds(month)
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Production');
    sheet.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Effectif Réel', key: 'effectif_reel', width: 14 },
      { header: 'Entrée Ligne (kg)', key: 'entree_ligne_kg', width: 16 },
      { header: 'Obj. Ligne', key: 'objectif_entree_ligne_kg', width: 12 },
      { header: 'Entrée R3 (kg)', key: 'entree_recyclage_r3_kg', width: 16 },
      { header: 'Obj. R3', key: 'objectif_entree_r3_kg', width: 12 },
      { header: 'Total (t)', key: 'total_jour_t', width: 10 },
      { header: 'Productivité', key: 'productivite_kg_per', width: 14 },
      { header: 'Encadrant', key: 'encadrant', width: 20 },
    ];
    sheet.addRows(result.rows);
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8BC540' } };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=production_${month}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[EXPORTS] Erreur export production :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Route /api/exports/invoice/:id (export PDF facture interne) retirée —
// arbitrage A2 audit 2026-07 : la facturation interne n'est plus exposée par l'UI.
// Tables invoices/invoice_lines conservées ; réactivable si le module billing revient.

// GET /api/exports/cav — Export Excel des CAV avec tonnages mensuels (format CAV 20XX.xlsx)
router.get('/cav', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const cavs = await pool.query(`
      SELECT c.*,
        (SELECT json_agg(json_build_object('month', EXTRACT(MONTH FROM th.date)::int, 'weight', SUM(th.weight_kg)))
         FROM tonnage_history th
         WHERE th.cav_id = c.id AND EXTRACT(YEAR FROM th.date) = $1
         GROUP BY EXTRACT(MONTH FROM th.date)
        ) as monthly_tonnage
      FROM cav c ORDER BY c.name
    `, [year]);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(`CAV ${year}`);

    // En-tête principale
    sheet.mergeCells('A1:L1');
    sheet.getCell('A1').value = `Solidarité Textiles - Compte rendu CAV ${year}`;
    sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1A202C' } };

    // Sous-en-tête avec mois
    const months = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

    // Headers
    const headerRow = sheet.getRow(3);
    const headers = ['PAV', 'Nb CAV', 'Adresse', 'Commune', 'Latitude', 'Longitude', 'Statut'];
    months.forEach(m => headers.push(`${m} (kg)`));
    headers.push('Total (kg)');

    headerRow.values = headers;
    headerRow.font = { bold: true, size: 10 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8BC540' } };

    sheet.getColumn(1).width = 45;
    sheet.getColumn(2).width = 8;
    sheet.getColumn(3).width = 35;
    sheet.getColumn(4).width = 20;
    for (let i = 8; i <= 20; i++) sheet.getColumn(i).width = 12;

    // Données
    for (const cav of cavs.rows) {
      const monthlyData = {};
      if (cav.monthly_tonnage) {
        for (const entry of cav.monthly_tonnage) {
          monthlyData[entry.month] = parseFloat(entry.weight) || 0;
        }
      }

      const rowData = [
        cav.name,
        cav.nb_containers,
        cav.address,
        cav.commune,
        cav.latitude,
        cav.longitude,
        cav.status,
      ];
      let total = 0;
      for (let m = 1; m <= 12; m++) {
        const val = monthlyData[m] || 0;
        rowData.push(Math.round(val));
        total += val;
      }
      rowData.push(Math.round(total));
      sheet.addRow(rowData);
    }

    // Ligne totaux
    const totalRow = sheet.addRow([]);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.font = { bold: true };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=CAV_${year}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[EXPORTS] Erreur export CAV :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/exports/tonnages — Export Excel détaillé des pesées (format Collect 20XX.xlsx)
router.get('/tonnages', async (req, res) => {
  try {
    const { year } = req.query;
    const yearFilter = year ? `AND EXTRACT(YEAR FROM th.date) = ${parseInt(year)}` : '';

    const result = await pool.query(`
      SELECT th.id, th.date, th.weight_kg, th.route_name, th.source,
             c.name as cav_name, c.commune,
             EXTRACT(MONTH FROM th.date)::int as mois,
             CASE WHEN EXTRACT(MONTH FROM th.date) <= 3 THEN 'T1'
                  WHEN EXTRACT(MONTH FROM th.date) <= 6 THEN 'T2'
                  WHEN EXTRACT(MONTH FROM th.date) <= 9 THEN 'T3'
                  ELSE 'T4' END as trimestre,
             EXTRACT(YEAR FROM th.date)::int as annee
      FROM tonnage_history th
      LEFT JOIN cav c ON th.cav_id = c.id
      WHERE 1=1 ${yearFilter}
      ORDER BY th.date, th.id
    `);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Tonnages');

    sheet.mergeCells('A1:F1');
    sheet.getCell('A1').value = `Saisies tonnages${year ? ` — ${year}` : ''}`;
    sheet.getCell('A1').font = { bold: true, size: 14 };

    sheet.getRow(3).values = ['ID', 'Origine', 'Catégorie', 'Poids net (kg)', 'Date', 'CAV', 'Commune', 'Mois', 'Trimestre', 'Année'];
    sheet.getRow(3).font = { bold: true };
    sheet.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8BC540' } };

    sheet.getColumn(1).width = 8;
    sheet.getColumn(2).width = 16;
    sheet.getColumn(3).width = 30;
    sheet.getColumn(4).width = 14;
    sheet.getColumn(5).width = 12;
    sheet.getColumn(6).width = 35;

    for (const row of result.rows) {
      sheet.addRow([
        row.id,
        'Collecte de CAV',
        row.route_name || row.cav_name,
        row.weight_kg,
        row.date,
        row.cav_name,
        row.commune,
        row.mois,
        row.trimestre,
        row.annee,
      ]);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Collect_${year || 'all'}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[EXPORTS] Erreur export tonnages :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/exports/kpi-production — Export KPI production (format KPI_Production 20XX.xlsx)
router.get('/kpi-production', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const result = await pool.query(
      'SELECT * FROM production_daily WHERE EXTRACT(YEAR FROM date) = $1 ORDER BY date',
      [year]
    );

    const workbook = new ExcelJS.Workbook();

    // Feuille annuelle
    const annualSheet = workbook.addWorksheet(`Production Annuel ${year}`);
    annualSheet.getRow(1).values = ['', 'Total entrée ligne (kg)', 'Total entrée recyclage N°3 (kg)', 'TOTAL (t)', 'Objectif mois (t)', 'Diff'];
    annualSheet.getRow(1).font = { bold: true };

    const months = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
    for (let m = 0; m < 12; m++) {
      const monthData = result.rows.filter(r => new Date(r.date).getMonth() === m);
      const totalLigne = monthData.reduce((s, r) => s + (parseFloat(r.entree_ligne_kg) || 0), 0);
      const totalR3 = monthData.reduce((s, r) => s + (parseFloat(r.entree_recyclage_r3_kg) || 0), 0);
      const totalT = (totalLigne + totalR3) / 1000;
      annualSheet.addRow([months[m], Math.round(totalLigne), Math.round(totalR3), Math.round(totalT * 1000) / 1000]);
    }

    // Feuilles mensuelles
    for (let m = 0; m < 12; m++) {
      const monthData = result.rows.filter(r => new Date(r.date).getMonth() === m);
      if (monthData.length === 0) continue;

      const monthSheet = workbook.addWorksheet(`${months[m]} ${year}`);
      monthSheet.getRow(1).values = ['Date', 'Eff. Théo.', 'Eff. Réel', 'Entrée ligne (kg)', 'Obj. ligne', 'Entrée R3 (kg)', 'Obj. R3', 'Total (t)', 'Productivité', 'Commentaire'];
      monthSheet.getRow(1).font = { bold: true };
      monthSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8BC540' } };

      for (const day of monthData) {
        monthSheet.addRow([
          day.date, day.effectif_theorique, day.effectif_reel,
          day.entree_ligne_kg, day.objectif_entree_ligne_kg,
          day.entree_recyclage_r3_kg, day.objectif_entree_r3_kg,
          day.total_jour_t, day.productivite_kg_per,
          day.commentaire,
        ]);
      }
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=KPI_Production_${year}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[EXPORTS] Erreur export KPI :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/exports/stock — Export mouvements de stock (format Mvmt Invent 20XX.xlsx)
router.get('/stock', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const result = await pool.query(`
      SELECT * FROM stock_movements
      WHERE EXTRACT(YEAR FROM date) = $1
      ORDER BY date, id
    `, [year]);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Mouvements');
    sheet.getRow(1).values = ['ID', 'Type', 'Date', 'Poids (kg)', 'Origine', 'Catégorie', 'Destination', 'Notes'];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8BC540' } };

    for (const row of result.rows) {
      sheet.addRow([row.id, row.type, row.date, row.poids_kg, row.origine, row.categorie_collecte, row.destination, row.notes]);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Mvmt_Invent_${year}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[EXPORTS] Erreur export stock :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// Export FSE+ — DÉPLACÉ (PR A, lot 2)
//
// L'ancienne route `GET /fse-plus` vivait ici. Elle sortait TOUJOURS des
// heures à 0 (elle sommait `EXTRACT(EPOCH FROM (end_time - start_time))` sur
// `work_hours`, table qui ne porte pas ces colonnes — l'erreur SQL était
// avalée par un `.catch(() => ({ rows: [] }))`, donc l'export sortait vide
// sans que rien ne le dise), livrait les questionnaires FSE+ en JSON brut dans
// deux colonnes, et n'était pas journalisée alors qu'elle est intégralement
// nominative.
//
// Elle est remplacée par `routes/exports-fse.js`, monté sur /api/exports AVANT
// ce routeur (une colonne par item, en français, 409 si aucune ligne, journal
// `EXPORT_FSE_PLUS` avant envoi). Elle n'est PAS réécrite ici : deux routes du
// même chemin dans deux fichiers, c'est la porte ouverte à ce que la version
// réparée soit masquée par l'ancienne au premier changement d'ordre de montage.
// ══════════════════════════════════════════

// ══════════════════════════════════════════
// Export COMPLET du module Insertion (EXG-43 — PR A lot 0)
//
// Parcours salariés, diagnostics CIP, jalons et plans d'action, en Excel
// multi-feuilles ou en CSV (un jeu de données par fichier — le CSV est
// mono-table). Données personnelles sensibles (freins santé, judiciaire) →
// ADMIN/RH, le routeur autorisant plus large.
//
// Trois règles posées par la PR A, communes à tous les exports nominatifs :
//  1. JOURNAL AVANT ENVOI — chaque génération écrit `EXPORT_INSERTION_COMPLET`
//     dans `rgpd_audit_log` ; un échec de journalisation fait échouer l'export
//     (jamais de fichier nominatif non tracé). La promesse figurait dans la
//     note aux certificateurs depuis un an sans être tenue ici.
//  2. EN-TÊTE DE TRAÇABILITÉ — date et heure de génération, générateur,
//     périmètre, nombre de lignes. Un classeur qui circule doit dire d'où il
//     vient : sans cela, un chiffre lu six mois plus tard n'est rattachable ni
//     à une date ni à une personne.
//  3. JAMAIS DE FICHIER VIDE — 0 ligne → 409 `EXPORT_VIDE` motivé. Un fichier
//     vide se lit « il n'y a personne », alors qu'il signale presque toujours
//     un filtre trop étroit ou une base non peuplée.
//
// Le `soft()` d'origine (chaque requête enveloppée d'un catch qui rendait une
// liste vide) est retiré : il transformait une erreur SQL en feuille vide, donc
// en « aucun diagnostic » indiscernable de « diagnostics non saisis ». Une
// requête en échec rend désormais un 500 qui NOMME le jeu de données fautif.
// ══════════════════════════════════════════

// Journal RGPD de l'export complet (EXG-43) — même format d'entrée que
// routes/rgpd.js et que logExportFreins ci-dessous. `details` porte le
// périmètre du tirage, JAMAIS une donnée nominative.
async function logExportInsertionComplet(req, { format, dataset, lignes }) {
  await pool.query(
    'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
    [req.user.id, 'EXPORT_INSERTION_COMPLET', 'insertion', null,
      JSON.stringify({ format, dataset, lignes, requested_by: req.user.id })]
  );
}

/** Nom lisible du générateur pour l'en-tête de traçabilité (jamais son e-mail). */
// `nomGenerateur` vit dans utils/export-csv.js : les DEUX exports transmis
// hors de la structure doivent composer leur en-tête de la même façon.

router.get('/insertion', authorize('ADMIN', 'RH'), async (req, res) => {
  // Normalise une valeur de cellule (dates ISO, tableaux/JSON en texte).
  const fmtCell = (v) => {
    if (v === null || v === undefined) return '';
    // Famille D-05 : `toISOString()` sur une colonne DATE rend la veille sous
    // tout fuseau positif. Le helper partagé lit les composantes locales.
    if (v instanceof Date) return isoDate(v);
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  };

  // Neutralisation de formule : règle partagée avec l'export FSE+ (M-04), voir
  // utils/export-csv.js — un tableur évalue toute cellule commençant par
  // « = », « + », « - », « @ », TAB ou CR, guillemets compris.

  // Exécute une requête en NOMMANT le jeu de données en cas d'échec : le 500
  // rendu à l'écran doit dire lequel a échoué, faute de quoi on retombe sur le
  // défaut que ce lot corrige (une erreur SQL indiscernable d'une absence).
  const lire = async (label, text, params = []) => {
    try { return (await pool.query(text, params)).rows; }
    catch (err) {
      err.datasetLabel = label;
      throw err;
    }
  };

  // Ajoute une feuille à colonnes DYNAMIQUES (toutes les colonnes présentes),
  // en plaçant matricule/nom/prénom en tête. Résilient au schéma variable.
  const addDataSheet = (workbook, name, rows, leadKeys = []) => {
    const sheet = workbook.addWorksheet(name);
    if (!rows.length) { sheet.addRow(['(aucune donnée)']); return; }
    const allKeys = Object.keys(rows[0]);
    const ordered = [
      ...leadKeys.filter((k) => allKeys.includes(k)),
      ...allKeys.filter((k) => !leadKeys.includes(k)),
    ];
    sheet.columns = ordered.map((k) => ({ header: k, key: k, width: Math.min(Math.max(k.length + 2, 12), 42) }));
    for (const r of rows) {
      const o = {};
      // ExcelJS écrit une chaîne commençant par « = » comme une FORMULE quand
      // la cellule est typée automatiquement : le classeur est exposé au même
      // défaut que le CSV, et il est justement le format par défaut de cet
      // export. Même neutralisation.
      for (const k of ordered) o[k] = neutraliserFormule(r[k], fmtCell(r[k]));
      sheet.addRow(o);
    }
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8BC540' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  };

  // Sérialise un jeu de lignes en CSV point-virgule + BOM (ouverture directe
  // dans Excel FR), colonnes matricule/nom/prénom en tête, valeurs échappées,
  // précédé des lignes « # » de traçabilité (règle 2 de l'en-tête).
  const toCsv = (rows, leadKeys = [], meta = []) => {
    // Garde-fou local rétabli (constat m-09) : sans elle, `Object.keys(rows[0])`
    // lève un TypeError sur un jeu vide. Les deux appelants sont gardés par un
    // 409 en amont — la fonction, elle, ne doit pas dépendre de ses appelants.
    if (!Array.isArray(rows) || rows.length === 0) {
      const e = new Error('Aucune donnée à exporter');
      e.code = 'EXPORT_VIDE';
      throw e;
    }
    const entete = meta.map((l) => `# ${l}`).join('\n') + (meta.length ? '\n\n' : '');
    const allKeys = Object.keys(rows[0]);
    const cols = [
      ...leadKeys.filter((k) => allKeys.includes(k)),
      ...allKeys.filter((k) => !leadKeys.includes(k)),
    ];
    const esc = (v) => {
      const s = neutraliserFormule(v, String(fmtCell(v)));
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = rows.map((r) => cols.map((k) => esc(r[k])).join(';'));
    return '﻿' + entete + cols.join(';') + '\n' + lines.join('\n') + '\n';
  };

  try {
    // 1) Salariés en insertion (vue synthèse curée) — les 9 freins du registre
    // unique (feuille Salariés : colonnes frein_mobilite … frein_judiciaire).
    const salaries = await lire('Salariés', `
      SELECT e.malibou_id AS matricule, e.last_name AS nom, e.first_name AS prenom,
             e.position AS poste, t.name AS equipe,
             e.insertion_status AS statut,
             e.insertion_start_date AS debut_parcours,
             COALESCE(e.insertion_end_date, e.contract_end) AS fin_prevue,
             e.prescripteur, po.nom AS prescripteur_orga, po.type AS prescripteur_type,
             e.pass_iae_number, e.pass_iae_end,
             e.visite_medicale_date,
             ${freinColumns('d.').join(', ')},
             (SELECT COUNT(*) FROM insertion_milestones m WHERE m.employee_id = e.id) AS nb_jalons,
             (SELECT COUNT(*) FROM insertion_milestones m WHERE m.employee_id = e.id AND m.status = 'realise') AS jalons_realises
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      LEFT JOIN insertion_diagnostics d ON d.employee_id = e.id AND COALESCE(d.parcours_num, 1) = COALESCE(e.parcours_num, 1)
      LEFT JOIN prescripteur_orgas po ON po.id = e.prescripteur_id
      WHERE e.insertion_status IS DISTINCT FROM 'none'
         OR d.employee_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM insertion_milestones m WHERE m.employee_id = e.id)
      ORDER BY e.last_name, e.first_name
    `);

    // 2) Diagnostics CIP — toutes les colonnes. Les champs sensibles chiffrés
    // (santé / judiciaire, utils/field-crypto) sont DÉCHIFFRÉS : cet export est
    // réservé ADMIN/RH (diffusion restreinte, mention RGPD en feuille 1).
    const { SENSITIVE_DIAG_FIELDS, decryptField } = require('../utils/field-crypto');
    const diagnostics = await lire('Diagnostics CIP', `
      SELECT e.malibou_id AS matricule, e.last_name AS nom, e.first_name AS prenom, d.*
      FROM insertion_diagnostics d
      JOIN employees e ON e.id = d.employee_id
      ORDER BY e.last_name, e.first_name
    `);
    for (const row of diagnostics) {
      for (const f of SENSITIVE_DIAG_FIELDS) {
        if (row[f] !== undefined) row[f] = decryptField(row[f]);
      }
    }

    // 3) Jalons — toutes les colonnes.
    const jalons = await lire('Jalons', `
      SELECT e.malibou_id AS matricule, e.last_name AS nom, e.first_name AS prenom, m.*
      FROM insertion_milestones m
      JOIN employees e ON e.id = m.employee_id
      ORDER BY e.last_name, e.first_name, m.due_date
    `);

    // 4) Plans d'action CIP — toutes les colonnes.
    const actions = await lire("Plans d'action", `
      SELECT e.malibou_id AS matricule, e.last_name AS nom, e.first_name AS prenom, a.*
      FROM cip_action_plans a
      JOIN employees e ON e.id = a.employee_id
      ORDER BY e.last_name, e.first_name
    `);

    const genere = new Date();
    // Jour civil de PARIS (et non le jour UTC) : un export tiré le 1er janvier
    // à 00 h 30 porterait sinon la date du 31 décembre dans son nom de fichier.
    const stamp = aujourdhuiParis();
    const horodatage = genere.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
    const lead = ['matricule', 'nom', 'prenom'];
    const format = (req.query.format || 'xlsx').toLowerCase() === 'csv' ? 'csv' : 'xlsx';
    const PERIMETRE = "Salariés en parcours d'insertion, ou porteurs d'un diagnostic ou d'un entretien (tous parcours, toutes années).";

    // ─── Règle 3 : jamais de fichier vide ───
    // Le périmètre de l'export est la population d'insertion : sans elle, il
    // n'y a rien à exporter, quel que soit le format demandé.
    if (!salaries.length) {
      return res.status(409).json({
        error: "Aucun salarié en parcours d'insertion à exporter.",
        code: 'EXPORT_VIDE',
        hint: "Vérifiez qu'au moins un collaborateur porte un statut d'insertion, un diagnostic ou un entretien avant de générer l'export.",
      });
    }

    // ─── Format CSV (une entité par fichier ; CSV est mono-table) ───
    if (format === 'csv') {
      const datasets = { salaries, diagnostics, jalons, actions, plans: actions };
      const libelles = {
        salaries: 'Salariés', diagnostics: 'Diagnostics CIP', jalons: 'Jalons',
        actions: "Plans d'action", plans: "Plans d'action",
      };
      const demande = (req.query.dataset || 'salaries').toLowerCase();
      const dataset = datasets[demande] ? demande : 'salaries';
      const rows = datasets[dataset];

      // Un jeu de données demandé mais vide est refusé pour la même raison que
      // ci-dessus : un CSV à en-tête seul se lit « aucun entretien saisi ».
      if (!rows.length) {
        return res.status(409).json({
          error: `Aucune ligne à exporter pour « ${libelles[dataset]} ».`,
          code: 'EXPORT_VIDE',
          hint: "Choisissez un autre jeu de données ou vérifiez la saisie du module Insertion.",
        });
      }

      // Règle 1 : journal AVANT envoi — un échec ici fait échouer l'export.
      await logExportInsertionComplet(req, { format: 'csv', dataset, lignes: rows.length });

      const meta = [
        "Export SOLIDATA — module Insertion (extraction complète)",
        `Jeu de données : ${libelles[dataset]}`,
        `Généré le : ${horodatage} (heure de Paris)`,
        `Générateur : ${nomGenerateur(req.user)}`,
        `Périmètre : ${PERIMETRE}`,
        `Lignes : ${rows.length}`,
        "Confidentialité : données personnelles sensibles (freins santé / judiciaire). Diffusion restreinte — RGPD, conservation limitée. Chaque génération est journalisée.",
      ];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=insertion_${dataset}_${stamp}.csv`);
      return res.send(toCsv(rows, lead, meta));
    }

    // ─── Format Excel (défaut) : classeur multi-feuilles ───
    // Règle 1 : journal AVANT toute composition de fichier.
    const totalLignes = salaries.length + diagnostics.length + jalons.length + actions.length;
    await logExportInsertionComplet(req, { format: 'xlsx', dataset: 'tout', lignes: totalLignes });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SOLIDATA';

    // Règle 2 : feuille de traçabilité (première feuille du classeur).
    const info = workbook.addWorksheet('Informations');
    info.columns = [{ header: 'Champ', key: 'k', width: 26 }, { header: 'Valeur', key: 'v', width: 80 }];
    info.addRows([
      { k: 'Export', v: "Données d'insertion — extraction complète" },
      { k: 'Généré le', v: `${horodatage} (heure de Paris)` },
      { k: 'Générateur', v: nomGenerateur(req.user) },
      { k: 'Périmètre', v: PERIMETRE },
      { k: 'Lignes (total)', v: totalLignes },
      { k: 'Salariés (insertion)', v: salaries.length },
      { k: 'Diagnostics CIP', v: diagnostics.length },
      { k: 'Jalons', v: jalons.length },
      { k: "Plans d'action", v: actions.length },
      { k: 'Confidentialité', v: 'Données personnelles sensibles (freins santé / judiciaire). Diffusion restreinte — RGPD, durée de conservation limitée.' },
      { k: 'Traçabilité', v: "Chaque génération de cet export est inscrite au journal d'audit RGPD (qui, quand, combien de lignes — jamais le contenu)." },
    ]);
    info.getRow(1).font = { bold: true };
    info.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8BC540' } };

    addDataSheet(workbook, 'Salariés', salaries, lead);
    addDataSheet(workbook, 'Diagnostics CIP', diagnostics, lead);
    addDataSheet(workbook, 'Jalons', jalons, lead);
    addDataSheet(workbook, "Plans d'action", actions, lead);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=insertion_complet_${stamp}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    // Le jeu de données fautif est NOMMÉ : sans lui, l'écran affiche « erreur
    // serveur » là où l'administrateur a besoin de savoir quelle requête a
    // échoué (typiquement une colonne absente sur une base non migrée).
    const ou = err.datasetLabel ? ` (jeu de données « ${err.datasetLabel} »)` : '';
    console.error(`[EXPORTS] Erreur export insertion${ou} :`, err);
    if (res.headersSent) return res.end();
    if (err.code === 'EXPORT_VIDE') {
      return res.status(409).json({ error: 'Aucune donnée à exporter sur ce périmètre.', code: 'EXPORT_VIDE' });
    }
    // `detail: err.message` retiré (constat m-03) : c'était le message SQL brut
    // rendu au client. Le jeu de données fautif et le SQLSTATE suffisent à
    // rendre l'erreur diagnosticable ; la trace complète reste au journal
    // serveur, juste au-dessus.
    res.status(500).json({ error: `Erreur lors de la génération de l'export${ou}`, code: err.code });
  }
});

// ══════════════════════════════════════════
// PR 2 — Export « tableau des freins » 23 colonnes (EXG-25/38/43)
//
// Reproduit colonne à colonne le tableau du CDC (rapport 01 §5, ordre STRICT ;
// arbitrage NOM/Prénom en 2 colonnes). Règle de valorisation des freins :
// DERNIÈRE évaluation en date — dernier entretien réalisé du parcours courant
// portant au moins un frein non nul (LATERAL), repli axe par axe sur le
// diagnostic d'accueil (COALESCE par colonne, même règle que /insertion/audit).
//
// RGPD : identité + santé (RQTH) + judiciaire (variante) → ADMIN/RH uniquement,
// CHAQUE génération journalisée dans rgpd_audit_log AVANT l'envoi du fichier
// (le journal qui échoue fait échouer l'export : pas d'export non tracé).
// `sensibles=0` (défaut) : SANS la colonne « Frein judiciaire » (art. 10,
// EXG-38) — la colonne n'est alors même pas lue en SQL (defense in depth).
// ══════════════════════════════════════════

const FREINS_STATUTS = ['all', 'en_parcours', 'sortis'];

/**
 * Périmètre EN TOUTES LETTRES pour l'en-tête de traçabilité — l'autorité exige
 * « les filtres appliqués en toutes lettres », pas `statut=all` : un code
 * technique dans un en-tête de fichier de contrôle n'est pas un périmètre.
 */
const PERIMETRES_FREINS = {
  all: "Toute personne passée en parcours d'insertion (en parcours ou sortie)",
  en_parcours: "Personnes actuellement en parcours d'insertion",
  sortis: "Personnes dont le parcours d'insertion est terminé ou abandonné",
};

/** Version de l'outil portée par l'en-tête (même source que les exports FSE+). */
const APP_VERSION_EXPORTS = process.env.APP_VERSION || require('../../package.json').version;

const freinsFilterValidators = [
  query('sensibles').optional().isIn(['0', '1']).withMessage('sensibles invalide (0 ou 1)'),
  query('annee').optional().isInt({ min: 2000, max: 2100 }).withMessage('annee invalide'),
  query('statut').optional().isIn(FREINS_STATUTS).withMessage(`statut invalide (${FREINS_STATUTS.join(', ')})`),
  query('cip').optional().isInt().withMessage('cip invalide (id utilisateur)'),
];

function parseFreinsFilters(req) {
  return {
    sensibles: req.query.sensibles === '1',
    statut: FREINS_STATUTS.includes(req.query.statut) ? req.query.statut : 'all',
    annee: req.query.annee ? parseInt(req.query.annee, 10) : null,
    cip: req.query.cip ? parseInt(req.query.cip, 10) : null,
  };
}

/**
 * Population + valorisation des 23 colonnes. Filtres :
 *  - statut=en_parcours → salariés en parcours ;
 *  - statut=sortis      → parcours terminés/abandonnés (annee → fin de parcours
 *    dans l'année) ;
 *  - statut=all (défaut) → toute personne passée en parcours (annee → en
 *    parcours OU sortie dans l'année) ;
 *  - cip → CIP référent.
 * Les axes de freins lus en SQL excluent le judiciaire quand sensibles=0.
 */
async function fetchFreinsRows({ statut = 'all', annee = null, cip = null, sensibles = false }) {
  const axes = sensibles ? freinColumns() : freinColumns().filter((c) => c !== 'frein_judiciaire');
  const lmCols = axes.map((c) => `im.${c}`).join(', ');
  const coalesced = axes.map((c) => `COALESCE(lm.${c}, d.${c}) AS ${c}`).join(', ');
  // CORRECTIF D-02 — la dernière évaluation BRUTE, à côté de la valeur repliée.
  // La colonne « évolution » comparait jusqu'ici l'entrée à `COALESCE(lm, d)`,
  // c'est-à-dire le diagnostic à lui-même quand aucun entretien n'a été réalisé :
  // elle rendait toujours « stable ». La valeur COURANTE (colonnes 14-20) reste
  // repliée, comme le CDC le demande ; seule l'évolution change de source.
  const actuels = axes.map((c) => `lm.${c} AS ${c}_actuel`).join(', ');

  const params = [];
  const where = [
    `(e.insertion_status IS DISTINCT FROM 'none'
       OR EXISTS (SELECT 1 FROM insertion_milestones mx WHERE mx.employee_id = e.id))`,
  ];
  if (statut === 'en_parcours') {
    where.push(`e.insertion_status = 'en_parcours'`);
  } else if (statut === 'sortis') {
    where.push(`e.insertion_status IN ('termine', 'abandon')`);
    if (annee) { params.push(annee); where.push(`EXTRACT(YEAR FROM e.insertion_end_date) = $${params.length}`); }
  } else if (annee) {
    params.push(annee);
    where.push(`(e.insertion_status = 'en_parcours' OR EXTRACT(YEAR FROM e.insertion_end_date) = $${params.length})`);
  }
  if (cip) { params.push(cip); where.push(`e.cip_referent_user_id = $${params.length}`); }

  // Valeurs d'ENTRÉE (diagnostic d'accueil) rendues À CÔTÉ des valeurs courantes
  // — c'est la comparaison des deux qui produit la colonne « évolution »
  // (PR D, export (d)). Le judiciaire suit `axes` : quand `sensibles=0`, ni sa
  // valeur courante ni sa valeur d'entrée ne sont lues en SQL.
  const entrees = axes.map((c) => `d.${c} AS ${c}_entree`).join(', ');

  const { rows } = await pool.query(`
    SELECT e.id, e.last_name, e.first_name, e.nationality, e.gender, e.birth_date,
           e.city, e.qualification, e.disability_status, e.pass_iae_end,
           COALESCE(prem.premier_cddi, e.insertion_start_date, e.contract_start) AS date_entree_aci,
           COALESCE(cc.weekly_hours, e.weekly_hours) AS heures_semaine,
           d.rqth, d.niveau_formation, d.ressources, d.logement_statut,
           d.situation_familiale, d.projet_formation, d.emploi_vise, d.emploi_vise_rome,
           ${coalesced},
           ${entrees},
           ${actuels},
           e.brsa, e.brsa_date_constat, e.ft_categorie, e.pass_iae_statut,
           e.referent_unique_type, e.referent_unique_nom, e.eligibilite_source,
           elig.criteres_eligibilite, proj.projets_cofinances,
           pm.nb_pmsmp, pm.derniere_pmsmp
    FROM employees e
    LEFT JOIN LATERAL (
      -- Critères d'éligibilité IAE : les critères marqués art. 10
      -- (« sortant de détention ») ne sont PAS LUS, quelle que soit la variante
      -- — le drapeau vit dans le référentiel, pas dans une liste recopiée ici.
      SELECT ARRAY_AGG(c.libelle ORDER BY c.ordre, c.code) AS criteres_eligibilite
      FROM employee_eligibilite ee
      JOIN insertion_eligibilite_criteres c ON c.code = ee.critere_code
      WHERE ee.employee_id = e.id AND COALESCE(c.sensible_art10, false) = false
    ) elig ON true
    LEFT JOIN LATERAL (
      SELECT ARRAY_AGG(DISTINCT pr.code) AS projets_cofinances
      FROM insertion_projet_participants pp
      JOIN insertion_projets pr ON pr.id = pp.projet_id
      WHERE pp.employee_id = e.id
    ) proj ON true
    LEFT JOIN LATERAL (
      SELECT MIN(ec.start_date) AS premier_cddi
      FROM employee_contracts ec
      WHERE ec.employee_id = e.id AND UPPER(ec.contract_type) = 'CDDI'
    ) prem ON true
    LEFT JOIN LATERAL (
      SELECT ec.weekly_hours FROM employee_contracts ec
      WHERE ec.employee_id = e.id AND ec.is_current = true
      ORDER BY ec.start_date DESC LIMIT 1
    ) cc ON true
    LEFT JOIN insertion_diagnostics d ON d.employee_id = e.id
      AND COALESCE(d.parcours_num, 1) = COALESCE(e.parcours_num, 1)
    LEFT JOIN LATERAL (
      SELECT ${lmCols}
      FROM insertion_milestones im
      WHERE im.employee_id = e.id
        AND COALESCE(im.parcours_num, 1) = COALESCE(e.parcours_num, 1)
        AND im.status = 'realise'
        AND COALESCE(${lmCols}) IS NOT NULL
      ORDER BY COALESCE(im.completed_date, im.due_date) DESC, im.id DESC
      LIMIT 1
    ) lm ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS nb_pmsmp, MAX(p.date_fin) AS derniere_pmsmp
      FROM insertion_pmsmp p WHERE p.employee_id = e.id
    ) pm ON true
    WHERE ${where.join('\n      AND ')}
    ORDER BY e.last_name, e.first_name
  `, params);

  // Semaines sous le plancher d'activité — l'indicateur que l'autorité a EXIGÉ
  // à la place de la moyenne d'heures (A4). Calculé par le moteur PARTAGÉ, en
  // UNE passe pour toute la cohorte (8 requêtes au total, quelle que soit sa
  // taille) et non salarié par salarié. Une source absente laisse la colonne
  // VIDE — jamais 0, qui se lirait « aucune semaine sous le plancher ».
  try {
    const an = annee || new Date().getFullYear();
    const { activiteHebdoCohorte } = require('../services/activite-hebdo');
    const m = await activiteHebdoCohorte({ employeeIds: rows.map((r) => r.id), annee: an });
    for (const r of rows) {
      const v = m.get(Number(r.id));
      r.semaines_sous_seuil = v && v.nb_semaines_sous_seuil != null ? v.nb_semaines_sous_seuil : null;
      // CORRECTIF D-03 — le nombre de semaines RELEVÉES accompagne le compte :
      // sans lui, « aucune semaine relevée » et « aucune semaine sous le
      // plancher » s'écrivent tous deux « 0 » dans la colonne d'un document de
      // contrôle, et disent le contraire l'un de l'autre.
      r.semaines_relevees = v && v.nb_semaines_relevees != null ? v.nb_semaines_relevees : null;
    }
  } catch (err) {
    console.error('[EXPORTS] « semaines sous seuil » ignorées :', err.message);
  }
  return rows;
}

// Journal RGPD (EXG-43) — même format d'entrée que routes/rgpd.js. La variante
// sensible (frein judiciaire inclus) est journalisée sous une action DISTINCTE.
async function logExportFreins(req, { format, sensibles, statut, annee, cip, lignes }) {
  await pool.query(
    'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
    [req.user.id,
      // Code DISTINCT pour la variante enrichie du cadre 2026 : elle emporte des
      // colonnes que l'export historique ne portait pas (BRSA, catégorie France
      // Travail, référent unique, projet cofinancé). Un journal qui les
      // confondrait ne permettrait plus de savoir CE QUI est sorti.
      sensibles ? 'EXPORT_INSERTION_FREINS_SENSIBLE' : 'EXPORT_INSERTION_FREINS_ENRICHI',
      'insertion_freins', null,
      JSON.stringify({ format, sensibles, statut, annee, cip, lignes, requested_by: req.user.id })]
  );
}

// GET /api/exports/insertion-freins?format=xlsx|csv&sensibles=0|1&annee=&statut=&cip=
router.get('/insertion-freins', authorize('ADMIN', 'RH'), [
  query('format').optional().isIn(['xlsx', 'csv']).withMessage('format invalide (xlsx ou csv)'),
  ...freinsFilterValidators,
], validate, async (req, res) => {
  try {
    const format = (req.query.format || 'xlsx').toLowerCase();
    const filtres = parseFreinsFilters(req);
    const rows = await fetchFreinsRows(filtres);
    const cols = freinsExportColumns(filtres.sensibles);
    const cellRows = rows.map((r) => rowToCells(r, filtres.sensibles));

    // Règle commune des exports (09 § 2) : zéro ligne → REFUS motivé, jamais un
    // fichier vide. Un fichier vide classé dans un dossier se lit « aucune
    // personne accompagnée », ce qui serait faux — c'est un filtre trop étroit.
    if (cellRows.length === 0) {
      return res.status(409).json({
        error: "Aucune fiche dans ce périmètre — aucun fichier n'est produit.",
        code: 'EXPORT_VIDE',
        hint: 'Élargissez les filtres (année, population, CIP référent) et réessayez.',
      });
    }
    // EXG-43 : journal AVANT l'envoi — un échec de journalisation fait échouer
    // l'export (jamais de fichier nominatif non tracé).
    await logExportFreins(req, { format, ...filtres, lignes: cellRows.length });

    const stamp = aujourdhuiParis();

    if (format === 'csv') {
      // Échappement PARTAGÉ (`utils/export-csv.js`) : il neutralise en plus les
      // cellules commençant par `=`, `+`, `-`, `@` — une commune de résidence
      // valant `=HYPERLINK(…)` compose une exfiltration en un clic sur le poste
      // de l'instructrice. La fonction locale qui vivait ici ne faisait que du
      // guillemetage : même famille que le constat M-04 de la PR A.
      const esc = (v) => escCsv(v);
      // CORRECTIF m-08 — en-tête de traçabilité EN LIGNES COMMENTÉES.
      // La règle commune de la matrice (09 § 2) l'impose « en première feuille
      // (tableur) OU en première ligne (CSV) », et le rapport de lot annonçait
      // « en-tête de traçabilité complet » : la variante CSV n'en avait aucun.
      // Le préfixe `#` la rend ignorable par tout import qui le filtre, ce qui
      // préserve l'argument d'origine — « le tableau doit rester importable
      // colonne à colonne » — sans laisser partir un fichier de contrôle sans
      // date, sans périmètre et sans version.
      const perimetre = `${PERIMETRES_FREINS[filtres.statut] || filtres.statut}`
        + `${filtres.annee ? ` — année ${filtres.annee}` : ' — toutes années'}`
        + `${filtres.cip ? ' — un seul CIP référent' : ' — tous CIP référents'}`;
      const meta = [
        '# Export;Tableau des freins — cadre 2026 (23 colonnes du CDC + colonnes du cadre 2026)',
        `# Généré le;${new Date().toLocaleString('fr-FR')};Généré par;${esc(nomGenerateur(req.user))}`,
        `# Périmètre;${esc(perimetre)}`,
        `# Nombre de lignes;${cellRows.length};Version de l'outil;${esc(APP_VERSION_EXPORTS)}`,
        `# Colonnes sensibles;${filtres.sensibles ? 'OUI — frein judiciaire inclus (art. 10 RGPD, diffusion interdite hors ADMIN/RH)' : 'Non (frein judiciaire exclu)'}`,
        '# Cellule vide;Champ non renseigné — jamais un zéro, jamais une valeur par défaut',
        "# Mention;Document de travail ERP — les saisies officielles (ASP, emplois de l'inclusion, Immersion Facilitée, Ma Démarche FSE+) font foi",
        '',
      ].join('\n');
      const lines = cellRows.map((row) => cols.map((c) => esc(row[c.key])).join(';'));
      const csv = '﻿' + meta + cols.map((c) => c.header).join(';') + '\n'
        + lines.join('\n') + (lines.length ? '\n' : '');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=insertion_freins_${stamp}.csv`);
      return res.send(csv);
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SOLIDATA';
    const sheet = workbook.addWorksheet('Freins');
    sheet.columns = cols.map((c) => ({ header: c.header, key: c.key, width: Math.min(Math.max(c.header.length + 2, 12), 30) }));
    for (const row of cellRows) sheet.addRow(row);
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8BC540' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const info = workbook.addWorksheet('Informations');
    info.columns = [{ header: 'Champ', key: 'k', width: 30 }, { header: 'Valeur', key: 'v', width: 80 }];
    // En-tête de traçabilité DICTÉ par l'autorité (09 § 2, règles communes) :
    // export, généré le, généré par, périmètre en toutes lettres, nombre de
    // lignes, version de l'outil, et la mention des saisies qui font foi.
    info.addRows([
      { k: 'Export', v: 'Tableau des freins — cadre 2026 (23 colonnes du CDC + colonnes du cadre 2026)' },
      { k: 'Généré le', v: new Date().toLocaleString('fr-FR') },
      { k: 'Généré par', v: nomGenerateur(req.user) },
      { k: 'Périmètre', v: `${PERIMETRES_FREINS[filtres.statut] || filtres.statut}`
        + `${filtres.annee ? ` — année ${filtres.annee}` : ' — toutes années'}`
        + `${filtres.cip ? ' — un seul CIP référent' : ' — tous CIP référents'}` },
      { k: 'Nombre de lignes', v: cellRows.length },
      { k: "Version de l'outil", v: APP_VERSION_EXPORTS },
      { k: 'Filtres', v: `statut=${filtres.statut}${filtres.annee ? `, annee=${filtres.annee}` : ''}${filtres.cip ? `, cip=${filtres.cip}` : ''}` },
      { k: 'Colonnes sensibles', v: filtres.sensibles ? 'OUI — frein judiciaire inclus (art. 10 RGPD, diffusion interdite hors ADMIN/RH)' : 'Non (frein judiciaire exclu — EXG-38)' },
      { k: 'Règle des freins (valeur courante)', v: "Dernière évaluation en date : dernier entretien réalisé du parcours courant portant au moins un frein, repli axe par axe sur le diagnostic d'accueil. Vide = non évalué." },
      { k: "Règle des colonnes « entrée » et « évolution »", v: "« Entrée » = niveau relevé au diagnostic d'accueil. « Évolution » compare l'entrée et la valeur courante sur une échelle de 1 (pas de difficulté) à 5 (bloquant) : levé = baisse d'au moins un niveau, aggravé = hausse d'au moins un niveau, stable sinon, « non évalué » dès qu'une des deux valeurs manque." },
      { k: 'Règle « Heures par semaine »', v: "Quotité CONTRACTUELLE (contrat en cours, repli fiche salarié) — ce n'est pas l'activité constatée. L'activité réelle se lit dans la colonne « Semaines sous 15 h (année) »." },
      { k: 'Règle « Semaines sous 15 h »', v: "Nombre de semaines RELEVÉES dont l'activité cumulée (travail en CDDI, accompagnement, immersion) est inférieure au plancher paramétré. Une semaine sans relevé de paie n'est jamais comptée comme une semaine à zéro heure. Cellule VIDE = aucune semaine relevée sur l'année, ou activité non calculable : ce n'est PAS « zéro semaine sous le plancher »." },
      { k: 'Cellule vide', v: "Champ non renseigné. Jamais un zéro, jamais une valeur par défaut." },
      { k: 'Confidentialité', v: 'Données personnelles (dont santé). Diffusion restreinte ADMIN/RH — génération journalisée (registre RGPD). Toute transmission externe passe par la synthèse agrégée non nominative.' },
      { k: 'Mention', v: "Document de travail ERP — les saisies officielles (ASP, emplois de l'inclusion, Immersion Facilitée, Ma Démarche FSE+) font foi" },
    ]);
    info.getRow(1).font = { bold: true };
    info.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8BC540' } };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=insertion_freins_${stamp}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[EXPORTS] Erreur export insertion-freins :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/exports/insertion-freins/completude — % de renseigné par colonne
// (REC-UX-14 : l'écran affiche les colonnes faibles AVANT de générer l'export).
// Mêmes filtres que l'export ; agrégat sans donnée nominative dans la réponse,
// mais réservé ADMIN/RH comme l'export qu'il prépare. Pas de journalisation
// (aucune ligne nominative ne sort).
router.get('/insertion-freins/completude', authorize('ADMIN', 'RH'),
  freinsFilterValidators, validate, async (req, res) => {
    try {
      const filtres = parseFreinsFilters(req);
      const rows = await fetchFreinsRows(filtres);
      const cellRows = rows.map((r) => rowToCells(r, filtres.sensibles));
      const comp = computeCompletude(cellRows, filtres.sensibles);
      res.json({
        sensibles: filtres.sensibles,
        filtres: { statut: filtres.statut, annee: filtres.annee, cip: filtres.cip },
        total: comp.total,
        colonnes: comp.colonnes,
      });
    } catch (err) {
      console.error('[EXPORTS] Erreur completude insertion-freins :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

// ══════════════════════════════════════════
// PR 2 — Synthèse comité de pilotage (EXG-14)
//
// Agrégats STRICTEMENT non nominatifs (effectifs, ETP approchés « contrôle »,
// typologies via tranches d'âge pii-pseudonymize, entretiens, sorties vs
// cibles, PMSMP, satisfaction) pour les COPIL 2×/an (art. 3.4) et le bilan
// annuel (art. 5). Réutilise gatherAuditKpis (mêmes chiffres que la page
// AuditInsertion — une seule vérité). ADMIN/MANAGER/RH (router).
// ══════════════════════════════════════════
const SYNTHESE_MENTION = 'Document agrégé non nominatif — comité de pilotage';

router.get('/insertion-synthese', [
  query('year').optional().isInt({ min: 2000, max: 2100 }).withMessage('year invalide'),
  query('format').optional().isIn(['json', 'csv']).withMessage('format invalide (json ou csv)'),
  query('trimestre').optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 1, max: 4 }).withMessage('trimestre invalide (1 à 4)'),
], validate, async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const tRaw = parseInt(req.query.trimestre, 10);
    const trimestre = Number.isFinite(tRaw) && tRaw >= 1 && tRaw <= 4 ? tRaw : null;

    if ((req.query.format || 'json').toLowerCase() === 'csv') {
      // ═══ PR D lot 6 — LE CSV EST DÉLÉGUÉ AU SERVICE DE SYNTHÈSE ══════════
      //
      // Ce fichier composait jusqu'ici SA PROPRE liste d'indicateurs, à côté de
      // la synthèse de dialogue de gestion qui en compose une autre. Deux
      // documents « agrégés non nominatifs » produits par deux codes différents,
      // c'est deux chiffres pour le même indicateur le jour où l'un est corrigé
      // et pas l'autre. Le CSV est donc la SYNTHÈSE (e), servie sous son nom.
      const { composerDialogueGestion, aplatirEnLignes, MENTION } = require('../services/dialogue-gestion');
      const synthese = await composerDialogueGestion({ annee: year, trimestre, user: req.user });

      // Règle commune des exports : zéro donnée → refus motivé, jamais un
      // fichier vide (la même garde que la route `/insertion/reporting`).
      const { estVide } = require('./insertion/reporting');
      if (estVide(synthese)) {
        return res.status(409).json({
          error: `Aucune donnée d'insertion sur ${trimestre ? `le T${trimestre} ${year}` : `l'année ${year}`} — aucun fichier n'est produit.`,
          code: 'EXPORT_VIDE',
          hint: "Vérifiez l'année demandée, ou saisissez les fins de parcours et les dossiers de la période.",
        });
      }

      // Journal BLOQUANT avant l'envoi : le document part vers l'autorité, il
      // n'existe pas sans la ligne qui dit qu'il a été produit.
      await pool.query(
        'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
        [req.user?.id ?? null, 'EXPORT_DIALOGUE_GESTION', 'insertion_reporting', null,
          JSON.stringify({ annee: year, trimestre, format: 'csv', source: 'exports/insertion-synthese' })]
      );

      const lignesSynthese = aplatirEnLignes(synthese);
      const e = synthese.en_tete || {};
      const meta = [
        `# Export;Synthèse de dialogue de gestion;Période;${trimestre ? `${year} T${trimestre} (version allégée)` : `Année ${year}`}`,
        `# Généré le;${new Date().toLocaleString('fr-FR')};Généré par (rôle);${escCsv(req.user?.role || '')}`,
        `# Périmètre;${escCsv(e.perimetre || '')}`,
        `# Nombre de lignes;${lignesSynthese.length};Version de l'outil;${escCsv(e.version || APP_VERSION_EXPORTS)}`,
        `# Méthode;Les règles de calcul de chaque indicateur figurent dans le bloc « 9. Méthode » de ce fichier`,
        `# ${MENTION}`,
        "# Document de travail ERP — les saisies officielles (ASP, emplois de l'inclusion, Immersion Facilitée, Ma Démarche FSE+) font foi",
        '',
      ].join('\n');
      const csv = '\ufeff' + meta + 'Bloc;Indicateur;Valeur\n'
        + lignesSynthese.map((l) => l.map((c) => escCsv(c)).join(';')).join('\n') + '\n';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition',
        `attachment; filename="dialogue-gestion_${year}${trimestre ? `_T${trimestre}` : ''}.csv"`);
      return res.send(csv);
    }

    // Format JSON : INCHANGÉ (les indicateurs de l'écran d'audit, consommés
    // tels quels depuis la PR 2). C'est le FICHIER qui change, pas l'API.
    // Require paresseux : routes.js vérifie PCM_ENCRYPTION_KEY/JWT_SECRET au
    // chargement — on ne le charge qu'à l'usage (env déjà posé à ce stade).
    // CORRECTIF B-02 — même frontière de rôle que `GET /insertion/audit` : ce
    // JSON est servi à ADMIN/MANAGER/RH sous la bannière « document agrégé non
    // nominatif », et il portait BRSA, catégorie France Travail, référent
    // unique et critères d'éligibilité (dont RQTH) sans aucune suppression. Les
    // blocs de statut social ne sont ni lus ni composés pour un MANAGER, et la
    // projection est reposée avant l'envoi.
    // 25/09/2026 (fusion de main) : le routeur n'admet plus qu'ADMIN/RH depuis
    // le retrait de MANAGER le 10/09/2026 — la projection par rôle reste en
    // place comme garde (fail-safe : tout rôle non ADMIN/RH est projeté).
    const { gatherAuditKpis, baseRoleOf, projeterAuditPourRole } = require('./insertion/routes');
    const baseRole = baseRoleOf(req);
    const k = await gatherAuditKpis(year, { baseRole });
    res.json({ mention: SYNTHESE_MENTION, ...projeterAuditPourRole(k, baseRole) });
  } catch (err) {
    console.error('[EXPORTS] Erreur insertion-synthese :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
