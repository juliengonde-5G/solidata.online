const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');

router.use(authenticate);
router.use(autoLogActivity('boutique'));

// GET /api/boutiques — lister toutes les boutiques
router.get('/', async (req, res) => {
  try {
    const { active } = req.query;
    let query = `
      SELECT b.*, t.name AS team_name,
             u.first_name AS responsable_first_name, u.last_name AS responsable_last_name
      FROM boutiques b
      LEFT JOIN teams t ON b.team_id = t.id
      LEFT JOIN users u ON b.responsable_id = u.id
      WHERE 1=1
    `;
    const params = [];
    if (active === 'true') {
      query += ' AND b.is_active = true';
    }
    query += ' ORDER BY b.nom';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[boutiques] GET /:', err);
    res.status(500).json({ error: 'Erreur chargement boutiques' });
  }
});

// GET /api/boutiques/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.*, t.name AS team_name,
             u.first_name AS responsable_first_name, u.last_name AS responsable_last_name
      FROM boutiques b
      LEFT JOIN teams t ON b.team_id = t.id
      LEFT JOIN users u ON b.responsable_id = u.id
      WHERE b.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Boutique introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[boutiques] GET /:id:', err);
    res.status(500).json({ error: 'Erreur chargement boutique' });
  }
});

// POST /api/boutiques — créer une boutique (ADMIN only)
router.post('/',
  authorize('ADMIN'),
  [
    body('nom').notEmpty().withMessage('Nom requis'),
    body('code').notEmpty().withMessage('Code requis'),
    body('latitude').optional().isFloat(),
    body('longitude').optional().isFloat(),
  ],
  validate,
  async (req, res) => {
    try {
      const {
        nom, code, adresse, ville, code_postal, latitude, longitude, telephone,
        responsable_id, team_id, budget_annuel, csv_folder_path,
        ouverture_lundi, ouverture_mardi, ouverture_mercredi, ouverture_jeudi,
        ouverture_vendredi, ouverture_samedi, ouverture_dimanche,
      } = req.body;
      const result = await pool.query(`
        INSERT INTO boutiques (
          nom, code, adresse, ville, code_postal, latitude, longitude, telephone,
          responsable_id, team_id, budget_annuel, csv_folder_path,
          ouverture_lundi, ouverture_mardi, ouverture_mercredi, ouverture_jeudi,
          ouverture_vendredi, ouverture_samedi, ouverture_dimanche
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        RETURNING *
      `, [
        nom, code, adresse || null, ville || null, code_postal || null,
        latitude || null, longitude || null, telephone || null,
        responsable_id || null, team_id || null, budget_annuel || 0, csv_folder_path || null,
        ouverture_lundi !== false, ouverture_mardi !== false, ouverture_mercredi !== false,
        ouverture_jeudi !== false, ouverture_vendredi !== false, ouverture_samedi !== false,
        ouverture_dimanche === true,
      ]);
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('[boutiques] POST /:', err);
      if (err.code === '23505') return res.status(400).json({ error: 'Nom ou code déjà utilisé' });
      res.status(500).json({ error: 'Erreur création boutique' });
    }
  }
);

// PUT /api/boutiques/:id
router.put('/:id',
  authorize('ADMIN', 'MANAGER'),
  async (req, res) => {
    try {
      const fields = [
        'nom', 'code', 'adresse', 'ville', 'code_postal', 'latitude', 'longitude', 'telephone',
        'responsable_id', 'team_id', 'budget_annuel', 'csv_folder_path', 'is_active',
        'ouverture_lundi', 'ouverture_mardi', 'ouverture_mercredi', 'ouverture_jeudi',
        'ouverture_vendredi', 'ouverture_samedi', 'ouverture_dimanche',
        'logics_mail_folder', 'logics_mail_subject_keyword', 'logics_mail_sender',
      ];
      const updates = [];
      const values = [];
      let idx = 1;
      for (const f of fields) {
        if (req.body[f] !== undefined) {
          updates.push(`${f} = $${idx++}`);
          values.push(req.body[f]);
        }
      }
      if (updates.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
      updates.push(`updated_at = NOW()`);
      values.push(req.params.id);
      const result = await pool.query(
        `UPDATE boutiques SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Boutique introuvable' });
      res.json(result.rows[0]);
    } catch (err) {
      console.error('[boutiques] PUT /:id:', err);
      res.status(500).json({ error: 'Erreur mise à jour' });
    }
  }
);

// DELETE /api/boutiques/:id — désactiver (soft delete)
router.delete('/:id',
  authorize('ADMIN'),
  async (req, res) => {
    try {
      await pool.query('UPDATE boutiques SET is_active = false WHERE id = $1', [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      console.error('[boutiques] DELETE /:id:', err);
      res.status(500).json({ error: 'Erreur désactivation' });
    }
  }
);

// GET /api/boutiques/:id/budget — suivi budget annuel
router.get('/:id/budget', async (req, res) => {
  try {
    const year = parseInt(req.query.annee) || new Date().getFullYear();
    const btq = await pool.query('SELECT id, nom, budget_annuel FROM boutiques WHERE id = $1', [req.params.id]);
    if (btq.rows.length === 0) return res.status(404).json({ error: 'Boutique introuvable' });

    // Réalisé par mois (TTC)
    const realise = await pool.query(`
      SELECT EXTRACT(MONTH FROM date_vente)::INT AS mois,
             COALESCE(SUM(total_ttc), 0)::FLOAT AS ca_ttc,
             COUNT(DISTINCT ticket_id)::INT AS nb_tickets
      FROM boutique_ventes
      WHERE boutique_id = $1 AND EXTRACT(YEAR FROM date_vente) = $2
      GROUP BY mois
      ORDER BY mois
    `, [req.params.id, year]);

    // Objectifs par mois
    const objectifs = await pool.query(`
      SELECT mois, ca_objectif_ttc::FLOAT AS ca_objectif_ttc,
             nb_tickets_objectif, panier_moyen_objectif::FLOAT AS panier_moyen_objectif
      FROM boutique_objectifs
      WHERE boutique_id = $1 AND annee = $2 AND segment = 'global'
      ORDER BY mois
    `, [req.params.id, year]);

    res.json({
      boutique: btq.rows[0],
      annee: year,
      realise_par_mois: realise.rows,
      objectifs_par_mois: objectifs.rows,
      ca_total_realise: realise.rows.reduce((s, r) => s + r.ca_ttc, 0),
      ca_total_objectif: objectifs.rows.reduce((s, r) => s + Number(r.ca_objectif_ttc), 0),
    });
  } catch (err) {
    console.error('[boutiques] GET /:id/budget:', err);
    res.status(500).json({ error: 'Erreur chargement budget' });
  }
});

// PUT /api/boutiques/:id/budget — définir le budget annuel
router.put('/:id/budget',
  authorize('ADMIN', 'MANAGER'),
  [body('budget_annuel').isFloat({ min: 0 })],
  validate,
  async (req, res) => {
    try {
      const result = await pool.query(
        'UPDATE boutiques SET budget_annuel = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [req.body.budget_annuel, req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Boutique introuvable' });
      res.json(result.rows[0]);
    } catch (err) {
      console.error('[boutiques] PUT /:id/budget:', err);
      res.status(500).json({ error: 'Erreur mise à jour budget' });
    }
  }
);

module.exports = router;
