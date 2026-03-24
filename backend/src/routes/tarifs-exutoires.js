const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

const TYPES_PRODUIT_VALIDES = ['original', 'csr', 'effilo_blanc', 'effilo_couleur', 'jean', 'coton_blanc', 'coton_couleur'];

// GET /api/tarifs-exutoires/prix — Résolution de prix
router.get('/prix', async (req, res) => {
  try {
    const { type_produit, client_id, date } = req.query;
    const dateRef = date || new Date().toISOString().slice(0, 10);

    // 1. Chercher un prix spécifique au client
    if (client_id) {
      const clientResult = await pool.query(
        `SELECT id, prix_reference_tonne FROM tarifs_exutoires
         WHERE type_produit = $1 AND client_id = $2
           AND date_debut <= $3 AND (date_fin IS NULL OR date_fin >= $3)
         ORDER BY date_debut DESC LIMIT 1`,
        [type_produit, client_id, dateRef]
      );
      if (clientResult.rows.length > 0) {
        return res.json({
          prix_tonne: clientResult.rows[0].prix_reference_tonne,
          source: 'client',
          tarif_id: clientResult.rows[0].id
        });
      }
    }

    // 2. Chercher le prix de référence par défaut (client_id IS NULL)
    const defaultResult = await pool.query(
      `SELECT id, prix_reference_tonne FROM tarifs_exutoires
       WHERE type_produit = $1 AND client_id IS NULL
         AND date_debut <= $2 AND (date_fin IS NULL OR date_fin >= $2)
       ORDER BY date_debut DESC LIMIT 1`,
      [type_produit, dateRef]
    );
    if (defaultResult.rows.length > 0) {
      return res.json({
        prix_tonne: defaultResult.rows[0].prix_reference_tonne,
        source: 'reference',
        tarif_id: defaultResult.rows[0].id
      });
    }

    // 3. Rien trouvé
    res.json({ prix_tonne: null, source: null });
  } catch (err) {
    console.error('[TARIFS-EXUTOIRES] Erreur résolution prix :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tarifs-exutoires — Lister tous les tarifs
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, c.raison_sociale
       FROM tarifs_exutoires t
       LEFT JOIN clients_exutoires c ON t.client_id = c.id
       ORDER BY t.type_produit, t.date_debut DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[TARIFS-EXUTOIRES] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tarifs-exutoires — Créer un tarif
router.post('/', [
  body('type_produit').isIn(['original', 'csr', 'effilo_blanc', 'effilo_couleur', 'jean', 'coton_blanc', 'coton_couleur']).withMessage('Type de produit invalide'),
  body('prix_reference_tonne').isFloat().withMessage('Prix par tonne requis (valeur numérique)'),
  body('date_debut').notEmpty().withMessage('Date de début requise'),
], validate, async (req, res) => {
  try {
    const { type_produit, prix_reference_tonne, date_debut, client_id, date_fin } = req.body;

    if (!type_produit || prix_reference_tonne == null || !date_debut) {
      return res.status(400).json({ error: 'type_produit, prix_reference_tonne et date_debut requis' });
    }

    if (!TYPES_PRODUIT_VALIDES.includes(type_produit)) {
      return res.status(400).json({ error: `type_produit invalide. Valeurs autorisées : ${TYPES_PRODUIT_VALIDES.join(', ')}` });
    }

    const result = await pool.query(
      `INSERT INTO tarifs_exutoires (type_produit, prix_reference_tonne, date_debut, client_id, date_fin)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [type_produit, prix_reference_tonne, date_debut, client_id || null, date_fin || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TARIFS-EXUTOIRES] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tarifs-exutoires/:id — Mettre à jour un tarif
router.put('/:id', async (req, res) => {
  try {
    const { type_produit, prix_reference_tonne, date_debut, client_id, date_fin } = req.body;

    if (type_produit && !TYPES_PRODUIT_VALIDES.includes(type_produit)) {
      return res.status(400).json({ error: `type_produit invalide. Valeurs autorisées : ${TYPES_PRODUIT_VALIDES.join(', ')}` });
    }

    const result = await pool.query(
      `UPDATE tarifs_exutoires
       SET type_produit = COALESCE($1, type_produit),
           prix_reference_tonne = COALESCE($2, prix_reference_tonne),
           date_debut = COALESCE($3, date_debut),
           client_id = $4,
           date_fin = $5
       WHERE id = $6 RETURNING *`,
      [type_produit, prix_reference_tonne, date_debut, client_id || null, date_fin || null, req.params.id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Tarif non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TARIFS-EXUTOIRES] Erreur mise à jour :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/tarifs-exutoires/:id — Supprimer un tarif
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM tarifs_exutoires WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tarif non trouvé' });
    res.json({ message: 'Tarif supprimé' });
  } catch (err) {
    console.error('[TARIFS-EXUTOIRES] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
