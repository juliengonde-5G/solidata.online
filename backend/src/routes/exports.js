const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('ADMIN', 'MANAGER', 'RH'));

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
      [month + '-01', month + '-31']
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

// GET /api/exports/invoice/:id — Export PDF facture
router.get('/invoice/:id', async (req, res) => {
  try {
    const invoice = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (invoice.rows.length === 0) return res.status(404).json({ error: 'Facture non trouvée' });

    const lines = await pool.query(
      'SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY position',
      [req.params.id]
    );

    const inv = invoice.rows[0];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${inv.invoice_number}.pdf`);
    doc.pipe(res);

    // En-tête
    doc.fontSize(20).fillColor('#8BC540').text('SOLIDATA', 50, 50);
    doc.fontSize(10).fillColor('#333').text('Solidarité Textiles', 50, 75);
    doc.text('Zone Industrielle, 76000 Rouen', 50, 87);

    // Facture
    doc.fontSize(16).fillColor('#1A202C').text(`Facture ${inv.invoice_number}`, 350, 50);
    doc.fontSize(10).fillColor('#666').text(`Date : ${inv.date}`, 350, 75);
    doc.text(`Échéance : ${inv.due_date || 'N/A'}`, 350, 87);
    doc.text(`Statut : ${inv.status}`, 350, 99);

    // Client
    doc.moveTo(50, 120).lineTo(545, 120).stroke('#ddd');
    doc.fontSize(12).fillColor('#333').text('Client', 50, 130);
    doc.fontSize(10).text(inv.client_name, 50, 148);
    if (inv.client_address) doc.text(inv.client_address, 50, 162);

    // Tableau lignes
    let y = 200;
    doc.fontSize(9).fillColor('#666');
    doc.text('#', 50, y).text('Description', 70, y).text('Qté', 370, y).text('P.U.', 410, y).text('Total', 470, y);
    doc.moveTo(50, y + 15).lineTo(545, y + 15).stroke('#ddd');
    y += 25;

    doc.fillColor('#333');
    for (const line of lines.rows) {
      doc.text(String(line.position), 50, y);
      doc.text(line.description, 70, y, { width: 290 });
      doc.text(String(line.quantity), 370, y);
      doc.text(`${line.unit_price}€`, 410, y);
      doc.text(`${line.total}€`, 470, y);
      y += 20;
    }

    // Totaux
    y += 20;
    doc.moveTo(350, y).lineTo(545, y).stroke('#ddd');
    y += 10;
    doc.fontSize(10);
    doc.text('Total HT', 370, y).text(`${inv.total_ht}€`, 470, y);
    y += 18;
    doc.text('TVA 20%', 370, y).text(`${inv.total_tva}€`, 470, y);
    y += 18;
    doc.fontSize(12).fillColor('#8BC540');
    doc.text('Total TTC', 370, y).text(`${inv.total_ttc}€`, 470, y);

    doc.end();
  } catch (err) {
    console.error('[EXPORTS] Erreur export facture :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

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
        sortie.milestone_type AS sortie_type_jalon,
        sortie.sortie_classification,
        sortie.sortie_type,
        sortie.completed_date AS sortie_date
      FROM employees e
      LEFT JOIN prescripteur_orgas po ON po.id = e.prescripteur_id
      LEFT JOIN LATERAL (
        SELECT milestone_type, sortie_classification, sortie_type, completed_date
        FROM insertion_milestones m
        WHERE m.employee_id = e.id
          AND m.milestone_type = 'Bilan Sortie'
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
    const headers = [
      'ID', 'Prénom', 'Nom', 'Type contrat', 'Début contrat', 'Fin contrat',
      'Statut insertion', 'Début parcours', 'Fin parcours',
      'Prescripteur (organisme)', 'Prescripteur (type)', 'Date prescription',
      'Heures travaillées (trimestre)',
      'Sortie type', 'Classification', 'Catégorie', 'Date sortie',
    ];
    const lines = rows.map(r => [
      r.id,
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
      r.sortie_type || '',
      r.sortie_date ? new Date(r.sortie_date).toISOString().slice(0, 10) : '',
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

module.exports = router;
