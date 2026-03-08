const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

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

module.exports = router;
