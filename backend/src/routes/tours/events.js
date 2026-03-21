const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');

// ══════════════════════════════════════════
// ÉVÉNEMENTS LOCAUX (brocantes, vide-greniers, etc.)
// ══════════════════════════════════════════

// GET /api/tours/events — Liste des événements locaux
router.get('/events', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM evenements_locaux ORDER BY date_debut DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[TOURS] Erreur événements :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/events — Créer un événement local
router.post('/events', authorize('ADMIN'), [
  body('nom').notEmpty().withMessage('Nom requis'),
  body('date_debut').notEmpty().withMessage('Date de début requise'),
  body('date_fin').notEmpty().withMessage('Date de fin requise'),
], validate, async (req, res) => {
  try {
    const { nom, type, date_debut, date_fin, latitude, longitude, adresse, commune, rayon_km, bonus_factor, notes } = req.body;
    const result = await pool.query(
      `INSERT INTO evenements_locaux (nom, type, date_debut, date_fin, latitude, longitude, adresse, commune, rayon_km, bonus_factor, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [nom, type || 'brocante', date_debut, date_fin, latitude || null, longitude || null, adresse || null, commune || null, rayon_km || 2, bonus_factor || 1.2, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur création événement :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tours/events/:id — Modifier un événement
router.put('/events/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const { nom, type, date_debut, date_fin, latitude, longitude, adresse, commune, rayon_km, bonus_factor, notes, is_active } = req.body;
    const result = await pool.query(
      `UPDATE evenements_locaux SET
       nom = COALESCE($1, nom), type = COALESCE($2, type),
       date_debut = COALESCE($3, date_debut), date_fin = COALESCE($4, date_fin),
       latitude = COALESCE($5, latitude), longitude = COALESCE($6, longitude),
       adresse = COALESCE($7, adresse), commune = COALESCE($8, commune),
       rayon_km = COALESCE($9, rayon_km), bonus_factor = COALESCE($10, bonus_factor),
       notes = COALESCE($11, notes), is_active = COALESCE($12, is_active)
       WHERE id = $13 RETURNING *`,
      [nom, type, date_debut, date_fin, latitude, longitude, adresse, commune, rayon_km, bonus_factor, notes, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Événement non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur modification événement :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/tours/events/:id — Supprimer un événement
router.delete('/events/:id', authorize('ADMIN'), async (req, res) => {
  try {
    await pool.query('DELETE FROM evenements_locaux WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[TOURS] Erreur suppression événement :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
