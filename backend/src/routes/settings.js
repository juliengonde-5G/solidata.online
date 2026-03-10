const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('ADMIN'));

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM settings ORDER BY category, key');
    res.json(result.rows);
  } catch (err) {
    console.error('[SETTINGS] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/settings/:key
router.put('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    const result = await pool.query(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
       RETURNING *`,
      [key, value]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[SETTINGS] Erreur modification :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/settings/templates
router.get('/templates', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM message_templates ORDER BY category, name');
    res.json(result.rows);
  } catch (err) {
    console.error('[SETTINGS] Erreur templates :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/settings/templates
router.post('/templates', async (req, res) => {
  try {
    const { name, type, category, subject, body, variables } = req.body;

    if (!name || !type || !category || !body) {
      return res.status(400).json({ error: 'Champs requis : name, type, category, body' });
    }

    const result = await pool.query(
      `INSERT INTO message_templates (name, type, category, subject, body, variables)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, type, category, subject, body, variables || []]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[SETTINGS] Erreur création template :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/settings/templates/:id
router.put('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, category, subject, body, variables, is_active } = req.body;

    const result = await pool.query(
      `UPDATE message_templates SET
       name = COALESCE($1, name), type = COALESCE($2, type),
       category = COALESCE($3, category), subject = COALESCE($4, subject),
       body = COALESCE($5, body), variables = COALESCE($6, variables),
       is_active = COALESCE($7, is_active), updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [name, type, category, subject, body, variables, is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template non trouvé' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[SETTINGS] Erreur modification template :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// Grille tarifaire
// ══════════════════════════════════════════

// GET /api/settings/tarifs?annee=2026
router.get('/tarifs', async (req, res) => {
  try {
    const annee = parseInt(req.query.annee) || new Date().getFullYear();
    const result = await pool.query(
      `SELECT g.*, e.nom AS exutoire_nom
       FROM grille_tarifaire g
       LEFT JOIN exutoires e ON e.id = g.exutoire_id
       WHERE g.annee = $1
       ORDER BY g.type, e.nom, g.trimestre`,
      [annee]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[SETTINGS] Erreur tarifs :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/settings/tarifs — upsert a tariff line
router.put('/tarifs', async (req, res) => {
  try {
    const { annee, type, exutoire_id, prix_tonne, trimestre } = req.body;
    if (!annee || !type || prix_tonne == null) {
      return res.status(400).json({ error: 'Champs requis : annee, type, prix_tonne' });
    }
    const exId = exutoire_id || null;
    const tri = trimestre ? parseInt(trimestre) : null;

    // Check if row exists (matching the COALESCE unique index)
    const existing = await pool.query(
      `SELECT id FROM grille_tarifaire
       WHERE annee = $1 AND type = $2
         AND COALESCE(exutoire_id, 0) = $3
         AND COALESCE(trimestre, 0) = $4`,
      [annee, type, exId || 0, tri || 0]
    );

    let result;
    if (existing.rows.length > 0) {
      result = await pool.query(
        `UPDATE grille_tarifaire SET prix_tonne = $1, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [prix_tonne, existing.rows[0].id]
      );
    } else {
      result = await pool.query(
        `INSERT INTO grille_tarifaire (annee, type, exutoire_id, prix_tonne, trimestre, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
        [annee, type, exId, prix_tonne, tri]
      );
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[SETTINGS] Erreur upsert tarif :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/settings/tarifs/:id
router.delete('/tarifs/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM grille_tarifaire WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[SETTINGS] Erreur suppression tarif :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// OBJECTIFS PÉRIODIQUES
// ══════════════════════════════════════════

// Créer la table si elle n'existe pas
pool.query(`
  CREATE TABLE IF NOT EXISTS periodic_objectives (
    id SERIAL PRIMARY KEY,
    domaine VARCHAR(50) NOT NULL,
    indicateur VARCHAR(100) NOT NULL,
    unite VARCHAR(30) DEFAULT '',
    periode VARCHAR(20) NOT NULL CHECK (periode IN ('mensuel', 'trimestriel', 'annuel')),
    annee INTEGER NOT NULL,
    mois INTEGER,
    trimestre INTEGER,
    valeur_cible DOUBLE PRECISION NOT NULL,
    commentaire TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )
`).catch(() => {});

router.get('/objectives', async (req, res) => {
  try {
    const { annee } = req.query;
    const year = annee || new Date().getFullYear();
    const result = await pool.query(
      'SELECT * FROM periodic_objectives WHERE annee = $1 ORDER BY domaine, indicateur, mois NULLS LAST, trimestre NULLS LAST',
      [year]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[SETTINGS] Erreur objectifs GET :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/objectives', async (req, res) => {
  try {
    const { domaine, indicateur, unite, periode, annee, mois, trimestre, valeur_cible, commentaire } = req.body;
    if (!domaine || !indicateur || !periode || !annee || valeur_cible == null) {
      return res.status(400).json({ error: 'Champs obligatoires : domaine, indicateur, periode, annee, valeur_cible' });
    }
    const result = await pool.query(
      `INSERT INTO periodic_objectives (domaine, indicateur, unite, periode, annee, mois, trimestre, valeur_cible, commentaire)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [domaine, indicateur, unite || '', periode, annee, mois || null, trimestre || null, valeur_cible, commentaire || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[SETTINGS] Erreur objectif POST :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/objectives/:id', async (req, res) => {
  try {
    const { valeur_cible, commentaire } = req.body;
    const result = await pool.query(
      'UPDATE periodic_objectives SET valeur_cible = COALESCE($1, valeur_cible), commentaire = COALESCE($2, commentaire), updated_at = NOW() WHERE id = $3 RETURNING *',
      [valeur_cible, commentaire, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Objectif non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[SETTINGS] Erreur objectif PUT :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/objectives/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM periodic_objectives WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[SETTINGS] Erreur objectif DELETE :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
