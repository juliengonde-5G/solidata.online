const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');

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

// GET /api/cav/fill-rate — Taux de remplissage en temps réel avec prévision
router.get('/fill-rate', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.name, c.address, c.commune, c.latitude, c.longitude,
        c.nb_containers, c.status, c.tournee, c.jours_collecte, c.freq_passage,
        c.avg_fill_rate, c.route_count,
        (SELECT MAX(th.date) FROM tonnage_history th WHERE th.cav_id = c.id) as last_collection,
        (SELECT AVG(th.weight_kg) FROM tonnage_history th WHERE th.cav_id = c.id
         AND th.date >= NOW() - INTERVAL '90 days') as avg_weight_90d,
        (SELECT COUNT(*) FROM tonnage_history th WHERE th.cav_id = c.id
         AND th.date >= NOW() - INTERVAL '90 days') as nb_collectes_90d,
        (SELECT AVG(th2.date - th1.date)
         FROM (SELECT date, ROW_NUMBER() OVER (ORDER BY date DESC) as rn FROM tonnage_history WHERE cav_id = c.id AND date >= NOW() - INTERVAL '180 days') th1
         JOIN (SELECT date, ROW_NUMBER() OVER (ORDER BY date DESC) as rn FROM tonnage_history WHERE cav_id = c.id AND date >= NOW() - INTERVAL '180 days') th2
         ON th2.rn = th1.rn - 1
        ) as avg_days_between_collections
      FROM cav c
      WHERE c.status = 'active' AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      ORDER BY c.name
    `);

    const now = new Date();
    const monthIndex = now.getMonth();
    const seasonalFactors = [0.8, 0.85, 0.95, 1.05, 1.15, 1.2, 1.15, 1.1, 1.05, 0.95, 0.85, 0.8];

    const JOURS_MAP = { 'lundi': 1, 'mardi': 2, 'mercredi': 3, 'jeudi': 4, 'vendredi': 5, 'samedi': 6, 'dimanche': 0 };

    const cavData = result.rows.map(cav => {
      const lastCollection = cav.last_collection ? new Date(cav.last_collection) : null;
      const daysSinceCollection = lastCollection
        ? Math.floor((now - lastCollection) / 86400000)
        : 30;

      const avgWeight = parseFloat(cav.avg_weight_90d) || 50;
      const avgDaysBetween = parseFloat(cav.avg_days_between_collections) || 14;
      const capacityKg = (cav.nb_containers || 1) * 150; // ~150kg par conteneur

      // Taux de remplissage estimé basé sur accumulation journalière
      const dailyAccumulation = avgWeight / Math.max(avgDaysBetween, 1);
      const accumulatedKg = daysSinceCollection * dailyAccumulation * seasonalFactors[monthIndex];
      const fillRate = Math.min(120, (accumulatedKg / capacityKg) * 100);

      // Prévision : quand sera-t-il plein (80%)
      const targetKg = capacityKg * 0.8;
      const remainingKg = Math.max(0, targetKg - accumulatedKg);
      const daysToFull = dailyAccumulation > 0 ? Math.ceil(remainingKg / (dailyAccumulation * seasonalFactors[monthIndex])) : null;
      const predictedFullDate = daysToFull != null && daysToFull > 0
        ? new Date(now.getTime() + daysToFull * 86400000).toISOString().split('T')[0]
        : null;

      // Prochain passage estimé
      let nextPassage = null;
      if (cav.jours_collecte) {
        const jours = cav.jours_collecte.toLowerCase().split(/[,\/\s]+/).map(j => j.trim());
        const todayDay = now.getDay();
        let minDaysAhead = 8;
        for (const jour of jours) {
          const targetDay = JOURS_MAP[jour];
          if (targetDay !== undefined) {
            let diff = targetDay - todayDay;
            if (diff <= 0) diff += 7;
            if (diff < minDaysAhead) minDaysAhead = diff;
          }
        }
        if (minDaysAhead <= 7) {
          nextPassage = new Date(now.getTime() + minDaysAhead * 86400000).toISOString().split('T')[0];
        }
      }
      // Fallback: utiliser la fréquence moyenne
      if (!nextPassage && lastCollection && avgDaysBetween > 0) {
        const nextDate = new Date(lastCollection.getTime() + avgDaysBetween * 86400000);
        if (nextDate > now) {
          nextPassage = nextDate.toISOString().split('T')[0];
        } else {
          // Déjà en retard
          nextPassage = 'en retard';
        }
      }

      return {
        id: cav.id,
        name: cav.name,
        address: cav.address,
        commune: cav.commune,
        latitude: cav.latitude,
        longitude: cav.longitude,
        nb_containers: cav.nb_containers,
        tournee: cav.tournee,
        jours_collecte: cav.jours_collecte,
        fill_rate: Math.round(fillRate),
        days_since_collection: daysSinceCollection,
        last_collection: cav.last_collection,
        daily_accumulation_kg: Math.round(dailyAccumulation * 10) / 10,
        predicted_full_date: predictedFullDate,
        days_to_full: daysToFull != null ? Math.max(0, daysToFull) : null,
        next_passage: nextPassage,
        nb_collectes_90d: parseInt(cav.nb_collectes_90d) || 0,
        avg_weight_90d: Math.round(avgWeight * 10) / 10,
      };
    });

    // Stats globales
    const totalCav = cavData.length;
    const critical = cavData.filter(c => c.fill_rate >= 80).length;
    const warning = cavData.filter(c => c.fill_rate >= 40 && c.fill_rate < 80).length;
    const ok = cavData.filter(c => c.fill_rate < 40).length;

    res.json({
      stats: { total: totalCav, critical, warning, ok },
      cavs: cavData,
    });
  } catch (err) {
    console.error('[CAV] Erreur fill-rate :', err);
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
router.post('/scan-qr', [
  body('qr_data').notEmpty().withMessage('Données QR requises'),
], validate, async (req, res) => {
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

// GET /api/cav/:id/activity — Histogramme activite : 10j passe + 10j futur
router.get('/:id/activity', async (req, res) => {
  try {
    const cavId = req.params.id;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 1. Verifier que le CAV existe
    const cavResult = await pool.query('SELECT id, name, nb_containers, avg_fill_rate FROM cav WHERE id = $1', [cavId]);
    if (cavResult.rows.length === 0) return res.status(404).json({ error: 'CAV non trouve' });
    const cav = cavResult.rows[0];

    // 2. Historique des 10 derniers jours — collectes reelles
    const tenDaysAgo = new Date(today);
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const historyResult = await pool.query(
      `SELECT date, SUM(weight_kg) as poids_kg
       FROM tonnage_history
       WHERE cav_id = $1 AND date >= $2 AND date <= $3
       GROUP BY date ORDER BY date`,
      [cavId, tenDaysAgo.toISOString().slice(0, 10), today.toISOString().slice(0, 10)]
    );
    const collectsByDate = {};
    for (const row of historyResult.rows) {
      collectsByDate[new Date(row.date).toISOString().slice(0, 10)] = parseFloat(row.poids_kg);
    }

    // 3. Parametres de prediction
    const avgResult = await pool.query(
      `SELECT AVG(weight_kg) as avg_weight,
              COUNT(*) as nb_collectes
       FROM tonnage_history WHERE cav_id = $1 AND date >= NOW() - INTERVAL '90 days'`,
      [cavId]
    );
    const avgWeight = parseFloat(avgResult.rows[0].avg_weight) || 50;
    const nbCollectes90d = parseInt(avgResult.rows[0].nb_collectes) || 0;
    const avgDaysBetween = nbCollectes90d > 1 ? 90 / nbCollectes90d : 14;
    const dailyAccumulation = avgWeight / Math.max(avgDaysBetween, 1);
    const capacityKg = (cav.nb_containers || 1) * 150;

    // Facteurs saisonniers et jour de semaine
    const SEASONAL = [0.88, 0.82, 0.94, 1.05, 1.12, 0.99, 1.19, 1.27, 1.13, 1.02, 0.84, 0.75];
    const DOW = [1.1, 1.25, 1.09, 1.05, 0.49, 1.11, 1.15]; // dim, lun, mar, mer, jeu, ven, sam

    // 4. Construire les donnees jour par jour
    const days = [];

    // -- Historique : 10 derniers jours
    // On simule l'accumulation : chaque jour le conteneur se remplit, une collecte remet a zero
    let accumulatedKg = 0;
    for (let i = -10; i <= 10; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const monthIdx = d.getMonth();
      const dowIdx = d.getDay();
      const dailyRate = dailyAccumulation * SEASONAL[monthIdx] * DOW[dowIdx];

      if (i <= 0) {
        // Passe : donnees reelles ou estimation
        const collected = collectsByDate[dateStr] || 0;
        if (collected > 0) {
          // Jour de collecte : on enregistre le poids collecte puis on remet a zero
          days.push({
            date: dateStr,
            type: 'historique',
            collecte_kg: Math.round(collected * 10) / 10,
            accumulation_kg: Math.round(accumulatedKg * 10) / 10,
            fill_pct: Math.min(120, Math.round((accumulatedKg / capacityKg) * 100)),
          });
          accumulatedKg = 0; // reset apres collecte
        } else {
          accumulatedKg += dailyRate;
          days.push({
            date: dateStr,
            type: 'historique',
            collecte_kg: 0,
            accumulation_kg: Math.round(accumulatedKg * 10) / 10,
            fill_pct: Math.min(120, Math.round((accumulatedKg / capacityKg) * 100)),
          });
        }
      } else {
        // Futur : prediction d'accumulation
        accumulatedKg += dailyRate;
        const fillPct = Math.min(120, Math.round((accumulatedKg / capacityKg) * 100));
        days.push({
          date: dateStr,
          type: 'prevision',
          collecte_kg: 0,
          accumulation_kg: Math.round(accumulatedKg * 10) / 10,
          fill_pct: fillPct,
        });
      }
    }

    res.json({
      cav_id: cav.id,
      cav_name: cav.name,
      capacite_kg: capacityKg,
      accumulation_quotidienne_kg: Math.round(dailyAccumulation * 10) / 10,
      jours: days,
    });
  } catch (err) {
    console.error('[CAV] Erreur activity forecast :', err);
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
router.post('/', authorize('ADMIN', 'MANAGER'), [
  body('name').notEmpty().withMessage('Nom requis'),
  body('latitude').isFloat().withMessage('Latitude invalide'),
  body('longitude').isFloat().withMessage('Longitude invalide'),
], validate, async (req, res) => {
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

// ══════════════════════════════════════════
// CAPTEURS ULTRASONS (LoRaWAN)
// ══════════════════════════════════════════

// PUT /api/cav/:id/sensor — Associer un capteur à un CAV
router.put('/:id/sensor', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { sensor_reference, sensor_type, population_commune } = req.body;
    const result = await pool.query(
      `UPDATE cav SET sensor_reference = $1, sensor_type = COALESCE($2, 'ultrasonic'),
       population_commune = COALESCE($3, population_commune)
       WHERE id = $4 RETURNING id, name, sensor_reference, sensor_type, population_commune`,
      [sensor_reference, sensor_type, population_commune, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'CAV non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CAV] Erreur sensor PUT :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cav/sensor-reading — Réception d'une lecture capteur (webhook LoRaWAN ou polling)
router.post('/sensor-reading', [
  body('sensor_reference').notEmpty().withMessage('Référence capteur requise'),
  body('fill_level_percent').isFloat({ min: 0, max: 120 }).withMessage('Niveau de remplissage invalide'),
], validate, async (req, res) => {
  try {
    const { sensor_reference, fill_level_percent, distance_cm, battery_level, temperature, rssi, raw_data } = req.body;
    if (!sensor_reference || fill_level_percent == null) {
      return res.status(400).json({ error: 'sensor_reference et fill_level_percent requis' });
    }

    // Trouver le CAV par référence capteur
    const cav = await pool.query('SELECT id FROM cav WHERE sensor_reference = $1', [sensor_reference]);
    if (cav.rows.length === 0) return res.status(404).json({ error: 'Capteur non associé à un CAV' });
    const cavId = cav.rows[0].id;

    // Enregistrer la lecture
    await pool.query(
      `INSERT INTO cav_sensor_readings (cav_id, sensor_reference, fill_level_percent, distance_cm, battery_level, temperature, rssi, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [cavId, sensor_reference, fill_level_percent, distance_cm, battery_level, temperature, rssi, raw_data ? JSON.stringify(raw_data) : null]
    );

    // Mettre à jour le CAV
    await pool.query(
      `UPDATE cav SET sensor_last_reading = $1, sensor_last_reading_at = NOW(),
       estimated_fill_rate = $1 WHERE id = $2`,
      [fill_level_percent, cavId]
    );

    res.json({ ok: true, cav_id: cavId, fill_level_percent });
  } catch (err) {
    console.error('[CAV] Erreur sensor reading :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/cav/:id/sensor-history — Historique lectures capteur
router.get('/:id/sensor-history', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const result = await pool.query(
      `SELECT fill_level_percent, distance_cm, battery_level, temperature, reading_at
       FROM cav_sensor_readings WHERE cav_id = $1
       AND reading_at >= NOW() - make_interval(days => $2)
       ORDER BY reading_at DESC`,
      [req.params.id, days]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[CAV] Erreur sensor history :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
