const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// Auto-create table
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS news_articles (
        id SERIAL PRIMARY KEY,
        category VARCHAR(30) NOT NULL CHECK (category IN ('metier', 'local')),
        title VARCHAR(255) NOT NULL,
        summary TEXT,
        content TEXT,
        source_url VARCHAR(500),
        source_name VARCHAR(100),
        tags TEXT[],
        is_pinned BOOLEAN DEFAULT false,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('[NEWSFEED] Table news_articles OK');
  } catch (err) {
    console.error('[NEWSFEED] Migration :', err.message);
  }
})();

router.use(authenticate);

// GET /api/news — Liste des articles
router.get('/', async (req, res) => {
  try {
    const { category, limit } = req.query;
    let query = 'SELECT * FROM news_articles';
    const params = [];

    if (category) {
      params.push(category);
      query += ` WHERE category = $${params.length}`;
    }

    query += ' ORDER BY is_pinned DESC, created_at DESC';

    if (limit) {
      params.push(parseInt(limit));
      query += ` LIMIT $${params.length}`;
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[NEWSFEED] Erreur GET :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/news — Creer un article (ADMIN/RH)
router.post('/', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { category, title, summary, content, source_url, source_name, tags, is_pinned } = req.body;
    if (!category || !title) {
      return res.status(400).json({ error: 'category et title requis' });
    }

    const result = await pool.query(
      `INSERT INTO news_articles (category, title, summary, content, source_url, source_name, tags, is_pinned, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [category, title, summary || null, content || null, source_url || null, source_name || null, tags || [], is_pinned || false, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[NEWSFEED] Erreur POST :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/news/:id
router.put('/:id', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { title, summary, content, source_url, source_name, tags, is_pinned, category } = req.body;
    const result = await pool.query(
      `UPDATE news_articles SET
       title = COALESCE($1, title), summary = COALESCE($2, summary),
       content = COALESCE($3, content), source_url = COALESCE($4, source_url),
       source_name = COALESCE($5, source_name), tags = COALESCE($6, tags),
       is_pinned = COALESCE($7, is_pinned), category = COALESCE($8, category),
       updated_at = NOW()
       WHERE id = $9 RETURNING *`,
      [title, summary, content, source_url, source_name, tags, is_pinned, category, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Article non trouve' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[NEWSFEED] Erreur PUT :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/news/:id
router.delete('/:id', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    await pool.query('DELETE FROM news_articles WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[NEWSFEED] Erreur DELETE :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
