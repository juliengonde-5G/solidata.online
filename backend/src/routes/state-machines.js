const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { MACHINES } = require('../services/state-machines');
const { getAvailableTransitions, canTransition } = require('../services/state-machine');
const pool = require('../config/database');

router.use(authenticate);

// GET /api/state-machines — Liste des machines disponibles + définitions
router.get('/', (req, res) => {
  res.json(Object.values(MACHINES).map((m) => ({
    name: m.name,
    description: m.description,
    states: m.states,
    initial: m.initial,
    terminal: m.terminal || [],
  })));
});

// GET /api/state-machines/:name — Détail d'une machine
router.get('/:name', (req, res) => {
  const m = MACHINES[req.params.name];
  if (!m) return res.status(404).json({ error: 'Machine inconnue' });
  res.json(m);
});

// GET /api/state-machines/:name/transitions?from=etat
// Liste les transitions possibles depuis un état pour l'utilisateur courant
router.get('/:name/transitions', (req, res) => {
  const m = MACHINES[req.params.name];
  if (!m) return res.status(404).json({ error: 'Machine inconnue' });
  const transitions = getAvailableTransitions(req.params.name, req.query.from, req.user?.role);
  res.json({ from: req.query.from || m.initial, transitions });
});

// POST /api/state-machines/:name/check
// Body : { from, to } — vérifie sans appliquer
router.post('/:name/check', (req, res) => {
  const { from, to } = req.body;
  const result = canTransition({ machine: req.params.name, fromState: from, toState: to, userRole: req.user?.role });
  res.status(result.ok ? 200 : 409).json(result);
});

// GET /api/state-machines/:name/audit?entity_type=&entity_id=
// Historique des transitions d'une entité
router.get('/:name/audit', async (req, res) => {
  try {
    const { entity_type, entity_id } = req.query;
    let query = `SELECT a.*, u.first_name || ' ' || u.last_name AS user_name
                 FROM state_transitions_audit a
                 LEFT JOIN users u ON u.id = a.user_id
                 WHERE a.machine = $1`;
    const params = [req.params.name];
    if (entity_type) { params.push(entity_type); query += ` AND a.entity_type = $${params.length}`; }
    if (entity_id)   { params.push(entity_id);   query += ` AND a.entity_id = $${params.length}`; }
    query += ' ORDER BY a.created_at DESC LIMIT 200';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[STATE-MACHINES] audit :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
