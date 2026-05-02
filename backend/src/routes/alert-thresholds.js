const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

const SEVERITES = ['info', 'warning', 'error', 'critical'];

// GET /api/alert-thresholds
router.get('/', async (req, res) => {
  try {
    const { domaine, actif } = req.query;
    let query = 'SELECT * FROM alert_thresholds WHERE 1=1';
    const params = [];
    if (domaine) { params.push(domaine); query += ` AND domaine = $${params.length}`; }
    if (actif !== undefined) { params.push(actif === 'true'); query += ` AND actif = $${params.length}`; }
    query += ' ORDER BY domaine, libelle';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[ALERT-THRESHOLDS] GET :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/alert-thresholds/:indicateur — UPSERT
router.put('/:indicateur', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { domaine, libelle, seuil_min, seuil_max, unite, severite, actif, notes } = req.body;
    if (severite && !SEVERITES.includes(severite)) {
      return res.status(400).json({ error: `severite invalide. Valeurs : ${SEVERITES.join(', ')}` });
    }
    const result = await pool.query(`
      INSERT INTO alert_thresholds (domaine, indicateur, libelle, seuil_min, seuil_max, unite, severite, actif, notes, created_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, true), $9, $10, NOW())
      ON CONFLICT (indicateur) DO UPDATE SET
        domaine    = COALESCE(EXCLUDED.domaine, alert_thresholds.domaine),
        libelle    = COALESCE(EXCLUDED.libelle, alert_thresholds.libelle),
        seuil_min  = EXCLUDED.seuil_min,
        seuil_max  = EXCLUDED.seuil_max,
        unite      = COALESCE(EXCLUDED.unite, alert_thresholds.unite),
        severite   = COALESCE(EXCLUDED.severite, alert_thresholds.severite),
        actif      = COALESCE(EXCLUDED.actif, alert_thresholds.actif),
        notes      = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING *
    `, [
      domaine, req.params.indicateur, libelle,
      seuil_min ?? null, seuil_max ?? null,
      unite || null, severite || 'warning', actif, notes || null, req.user.id,
    ]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[ALERT-THRESHOLDS] PUT :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/alert-thresholds/:indicateur
router.delete('/:indicateur', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM alert_thresholds WHERE indicateur = $1 RETURNING id',
      [req.params.indicateur]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Indicateur introuvable' });
    res.json({ message: 'Supprimé' });
  } catch (err) {
    console.error('[ALERT-THRESHOLDS] DELETE :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
