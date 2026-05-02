const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// Référentiel unifié — fusion exutoires + clients_exutoires + boutiques.
// Source de vérité unique pour expeditions, commandes_exutoires, factures_exutoires
// et produits_finis (côté aval). Les associations restent dans leur table dédiée
// (collecte amont, sémantique distincte).

const PARTNER_TYPES = [
  'exutoire_recycleur',
  'exutoire_negociant',
  'exutoire_industriel',
  'exutoire_autre',
  'boutique',
];

// GET /api/partners — Liste filtrable
// ?type=exutoire_recycleur|boutique  ?actif=true  ?search=texte
router.get('/', async (req, res) => {
  try {
    const { type, actif, search } = req.query;
    let query = 'SELECT * FROM partners WHERE 1=1';
    const params = [];
    if (type) {
      // Support 'exutoire' (préfixe) → tous les exutoire_*
      if (type === 'exutoire') {
        query += ` AND type LIKE 'exutoire_%'`;
      } else {
        params.push(type); query += ` AND type = $${params.length}`;
      }
    }
    if (actif !== undefined) { params.push(actif === 'true'); query += ` AND actif = $${params.length}`; }
    if (search) { params.push(`%${search}%`); query += ` AND nom ILIKE $${params.length}`; }
    query += ' ORDER BY type, nom';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[PARTNERS] GET / :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/partners/types — UI dropdown
router.get('/types', (req, res) => {
  res.json([
    { value: 'exutoire_recycleur',  label: 'Exutoire — Recycleur' },
    { value: 'exutoire_negociant',  label: 'Exutoire — Négociant' },
    { value: 'exutoire_industriel', label: 'Exutoire — Industriel' },
    { value: 'exutoire_autre',      label: 'Exutoire — Autre' },
    { value: 'boutique',            label: 'Boutique (vente 2nde main)' },
  ]);
});

// GET /api/partners/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM partners WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Partenaire introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PARTNERS] GET /:id :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/partners/:id/interactions
// Vue consolidée : expeditions + commandes + factures + produits_finis pour ce partenaire
router.get('/:id/interactions', async (req, res) => {
  try {
    const id = req.params.id;
    const [expe, commandes, factures, pf] = await Promise.all([
      pool.query('SELECT id, date, weight_kg FROM expeditions WHERE partner_id = $1 ORDER BY date DESC LIMIT 100', [id]),
      pool.query('SELECT id, reference, statut, date_commande FROM commandes_exutoires WHERE partner_id = $1 ORDER BY date_commande DESC LIMIT 100', [id]).catch(() => ({ rows: [] })),
      pool.query('SELECT id, numero_facture, statut_facture, date_facture FROM factures_exutoires WHERE partner_id = $1 ORDER BY date_facture DESC LIMIT 100', [id]).catch(() => ({ rows: [] })),
      pool.query('SELECT id, code_barre, poids_kg, date_sortie FROM produits_finis WHERE partner_id = $1 ORDER BY date_sortie DESC NULLS LAST LIMIT 100', [id]),
    ]);
    res.json({
      expeditions: expe.rows,
      commandes: commandes.rows,
      factures: factures.rows,
      produits_finis: pf.rows,
    });
  } catch (err) {
    console.error('[PARTNERS] /interactions :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/partners — Créer
router.post('/', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const {
      type, nom, siret, adresse, code_postal, ville, latitude, longitude,
      contact_nom, contact_email, contact_tel, notes,
    } = req.body;
    if (!type || !nom) return res.status(400).json({ error: 'type et nom requis' });
    if (!PARTNER_TYPES.includes(type)) {
      return res.status(400).json({ error: `type invalide. Valeurs : ${PARTNER_TYPES.join(', ')}` });
    }
    const result = await pool.query(
      `INSERT INTO partners (type, nom, siret, adresse, code_postal, ville,
        latitude, longitude, contact_nom, contact_email, contact_tel, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [type, nom, siret || null, adresse || null, code_postal || null, ville || null,
       latitude || null, longitude || null, contact_nom || null, contact_email || null,
       contact_tel || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[PARTNERS] POST :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/partners/:id
router.put('/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const allowed = [
      'type', 'nom', 'siret', 'adresse', 'code_postal', 'ville', 'latitude',
      'longitude', 'contact_nom', 'contact_email', 'contact_tel', 'actif', 'notes',
    ];
    const fields = req.body;
    if (fields.type && !PARTNER_TYPES.includes(fields.type)) {
      return res.status(400).json({ error: 'type invalide' });
    }
    const setClauses = [];
    const values = [];
    let i = 1;
    for (const f of allowed) {
      if (fields[f] !== undefined) {
        setClauses.push(`${f} = $${i++}`);
        values.push(fields[f]);
      }
    }
    if (setClauses.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });
    setClauses.push('updated_at = NOW()');
    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE partners SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Partenaire introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PARTNERS] PUT :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/partners/:id (soft : actif=false sauf ?hard=true ADMIN)
router.delete('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    if (req.query.hard === 'true') {
      await pool.query('DELETE FROM partners WHERE id = $1', [req.params.id]);
      return res.json({ message: 'Supprimé définitivement' });
    }
    const result = await pool.query(
      'UPDATE partners SET actif = false, updated_at = NOW() WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Partenaire introuvable' });
    res.json({ message: 'Désactivé' });
  } catch (err) {
    console.error('[PARTNERS] DELETE :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
