const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../../uploads/pesee');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads/pesee')),
  filename: (req, file, cb) => {
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `pesee-${Date.now()}-${safeName}`);
  }
});
const upload = multer({ storage, fileFilter: (req, file, cb) => {
  cb(null, file.mimetype === 'application/pdf');
}, limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

// GET /api/controles-pesee — List all controles
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT cp.*, cp.statut_controle as statut, cp.ecart_pesee as ecart, cp.ecart_pourcentage as ecart_pct,
              c.reference as commande_reference, c.type_produit, cl.raison_sociale as client_nom
       FROM controles_pesee cp
       JOIN commandes_exutoires c ON cp.commande_id = c.id
       JOIN clients_exutoires cl ON c.client_id = cl.id
       ORDER BY cp.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[CONTROLES-PESEE] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/controles-pesee — Create controle with PDF upload
router.post('/', upload.single('ticket_pesee'), async (req, res) => {
  try {
    const { commande_id, pesee_client, date_reception_ticket, notes } = req.body;

    if (!commande_id || !pesee_client || !date_reception_ticket) {
      return res.status(400).json({ error: 'commande_id, pesee_client et date_reception_ticket requis' });
    }

    // Fetch preparation to get pesee_interne
    const prepResult = await pool.query(
      'SELECT pesee_interne FROM preparations_expedition WHERE commande_id = $1',
      [commande_id]
    );
    if (prepResult.rows.length === 0 || !prepResult.rows[0].pesee_interne) {
      return res.status(400).json({ error: 'Preparation non trouvee ou pesee_interne manquante' });
    }

    const pesee_interne = parseFloat(prepResult.rows[0].pesee_interne);
    const peseeClientFloat = parseFloat(pesee_client);

    // Calculate ecart
    const ecart_pesee = pesee_interne - peseeClientFloat;
    const ecart_pourcentage = (Math.abs(ecart_pesee) / pesee_interne) * 100;

    // Determine statut_controle
    let statut_controle;
    if (ecart_pourcentage <= 2) {
      statut_controle = 'conforme';
    } else if (ecart_pourcentage <= 5) {
      statut_controle = 'ecart_acceptable';
    } else {
      statut_controle = 'litige';
    }

    // File path if uploaded
    const ticket_pesee_pdf = req.file ? req.file.path : null;

    // Insert controle
    const insertResult = await pool.query(
      `INSERT INTO controles_pesee (commande_id, pesee_interne, pesee_client, ecart_pesee, ecart_pourcentage, statut_controle, date_reception_ticket, ticket_pesee_pdf, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [commande_id, pesee_interne, peseeClientFloat, ecart_pesee, ecart_pourcentage, statut_controle, date_reception_ticket, ticket_pesee_pdf, notes || null]
    );
    const controle = insertResult.rows[0];

    // Update commande statut to 'pesee_recue'
    await pool.query(
      "UPDATE commandes_exutoires SET statut = 'pesee_recue', updated_at = NOW() WHERE id = $1",
      [commande_id]
    );

    // Adjust stock movement: find by code_barre LIKE 'EXU-' + commande reference
    const commandeResult = await pool.query(
      'SELECT reference FROM commandes_exutoires WHERE id = $1',
      [commande_id]
    );
    const reference = commandeResult.rows[0].reference;
    const codeBarre = 'EXU-' + reference;

    const stockNotes = ecart_pesee !== 0
      ? `Ecart pesee: ${ecart_pesee.toFixed(3)}t (${ecart_pourcentage.toFixed(2)}%) - ${statut_controle}`
      : null;

    const stockUpdate = stockNotes
      ? await pool.query(
          `UPDATE stock_movements SET poids_kg = $1, origine = 'exutoire_definitif', notes = COALESCE(notes || ' | ', '') || $2, updated_at = NOW()
           WHERE code_barre = $3 RETURNING *`,
          [peseeClientFloat * 1000, stockNotes, codeBarre]
        )
      : await pool.query(
          `UPDATE stock_movements SET poids_kg = $1, origine = 'exutoire_definitif', updated_at = NOW()
           WHERE code_barre = $2 RETURNING *`,
          [peseeClientFloat * 1000, codeBarre]
        );

    console.log('[CONTROLES-PESEE] Controle cree :', controle.id, '- Statut:', statut_controle, '- Stock ajuste:', stockUpdate.rows.length > 0);

    res.status(201).json(controle);
  } catch (err) {
    console.error('[CONTROLES-PESEE] Erreur creation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/controles-pesee/:id/valider — Validate a controle
router.patch('/:id/valider', async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    let query = `UPDATE controles_pesee SET statut_controle = 'valide', validee_par = $1, date_validation = NOW()`;
    const params = [req.user.id];

    if (notes) {
      params.push(notes);
      query += `, notes = $${params.length}`;
    }

    params.push(id);
    query += ` WHERE id = $${params.length} RETURNING *`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Controle non trouve' });
    }

    const controle = result.rows[0];

    // Update commande statut to 'facturee'
    await pool.query(
      "UPDATE commandes_exutoires SET statut = 'facturee', updated_at = NOW() WHERE id = $1",
      [controle.commande_id]
    );

    console.log('[CONTROLES-PESEE] Controle valide :', id);

    res.json(controle);
  } catch (err) {
    console.error('[CONTROLES-PESEE] Erreur validation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/controles-pesee/:id — Get single controle
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT cp.*, c.reference, c.type_produit, cl.raison_sociale
       FROM controles_pesee cp
       JOIN commandes_exutoires c ON cp.commande_id = c.id
       JOIN clients_exutoires cl ON c.client_id = cl.id
       WHERE cp.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Controle non trouve' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CONTROLES-PESEE] Erreur detail :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
