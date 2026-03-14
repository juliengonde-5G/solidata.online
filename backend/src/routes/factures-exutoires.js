const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

// Multer setup for PDF upload
const uploadDir = path.join(__dirname, '../../uploads/factures-exutoires');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `facture-${Date.now()}-${safeName}`);
  }
});
const upload = multer({ storage, fileFilter: (req, file, cb) => {
  cb(null, file.mimetype === 'application/pdf');
}, limits: { fileSize: 10 * 1024 * 1024 } });

// OCR helper function
async function extractInvoiceData(pdfPath) {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdfParse(dataBuffer);
    const text = data.text;

    // Extract date - formats: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
    let ocr_date = null;
    const dateMatch = text.match(/(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})/);
    if (dateMatch) {
      ocr_date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
    } else {
      // Try YYYY-MM-DD
      const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (isoMatch) ocr_date = isoMatch[0];
    }

    // Extract tonnage - number followed by t, T, tonne(s), or kg (convert)
    let ocr_tonnage = null;
    const tonMatch = text.match(/([\d\s,.]+)\s*(?:tonne|tonnes|t(?:\.|\s|$))/i);
    if (tonMatch) {
      ocr_tonnage = parseFloat(tonMatch[1].replace(/\s/g, '').replace(',', '.'));
    } else {
      const kgMatch = text.match(/([\d\s,.]+)\s*kg/i);
      if (kgMatch) {
        ocr_tonnage = parseFloat(kgMatch[1].replace(/\s/g, '').replace(',', '.')) / 1000;
      }
    }

    // Extract amount - number near euro, EUR, Total, Montant, Net a payer
    let ocr_montant = null;
    const montantPatterns = [
      /(?:total|montant|net\s*[àa]\s*payer|ttc)\s*[:\s]*([\d\s,.]+)\s*(?:€|eur)/i,
      /([\d\s,.]+)\s*(?:€|eur)/i,
    ];
    for (const pattern of montantPatterns) {
      const match = text.match(pattern);
      if (match) {
        ocr_montant = parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
        break;
      }
    }

    return { ocr_date, ocr_tonnage, ocr_montant, raw_text: text.substring(0, 2000) };
  } catch (err) {
    console.error('[OCR] Erreur extraction :', err);
    return { ocr_date: null, ocr_tonnage: null, ocr_montant: null, raw_text: null };
  }
}

// GET /api/factures-exutoires
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT f.*, f.statut_facture as statut, c.reference as commande_reference, c.type_produit, c.prix_tonne,
             cl.raison_sociale as client_nom
      FROM factures_exutoires f
      JOIN commandes_exutoires c ON f.commande_id = c.id
      JOIN clients_exutoires cl ON c.client_id = cl.id
      ORDER BY f.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[FACTURES-EXUTOIRES] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/factures-exutoires
router.post('/', upload.single('facture'), async (req, res) => {
  try {
    const { commande_id } = req.body;

    if (!commande_id) {
      return res.status(400).json({ error: 'Champ obligatoire : commande_id' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Fichier PDF obligatoire' });
    }

    // Run OCR on uploaded PDF
    const ocrData = await extractInvoiceData(req.file.path);

    // Fetch commande + client details for concordance
    const commandeResult = await pool.query(
      `SELECT c.*, cl.raison_sociale, cl.siret as client_siret
       FROM commandes_exutoires c
       JOIN clients_exutoires cl ON c.client_id = cl.id
       WHERE c.id = $1`,
      [commande_id]
    );
    if (commandeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Commande non trouvee' });
    }
    const commande = commandeResult.rows[0];
    const prix_tonne = parseFloat(commande.prix_tonne);

    // Calculate montant_attendu: pesee_client * prix_tonne, fallback to pesee_interne
    let montant_attendu = null;
    let pesee_reference = null;
    let pesee_source = null;

    const peseeResult = await pool.query(
      'SELECT pesee_client FROM controles_pesee WHERE commande_id = $1',
      [commande_id]
    );
    if (peseeResult.rows.length > 0 && peseeResult.rows[0].pesee_client != null) {
      pesee_reference = parseFloat(peseeResult.rows[0].pesee_client);
      pesee_source = 'client';
      montant_attendu = pesee_reference * prix_tonne;
    } else {
      const prepResult = await pool.query(
        'SELECT pesee_interne FROM preparations_expedition WHERE commande_id = $1',
        [commande_id]
      );
      if (prepResult.rows.length > 0 && prepResult.rows[0].pesee_interne != null) {
        pesee_reference = parseFloat(prepResult.rows[0].pesee_interne);
        pesee_source = 'interne';
        montant_attendu = pesee_reference * prix_tonne;
      }
    }

    // Calculate ecart_montant
    let ecart_montant = null;
    if (ocrData.ocr_montant != null && montant_attendu != null) {
      ecart_montant = ocrData.ocr_montant - montant_attendu;
    }

    // Determine statut_facture
    let statut_facture;
    if (ecart_montant === null) {
      statut_facture = 'recue';
    } else if (Math.abs(ecart_montant) < 1) {
      statut_facture = 'conforme';
    } else {
      statut_facture = 'ecart';
    }

    // Concordance checks
    const concordance = {
      client_attendu: commande.raison_sociale,
      client_siret: commande.client_siret || null,
      prix_tonne_commande: prix_tonne,
      pesee_reference,
      pesee_source,
      montant_attendu,
      types_produit: commande.type_produit,
      // Check if OCR text contains client name
      client_trouve_dans_facture: ocrData.raw_text
        ? ocrData.raw_text.toLowerCase().includes((commande.raison_sociale || '').toLowerCase())
        : null,
      // Check if OCR tonnage matches pesee
      ecart_tonnage: (ocrData.ocr_tonnage != null && pesee_reference != null)
        ? ocrData.ocr_tonnage - pesee_reference : null,
      ecart_tonnage_pct: (ocrData.ocr_tonnage != null && pesee_reference != null && pesee_reference > 0)
        ? ((ocrData.ocr_tonnage - pesee_reference) / pesee_reference * 100) : null,
    };

    const facturePath = req.file.filename;

    const result = await pool.query(
      `INSERT INTO factures_exutoires (commande_id, facture_pdf, ocr_date, ocr_tonnage, ocr_montant, montant_attendu, ecart_montant, statut_facture)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [commande_id, facturePath, ocrData.ocr_date, ocrData.ocr_tonnage, ocrData.ocr_montant, montant_attendu, ecart_montant, statut_facture]
    );

    res.status(201).json({ ...result.rows[0], ocr: ocrData, concordance });
  } catch (err) {
    console.error('[FACTURES-EXUTOIRES] Erreur creation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/factures-exutoires/:id
router.put('/:id', async (req, res) => {
  try {
    const { ocr_date, ocr_tonnage, ocr_montant } = req.body;

    const existing = await pool.query('SELECT * FROM factures_exutoires WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvee' });
    }

    const facture = existing.rows[0];
    const newMontant = ocr_montant != null ? parseFloat(ocr_montant) : parseFloat(facture.ocr_montant);
    const montant_attendu = facture.montant_attendu != null ? parseFloat(facture.montant_attendu) : null;

    // Recalculate ecart_montant
    let ecart_montant = null;
    if (!isNaN(newMontant) && montant_attendu != null) {
      ecart_montant = newMontant - montant_attendu;
    }

    // Recalculate statut_facture
    let statut_facture;
    if (ecart_montant === null) {
      statut_facture = 'recue';
    } else if (Math.abs(ecart_montant) < 1) {
      statut_facture = 'conforme';
    } else {
      statut_facture = 'ecart';
    }

    const result = await pool.query(
      `UPDATE factures_exutoires SET
       ocr_date = COALESCE($1, ocr_date),
       ocr_tonnage = COALESCE($2, ocr_tonnage),
       ocr_montant = COALESCE($3, ocr_montant),
       ecart_montant = $4,
       statut_facture = $5
       WHERE id = $6 RETURNING *`,
      [ocr_date || null, ocr_tonnage || null, ocr_montant || null, ecart_montant, statut_facture, req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[FACTURES-EXUTOIRES] Erreur mise a jour :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/factures-exutoires/:id/valider
router.patch('/:id/valider', async (req, res) => {
  try {
    const existing = await pool.query('SELECT * FROM factures_exutoires WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvee' });
    }

    const result = await pool.query(
      `UPDATE factures_exutoires SET
       statut_facture = 'validee',
       validee_par = $1,
       date_validation = NOW()
       WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.id]
    );

    // Update commande statut to 'cloturee'
    await pool.query(
      `UPDATE commandes_exutoires SET statut = 'cloturee', updated_at = NOW() WHERE id = $1`,
      [existing.rows[0].commande_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[FACTURES-EXUTOIRES] Erreur validation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/factures-exutoires/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT f.*, c.reference, c.type_produit, c.prix_tonne, c.tonnage_prevu, c.statut as commande_statut,
             cl.raison_sociale, cl.contact_nom, cl.contact_email
      FROM factures_exutoires f
      JOIN commandes_exutoires c ON f.commande_id = c.id
      JOIN clients_exutoires cl ON c.client_id = cl.id
      WHERE f.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Facture non trouvee' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[FACTURES-EXUTOIRES] Erreur detail :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
