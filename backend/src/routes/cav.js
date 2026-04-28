const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');

// Multer pour upload photo CAV
const cavPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads', 'cav-photos');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `cav_${req.params.id}_${Date.now()}${ext}`);
  },
});
const uploadCavPhoto = multer({
  storage: cavPhotoStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

router.use(authenticate);
router.use(autoLogActivity('cav'));

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

// GET /api/cav/map — Données carte avec remplissage unifié (capteur si frais, sinon heuristique)
router.get('/map', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.name, c.address, c.commune, c.latitude, c.longitude,
        c.nb_containers, c.avg_fill_rate, c.status, c.unavailable_reason,
        c.route_count,
        c.lora_deveui, c.sensor_reference,
        c.sensor_last_reading, c.sensor_last_reading_at,
        c.sensor_battery_level, c.sensor_last_rssi, c.sensor_status,
        (SELECT MAX(th.date) FROM tonnage_history th WHERE th.cav_id = c.id) as last_collection,
        (SELECT AVG(th.weight_kg) FROM tonnage_history th WHERE th.cav_id = c.id
         AND th.date >= NOW() - INTERVAL '90 days') as avg_weight_90d
      FROM cav c
      WHERE c.status = 'active'
      ORDER BY c.name
    `);

    const now = new Date();
    const monthIndex = now.getMonth();
    const seasonalFactors = [0.8, 0.85, 0.95, 1.05, 1.15, 1.2, 1.15, 1.1, 1.05, 0.95, 0.85, 0.8];
    const freshnessMs = (parseInt(process.env.SENSOR_FRESHNESS_HOURS, 10) || 8) * 3600 * 1000;

    const cavWithFill = result.rows.map(cav => {
      const daysSinceCollection = cav.last_collection
        ? Math.floor((now - new Date(cav.last_collection)) / (86400000))
        : 30;
      const avgWeight = parseFloat(cav.avg_weight_90d) || 50;
      const dailyAccumulation = avgWeight / 7;
      const rawFill = (daysSinceCollection * dailyAccumulation / (cav.nb_containers || 1)) * 100;
      const calculatedFill = Math.min(120, rawFill * seasonalFactors[monthIndex]);

      // Fusion capteur / heuristique
      const sensorFresh = cav.sensor_last_reading_at &&
        (now - new Date(cav.sensor_last_reading_at)) < freshnessMs &&
        cav.sensor_last_reading != null;
      const fill_source = sensorFresh ? 'sensor' : 'calculated';
      const fill_rate = sensorFresh ? Math.round(parseFloat(cav.sensor_last_reading)) : Math.round(calculatedFill);

      return {
        ...cav,
        fill_rate,
        fill_source,
        estimated_fill_rate: Math.round(calculatedFill), // compat frontend existant
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
        c.lora_deveui, c.sensor_reference,
        c.sensor_last_reading, c.sensor_last_reading_at,
        c.sensor_battery_level, c.sensor_last_rssi, c.sensor_status,
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
    const freshnessMs = (parseInt(process.env.SENSOR_FRESHNESS_HOURS, 10) || 8) * 3600 * 1000;

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
      // Le volume repart à zéro après chaque collecte (daysSinceCollection)
      const dailyAccumulation = avgWeight / Math.max(avgDaysBetween, 1);
      const accumulatedKg = daysSinceCollection * dailyAccumulation * seasonalFactors[monthIndex];
      const calculatedFill = Math.min(120, (accumulatedKg / capacityKg) * 100);

      // Fusion capteur / heuristique
      const sensorFresh = cav.sensor_last_reading_at &&
        (now - new Date(cav.sensor_last_reading_at)) < freshnessMs &&
        cav.sensor_last_reading != null;
      const fill_source = sensorFresh ? 'sensor' : 'calculated';
      const fillRate = sensorFresh ? parseFloat(cav.sensor_last_reading) : calculatedFill;

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
        fill_source,
        calculated_fill_rate: Math.round(calculatedFill),
        sensor_last_reading: cav.sensor_last_reading != null ? parseFloat(cav.sensor_last_reading) : null,
        sensor_last_reading_at: cav.sensor_last_reading_at,
        sensor_battery_level: cav.sensor_battery_level,
        sensor_last_rssi: cav.sensor_last_rssi,
        sensor_status: cav.sensor_status,
        lora_deveui: cav.lora_deveui,
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

// GET /api/cav/qr-sheets/:format — Télécharger la planche PDF des QR codes (A7 ou A8)
router.get('/qr-sheets/:format', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const format = (req.params.format || 'A7').toUpperCase();
    if (!['A7', 'A8'].includes(format)) {
      return res.status(400).json({ error: 'Format invalide. Utilisez A7 ou A8.' });
    }

    const { generateSheets } = require('../scripts/generate-qr-sheets');
    const outputPath = await generateSheets({ format });

    res.download(outputPath, `SOLIDATA_QR_CAV_${format}_${new Date().toISOString().slice(0, 10)}.pdf`, (err) => {
      if (err) {
        console.error('[CAV] Erreur téléchargement planche QR :', err);
        if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
      }
    });
  } catch (err) {
    console.error('[CAV] Erreur génération planche QR :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cav/:id/photo — Upload photo d'un CAV
router.post('/:id/photo', authorize('ADMIN', 'MANAGER'), uploadCavPhoto.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucune photo fournie (jpg, png, webp, max 10 Mo)' });

    // Supprimer l'ancienne photo si elle existe
    const old = await pool.query('SELECT photo_path FROM cav WHERE id = $1', [req.params.id]);
    if (old.rows.length > 0 && old.rows[0].photo_path) {
      const oldPath = path.join(__dirname, '..', '..', old.rows[0].photo_path);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const photoPath = `/uploads/cav-photos/${req.file.filename}`;
    const result = await pool.query(
      'UPDATE cav SET photo_path = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [photoPath, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'CAV non trouvé' });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CAV] Erreur upload photo :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/cav/:id/photo — Supprimer la photo d'un CAV
router.delete('/:id/photo', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const old = await pool.query('SELECT photo_path FROM cav WHERE id = $1', [req.params.id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'CAV non trouvé' });

    if (old.rows[0].photo_path) {
      const oldPath = path.join(__dirname, '..', '..', old.rows[0].photo_path);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    await pool.query('UPDATE cav SET photo_path = NULL, updated_at = NOW() WHERE id = $1', [req.params.id]);
    res.json({ message: 'Photo supprimée' });
  } catch (err) {
    console.error('[CAV] Erreur suppression photo :', err);
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
    const cavResult = await pool.query(
      'SELECT id, name, nb_containers, avg_fill_rate, lora_deveui, sensor_reference FROM cav WHERE id = $1',
      [cavId]
    );
    if (cavResult.rows.length === 0) return res.status(404).json({ error: 'CAV non trouve' });
    const cav = cavResult.rows[0];
    const hasSensor = !!(cav.lora_deveui || cav.sensor_reference);

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

    // 2b. Si capteur LoRaWAN provisionné : récupérer la moyenne quotidienne réelle
    //     du fill_level_percent sur les 10 derniers jours (issue de cav_sensor_readings)
    const sensorByDate = {};
    if (hasSensor) {
      const sensorRows = await pool.query(
        `SELECT
           DATE(reading_at) AS d,
           AVG(fill_level_percent) AS avg_fill,
           MAX(fill_level_percent) AS max_fill,
           COUNT(*) AS nb_readings
         FROM cav_sensor_readings
         WHERE cav_id = $1
           AND reading_at >= $2::date
           AND reading_at < ($3::date + INTERVAL '1 day')
         GROUP BY DATE(reading_at)
         ORDER BY d`,
        [cavId, tenDaysAgo.toISOString().slice(0, 10), today.toISOString().slice(0, 10)]
      );
      for (const row of sensorRows.rows) {
        sensorByDate[new Date(row.d).toISOString().slice(0, 10)] = {
          fill_pct: Math.min(120, Math.round(parseFloat(row.avg_fill))),
          max_fill: Math.min(120, Math.round(parseFloat(row.max_fill))),
          nb_readings: parseInt(row.nb_readings, 10),
        };
      }
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
        const sensorDay = sensorByDate[dateStr];
        if (collected > 0) {
          // Jour de collecte : on enregistre le poids collecte puis on remet a zero
          days.push({
            date: dateStr,
            type: 'historique',
            source: sensorDay ? 'sensor' : 'estimated',
            collecte_kg: Math.round(collected * 10) / 10,
            accumulation_kg: Math.round(accumulatedKg * 10) / 10,
            fill_pct: sensorDay ? sensorDay.fill_pct : Math.min(120, Math.round((accumulatedKg / capacityKg) * 100)),
            ...(sensorDay ? { sensor_max_fill: sensorDay.max_fill, sensor_nb_readings: sensorDay.nb_readings } : {}),
          });
          accumulatedKg = 0; // reset apres collecte
        } else if (sensorDay) {
          // Capteur LoRaWAN : valeur réelle du jour (moyenne des relevés)
          days.push({
            date: dateStr,
            type: 'historique',
            source: 'sensor',
            collecte_kg: 0,
            accumulation_kg: Math.round((sensorDay.fill_pct / 100) * capacityKg * 10) / 10,
            fill_pct: sensorDay.fill_pct,
            sensor_max_fill: sensorDay.max_fill,
            sensor_nb_readings: sensorDay.nb_readings,
          });
          // Synchroniser l'accumulation pour la prévision future
          accumulatedKg = (sensorDay.fill_pct / 100) * capacityKg;
        } else {
          accumulatedKg += dailyRate;
          days.push({
            date: dateStr,
            type: 'historique',
            source: 'estimated',
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
      has_sensor: hasSensor,
      sensor_days_with_data: Object.keys(sensorByDate).length,
      jours: days,
    });
  } catch (err) {
    console.error('[CAV] Erreur activity forecast :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// GESTION DE LA FLOTTE DE CAPTEURS LoRaWAN
// (déclaré avant /:id pour éviter la collision d'URL)
// ══════════════════════════════════════════

// GET /api/cav/sensors — Liste de la flotte capteurs (+ statut online/offline calculé)
router.get('/sensors', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id, c.name, c.commune, c.latitude, c.longitude,
        c.sensor_reference, c.sensor_type, c.lora_deveui,
        c.sensor_height_cm, c.sensor_install_date, c.sensor_reporting_interval_min,
        c.sensor_last_reading, c.sensor_last_reading_at,
        c.sensor_battery_level, c.sensor_last_rssi,
        CASE
          WHEN c.sensor_last_reading_at IS NULL THEN 'never'
          WHEN c.sensor_last_reading_at < NOW() - (COALESCE(c.sensor_reporting_interval_min, 360) * INTERVAL '2 minute') THEN 'offline'
          WHEN c.sensor_battery_level IS NOT NULL AND c.sensor_battery_level <= 20 THEN 'low_battery'
          ELSE 'active'
        END AS computed_status,
        c.sensor_status,
        (SELECT COUNT(*) FROM cav_sensor_alerts a WHERE a.cav_id = c.id AND a.resolved_at IS NULL) AS open_alerts
      FROM cav c
      WHERE c.lora_deveui IS NOT NULL OR c.sensor_reference IS NOT NULL
      ORDER BY c.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[CAV] Erreur liste sensors :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/cav/liveobjects-devices — Liste les devices déclarés côté Orange Live Objects,
// annotés avec l'assignation SOLIDATA actuelle (si le devEUI est déjà lié à un CAV).
router.get('/liveobjects-devices', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { listLoraDevices } = require('../services/liveobjects-api');
    const devices = await listLoraDevices();

    // Jointure avec la table cav pour marquer assigned/free
    const devEuis = devices.map((d) => d.devEui).filter(Boolean);
    let assignments = {};
    if (devEuis.length > 0) {
      const rows = await pool.query(
        'SELECT id, name, commune, lora_deveui FROM cav WHERE lora_deveui = ANY($1::text[])',
        [devEuis]
      );
      assignments = Object.fromEntries(rows.rows.map((r) => [r.lora_deveui, r]));
    }

    const enriched = devices.map((d) => ({
      ...d,
      assigned_cav: assignments[d.devEui] || null,
    }));

    res.json({
      total: enriched.length,
      assigned: enriched.filter((d) => d.assigned_cav).length,
      orphans: enriched.filter((d) => !d.assigned_cav).length,
      devices: enriched,
    });
  } catch (err) {
    console.error('[CAV] Erreur liveobjects-devices :', err);
    res.status(502).json({ error: err.message || 'Live Objects indisponible' });
  }
});

// POST /api/cav/sensors/alerts/:alertId/ack — Acquitter une alerte (déclaré avant /:id)
router.post('/sensors/alerts/:alertId/ack', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE cav_sensor_alerts
       SET acknowledged_at = NOW(), acknowledged_by = $1
       WHERE id = $2 AND acknowledged_at IS NULL
       RETURNING *`,
      [req.user.id, req.params.alertId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Alerte introuvable ou déjà acquittée' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CAV] Erreur ack alerte :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cav/:id/sensor/provision — Provisionner un capteur LoRaWAN complet
router.post('/:id/sensor/provision', authorize('ADMIN', 'MANAGER'), [
  body('dev_eui').isString().isLength({ min: 8 }).withMessage('DevEUI requis'),
  body('sensor_height_cm').isInt({ min: 30, max: 500 }).withMessage('Hauteur 30-500 cm requise'),
], validate, async (req, res) => {
  try {
    const { encryptAppKey } = require('../utils/lora-crypto');
    const {
      dev_eui, app_eui, app_key,
      sensor_reference, sensor_type, sensor_height_cm,
      sensor_install_date, sensor_reporting_interval_min,
    } = req.body;

    // Unicité du DevEUI
    const dup = await pool.query(
      'SELECT id FROM cav WHERE lora_deveui = $1 AND id <> $2',
      [dev_eui.toUpperCase(), req.params.id]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'Ce DevEUI est déjà associé à un autre CAV', cav_id: dup.rows[0].id });
    }

    const encrypted = app_key ? encryptAppKey(app_key) : null;
    const ref = sensor_reference || dev_eui.toUpperCase();

    const result = await pool.query(
      `UPDATE cav SET
         lora_deveui = $1,
         lora_appeui = $2,
         lora_appkey_encrypted = COALESCE($3, lora_appkey_encrypted),
         sensor_reference = $4,
         sensor_type = COALESCE($5, 'ultrasonic'),
         sensor_height_cm = $6,
         sensor_install_date = COALESCE($7, CURRENT_DATE),
         sensor_reporting_interval_min = COALESCE($8, 360),
         sensor_status = 'active'
       WHERE id = $9
       RETURNING id, name, lora_deveui, lora_appeui, sensor_reference, sensor_type,
                 sensor_height_cm, sensor_install_date, sensor_reporting_interval_min, sensor_status`,
      [
        dev_eui.toUpperCase(), app_eui || null, encrypted,
        ref, sensor_type, sensor_height_cm,
        sensor_install_date || null, sensor_reporting_interval_min || 360,
        req.params.id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'CAV non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CAV] Erreur provision sensor :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/cav/:id/sensor — Déprovisionner un capteur
router.delete('/:id/sensor', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE cav SET
         lora_deveui = NULL,
         lora_appeui = NULL,
         lora_appkey_encrypted = NULL,
         sensor_reference = NULL,
         sensor_height_cm = NULL,
         sensor_install_date = NULL,
         sensor_status = 'inactive',
         sensor_last_reading = NULL,
         sensor_last_reading_at = NULL,
         sensor_battery_level = NULL,
         sensor_last_rssi = NULL
       WHERE id = $1 RETURNING id, name`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'CAV non trouvé' });
    // Fermer les alertes ouvertes
    await pool.query(
      'UPDATE cav_sensor_alerts SET resolved_at = NOW() WHERE cav_id = $1 AND resolved_at IS NULL',
      [req.params.id]
    );
    res.json({ ok: true, ...result.rows[0] });
  } catch (err) {
    console.error('[CAV] Erreur déprovision sensor :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/cav/:id/sensor-status — Statut agrégé (dernière lecture + alertes ouvertes)
router.get('/:id/sensor-status', async (req, res) => {
  try {
    const cav = await pool.query(
      `SELECT id, name, lora_deveui, sensor_reference, sensor_type,
              sensor_height_cm, sensor_install_date, sensor_reporting_interval_min,
              sensor_last_reading, sensor_last_reading_at,
              sensor_battery_level, sensor_last_rssi, sensor_status
       FROM cav WHERE id = $1`,
      [req.params.id]
    );
    if (cav.rows.length === 0) return res.status(404).json({ error: 'CAV non trouvé' });

    const alerts = await pool.query(
      `SELECT id, alert_type, severity, message, triggered_at, acknowledged_at, acknowledged_by
       FROM cav_sensor_alerts WHERE cav_id = $1 AND resolved_at IS NULL
       ORDER BY triggered_at DESC`,
      [req.params.id]
    );

    const lastReadings = await pool.query(
      `SELECT fill_level_percent, distance_cm, battery_level, temperature, rssi, tilt_detected, reading_at
       FROM cav_sensor_readings WHERE cav_id = $1
       ORDER BY reading_at DESC LIMIT 10`,
      [req.params.id]
    );

    res.json({
      ...cav.rows[0],
      open_alerts: alerts.rows,
      recent_readings: lastReadings.rows,
    });
  } catch (err) {
    console.error('[CAV] Erreur sensor-status :', err);
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
    const { name, address, commune, latitude, longitude, nb_containers,
            communaute_communes, surface, ref_refashion, entite_detentrice, code_postal } = req.body;
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
       geom, nb_containers, qr_code_data, qr_code_image_path,
       communaute_communes, surface, ref_refashion, entite_detentrice, code_postal)
       VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($5, $4), 4326), $6, $7, $8,
               $9, $10, $11, $12, $13)
       RETURNING *`,
      [name, address, commune, latitude, longitude, nb_containers || 1, qrData, `/uploads/qrcodes/${qrFilename}`,
       communaute_communes || null, surface || null, ref_refashion || null, entite_detentrice || null, code_postal || null]
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
    const { name, address, commune, latitude, longitude, nb_containers, status, unavailable_reason,
            communaute_communes, surface, ref_refashion, entite_detentrice, code_postal } = req.body;

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
    if (communaute_communes !== undefined) { setClauses.push(`communaute_communes = $${i}`); values.push(communaute_communes); i++; }
    if (surface !== undefined) { setClauses.push(`surface = $${i}`); values.push(surface); i++; }
    if (ref_refashion !== undefined) { setClauses.push(`ref_refashion = $${i}`); values.push(ref_refashion); i++; }
    if (entite_detentrice !== undefined) { setClauses.push(`entite_detentrice = $${i}`); values.push(entite_detentrice); i++; }
    if (code_postal !== undefined) { setClauses.push(`code_postal = $${i}`); values.push(code_postal); i++; }
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

// POST /api/cav/sensor-reading — Réception d'une lecture capteur (ancien webhook, auth JWT).
// Préférer /api/webhooks/liveobjects/uplink côté Orange Live Objects (auth par X-Webhook-Secret).
// Cette route reste pour les scripts internes et la rétro-compatibilité.
router.post('/sensor-reading', [
  body('sensor_reference').optional().isString(),
  body('fill_level_percent').optional().isFloat({ min: 0, max: 120 }),
], validate, async (req, res) => {
  try {
    const { processUplink } = require('../services/liveobjects-processor');
    const io = req.app.get('io');
    const result = await processUplink(req.body, io);
    if (!result) return res.status(400).json({ error: 'Uplink non reconnu' });
    if (result.error === 'cav_not_found') return res.status(404).json({ error: 'Capteur non associé à un CAV' });
    if (result.error === 'fill_not_computable') {
      return res.status(400).json({ error: 'fill_level_percent ou (distance_cm + sensor_height_cm) requis' });
    }
    res.json(result);
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

// GET /api/cav/:id/sensor-readings-raw — Historique brut (toutes colonnes + payload JSON)
router.get('/:id/sensor-readings-raw', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const result = await pool.query(
      `SELECT id, sensor_reference, fill_level_percent, distance_cm,
              battery_level, temperature, rssi, snr, sf, fport, fcnt,
              tilt_detected, alarm_type, raw_data, reading_at, created_at
       FROM cav_sensor_readings WHERE cav_id = $1
       ORDER BY reading_at DESC LIMIT $2`,
      [req.params.id, limit]
    );
    res.json({ count: result.rows.length, readings: result.rows });
  } catch (err) {
    console.error('[CAV] Erreur sensor raw history :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/cav/:id/sensor-diagnostic — Diagnostic 4 couches : sonde / Live Objects / Solidata / BDD
router.get('/:id/sensor-diagnostic', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const cavResult = await pool.query(
      `SELECT id, name, commune, lora_deveui, sensor_reference, sensor_type,
              sensor_height_cm, sensor_install_date, sensor_reporting_interval_min,
              sensor_status, sensor_last_reading_at, sensor_battery_level
       FROM cav WHERE id = $1`,
      [req.params.id]
    );
    if (cavResult.rows.length === 0) return res.status(404).json({ error: 'CAV introuvable' });
    const cav = cavResult.rows[0];

    if (!cav.lora_deveui && !cav.sensor_reference) {
      return res.status(400).json({ error: 'Aucun capteur provisionné sur ce CAV' });
    }

    const reportingMin = cav.sensor_reporting_interval_min || 360; // défaut 6h
    const expectedGapMin = reportingMin * 2; // tolérance ×2

    // ───── Couche 1 : Sonde (config locale) ─────
    const layer1Issues = [];
    if (!cav.lora_deveui) layer1Issues.push('DevEUI manquant');
    if (!cav.sensor_height_cm) layer1Issues.push('Hauteur capteur non calibrée — fill_level ne peut pas être calculé');
    if (!cav.sensor_install_date) layer1Issues.push('Date d\'installation non renseignée');
    if (cav.sensor_status === 'inactive') layer1Issues.push('Statut configuré sur "inactive"');

    const layer1 = {
      name: 'Sonde',
      label: '1. Configuration sonde (SOLIDATA)',
      status: layer1Issues.length === 0 ? 'ok' : 'warning',
      details: {
        devEui: cav.lora_deveui,
        sensor_reference: cav.sensor_reference,
        sensor_type: cav.sensor_type,
        sensor_height_cm: cav.sensor_height_cm,
        sensor_install_date: cav.sensor_install_date,
        reporting_interval_min: reportingMin,
        sensor_status: cav.sensor_status,
      },
      issues: layer1Issues,
    };

    // ───── Couche 2 : Plateforme Orange Live Objects ─────
    let layer2 = {
      name: 'Live Objects',
      label: '2. Plateforme Orange Live Objects',
      status: 'unknown',
      details: {},
      issues: [],
    };
    try {
      const { findLoraDeviceByDevEui } = require('../services/liveobjects-api');
      if (!process.env.LIVEOBJECTS_API_KEY) {
        layer2.status = 'error';
        layer2.issues.push('LIVEOBJECTS_API_KEY non configuré côté SOLIDATA — impossible d\'interroger Live Objects');
      } else if (!cav.lora_deveui) {
        layer2.status = 'warning';
        layer2.issues.push('Pas de DevEUI à chercher dans Live Objects');
      } else {
        const device = await findLoraDeviceByDevEui(cav.lora_deveui);
        if (!device) {
          layer2.status = 'error';
          layer2.issues.push(`Le DevEUI ${cav.lora_deveui} n'existe pas (ou n'est pas visible) côté Live Objects — provisioning Orange manquant ou clé API limitée`);
        } else {
          layer2.details = {
            id: device.id,
            name: device.name,
            tags: device.tags,
            group: device.group,
            profile: device.profile,
            status: device.status,
            lastUplinkAt: device.lastUplinkAt,
          };
          if (!device.lastUplinkAt) {
            layer2.status = 'error';
            layer2.issues.push('Aucun uplink reçu côté Live Objects — la sonde ne transmet pas (couverture LoRa, batterie HS, ou non activée)');
          } else {
            const ageMs = Date.now() - new Date(device.lastUplinkAt).getTime();
            const ageMin = Math.round(ageMs / 60000);
            layer2.details.minutes_since_last_uplink = ageMin;
            if (ageMin > expectedGapMin) {
              layer2.status = 'warning';
              layer2.issues.push(`Dernier uplink Orange il y a ${formatDuration(ageMin)} (>${formatDuration(expectedGapMin)}, attendu toutes les ${formatDuration(reportingMin)})`);
            } else {
              layer2.status = 'ok';
            }
          }
        }
      }
    } catch (err) {
      layer2.status = 'error';
      layer2.issues.push(`API Live Objects injoignable : ${err.message}`);
    }

    // ───── Couche 3 : Réception SOLIDATA (webhook + MQTT) ─────
    const layer3Issues = [];
    const webhookConfigured = !!process.env.LIVEOBJECTS_WEBHOOK_SECRET;
    let mqttStatus;
    try {
      const { getMqttStatus } = require('../services/liveobjects-mqtt');
      mqttStatus = getMqttStatus();
    } catch (_) {
      mqttStatus = { error: 'service mqtt indisponible' };
    }
    if (!webhookConfigured && !(mqttStatus.enabled && mqttStatus.connected)) {
      layer3Issues.push('Aucun canal de réception actif (ni webhook, ni MQTT)');
    } else {
      if (!webhookConfigured) layer3Issues.push('Webhook HTTP désactivé (LIVEOBJECTS_WEBHOOK_SECRET manquant)');
      if (mqttStatus.enabled) {
        if (!mqttStatus.has_api_key) layer3Issues.push('MQTT activé mais LIVEOBJECTS_API_KEY manquant');
        else if (!mqttStatus.fifo_name) layer3Issues.push('MQTT activé mais LIVEOBJECTS_FIFO_NAME manquant');
        else if (!mqttStatus.connected) layer3Issues.push(`MQTT non connecté (tentatives: ${mqttStatus.reconnect_attempts}${mqttStatus.last_error ? ', dernière erreur: ' + mqttStatus.last_error.message : ''})`);
      }
    }
    const layer3 = {
      name: 'Réception SOLIDATA',
      label: '3. Réception SOLIDATA (webhook HTTP / MQTT FIFO)',
      status: layer3Issues.length === 0 ? 'ok' : 'warning',
      details: {
        webhook_configured: webhookConfigured,
        webhook_url_path: '/api/webhooks/liveobjects/uplink',
        mqtt: mqttStatus,
      },
      issues: layer3Issues,
    };

    // ───── Couche 4 : Stockage & affichage (BDD cav_sensor_readings) ─────
    const dbStats = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE reading_at >= NOW() - INTERVAL '24 hours')::int AS last_24h,
         COUNT(*) FILTER (WHERE reading_at >= NOW() - INTERVAL '7 days')::int AS last_7d,
         MAX(reading_at) AS last_reading_at,
         MIN(reading_at) AS first_reading_at,
         MAX(fcnt) AS last_fcnt
       FROM cav_sensor_readings WHERE cav_id = $1`,
      [cav.id]
    );
    const dbRow = dbStats.rows[0];
    const layer4Issues = [];
    if (dbRow.total === 0) {
      layer4Issues.push('Aucune transaction enregistrée en BDD — vérifier les couches 2 et 3');
    } else if (dbRow.last_reading_at) {
      const ageMin = Math.round((Date.now() - new Date(dbRow.last_reading_at).getTime()) / 60000);
      if (ageMin > expectedGapMin) {
        layer4Issues.push(`Dernière transaction reçue il y a ${formatDuration(ageMin)} (>${formatDuration(expectedGapMin)} attendu)`);
      }
    }

    // Cohérence Live Objects vs BDD : si Orange a un uplink récent mais nous non, le pipeline 2→3 a un souci
    if (layer2.status === 'ok' && dbRow.total === 0) {
      layer3Issues.push('Live Objects reçoit des uplinks mais aucune transaction n\'arrive en BDD : webhook non configuré côté Orange ou MQTT FIFO non abonnée');
      layer3.status = 'error';
      layer3.issues = layer3Issues;
    }
    if (layer2.details?.lastUplinkAt && dbRow.last_reading_at) {
      const orangeAge = Date.now() - new Date(layer2.details.lastUplinkAt).getTime();
      const dbAge = Date.now() - new Date(dbRow.last_reading_at).getTime();
      if (dbAge - orangeAge > 30 * 60 * 1000) {
        // décalage > 30 min entre Orange et SOLIDATA
        layer3Issues.push(`Décalage entre dernier uplink Orange et BDD : ${formatDuration(Math.round((dbAge - orangeAge) / 60000))} de retard côté SOLIDATA`);
        if (layer3.status === 'ok') layer3.status = 'warning';
        layer3.issues = layer3Issues;
      }
    }

    const layer4 = {
      name: 'Stockage & affichage',
      label: '4. Stockage BDD cav_sensor_readings',
      status: layer4Issues.length === 0 && dbRow.total > 0 ? 'ok' : (dbRow.total === 0 ? 'error' : 'warning'),
      details: {
        total: dbRow.total,
        last_24h: dbRow.last_24h,
        last_7d: dbRow.last_7d,
        first_reading_at: dbRow.first_reading_at,
        last_reading_at: dbRow.last_reading_at,
        last_fcnt: dbRow.last_fcnt,
      },
      issues: layer4Issues,
    };

    // ───── Recommandations ─────
    const recommendations = [];
    if (layer1.status !== 'ok') recommendations.push("Compléter la calibration côté SOLIDATA (hauteur capteur, date d'installation).");
    if (layer2.status === 'error') {
      if (layer2.issues.some((i) => i.includes('API_KEY'))) recommendations.push('Renseigner LIVEOBJECTS_API_KEY dans /opt/solidata.online/.env puis redémarrer le backend.');
      else if (layer2.issues.some((i) => i.includes('n\'existe pas'))) recommendations.push('Provisionner le device dans Orange Live Objects (Devices → Create) ou vérifier le DevEUI.');
      else if (layer2.issues.some((i) => i.includes('Aucun uplink'))) recommendations.push('Vérifier la sonde sur site : alimentation, couverture LoRa du gateway le plus proche, activation OTAA (AppKey/AppEUI corrects).');
    }
    if (layer3.status !== 'ok') {
      if (!webhookConfigured && !mqttStatus.enabled) {
        recommendations.push('Activer un canal de réception : soit le webhook HTTP (LIVEOBJECTS_WEBHOOK_SECRET) soit MQTT (LIVEOBJECTS_ENABLED=true + LIVEOBJECTS_API_KEY + LIVEOBJECTS_FIFO_NAME).');
      } else if (mqttStatus.enabled && !mqttStatus.connected) {
        recommendations.push('Vérifier le compte Live Objects et le nom de FIFO. Logs serveur : grep "LiveObjects MQTT" backend logs.');
      }
      if (layer2.status === 'ok' && dbRow.total === 0) {
        recommendations.push("Côté Orange : créer un connector HTTP Push vers https://solidata.online/api/webhooks/liveobjects/uplink avec header X-Webhook-Secret = LIVEOBJECTS_WEBHOOK_SECRET, ou s'abonner à la FIFO LIVEOBJECTS_FIFO_NAME via MQTT.");
      }
    }
    if (layer4.status === 'ok' && layer1.status === 'ok' && layer2.status === 'ok' && layer3.status === 'ok') {
      recommendations.push('Chaîne de bout en bout fonctionnelle. Si l\'UI ne montre pas les données, recharger /admin-sensors (Ctrl+F5).');
    }

    res.json({
      cav_id: cav.id,
      cav_name: cav.name,
      cav_commune: cav.commune,
      generated_at: new Date(),
      layers: [layer1, layer2, layer3, layer4],
      recommendations,
    });
  } catch (err) {
    console.error('[CAV] Erreur sensor-diagnostic :', err);
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
});

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${minutes % 60 ? ` ${minutes % 60}min` : ''}`;
  const days = Math.floor(hours / 24);
  return `${days}j${hours % 24 ? ` ${hours % 24}h` : ''}`;
}

// POST /api/cav/sensors/reassign — Déplacer un capteur du CAV source vers un CAV cible
// Conserve devEUI/appKey/référence, ne touche pas l'historique des lectures (cav_id reste sur source)
router.post('/sensors/reassign', authorize('ADMIN', 'MANAGER'), [
  body('source_cav_id').isInt().withMessage('source_cav_id requis'),
  body('target_cav_id').isInt().withMessage('target_cav_id requis'),
], validate, async (req, res) => {
  const { source_cav_id, target_cav_id } = req.body;
  if (source_cav_id === target_cav_id) {
    return res.status(400).json({ error: 'CAV source et cible identiques' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Charger l'état du capteur sur source
    const src = await client.query(
      `SELECT lora_deveui, lora_appeui, lora_appkey_encrypted, sensor_reference,
              sensor_type, sensor_height_cm, sensor_install_date, sensor_reporting_interval_min
       FROM cav WHERE id = $1`,
      [source_cav_id]
    );
    if (src.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'CAV source introuvable' });
    }
    if (!src.rows[0].lora_deveui && !src.rows[0].sensor_reference) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucun capteur provisionné sur le CAV source' });
    }
    const sensor = src.rows[0];

    // 2. Vérifier que le CAV cible existe et n'a pas déjà un capteur
    const tgt = await client.query(
      'SELECT id, lora_deveui, sensor_reference FROM cav WHERE id = $1',
      [target_cav_id]
    );
    if (tgt.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'CAV cible introuvable' });
    }
    if (tgt.rows[0].lora_deveui || tgt.rows[0].sensor_reference) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Le CAV cible a déjà un capteur — déprovisionner d\'abord' });
    }

    // 3. Détacher du source (ne réinitialise PAS sensor_last_*, on les déplace)
    await client.query(
      `UPDATE cav SET
         lora_deveui = NULL, lora_appeui = NULL, lora_appkey_encrypted = NULL,
         sensor_reference = NULL, sensor_type = NULL,
         sensor_height_cm = NULL, sensor_install_date = NULL,
         sensor_reporting_interval_min = NULL, sensor_status = 'inactive',
         sensor_last_reading = NULL, sensor_last_reading_at = NULL,
         sensor_battery_level = NULL, sensor_last_rssi = NULL
       WHERE id = $1`,
      [source_cav_id]
    );
    // Fermer alertes ouvertes côté source
    await client.query(
      'UPDATE cav_sensor_alerts SET resolved_at = NOW() WHERE cav_id = $1 AND resolved_at IS NULL',
      [source_cav_id]
    );

    // 4. Attacher au cible
    const result = await client.query(
      `UPDATE cav SET
         lora_deveui = $1, lora_appeui = $2, lora_appkey_encrypted = $3,
         sensor_reference = $4, sensor_type = $5,
         sensor_height_cm = $6, sensor_install_date = $7,
         sensor_reporting_interval_min = $8, sensor_status = 'active'
       WHERE id = $9
       RETURNING id, name, lora_deveui, sensor_reference, sensor_type, sensor_height_cm`,
      [
        sensor.lora_deveui, sensor.lora_appeui, sensor.lora_appkey_encrypted,
        sensor.sensor_reference, sensor.sensor_type,
        sensor.sensor_height_cm, sensor.sensor_install_date,
        sensor.sensor_reporting_interval_min, target_cav_id,
      ]
    );

    await client.query('COMMIT');
    res.json({
      ok: true,
      message: 'Capteur réaffecté',
      source: { id: source_cav_id },
      target: result.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[CAV] Erreur reassign sensor :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

module.exports = router;
