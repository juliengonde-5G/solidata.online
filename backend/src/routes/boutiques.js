const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');
const {
  attachBoutiqueScope, enforceBoutiqueParam, boutiqueScopeSql,
} = require('../middleware/boutique-scope');

router.use(authenticate);
router.use(attachBoutiqueScope);
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
    // Cloisonnement : un RESP_BTQ ne liste que les boutiques de son périmètre.
    query += boutiqueScopeSql(req, 'b.id', params);
    query += ' ORDER BY b.nom';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[boutiques] GET /:', err);
    res.status(500).json({ error: 'Erreur chargement boutiques' });
  }
});

// GET /api/boutiques/analytics/consolidation — vue consolidée multi-boutiques
// (item 55c). Agrège par boutique CA HT / tickets / panier moyen sur la période
// + comparaison N-1 (même période, année précédente). Base HT (acquis vague 0/1).
// Scope-filtré : ADMIN/MANAGER voient toutes les boutiques, un RESP_BTQ n'obtient
// que son périmètre. (Route à 2 segments : jamais capturée par GET /:id.)
router.get('/analytics/consolidation', async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    if (!date_from || !date_to) {
      return res.status(400).json({ error: 'date_from et date_to requis' });
    }
    const shiftYear = (dateStr, years) => {
      const d = new Date(`${dateStr}T00:00:00Z`);
      if (isNaN(d.getTime())) return null;
      d.setUTCFullYear(d.getUTCFullYear() - years);
      return d.toISOString().slice(0, 10);
    };
    const n1From = shiftYear(date_from, 1);
    const n1To = shiftYear(date_to, 1);
    if (!n1From || !n1To) return res.status(400).json({ error: 'Dates invalides' });

    // Agrégat par boutique sur une plage. Filtrage périmètre appliqué sur b.id.
    async function aggByBoutique(from, to) {
      const params = [from, to];
      const scope = boutiqueScopeSql(req, 'b.id', params);
      const r = await pool.query(`
        SELECT b.id AS boutique_id, b.nom,
               COALESCE(v.ca_ht, 0)::FLOAT       AS ca_ht,
               COALESCE(v.nb_articles, 0)::INT   AS nb_articles,
               COALESCE(t.nb_tickets, 0)::INT    AS nb_tickets,
               COALESCE(t.panier_moyen, 0)::FLOAT AS panier_moyen
        FROM boutiques b
        LEFT JOIN (
          SELECT boutique_id,
                 SUM(total_ht) AS ca_ht,
                 SUM(quantite) AS nb_articles
          FROM boutique_ventes
          WHERE DATE(date_vente) BETWEEN $1::DATE AND $2::DATE
          GROUP BY boutique_id
        ) v ON v.boutique_id = b.id
        LEFT JOIN (
          SELECT boutique_id,
                 COUNT(*) AS nb_tickets,
                 AVG(total_ht) AS panier_moyen
          FROM boutique_tickets
          WHERE DATE(date_ticket) BETWEEN $1::DATE AND $2::DATE
          GROUP BY boutique_id
        ) t ON t.boutique_id = b.id
        WHERE b.is_active = true${scope}
        ORDER BY b.nom
      `, params);
      return r.rows;
    }

    const [current, previous] = await Promise.all([
      aggByBoutique(date_from, date_to),
      aggByBoutique(n1From, n1To),
    ]);
    const prevById = new Map(previous.map((p) => [p.boutique_id, p]));
    const delta = (c, p) => (p > 0 ? ((c - p) / p) * 100 : (c > 0 ? 100 : null));

    const boutiques = current.map((c) => {
      const p = prevById.get(c.boutique_id) || { ca_ht: 0, nb_tickets: 0, panier_moyen: 0, nb_articles: 0 };
      return {
        boutique_id: c.boutique_id,
        nom: c.nom,
        ca_ht: c.ca_ht,
        nb_tickets: c.nb_tickets,
        nb_articles: c.nb_articles,
        panier_moyen: c.panier_moyen,
        ca_ht_n1: p.ca_ht,
        nb_tickets_n1: p.nb_tickets,
        panier_moyen_n1: p.panier_moyen,
        delta_ca_ht_pct: delta(c.ca_ht, p.ca_ht),
        delta_tickets_pct: delta(c.nb_tickets, p.nb_tickets),
        delta_panier_pct: delta(c.panier_moyen, p.panier_moyen),
      };
    });

    const sum = (arr, k) => arr.reduce((s, x) => s + Number(x[k] || 0), 0);
    const totCaHt = sum(boutiques, 'ca_ht');
    const totTickets = sum(boutiques, 'nb_tickets');
    const totCaHtN1 = sum(boutiques, 'ca_ht_n1');
    const totTicketsN1 = sum(boutiques, 'nb_tickets_n1');
    const totaux = {
      ca_ht: totCaHt,
      nb_tickets: totTickets,
      nb_articles: sum(boutiques, 'nb_articles'),
      panier_moyen: totTickets > 0 ? totCaHt / totTickets : 0,
      ca_ht_n1: totCaHtN1,
      nb_tickets_n1: totTicketsN1,
      panier_moyen_n1: totTicketsN1 > 0 ? totCaHtN1 / totTicketsN1 : 0,
      delta_ca_ht_pct: delta(totCaHt, totCaHtN1),
      delta_tickets_pct: delta(totTickets, totTicketsN1),
    };

    res.json({
      periode: { date_from, date_to },
      periode_n1: { date_from: n1From, date_to: n1To },
      boutiques,
      totaux,
    });
  } catch (err) {
    console.error('[boutiques] GET /analytics/consolidation:', err);
    res.status(500).json({ error: 'Erreur consolidation' });
  }
});

// GET /api/boutiques/assignable-users — utilisateurs affectables à une boutique
// (rôle RESP_BTQ, ou rôle personnalisé dérivé de RESP_BTQ). ADMIN uniquement.
// (Route à 1 segment : DOIT être déclarée avant GET /:id.)
router.get('/assignable-users', authorize('ADMIN'), async (req, res) => {
  try {
    let rows;
    try {
      const r = await pool.query(`
        SELECT id, username, first_name, last_name, role, is_active
        FROM users
        WHERE is_active = true
          AND (role = 'RESP_BTQ'
               OR role IN (SELECT role_key FROM custom_roles WHERE base_role = 'RESP_BTQ'))
        ORDER BY last_name, first_name
      `);
      rows = r.rows;
    } catch (e) {
      // Base ancienne sans table custom_roles : repli sur le rôle intégré.
      const r = await pool.query(`
        SELECT id, username, first_name, last_name, role, is_active
        FROM users WHERE is_active = true AND role = 'RESP_BTQ'
        ORDER BY last_name, first_name
      `);
      rows = r.rows;
    }
    res.json(rows);
  } catch (err) {
    console.error('[boutiques] GET /assignable-users:', err);
    res.status(500).json({ error: 'Erreur chargement utilisateurs' });
  }
});

// GET /api/boutiques/:id
router.get('/:id', async (req, res) => {
  try {
    if (!enforceBoutiqueParam(req, res, req.params.id)) return;
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

// ══════════════════════════════════════════
// Gestion des accès RESP_BTQ (affectation user ↔ boutique) — ADMIN uniquement
// ══════════════════════════════════════════

// GET /api/boutiques/:id/access — utilisateurs affectés à cette boutique
router.get('/:id/access', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ub.user_id, ub.created_at,
             u.username, u.first_name, u.last_name, u.role, u.is_active
      FROM user_boutiques ub
      JOIN users u ON u.id = ub.user_id
      WHERE ub.boutique_id = $1
      ORDER BY u.last_name, u.first_name
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    console.error('[boutiques] GET /:id/access:', err);
    res.status(500).json({ error: 'Erreur chargement accès' });
  }
});

// POST /api/boutiques/:id/access — affecter un utilisateur à la boutique
router.post('/:id/access',
  authorize('ADMIN'),
  [body('user_id').isInt()],
  validate,
  async (req, res) => {
    try {
      const boutiqueId = parseInt(req.params.id);
      const userId = parseInt(req.body.user_id);
      const btq = await pool.query('SELECT id FROM boutiques WHERE id = $1', [boutiqueId]);
      if (btq.rows.length === 0) return res.status(404).json({ error: 'Boutique introuvable' });
      const usr = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
      if (usr.rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
      await pool.query(`
        INSERT INTO user_boutiques (user_id, boutique_id, created_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, boutique_id) DO NOTHING
      `, [userId, boutiqueId, req.user.id]);
      res.status(201).json({ success: true });
    } catch (err) {
      console.error('[boutiques] POST /:id/access:', err);
      res.status(500).json({ error: 'Erreur affectation' });
    }
  }
);

// DELETE /api/boutiques/:id/access/:userId — retirer l'accès d'un utilisateur
router.delete('/:id/access/:userId', authorize('ADMIN'), async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM user_boutiques WHERE boutique_id = $1 AND user_id = $2',
      [req.params.id, req.params.userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[boutiques] DELETE /:id/access/:userId:', err);
    res.status(500).json({ error: 'Erreur retrait accès' });
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
    if (!enforceBoutiqueParam(req, res, req.params.id)) return;
    const year = parseInt(req.query.annee) || new Date().getFullYear();
    const btq = await pool.query('SELECT id, nom, budget_annuel FROM boutiques WHERE id = $1', [req.params.id]);
    if (btq.rows.length === 0) return res.status(404).json({ error: 'Boutique introuvable' });

    // Réalisé par mois — CA HT (base cohérente avec les objectifs, saisis en HT).
    // ca_ttc reste exposé pour compat, mais le pilotage (ca_total_realise) est en HT.
    const realise = await pool.query(`
      SELECT EXTRACT(MONTH FROM date_vente)::INT AS mois,
             COALESCE(SUM(total_ht), 0)::FLOAT AS ca_ht,
             COALESCE(SUM(total_ttc), 0)::FLOAT AS ca_ttc,
             COUNT(DISTINCT ticket_id)::INT AS nb_tickets
      FROM boutique_ventes
      WHERE boutique_id = $1 AND EXTRACT(YEAR FROM date_vente) = $2
      GROUP BY mois
      ORDER BY mois
    `, [req.params.id, year]);

    // Objectifs par mois
    const objectifs = await pool.query(`
      SELECT mois, ca_objectif_ht::FLOAT AS ca_objectif_ht,
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
      // Réalisé et objectif comparés sur la même base HT (les objectifs sont saisis en HT).
      ca_total_realise: realise.rows.reduce((s, r) => s + r.ca_ht, 0),
      ca_total_objectif: objectifs.rows.reduce((s, r) => s + Number(r.ca_objectif_ht), 0),
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
