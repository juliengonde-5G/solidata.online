const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { invalidateSkillPatternsCache } = require('./cv-engine');

// ══════════════════════════════════════════
// CRUD Skill Keywords (ADMIN only)
// ══════════════════════════════════════════

// GET /api/candidates/keywords — Liste tous les keywords
router.get('/', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM skill_keywords ORDER BY skill_name, keyword'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[CANDIDATES] Erreur liste keywords :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/candidates/keywords — Créer un keyword
router.post('/', authorize('ADMIN'), async (req, res) => {
  try {
    const { skill_name, keyword, synonyms } = req.body;

    if (!skill_name || !keyword) {
      return res.status(400).json({ error: 'skill_name et keyword sont requis' });
    }

    const result = await pool.query(
      `INSERT INTO skill_keywords (skill_name, keyword, synonyms)
       VALUES ($1, $2, $3) RETURNING *`,
      [skill_name, keyword, synonyms || []]
    );

    invalidateSkillPatternsCache();
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ce keyword existe déjà pour cette compétence' });
    }
    console.error('[CANDIDATES] Erreur création keyword :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/candidates/keywords/:id — Modifier un keyword
router.put('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { skill_name, keyword, synonyms, is_active } = req.body;

    const setClauses = [];
    const values = [];
    let i = 1;

    if (skill_name !== undefined) { setClauses.push(`skill_name = $${i}`); values.push(skill_name); i++; }
    if (keyword !== undefined) { setClauses.push(`keyword = $${i}`); values.push(keyword); i++; }
    if (synonyms !== undefined) { setClauses.push(`synonyms = $${i}`); values.push(synonyms); i++; }
    if (is_active !== undefined) { setClauses.push(`is_active = $${i}`); values.push(is_active); i++; }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à modifier' });
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE skill_keywords SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Keyword non trouvé' });
    }

    invalidateSkillPatternsCache();
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur modification keyword :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/candidates/keywords/:id — Supprimer un keyword
router.delete('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM skill_keywords WHERE id = $1 RETURNING id',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Keyword non trouvé' });
    }

    invalidateSkillPatternsCache();
    res.json({ message: 'Keyword supprimé' });
  } catch (err) {
    console.error('[CANDIDATES] Erreur suppression keyword :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
