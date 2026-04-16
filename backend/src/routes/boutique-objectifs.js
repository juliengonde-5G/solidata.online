const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');

router.use(authenticate);

// GET /api/boutique-objectifs?boutique_id=X&annee=Y
router.get('/', async (req, res) => {
  try {
    const { boutique_id, annee, segment } = req.query;
    let query = 'SELECT * FROM boutique_objectifs WHERE 1=1';
    const params = [];
    if (boutique_id) { params.push(boutique_id); query += ` AND boutique_id = $${params.length}`; }
    if (annee) { params.push(annee); query += ` AND annee = $${params.length}`; }
    if (segment) { params.push(segment); query += ` AND segment = $${params.length}`; }
    query += ' ORDER BY annee, mois, segment';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[boutique-objectifs] GET /:', err);
    res.status(500).json({ error: 'Erreur' });
  }
});

// GET /api/boutique-objectifs/compare?boutique_id=X&annee=Y
router.get('/compare', async (req, res) => {
  try {
    const { boutique_id, annee } = req.query;
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });
    const year = annee || new Date().getFullYear();

    const objs = await pool.query(
      `SELECT mois, segment, ca_objectif_ttc::FLOAT AS ca_objectif_ttc,
              nb_tickets_objectif, panier_moyen_objectif::FLOAT AS panier_moyen_objectif
       FROM boutique_objectifs
       WHERE boutique_id = $1 AND annee = $2`,
      [boutique_id, year]
    );

    const ventes = await pool.query(`
      SELECT EXTRACT(MONTH FROM date_vente)::INT AS mois,
             segment,
             COALESCE(SUM(total_ttc), 0)::FLOAT AS ca_ttc,
             COUNT(DISTINCT ticket_id)::INT AS nb_tickets,
             CASE WHEN COUNT(DISTINCT ticket_id) > 0
                  THEN (SUM(total_ttc) / COUNT(DISTINCT ticket_id))::FLOAT ELSE 0 END AS panier_moyen
      FROM boutique_ventes
      WHERE boutique_id = $1 AND EXTRACT(YEAR FROM date_vente) = $2
      GROUP BY mois, segment
    `, [boutique_id, year]);

    // Global = somme de tous segments par mois
    const globalVentes = {};
    for (const v of ventes.rows) {
      if (!globalVentes[v.mois]) globalVentes[v.mois] = { mois: v.mois, ca_ttc: 0, nb_tickets: 0 };
      globalVentes[v.mois].ca_ttc += v.ca_ttc;
      globalVentes[v.mois].nb_tickets += v.nb_tickets;
    }
    for (const m in globalVentes) {
      globalVentes[m].panier_moyen = globalVentes[m].nb_tickets > 0
        ? globalVentes[m].ca_ttc / globalVentes[m].nb_tickets : 0;
    }

    res.json({
      annee: year,
      objectifs: objs.rows,
      ventes: ventes.rows,
      ventes_global: Object.values(globalVentes),
    });
  } catch (err) {
    console.error('[boutique-objectifs] compare:', err);
    res.status(500).json({ error: 'Erreur' });
  }
});

// POST /api/boutique-objectifs — créer ou upsert
router.post('/',
  authorize('ADMIN', 'MANAGER'),
  [
    body('boutique_id').isInt(),
    body('annee').isInt({ min: 2020, max: 2100 }),
    body('mois').isInt({ min: 1, max: 12 }),
    body('ca_objectif_ttc').isFloat({ min: 0 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { boutique_id, annee, mois, ca_objectif_ttc, nb_tickets_objectif, panier_moyen_objectif, segment, notes } = req.body;
      const result = await pool.query(`
        INSERT INTO boutique_objectifs
          (boutique_id, annee, mois, ca_objectif_ttc, nb_tickets_objectif, panier_moyen_objectif, segment, notes, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (boutique_id, annee, mois, segment) DO UPDATE SET
          ca_objectif_ttc = EXCLUDED.ca_objectif_ttc,
          nb_tickets_objectif = EXCLUDED.nb_tickets_objectif,
          panier_moyen_objectif = EXCLUDED.panier_moyen_objectif,
          notes = EXCLUDED.notes,
          updated_at = NOW()
        RETURNING *
      `, [boutique_id, annee, mois, ca_objectif_ttc, nb_tickets_objectif || null,
          panier_moyen_objectif || null, segment || 'global', notes || null, req.user.id]);
      res.json(result.rows[0]);
    } catch (err) {
      console.error('[boutique-objectifs] POST /:', err);
      res.status(500).json({ error: 'Erreur' });
    }
  }
);

// POST /api/boutique-objectifs/bulk — saisie en masse (12 mois)
router.post('/bulk',
  authorize('ADMIN', 'MANAGER'),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { boutique_id, annee, segment, objectifs } = req.body;
      if (!Array.isArray(objectifs)) return res.status(400).json({ error: 'objectifs doit être un tableau' });

      for (const o of objectifs) {
        await client.query(`
          INSERT INTO boutique_objectifs
            (boutique_id, annee, mois, ca_objectif_ttc, nb_tickets_objectif, panier_moyen_objectif, segment, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (boutique_id, annee, mois, segment) DO UPDATE SET
            ca_objectif_ttc = EXCLUDED.ca_objectif_ttc,
            nb_tickets_objectif = EXCLUDED.nb_tickets_objectif,
            panier_moyen_objectif = EXCLUDED.panier_moyen_objectif,
            updated_at = NOW()
        `, [boutique_id, annee, o.mois, o.ca_objectif_ttc || 0,
            o.nb_tickets_objectif || null, o.panier_moyen_objectif || null,
            segment || 'global', req.user.id]);
      }

      await client.query('COMMIT');
      res.json({ success: true, count: objectifs.length });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[boutique-objectifs] bulk:', err);
      res.status(500).json({ error: 'Erreur bulk' });
    } finally {
      client.release();
    }
  }
);

// DELETE /api/boutique-objectifs/:id
router.delete('/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    await pool.query('DELETE FROM boutique_objectifs WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur' });
  }
});

module.exports = router;
