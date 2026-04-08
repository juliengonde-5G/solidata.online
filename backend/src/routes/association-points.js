const express = require('express');
const router = express.Router();
const https = require('https');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');

router.use(authenticate);
router.use(autoLogActivity('association-points'));

// ══════════════════════════════════════════
// Géocodage via API adresse.data.gouv.fr
// ══════════════════════════════════════════
function geocodeAddress(address, city, postcode) {
  return new Promise((resolve) => {
    if (!address || !city) { resolve(null); return; }
    const query = encodeURIComponent(`${address} ${city}`);
    const url = `https://api-adresse.data.gouv.fr/search/?q=${query}${postcode ? `&postcode=${postcode}` : ''}&limit=1`;

    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.features && json.features.length > 0) {
            const [lng, lat] = json.features[0].geometry.coordinates;
            const label = json.features[0].properties.label;
            resolve({ latitude: lat, longitude: lng, label });
          } else {
            resolve(null);
          }
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

// GET /api/association-points — Liste avec filtres
router.get('/', async (req, res) => {
  try {
    const { status, ville, search } = req.query;
    let query = 'SELECT * FROM association_points WHERE 1=1';
    const params = [];

    if (status) { params.push(status); query += ` AND status = $${params.length}`; }
    if (ville) { params.push(ville); query += ` AND ville = $${params.length}`; }
    if (search) { params.push(`%${search}%`); query += ` AND (name ILIKE $${params.length} OR address ILIKE $${params.length} OR ville ILIKE $${params.length})`; }

    query += ' ORDER BY name';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[ASSO-POINTS] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/association-points/villes — Liste des villes distinctes
router.get('/villes', async (req, res) => {
  try {
    const result = await pool.query("SELECT DISTINCT ville FROM association_points WHERE ville IS NOT NULL AND ville != '' ORDER BY ville");
    res.json(result.rows.map(r => r.ville));
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/association-points/map — Données carte
router.get('/map', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ap.id, ap.name, ap.address, ap.complement_adresse, ap.code_postal, ap.ville,
        ap.latitude, ap.longitude, ap.contact_phone, ap.avg_fill_rate, ap.status,
        ap.unavailable_reason, ap.route_count,
        (SELECT MAX(tha.date) FROM tonnage_history_association tha WHERE tha.association_point_id = ap.id) as last_collection,
        (SELECT AVG(tha.weight_kg) FROM tonnage_history_association tha WHERE tha.association_point_id = ap.id
         AND tha.date >= NOW() - INTERVAL '90 days') as avg_weight_90d
      FROM association_points ap
      WHERE ap.status IN ('active', 'temporairement_indisponible')
      ORDER BY ap.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[ASSO-POINTS] Erreur map :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/association-points/geocode — Géocoder une adresse
router.post('/geocode', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { address, city, postcode } = req.body;
    const result = await geocodeAddress(address, city, postcode);
    if (result) {
      res.json(result);
    } else {
      res.status(404).json({ error: 'Adresse non trouvée' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Erreur de géocodage' });
  }
});

// GET /api/association-points/:id — Détail d'un point
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM association_points WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Point non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/association-points — Créer un point
router.post('/', authorize('ADMIN', 'MANAGER'), [
  body('name').notEmpty().withMessage('Nom requis'),
], validate, async (req, res) => {
  try {
    const { name, address, complement_adresse, code_postal, ville, latitude, longitude, contact_phone, contact_info } = req.body;

    // Géocodage auto si pas de coordonnées fournies
    let lat = latitude ? parseFloat(latitude) : null;
    let lng = longitude ? parseFloat(longitude) : null;
    if (!lat && !lng && address && ville) {
      const geo = await geocodeAddress(address, ville, code_postal);
      if (geo) { lat = geo.latitude; lng = geo.longitude; }
    }

    const result = await pool.query(
      `INSERT INTO association_points (name, address, complement_adresse, code_postal, ville, latitude, longitude, geom, contact_phone, contact_info)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
         ${lat && lng ? `ST_SetSRID(ST_MakePoint($7, $6), 4326)` : 'NULL'},
         $8, $9) RETURNING *`,
      [name, address || null, complement_adresse || null, code_postal || null, ville || null, lat, lng, contact_phone || null, contact_info || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[ASSO-POINTS] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/association-points/:id — Modifier un point
router.put('/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { name, address, complement_adresse, code_postal, ville, latitude, longitude, contact_phone, contact_info, status, unavailable_reason } = req.body;

    let lat = latitude ? parseFloat(latitude) : null;
    let lng = longitude ? parseFloat(longitude) : null;

    // Géocodage auto si adresse modifiée sans coordonnées
    if (!lat && !lng && address && ville) {
      const geo = await geocodeAddress(address, ville, code_postal);
      if (geo) { lat = geo.latitude; lng = geo.longitude; }
    }

    const result = await pool.query(
      `UPDATE association_points SET
        name = COALESCE($1, name),
        address = COALESCE($2, address),
        complement_adresse = $3,
        code_postal = COALESCE($4, code_postal),
        ville = COALESCE($5, ville),
        latitude = COALESCE($6, latitude),
        longitude = COALESCE($7, longitude),
        geom = ${lat && lng ? `ST_SetSRID(ST_MakePoint($7, $6), 4326)` : 'COALESCE(geom, NULL)'},
        contact_phone = $8,
        contact_info = $9,
        status = COALESCE($10, status),
        unavailable_reason = $11,
        unavailable_since = CASE WHEN $10 = 'temporairement_indisponible' AND status != 'temporairement_indisponible' THEN CURRENT_DATE ELSE unavailable_since END,
        updated_at = NOW()
       WHERE id = $12 RETURNING *`,
      [name, address, complement_adresse || null, code_postal, ville, lat, lng, contact_phone || null, contact_info || null, status, unavailable_reason || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Point non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[ASSO-POINTS] Erreur mise à jour :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/association-points/:id — Supprimer un point
router.delete('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM association_points WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Point non trouvé' });
    res.json({ message: 'Point supprimé' });
  } catch (err) {
    console.error('[ASSO-POINTS] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/association-points/:id/geocode — Regéocoder un point existant
router.post('/:id/geocode', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const point = await pool.query('SELECT address, ville, code_postal FROM association_points WHERE id = $1', [req.params.id]);
    if (point.rows.length === 0) return res.status(404).json({ error: 'Point non trouvé' });

    const { address, ville, code_postal } = point.rows[0];
    const geo = await geocodeAddress(address, ville, code_postal);
    if (!geo) return res.status(404).json({ error: 'Adresse non trouvée par le géocodeur' });

    await pool.query(
      `UPDATE association_points SET latitude = $1, longitude = $2, geom = ST_SetSRID(ST_MakePoint($2, $1), 4326), updated_at = NOW() WHERE id = $3`,
      [geo.latitude, geo.longitude, req.params.id]
    );
    res.json({ latitude: geo.latitude, longitude: geo.longitude, label: geo.label });
  } catch (err) {
    res.status(500).json({ error: 'Erreur de géocodage' });
  }
});

module.exports = router;
