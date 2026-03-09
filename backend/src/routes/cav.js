const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// GET /api/cav — Liste avec filtres
router.get('/', async (req, res) => {
  try {
    const { status, commune, search } = req.query;
    let query = 'SELECT * FROM cav WHERE 1=1';
    const params = [];

    if (status) { params.push(status); query += ` AND status = $${params.length}`; }
    if (commune) { params.push(commune); query += ` AND commune = $${params.length}`; }
    if (search) { params.push(`%${search}%`); query += ` AND (name ILIKE $${params.length} OR address ILIKE $${params.length})`; }

    query += ' ORDER BY name';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[CAV] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/cav/map — Données carte avec taux de remplissage estimé
router.get('/map', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.name, c.address, c.commune, c.latitude, c.longitude,
        c.nb_containers, c.avg_fill_rate, c.status, c.unavailable_reason,
        c.route_count,
        (SELECT MAX(th.date) FROM tonnage_history th WHERE th.cav_id = c.id) as last_collection,
        (SELECT AVG(th.weight_kg) FROM tonnage_history th WHERE th.cav_id = c.id
         AND th.date >= NOW() - INTERVAL '90 days') as avg_weight_90d
      FROM cav c
      WHERE c.status = 'active'
      ORDER BY c.name
    `);

    // Calcul du taux de remplissage estimé
    const now = new Date();
    const monthIndex = now.getMonth();
    const seasonalFactors = [0.8, 0.85, 0.95, 1.05, 1.15, 1.2, 1.15, 1.1, 1.05, 0.95, 0.85, 0.8];

    const cavWithFill = result.rows.map(cav => {
      const daysSinceCollection = cav.last_collection
        ? Math.floor((now - new Date(cav.last_collection)) / (86400000))
        : 30;
      const avgWeight = parseFloat(cav.avg_weight_90d) || 50;
      const dailyAccumulation = avgWeight / 7;
      const rawFill = (daysSinceCollection * dailyAccumulation / (cav.nb_containers || 1)) * 100;
      const estimatedFill = Math.min(120, rawFill * seasonalFactors[monthIndex]);

      return {
        ...cav,
        estimated_fill_rate: Math.round(estimatedFill),
        days_since_collection: daysSinceCollection,
        daily_accumulation: Math.round(dailyAccumulation * 10) / 10,
      };
    });

    res.json(cavWithFill);
  } catch (err) {
    console.error('[CAV] Erreur map :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/cav/communes — Liste des communes distinctes
router.get('/communes', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT DISTINCT commune FROM cav WHERE commune IS NOT NULL ORDER BY commune"
    );
    res.json(result.rows.map(r => r.commune));
  } catch (err) {
    console.error('[CAV] Erreur communes :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// QR CODE — Scan & Identification
// ══════════════════════════════════════════

// POST /api/cav/scan-qr — Scanner un QR code de CAV (depuis mobile)
router.post('/scan-qr', async (req, res) => {
  try {
    const { qr_data, tour_id, scan_type, latitude, longitude, notes } = req.body;
    if (!qr_data) return res.status(400).json({ error: 'Données QR requises' });

    // Trouver le CAV par son QR code
    const cav = await pool.query('SELECT * FROM cav WHERE qr_code_data = $1', [qr_data]);
    if (cav.rows.length === 0) {
      return res.status(404).json({ error: 'QR code non reconnu. Ce CAV n\'est pas enregistré.' });
    }

    const cavData = cav.rows[0];

    // Enregistrer le scan
    await pool.query(
      `INSERT INTO cav_qr_scans (cav_id, tour_id, scanned_by, scan_type, latitude, longitude, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [cavData.id, tour_id || null, req.user.id, scan_type || 'collection', latitude, longitude, notes]
    );

    // Si en tournée, marquer le QR comme scanné
    if (tour_id) {
      await pool.query(
        'UPDATE tour_cav SET qr_scanned = true WHERE tour_id = $1 AND cav_id = $2',
        [tour_id, cavData.id]
      );
    }

    res.json({
      cav: {
        id: cavData.id,
        name: cavData.name,
        address: cavData.address,
        commune: cavData.commune,
        status: cavData.status,
        nb_containers: cavData.nb_containers,
      },
      scan_recorded: true,
      message: `CAV "${cavData.name}" identifié`,
    });
  } catch (err) {
    console.error('[CAV] Erreur scan QR :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/cav/:id/scans — Historique des scans QR d'un CAV
router.get('/:id/scans', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, u.first_name, u.last_name, t.date as tour_date
       FROM cav_qr_scans s
       LEFT JOIN users u ON s.scanned_by = u.id
       LEFT JOIN tours t ON s.tour_id = t.id
       WHERE s.cav_id = $1
       ORDER BY s.scanned_at DESC LIMIT 100`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[CAV] Erreur historique scans :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/cav/:id/qr-code — Télécharger le QR code d'un CAV
router.get('/:id/qr-code', async (req, res) => {
  try {
    const result = await pool.query('SELECT qr_code_image_path, name FROM cav WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'CAV non trouvé' });
    if (!result.rows[0].qr_code_image_path) return res.status(404).json({ error: 'QR code non généré' });

    const filePath = path.join(__dirname, '..', '..', result.rows[0].qr_code_image_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier QR introuvable' });

    res.download(filePath, `QR_CAV_${result.rows[0].name.replace(/\s+/g, '_')}.png`);
  } catch (err) {
    console.error('[CAV] Erreur téléchargement QR :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cav/batch-generate-qr — Générer les QR codes manquants
router.post('/batch-generate-qr', authorize('ADMIN'), async (req, res) => {
  try {
    const cavs = await pool.query('SELECT id, name FROM cav WHERE qr_code_data IS NULL OR qr_code_data = \'\'');

    const qrDir = path.join(__dirname, '..', '..', 'uploads', 'qrcodes');
    if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });

    let generated = 0;
    for (const c of cavs.rows) {
      const qrData = `SOLIDATA-CAV-${c.id}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
      const qrFilename = `qr_${qrData}.png`;
      const qrPath = path.join(qrDir, qrFilename);
      await QRCode.toFile(qrPath, qrData, { width: 300, margin: 2, color: { dark: '#1A202C', light: '#FFFFFF' } });
      await pool.query(
        'UPDATE cav SET qr_code_data = $1, qr_code_image_path = $2 WHERE id = $3',
        [qrData, `/uploads/qrcodes/${qrFilename}`, c.id]
      );
      generated++;
    }

    res.json({ message: `${generated} QR codes générés`, generated });
  } catch (err) {
    console.error('[CAV] Erreur batch QR :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/cav/:id
router.get('/:id', async (req, res) => {
  try {
    const cav = await pool.query('SELECT * FROM cav WHERE id = $1', [req.params.id]);
    if (cav.rows.length === 0) return res.status(404).json({ error: 'CAV non trouvé' });

    // Historique de collecte
    const history = await pool.query(
      'SELECT * FROM tonnage_history WHERE cav_id = $1 ORDER BY date DESC LIMIT 50',
      [req.params.id]
    );

    res.json({ ...cav.rows[0], collection_history: history.rows });
  } catch (err) {
    console.error('[CAV] Erreur détail :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cav
router.post('/', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { name, address, commune, latitude, longitude, nb_containers } = req.body;
    if (!name || !latitude || !longitude) {
      return res.status(400).json({ error: 'Nom, latitude et longitude requis' });
    }

    // Générer QR code unique
    const qrData = `SOLIDATA-CAV-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const qrDir = path.join(__dirname, '..', '..', 'uploads', 'qrcodes');
    if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });
    const qrFilename = `qr_${qrData}.png`;
    const qrPath = path.join(qrDir, qrFilename);
    await QRCode.toFile(qrPath, qrData, { width: 300, margin: 2, color: { dark: '#1A202C', light: '#FFFFFF' } });

    const result = await pool.query(
      `INSERT INTO cav (name, address, commune, latitude, longitude,
       geom, nb_containers, qr_code_data, qr_code_image_path)
       VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($5, $4), 4326), $6, $7, $8)
       RETURNING *`,
      [name, address, commune, latitude, longitude, nb_containers || 1, qrData, `/uploads/qrcodes/${qrFilename}`]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[CAV] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/cav/:id
router.put('/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { name, address, commune, latitude, longitude, nb_containers, status, unavailable_reason } = req.body;

    const setClauses = ['updated_at = NOW()'];
    const values = [];
    let i = 1;

    if (name !== undefined) { setClauses.push(`name = $${i}`); values.push(name); i++; }
    if (address !== undefined) { setClauses.push(`address = $${i}`); values.push(address); i++; }
    if (commune !== undefined) { setClauses.push(`commune = $${i}`); values.push(commune); i++; }
    if (latitude !== undefined && longitude !== undefined) {
      setClauses.push(`latitude = $${i}`); values.push(latitude); i++;
      setClauses.push(`longitude = $${i}`); values.push(longitude); i++;
      setClauses.push(`geom = ST_SetSRID(ST_MakePoint($${i-1}, $${i-2}), 4326)`);
    }
    if (nb_containers !== undefined) { setClauses.push(`nb_containers = $${i}`); values.push(nb_containers); i++; }
    if (status !== undefined) {
      setClauses.push(`status = $${i}`); values.push(status); i++;
      if (status === 'unavailable') {
        setClauses.push(`unavailable_since = NOW()`);
        if (unavailable_reason) { setClauses.push(`unavailable_reason = $${i}`); values.push(unavailable_reason); i++; }
      } else {
        setClauses.push(`unavailable_since = NULL, unavailable_reason = NULL`);
      }
    }

    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE cav SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'CAV non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CAV] Erreur modification :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cav/:id/regenerate-qr
router.post('/:id/regenerate-qr', authorize('ADMIN'), async (req, res) => {
  try {
    const qrData = `SOLIDATA-CAV-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const qrDir = path.join(__dirname, '..', '..', 'uploads', 'qrcodes');
    if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });
    const qrFilename = `qr_${qrData}.png`;
    const qrPath = path.join(qrDir, qrFilename);
    await QRCode.toFile(qrPath, qrData, { width: 300, margin: 2 });

    await pool.query(
      'UPDATE cav SET qr_code_data = $1, qr_code_image_path = $2, updated_at = NOW() WHERE id = $3',
      [qrData, `/uploads/qrcodes/${qrFilename}`, req.params.id]
    );

    res.json({ message: 'QR code régénéré', qrData, qrImagePath: `/uploads/qrcodes/${qrFilename}` });
  } catch (err) {
    console.error('[CAV] Erreur QR :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/cav/:id/history — Historique tonnage
router.get('/:id/history', async (req, res) => {
  try {
    const { period } = req.query; // 30, 90, 365
    const days = parseInt(period) || 90;
    const result = await pool.query(
      `SELECT * FROM tonnage_history WHERE cav_id = $1
       AND date >= NOW() - make_interval(days => $2)
       ORDER BY date DESC`,
      [req.params.id, days]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[CAV] Erreur historique :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/cav/:id
router.delete('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE cav SET status = 'unavailable', unavailable_reason = 'Supprimé', updated_at = NOW() WHERE id = $1 RETURNING id",
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'CAV non trouvé' });
    res.json({ message: 'CAV désactivé' });
  } catch (err) {
    console.error('[CAV] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
