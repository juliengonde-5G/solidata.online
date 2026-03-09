const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// ══════════════════════════════════════════
// REGISTRE DES TRAITEMENTS (Article 30 RGPD)
// ══════════════════════════════════════════

// GET /api/rgpd/registre — Registre des traitements de données
router.get('/registre', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM rgpd_registre ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('[RGPD] Erreur registre :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/rgpd/registre — Ajouter un traitement
router.post('/registre', authorize('ADMIN'), async (req, res) => {
  try {
    const { nom_traitement, finalite, base_legale, categories_personnes, categories_donnees,
      destinataires, duree_conservation, mesures_securite } = req.body;
    if (!nom_traitement || !finalite || !base_legale) {
      return res.status(400).json({ error: 'Nom, finalité et base légale requis' });
    }
    const result = await pool.query(
      `INSERT INTO rgpd_registre (nom_traitement, finalite, base_legale, categories_personnes,
       categories_donnees, destinataires, duree_conservation, mesures_securite)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [nom_traitement, finalite, base_legale, categories_personnes, categories_donnees,
       destinataires, duree_conservation, mesures_securite]
    );
    // Log audit
    await pool.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'CREATE', 'registre', result.rows[0].id, JSON.stringify({ nom_traitement })]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[RGPD] Erreur ajout traitement :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// DROIT D'ACCÈS (Article 15 RGPD)
// ══════════════════════════════════════════

// GET /api/rgpd/export/:type/:id — Exporter toutes les données d'une personne
router.get('/export/:type/:id', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { type, id } = req.params;
    let data = {};

    if (type === 'candidate') {
      const candidate = await pool.query('SELECT * FROM candidates WHERE id = $1', [id]);
      if (candidate.rows.length === 0) return res.status(404).json({ error: 'Candidat non trouvé' });
      data.candidate = candidate.rows[0];
      data.skills = (await pool.query('SELECT * FROM candidate_skills WHERE candidate_id = $1', [id])).rows;
      data.history = (await pool.query('SELECT * FROM candidate_history WHERE candidate_id = $1', [id])).rows;
      data.pcm = (await pool.query('SELECT id, dominant_type, scores, created_at FROM pcm_profiles WHERE candidate_id = $1', [id])).rows;
    } else if (type === 'employee') {
      const employee = await pool.query('SELECT * FROM employees WHERE id = $1', [id]);
      if (employee.rows.length === 0) return res.status(404).json({ error: 'Employé non trouvé' });
      data.employee = employee.rows[0];
      data.contracts = (await pool.query('SELECT * FROM employee_contracts WHERE employee_id = $1', [id])).rows;
    } else {
      return res.status(400).json({ error: 'Type invalide (candidate ou employee)' });
    }

    // Log audit
    await pool.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'EXPORT_DATA', type, parseInt(id), JSON.stringify({ requested_by: req.user.id })]
    );

    res.json({ type, id: parseInt(id), exported_at: new Date().toISOString(), data });
  } catch (err) {
    console.error('[RGPD] Erreur export :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// DROIT À L'EFFACEMENT (Article 17 RGPD)
// ══════════════════════════════════════════

// POST /api/rgpd/anonymize/:type/:id — Anonymiser les données personnelles
router.post('/anonymize/:type/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const { type, id } = req.params;
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Motif d\'anonymisation requis' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (type === 'candidate') {
        const candidate = await client.query('SELECT first_name, last_name FROM candidates WHERE id = $1', [id]);
        if (candidate.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Candidat non trouvé' }); }

        await client.query(
          `UPDATE candidates SET
           first_name = 'ANONYME', last_name = CONCAT('CANDIDAT-', id),
           email = NULL, phone = NULL, cv_file_path = NULL, cv_raw_text = NULL,
           comment = NULL, interviewer_name = NULL, interview_comment = NULL,
           practical_test_comment = NULL, appointment_location = NULL,
           updated_at = NOW()
           WHERE id = $1`, [id]
        );
        await client.query('DELETE FROM candidate_skills WHERE candidate_id = $1', [id]);
        // Supprimer le profil PCM (données sensibles)
        await client.query('DELETE FROM pcm_profiles WHERE candidate_id = $1', [id]);

      } else if (type === 'employee') {
        const employee = await client.query('SELECT first_name, last_name FROM employees WHERE id = $1', [id]);
        if (employee.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Employé non trouvé' }); }

        await client.query(
          `UPDATE employees SET
           first_name = 'ANONYME', last_name = CONCAT('EMPLOYE-', id),
           email = NULL, phone = NULL, photo_path = NULL,
           skills = '{}', is_active = false,
           updated_at = NOW()
           WHERE id = $1`, [id]
        );
        // Anonymiser le user associé s'il existe
        await client.query(
          `UPDATE users SET first_name = 'ANONYME', last_name = CONCAT('USER-', id),
           email = CONCAT('anonyme-', id, '@supprime.local'), is_active = false
           WHERE id = (SELECT user_id FROM employees WHERE id = $1)`, [id]
        );
      } else {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Type invalide' });
      }

      // Log audit
      await client.query(
        'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
        [req.user.id, 'ANONYMIZE', type, parseInt(id), JSON.stringify({ reason })]
      );

      await client.query('COMMIT');
      res.json({ message: `Données ${type} #${id} anonymisées`, anonymized_at: new Date().toISOString() });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[RGPD] Erreur anonymisation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// GESTION DU CONSENTEMENT
// ══════════════════════════════════════════

// GET /api/rgpd/consent/:type/:id — Voir les consentements
router.get('/consent/:type/:id', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM rgpd_consents WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC',
      [req.params.type, req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[RGPD] Erreur consentements :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/rgpd/consent — Enregistrer un consentement
router.post('/consent', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { entity_type, entity_id, consent_type, granted, comment } = req.body;
    if (!entity_type || !entity_id || !consent_type) {
      return res.status(400).json({ error: 'entity_type, entity_id et consent_type requis' });
    }
    const result = await pool.query(
      `INSERT INTO rgpd_consents (entity_type, entity_id, consent_type, granted, comment, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (entity_type, entity_id, consent_type) DO UPDATE
       SET granted = $4, comment = $5, recorded_by = $6, updated_at = NOW()
       RETURNING *`,
      [entity_type, entity_id, consent_type, granted !== false, comment, req.user.id]
    );
    // Log
    await pool.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, granted !== false ? 'CONSENT_GRANTED' : 'CONSENT_REVOKED', entity_type, entity_id,
       JSON.stringify({ consent_type })]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[RGPD] Erreur consentement :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// JOURNAL D'AUDIT
// ══════════════════════════════════════════

// GET /api/rgpd/audit — Journal des actions RGPD
router.get('/audit', authorize('ADMIN'), async (req, res) => {
  try {
    const { limit: lim, offset: off, action, entity_type } = req.query;
    let query = `SELECT a.*, u.first_name, u.last_name FROM rgpd_audit_log a
      LEFT JOIN users u ON a.user_id = u.id WHERE 1=1`;
    const params = [];
    if (action) { params.push(action); query += ` AND a.action = $${params.length}`; }
    if (entity_type) { params.push(entity_type); query += ` AND a.entity_type = $${params.length}`; }
    query += ' ORDER BY a.created_at DESC';
    params.push(parseInt(lim) || 50);
    query += ` LIMIT $${params.length}`;
    params.push(parseInt(off) || 0);
    query += ` OFFSET $${params.length}`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[RGPD] Erreur audit :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// PURGE AUTOMATIQUE (Conservation limitée)
// ══════════════════════════════════════════

// POST /api/rgpd/purge-expired — Anonymiser les données expirées
router.post('/purge-expired', authorize('ADMIN'), async (req, res) => {
  try {
    // Candidats non recrutés > 24 mois (durée légale de conservation)
    const expired = await pool.query(
      `SELECT id FROM candidates
       WHERE status != 'hired' AND updated_at < NOW() - INTERVAL '24 months'
       AND first_name != 'ANONYME'`
    );

    let count = 0;
    for (const c of expired.rows) {
      await pool.query(
        `UPDATE candidates SET
         first_name = 'ANONYME', last_name = CONCAT('CANDIDAT-', id),
         email = NULL, phone = NULL, cv_file_path = NULL, cv_raw_text = NULL,
         comment = NULL, updated_at = NOW() WHERE id = $1`, [c.id]
      );
      await pool.query('DELETE FROM candidate_skills WHERE candidate_id = $1', [c.id]);
      await pool.query('DELETE FROM pcm_profiles WHERE candidate_id = $1', [c.id]);
      count++;
    }

    await pool.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'PURGE_EXPIRED', 'candidates', 0, JSON.stringify({ count, threshold: '24 months' })]
    );

    res.json({ message: `${count} candidats anonymisés (> 24 mois)`, purged_at: new Date().toISOString() });
  } catch (err) {
    console.error('[RGPD] Erreur purge :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
