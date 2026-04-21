// ══════════════════════════════════════════════════════════════
// Contrats d'entretien véhicules (Niveau 2.8)
// ══════════════════════════════════════════════════════════════
// CRUD + upload PDF + liste des contrats expirant ≤ 30 j.

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');

// Stockage PDF des contrats
const contractStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads', 'vehicle-contracts');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, `contract_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage: contractStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Accepte PDF et images scan
    if (/pdf|jpeg|jpg|png/i.test(file.mimetype)) return cb(null, true);
    cb(new Error('Format non supporté (PDF/JPG/PNG uniquement)'));
  },
});

router.use(authenticate);

// GET /api/vehicle-contracts — Liste tous les contrats (+filtre vehicle_id, active)
router.get('/', async (req, res) => {
  try {
    const { vehicle_id, active, expiring_days } = req.query;
    let query = `SELECT c.*, v.registration, v.name AS vehicle_name
                   FROM vehicle_maintenance_contracts c
                   JOIN vehicles v ON v.id = c.vehicle_id
                  WHERE 1=1`;
    const params = [];
    if (vehicle_id) { params.push(vehicle_id); query += ` AND c.vehicle_id = $${params.length}`; }
    if (active === 'true') { query += ' AND c.active = true'; }
    if (active === 'false') { query += ' AND c.active = false'; }
    if (expiring_days) {
      const days = parseInt(expiring_days, 10);
      if (Number.isInteger(days)) {
        params.push(days);
        query += ` AND c.active = true AND c.fin <= CURRENT_DATE + ($${params.length} || ' days')::interval`;
      }
    }
    query += ' ORDER BY c.fin ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[VEHICLE-CONTRACTS] list :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/vehicle-contracts/:id — Détail
router.get('/:id', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.*, v.registration, v.name AS vehicle_name
         FROM vehicle_maintenance_contracts c
         JOIN vehicles v ON v.id = c.vehicle_id
        WHERE c.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Contrat non trouvé' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[VEHICLE-CONTRACTS] detail :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/vehicle-contracts — Créer (avec ou sans document)
router.post('/',
  authorize('ADMIN', 'MANAGER'),
  upload.single('document'),
  [
    body('vehicle_id').isInt().withMessage('ID véhicule requis'),
    body('prestataire').notEmpty().withMessage('Prestataire requis'),
    body('debut').notEmpty().withMessage('Date de début requise'),
    body('fin').notEmpty().withMessage('Date de fin requise'),
    body('type_contrat').optional().isIn(['full', 'partiel']),
  ],
  validate,
  async (req, res) => {
    try {
      const {
        vehicle_id, prestataire, type_contrat, debut, fin,
        tarif_mensuel_eur, operations_incluses, contact_nom,
        contact_telephone, contact_email, notes,
      } = req.body;

      // operations_incluses peut arriver en string CSV ou array (multipart)
      let ops = operations_incluses;
      if (typeof ops === 'string') {
        ops = ops.split(',').map(s => s.trim()).filter(Boolean);
      }
      if (!Array.isArray(ops)) ops = [];

      const documentPath = req.file ? `/uploads/vehicle-contracts/${req.file.filename}` : null;

      const result = await pool.query(
        `INSERT INTO vehicle_maintenance_contracts
         (vehicle_id, prestataire, type_contrat, debut, fin,
          tarif_mensuel_eur, operations_incluses, contact_nom,
          contact_telephone, contact_email, document_path, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [
          parseInt(vehicle_id, 10), prestataire, type_contrat || 'partiel', debut, fin,
          tarif_mensuel_eur ? parseFloat(tarif_mensuel_eur) : null,
          ops, contact_nom || null, contact_telephone || null, contact_email || null,
          documentPath, notes || null,
        ]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('[VEHICLE-CONTRACTS] create :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// PUT /api/vehicle-contracts/:id — MAJ (sans remplacer le doc)
router.put('/:id',
  authorize('ADMIN', 'MANAGER'),
  async (req, res) => {
    try {
      const fields = [
        'prestataire', 'type_contrat', 'debut', 'fin', 'tarif_mensuel_eur',
        'operations_incluses', 'contact_nom', 'contact_telephone', 'contact_email',
        'notes', 'active',
      ];
      const updates = [];
      const params = [];
      for (const f of fields) {
        if (req.body[f] !== undefined) {
          params.push(req.body[f]);
          updates.push(`${f} = $${params.length}`);
        }
      }
      if (updates.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
      updates.push('updated_at = NOW()');
      params.push(req.params.id);
      const result = await pool.query(
        `UPDATE vehicle_maintenance_contracts SET ${updates.join(', ')}
          WHERE id = $${params.length} RETURNING *`,
        params
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Contrat non trouvé' });
      res.json(result.rows[0]);
    } catch (err) {
      console.error('[VEHICLE-CONTRACTS] update :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// POST /api/vehicle-contracts/:id/document — Ajouter / remplacer le PDF
router.post('/:id/document',
  authorize('ADMIN', 'MANAGER'),
  upload.single('document'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Fichier requis' });
      const docPath = `/uploads/vehicle-contracts/${req.file.filename}`;
      const result = await pool.query(
        `UPDATE vehicle_maintenance_contracts SET document_path = $1, updated_at = NOW()
          WHERE id = $2 RETURNING *`,
        [docPath, req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Contrat non trouvé' });
      res.json(result.rows[0]);
    } catch (err) {
      console.error('[VEHICLE-CONTRACTS] document :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// DELETE /api/vehicle-contracts/:id
router.delete('/:id',
  authorize('ADMIN'),
  async (req, res) => {
    try {
      const r = await pool.query(
        'DELETE FROM vehicle_maintenance_contracts WHERE id = $1 RETURNING document_path',
        [req.params.id]
      );
      if (r.rows.length === 0) return res.status(404).json({ error: 'Contrat non trouvé' });
      // best-effort : purger le fichier
      const docPath = r.rows[0].document_path;
      if (docPath) {
        const abs = path.join(__dirname, '..', '..', docPath.replace(/^\/+/, ''));
        fs.unlink(abs, () => {});
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('[VEHICLE-CONTRACTS] delete :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

module.exports = router;
