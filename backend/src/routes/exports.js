const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { requireMfa } = require('../middleware/mfa');
const { query } = require('express-validator');
const { validate } = require('../middleware/validate');
const { monthBounds } = require('../utils/month-range');
const { FREINS, freinColumns } = require('./insertion/freins-registry');
const { freinsExportColumns, rowToCells, computeCompletude } = require('../utils/insertion-freins-export');

// Double authentification (2.43.0) : pour les rôles soumis (settings
// « securite.mfa_roles », défaut ADMIN/RH/DPO), la session doit avoir
// franchi le défi TOTP. No-op intégral pour les autres rôles.
router.use(authenticate, requireMfa, authorize('ADMIN', 'MANAGER', 'RH'));

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
    const month = req.query.month || new Date().toISOString().slice(0, 7);
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
// V4 — Export FSE+ (Fonds Social Européen Plus)
//
// Conformité IAE — la SIAE doit déclarer trimestriellement les bénéficiaires
// CDDI au cofinanceur FSE+. Données obligatoires : prénom, nom, SIRET
// employeur, dates contrat, heures cumulées, type de sortie, prescripteur,
// genre, situation sociale.
//
// Format CSV semi-colon (compatible export DGEFP / pôle FSE+).
// Le visuel UE est intégré dans les éditions PDF (cf utils/fse-plus.js).
// ══════════════════════════════════════════

// GET /api/exports/fse-plus?annee=2026&trimestre=1
// CSV avec en-tête signalant la source FSE+ + footer "Cofinancé par l'Union européenne"
router.get('/fse-plus', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const annee = parseInt(req.query.annee) || new Date().getFullYear();
    const trimestre = parseInt(req.query.trimestre) || Math.ceil((new Date().getMonth() + 1) / 3);

    const periodeStart = `${annee}-${String((trimestre - 1) * 3 + 1).padStart(2, '0')}-01`;
    const periodeEnd = trimestre === 4
      ? `${annee + 1}-01-01`
      : `${annee}-${String(trimestre * 3 + 1).padStart(2, '0')}-01`;

    const { rows } = await pool.query(`
      SELECT
        e.id,
        e.civility,
        e.gender,
        e.first_name,
        e.last_name,
        e.contract_type,
        e.contract_start,
        e.contract_end,
        e.insertion_status,
        e.insertion_start_date,
        e.insertion_end_date,
        po.nom AS prescripteur_orga,
        po.type AS prescripteur_type,
        e.date_prescription,
        (
          SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600), 0)::numeric(10,2)
          FROM work_hours wh
          WHERE wh.employee_id = e.id
            AND wh.date >= $1::date
            AND wh.date < $2::date
        ) AS heures_trimestre,
        diag.fse_entree,
        sortie.milestone_type AS sortie_type_jalon,
        sortie.sortie_classification,
        sortie.sortie_type,
        sortie.sortie_employeur_siret,
        sortie.sortie_duree_contrat_mois,
        sortie.completed_date AS sortie_date,
        sortie.fse_sortie
      FROM employees e
      LEFT JOIN prescripteur_orgas po ON po.id = e.prescripteur_id
      LEFT JOIN LATERAL (
        SELECT d.fse_entree FROM insertion_diagnostics d
        WHERE d.employee_id = e.id
        ORDER BY d.parcours_num DESC LIMIT 1
      ) diag ON true
      LEFT JOIN LATERAL (
        SELECT milestone_type, sortie_classification, sortie_type,
               sortie_employeur_siret, sortie_duree_contrat_mois, completed_date, fse_sortie
        FROM insertion_milestones m
        WHERE m.employee_id = e.id
          AND m.milestone_type = 'bilan_sortie'
          AND m.completed_date >= $1::date
          AND m.completed_date < $2::date
        ORDER BY m.completed_date DESC LIMIT 1
      ) sortie ON true
      WHERE e.contract_type = 'CDDI'
        AND (
          (e.contract_start IS NOT NULL AND e.contract_start < $2::date AND
            (e.contract_end IS NULL OR e.contract_end >= $1::date))
          OR (e.insertion_start_date IS NOT NULL AND e.insertion_start_date < $2::date)
        )
      ORDER BY e.last_name, e.first_name
    `, [periodeStart, periodeEnd]).catch(() => ({ rows: [] }));

    // CSV semi-colon — encodage UTF-8 BOM pour Excel
    // Classification = NOUVELLE nomenclature (emploi_durable / emploi_transition /
    // sortie_positive / autre — D8/EXG-06) ; « Sortie dynamique » explicite.
    // Données FSE+ (EXG-12) : fse_entree (diagnostic) / fse_sortie (bilan de
    // sortie) sérialisées en JSON.
    const DYN = ['emploi_durable', 'emploi_transition', 'sortie_positive'];
    const headers = [
      'ID', 'Civilité', 'Genre', 'Prénom', 'Nom', 'Type contrat', 'Début contrat', 'Fin contrat',
      'Statut insertion', 'Début parcours', 'Fin parcours',
      'Prescripteur (organisme)', 'Prescripteur (type)', 'Date prescription',
      'Heures travaillées (trimestre)',
      'Sortie type', 'Classification', 'Sortie dynamique', 'Catégorie', 'SIRET employeur sortie', 'Durée contrat sortie (mois)', 'Date sortie',
      'FSE+ entrée', 'FSE+ sortie',
    ];
    const lines = rows.map(r => [
      r.id,
      r.civility || '',
      r.gender || '',
      r.first_name || '',
      r.last_name || '',
      r.contract_type || '',
      r.contract_start ? new Date(r.contract_start).toISOString().slice(0, 10) : '',
      r.contract_end ? new Date(r.contract_end).toISOString().slice(0, 10) : '',
      r.insertion_status || '',
      r.insertion_start_date ? new Date(r.insertion_start_date).toISOString().slice(0, 10) : '',
      r.insertion_end_date ? new Date(r.insertion_end_date).toISOString().slice(0, 10) : '',
      r.prescripteur_orga || '',
      r.prescripteur_type || '',
      r.date_prescription ? new Date(r.date_prescription).toISOString().slice(0, 10) : '',
      r.heures_trimestre || 0,
      r.sortie_type_jalon || '',
      r.sortie_classification || '',
      r.sortie_classification ? (DYN.includes(r.sortie_classification) ? 'oui' : 'non') : '',
      r.sortie_type || '',
      r.sortie_employeur_siret || '',
      r.sortie_duree_contrat_mois != null ? r.sortie_duree_contrat_mois : '',
      r.sortie_date ? new Date(r.sortie_date).toISOString().slice(0, 10) : '',
      r.fse_entree ? JSON.stringify(r.fse_entree) : '',
      r.fse_sortie ? JSON.stringify(r.fse_sortie) : '',
    ].map(v => {
      const s = String(v ?? '').replace(/"/g, '""');
      return /[;\n"]/.test(s) ? `"${s}"` : s;
    }).join(';'));

    const meta = [
      `# Export FSE+ — SOLIDARITE TEXTILES`,
      `# Période : ${annee} T${trimestre} (${periodeStart} → ${periodeEnd})`,
      `# Bénéficiaires CDDI : ${rows.length}`,
      `# Cofinancé par l'Union européenne — FSE+`,
      `# Généré le ${new Date().toISOString()}`,
      '',
    ].join('\n');

    const csv = '﻿' + meta + headers.join(';') + '\n' + lines.join('\n') + '\n';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="fse-plus_${annee}_T${trimestre}_solidarite-textiles.csv"`
    );
    res.send(csv);
  } catch (err) {
    console.error('[EXPORTS] Erreur FSE+ :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/exports/insertion — Extraction COMPLÈTE des données d'insertion
// (parcours salariés, diagnostics CIP, jalons, plans d'action) au format
// Excel multi-feuilles. Données personnelles sensibles (freins santé/social)
// → restreint à ADMIN/RH (le router autorise ADMIN/MANAGER/RH, on resserre).
router.get('/insertion', authorize('ADMIN', 'RH'), async (req, res) => {
  // Requête résiliente : une requête qui échoue (colonne absente sur une base
  // ancienne) n'annule pas tout l'export — la feuille concernée est juste vide.
  const soft = async (label, text, params = []) => {
    try { return (await pool.query(text, params)).rows; }
    catch (err) { console.error(`[EXPORTS] insertion « ${label} » ignorée (${err.code || '?'}) : ${err.message}`); return []; }
  };

  // Normalise une valeur de cellule (dates ISO, tableaux/JSON en texte).
  const fmtCell = (v) => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
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
      for (const k of ordered) o[k] = fmtCell(r[k]);
      sheet.addRow(o);
    }
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8BC540' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  };

  // Sérialise un jeu de lignes en CSV point-virgule + BOM (ouverture directe
  // dans Excel FR), colonnes matricule/nom/prénom en tête, valeurs échappées.
  const toCsv = (rows, leadKeys = []) => {
    if (!rows.length) return '﻿(aucune donnée)\n';
    const allKeys = Object.keys(rows[0]);
    const cols = [
      ...leadKeys.filter((k) => allKeys.includes(k)),
      ...allKeys.filter((k) => !leadKeys.includes(k)),
    ];
    const esc = (v) => {
      const s = String(fmtCell(v));
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = rows.map((r) => cols.map((k) => esc(r[k])).join(';'));
    return '﻿' + cols.join(';') + '\n' + lines.join('\n') + '\n';
  };

  try {
    // 1) Salariés en insertion (vue synthèse curée) — les 9 freins du registre
    // unique (feuille Salariés : colonnes frein_mobilite … frein_judiciaire).
    let salaries = await soft('salaries', `
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
    if (!salaries.length) {
      // Repli minimal (colonnes garanties) si la requête curée a échoué.
      salaries = await soft('salaries-min', `
        SELECT e.id AS employee_id, e.last_name AS nom, e.first_name AS prenom,
               e.insertion_status AS statut, e.insertion_start_date AS debut_parcours
        FROM employees e
        WHERE e.insertion_status IS DISTINCT FROM 'none'
        ORDER BY e.last_name, e.first_name
      `);
    }

    // 2) Diagnostics CIP — toutes les colonnes. Les champs sensibles chiffrés
    // (santé / judiciaire, utils/field-crypto) sont DÉCHIFFRÉS : cet export est
    // réservé ADMIN/RH (diffusion restreinte, mention RGPD en feuille 1).
    const { SENSITIVE_DIAG_FIELDS, decryptField } = require('../utils/field-crypto');
    const diagnostics = await soft('diagnostics', `
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
    const jalons = await soft('jalons', `
      SELECT e.malibou_id AS matricule, e.last_name AS nom, e.first_name AS prenom, m.*
      FROM insertion_milestones m
      JOIN employees e ON e.id = m.employee_id
      ORDER BY e.last_name, e.first_name, m.due_date
    `);

    // 4) Plans d'action CIP — toutes les colonnes.
    const actions = await soft('actions', `
      SELECT e.malibou_id AS matricule, e.last_name AS nom, e.first_name AS prenom, a.*
      FROM cip_action_plans a
      JOIN employees e ON e.id = a.employee_id
      ORDER BY e.last_name, e.first_name
    `);

    const stamp = new Date().toISOString().slice(0, 10);
    const lead = ['matricule', 'nom', 'prenom'];

    // ─── Format CSV (une entité par fichier ; CSV est mono-table) ───
    if ((req.query.format || 'xlsx').toLowerCase() === 'csv') {
      const datasets = { salaries, diagnostics, jalons, actions, plans: actions };
      const key = (req.query.dataset || 'salaries').toLowerCase();
      const rows = datasets[key] || salaries;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=insertion_${datasets[key] ? key : 'salaries'}_${stamp}.csv`);
      return res.send(toCsv(rows, lead));
    }

    // ─── Format Excel (défaut) : classeur multi-feuilles ───
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SOLIDATA';

    // Feuille d'informations / RGPD.
    const info = workbook.addWorksheet('Informations');
    info.columns = [{ header: 'Champ', key: 'k', width: 26 }, { header: 'Valeur', key: 'v', width: 70 }];
    info.addRows([
      { k: 'Export', v: "Données d'insertion — extraction complète" },
      { k: 'Généré le', v: new Date().toISOString() },
      { k: 'Salariés (insertion)', v: salaries.length },
      { k: 'Diagnostics CIP', v: diagnostics.length },
      { k: 'Jalons', v: jalons.length },
      { k: "Plans d'action", v: actions.length },
      { k: 'Confidentialité', v: 'Données personnelles sensibles (freins santé/social). Diffusion restreinte — RGPD, durée de conservation limitée.' },
    ]);
    info.getRow(1).font = { bold: true };
    info.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8BC540' } };

    addDataSheet(workbook, 'Salariés', salaries, ['matricule', 'nom', 'prenom']);
    addDataSheet(workbook, 'Diagnostics CIP', diagnostics, ['matricule', 'nom', 'prenom']);
    addDataSheet(workbook, 'Jalons', jalons, ['matricule', 'nom', 'prenom']);
    addDataSheet(workbook, "Plans d'action", actions, ['matricule', 'nom', 'prenom']);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=insertion_complet_${stamp}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[EXPORTS] Erreur export insertion :', err);
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
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

  const { rows } = await pool.query(`
    SELECT e.id, e.last_name, e.first_name, e.nationality, e.gender, e.birth_date,
           e.city, e.qualification, e.disability_status, e.pass_iae_end,
           COALESCE(prem.premier_cddi, e.insertion_start_date, e.contract_start) AS date_entree_aci,
           COALESCE(cc.weekly_hours, e.weekly_hours) AS heures_semaine,
           d.rqth, d.niveau_formation, d.ressources, d.logement_statut,
           d.situation_familiale, d.projet_formation, d.emploi_vise, d.emploi_vise_rome,
           ${coalesced},
           pm.nb_pmsmp, pm.derniere_pmsmp
    FROM employees e
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
  return rows;
}

// Journal RGPD (EXG-43) — même format d'entrée que routes/rgpd.js. La variante
// sensible (frein judiciaire inclus) est journalisée sous une action DISTINCTE.
async function logExportFreins(req, { format, sensibles, statut, annee, cip, lignes }) {
  await pool.query(
    'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
    [req.user.id,
      sensibles ? 'EXPORT_INSERTION_FREINS_SENSIBLE' : 'EXPORT_INSERTION_FREINS',
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

    // EXG-43 : journal AVANT l'envoi — un échec de journalisation fait échouer
    // l'export (jamais de fichier nominatif non tracé).
    await logExportFreins(req, { format, ...filtres, lignes: cellRows.length });

    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      const esc = (v) => {
        const s = String(v ?? '');
        return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      // CSV STRICT (pas de ligne de méta : le tableau doit rester importable
      // colonne à colonne — la traçabilité vit dans rgpd_audit_log).
      const lines = cellRows.map((row) => cols.map((c) => esc(row[c.key])).join(';'));
      const csv = '﻿' + cols.map((c) => c.header).join(';') + '\n'
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
    info.addRows([
      { k: 'Export', v: 'Tableau des freins (CDC — 23 colonnes)' },
      { k: 'Généré le', v: new Date().toISOString() },
      { k: 'Lignes', v: cellRows.length },
      { k: 'Filtres', v: `statut=${filtres.statut}${filtres.annee ? `, annee=${filtres.annee}` : ''}${filtres.cip ? `, cip=${filtres.cip}` : ''}` },
      { k: 'Colonnes sensibles', v: filtres.sensibles ? 'OUI — frein judiciaire inclus (art. 10 RGPD, diffusion interdite hors ADMIN/RH)' : 'Non (frein judiciaire exclu — EXG-38)' },
      { k: 'Règle des freins', v: "Dernière évaluation en date : dernier entretien réalisé du parcours courant portant au moins un frein, repli axe par axe sur le diagnostic d'accueil. Vide = non évalué." },
      { k: 'Confidentialité', v: 'Données personnelles (dont santé). Diffusion restreinte ADMIN/RH — génération journalisée (registre RGPD). Toute transmission externe passe par la synthèse agrégée non nominative.' },
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
], validate, async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    // Require paresseux : routes.js vérifie PCM_ENCRYPTION_KEY/JWT_SECRET au
    // chargement — on ne le charge qu'à l'usage (env déjà posé à ce stade).
    const { gatherAuditKpis } = require('./insertion/routes');
    const k = await gatherAuditKpis(year);

    if ((req.query.format || 'json').toLowerCase() === 'csv') {
      const rows = [];
      const cible = (v) => (v == null ? 'objectif non paramétré' : v);
      rows.push(['Général', 'Année', k.annee]);
      rows.push(['Général', 'Salariés en parcours', k.nb_en_parcours]);
      rows.push(['Général', 'Délai moyen du diagnostic (jours)', k.delai_moyen_diagnostic_jours ?? '']);
      rows.push(['ETP (contrôle ERP)', 'ETP réalisés approchés', k.etp_realises_approx?.valeur ?? '']);
      rows.push(['ETP (contrôle ERP)', 'CDDI actifs', k.etp_realises_approx?.nb_cddi_actifs ?? '']);
      rows.push(['ETP (contrôle ERP)', 'Cible conventionnée', cible(k.conventionnel?.cibles?.cible_etp_conventionnes)]);
      rows.push(['ETP (contrôle ERP)', 'Note', k.etp_realises_approx?.note || '']);
      rows.push(['Typologies', 'RQTH', k.typologies?.rqth ?? '']);
      for (const [src, n] of Object.entries(k.typologies?.ressources || {})) rows.push(['Typologies', `Ressource — ${src}`, n]);
      for (const [niv, n] of Object.entries(k.typologies?.niveaux_formation || {})) rows.push(['Typologies', `Niveau de formation — ${niv}`, n]);
      for (const [tr, n] of Object.entries(k.typologies?.tranches_age || {})) rows.push(['Typologies', `Tranche d'âge — ${tr}`, n]);
      for (const m of k.milestones?.par_type || []) {
        rows.push(['Entretiens', `${m.label} — réalisés / échus`, `${m.realises_echus} / ${m.echus}`]);
      }
      rows.push(['Entretiens', 'Taux de réalisation global (échus) %', k.milestones?.global?.taux ?? '']);
      for (const f of FREINS) {
        const moy = k.freins_moyennes?.[f.column];
        rows.push(['Freins (moyenne cohorte /5)', f.label, moy ?? 'non évalué']);
      }
      rows.push(['Sorties', 'Total constaté', k.sorties?.total ?? 0]);
      rows.push(['Sorties', 'Dynamiques — nb', k.sorties?.dynamiques ?? 0]);
      rows.push(['Sorties', 'Taux dynamiques (%)', k.sorties?.taux_dynamiques ?? '']);
      rows.push(['Sorties', 'Cible dynamiques (%)', cible(k.conventionnel?.cibles?.cible_taux_dynamiques)]);
      for (const [cls, cKey] of [['emploi_durable', 'cible_taux_durable'], ['emploi_transition', 'cible_taux_transition'], ['sortie_positive', 'cible_taux_positive']]) {
        rows.push(['Sorties', `${cls} — nb`, k.sorties?.par_classification?.[cls] ?? 0]);
        rows.push(['Sorties', `${cls} — taux (%)`, k.sorties?.taux_par_classification?.[cls] ?? '']);
        rows.push(['Sorties', `${cls} — cible (%)`, cible(k.conventionnel?.cibles?.[cKey])]);
      }
      rows.push(['Sorties', 'Méthode', k.conventionnel?.methode || '']);
      rows.push(['PMSMP', 'Conventions de l\'année', k.pmsmp?.nb ?? 0]);
      rows.push(['PMSMP', 'Jours calendaires', k.pmsmp?.jours ?? 0]);
      rows.push(['PMSMP', 'Salariés concernés', k.pmsmp?.nb_salaries ?? 0]);
      rows.push(['Satisfaction de sortie', 'Réponses', k.satisfaction?.nb_reponses ?? 0]);
      rows.push(['Satisfaction de sortie', 'Moyenne globale (1-4)', k.satisfaction?.moyenne_globale ?? '']);
      rows.push(['Actions CIP', 'En cours', k.actions?.total_en_cours ?? 0]);

      const esc = (v) => {
        const s = String(v ?? '');
        return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const csv = '﻿' + `${SYNTHESE_MENTION}\n`
        + 'Section;Indicateur;Valeur\n'
        + rows.map((r) => r.map(esc).join(';')).join('\n') + '\n';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=insertion_synthese_${year}.csv`);
      return res.send(csv);
    }

    res.json({ mention: SYNTHESE_MENTION, ...k });
  } catch (err) {
    console.error('[EXPORTS] Erreur insertion-synthese :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
