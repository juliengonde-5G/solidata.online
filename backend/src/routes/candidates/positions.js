const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');

// ══════════════════════════════════════════
// POSITIONS (Postes)
// ══════════════════════════════════════════

router.get('/list', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const queries = [
      `SELECT p.*, (SELECT COUNT(*)::int FROM candidates c WHERE c.position_id = p.id AND c.status = 'hired') as filled
       FROM positions p WHERE p.is_active = true ORDER BY p.created_at DESC`,
      `SELECT p.*, 0 as filled FROM positions p WHERE p.is_active = true ORDER BY p.id DESC`,
      `SELECT p.*, 0 as filled FROM positions p ORDER BY p.id DESC`,
    ];
    let result;
    for (const sql of queries) {
      try {
        result = await pool.query(sql);
        break;
      } catch (colErr) {
        if (colErr.code !== '42703') throw colErr;
      }
    }
    if (!result) throw new Error('positions list failed');
    res.json(result.rows);
  } catch (err) {
    console.error('[POSITIONS] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { title, type, month, slots_open, team_type, required_skills } = req.body;
    const result = await pool.query(
      `INSERT INTO positions (title, type, month, slots_open, team_type, required_skills)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, type, month, slots_open || 1, team_type, required_skills || []]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[POSITIONS] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/:id', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { title, type, month, slots_open, team_type, required_skills } = req.body;
    const result = await pool.query(
      `UPDATE positions SET title = COALESCE($1, title), type = COALESCE($2, type),
       month = COALESCE($3, month), slots_open = COALESCE($4, slots_open),
       team_type = COALESCE($5, team_type), required_skills = COALESCE($6, required_skills)
       WHERE id = $7 RETURNING *`,
      [title, type, month, slots_open, team_type, required_skills, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Poste non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[POSITIONS] Erreur modification :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    await pool.query('UPDATE candidates SET position_id = NULL WHERE position_id = $1', [req.params.id]);
    const result = await pool.query('DELETE FROM positions WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Poste non trouvé' });
    res.json({ message: 'Poste supprimé' });
  } catch (err) {
    console.error('[POSITIONS] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
