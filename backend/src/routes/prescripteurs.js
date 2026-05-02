const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// Conformité IAE : organismes prescripteurs (Pôle Emploi / France Travail / Mission Locale,
// Conseil Départemental, CCAS, Cap Emploi, autres associations…). Source des prescriptions
// SIAE — donnée obligatoire pour reporting FSE+ et Pôle Emploi.

const TYPES = ['PE', 'FT', 'ML', 'CD', 'CCAS', 'CAP_EMPLOI', 'AUTRE_ASSO', 'DIRECT'];

// GET /api/prescripteurs — Liste (filtres : type, actif, région)
router.get('/', async (req, res) => {
  try {
    const { type, actif, region } = req.query;
    let query = 'SELECT * FROM prescripteur_orgas WHERE 1=1';
    const params = [];
    if (type) { params.push(type); query += ` AND type = $${params.length}`; }
    if (actif !== undefined) { params.push(actif === 'true'); query += ` AND actif = $${params.length}`; }
    if (region) { params.push(region); query += ` AND region = $${params.length}`; }
    query += ' ORDER BY type, nom';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[PRESCRIPTEURS] GET /:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/prescripteurs/types — Liste des types valides (pour UI)
router.get('/types', (req, res) => {
  res.json([
    { value: 'PE', label: 'Pôle Emploi (historique)' },
    { value: 'FT', label: 'France Travail' },
    { value: 'ML', label: 'Mission Locale' },
    { value: 'CD', label: 'Conseil Départemental' },
    { value: 'CCAS', label: 'Centre Communal d\'Action Sociale' },
    { value: 'CAP_EMPLOI', label: 'Cap Emploi (handicap)' },
    { value: 'AUTRE_ASSO', label: 'Autre association' },
    { value: 'DIRECT', label: 'Recrutement direct' },
  ]);
});

// GET /api/prescripteurs/:id — Détail
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM prescripteur_orgas WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Prescripteur introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PRESCRIPTEURS] GET /:id :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/prescripteurs — Créer
router.post('/', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { nom, type, contact_nom, contact_email, contact_phone, region, siret, notes } = req.body;
    if (!nom || !type) return res.status(400).json({ error: 'nom et type requis' });
    if (!TYPES.includes(type)) return res.status(400).json({ error: `type invalide. Valeurs : ${TYPES.join(', ')}` });
    const result = await pool.query(
      `INSERT INTO prescripteur_orgas (nom, type, contact_nom, contact_email, contact_phone, region, siret, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [nom, type, contact_nom || null, contact_email || null, contact_phone || null, region || null, siret || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[PRESCRIPTEURS] POST :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/prescripteurs/:id — Mettre à jour
router.put('/:id', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { nom, type, contact_nom, contact_email, contact_phone, region, siret, notes, actif } = req.body;
    if (type && !TYPES.includes(type)) return res.status(400).json({ error: `type invalide` });
    const result = await pool.query(
      `UPDATE prescripteur_orgas SET
         nom = COALESCE($1, nom),
         type = COALESCE($2, type),
         contact_nom = $3,
         contact_email = $4,
         contact_phone = $5,
         region = $6,
         siret = $7,
         notes = $8,
         actif = COALESCE($9, actif),
         updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [nom, type, contact_nom, contact_email, contact_phone, region, siret, notes, actif, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Prescripteur introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PRESCRIPTEURS] PUT :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/prescripteurs/:id — Supprimer (préfère désactivation)
router.delete('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    // Soft delete : passer en actif=false (sauf si demande hard via ?hard=true)
    if (req.query.hard === 'true') {
      await pool.query('DELETE FROM prescripteur_orgas WHERE id = $1', [req.params.id]);
      return res.json({ message: 'Supprimé définitivement' });
    }
    const result = await pool.query(
      'UPDATE prescripteur_orgas SET actif = false, updated_at = NOW() WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Prescripteur introuvable' });
    res.json({ message: 'Désactivé' });
  } catch (err) {
    console.error('[PRESCRIPTEURS] DELETE :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/prescripteurs/:id/assign — Affecter à un employé
// Body : { employee_id, date_prescription }
router.post('/:id/assign', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { employee_id, date_prescription } = req.body;
    if (!employee_id) return res.status(400).json({ error: 'employee_id requis' });
    const result = await pool.query(
      `UPDATE employees
       SET prescripteur_id = $1,
           date_prescription = $2
       WHERE id = $3 RETURNING id, prescripteur_id, date_prescription`,
      [req.params.id, date_prescription || new Date().toISOString().split('T')[0], employee_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Employé introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PRESCRIPTEURS] /assign :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
