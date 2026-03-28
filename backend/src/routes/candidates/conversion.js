const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');

// ══════════════════════════════════════════
// CONVERSION CANDIDAT → EMPLOYÉ
// ══════════════════════════════════════════

// POST /api/candidates/:id/convert-to-employee — Convertir candidat en employé
router.post('/:id/convert-to-employee', authorize('ADMIN', 'RH'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { team_id, position, contract_type, contract_start, weekly_hours } = req.body;

    // Vérifier que le candidat existe et est au statut 'hired'
    const candidate = await client.query('SELECT * FROM candidates WHERE id = $1', [id]);
    if (candidate.rows.length === 0) { client.release(); return res.status(404).json({ error: 'Candidat non trouvé' }); }
    if (candidate.rows[0].status !== 'hired') {
      client.release();
      return res.status(400).json({ error: 'Le candidat doit être au statut "hired" pour être converti' });
    }

    // Vérifier qu'il n'est pas déjà converti
    const existing = await client.query('SELECT id FROM employees WHERE candidate_id = $1', [id]);
    if (existing.rows.length > 0) {
      client.release();
      return res.status(409).json({ error: 'Ce candidat a déjà été converti en employé', employee_id: existing.rows[0].id });
    }

    const c = candidate.rows[0];

    // Vérifier que le candidat a un nom/prénom
    if (!c.first_name || !c.last_name) {
      client.release();
      return res.status(400).json({ error: 'Le candidat doit avoir un prénom et un nom avant d\'être converti. Complétez sa fiche.' });
    }

    await client.query('BEGIN');

    // Récupérer les compétences confirmées du candidat
    const skillsResult = await client.query(
      "SELECT skill_name FROM candidate_skills WHERE candidate_id = $1 AND status IN ('confirmed', 'detected')",
      [id]
    );
    const skills = skillsResult.rows.map(r => r.skill_name);

    // Créer l'employé avec les données du candidat
    const employee = await client.query(
      `INSERT INTO employees (candidate_id, first_name, last_name, phone, email,
       team_id, position, contract_type, contract_start, has_permis_b, has_caces,
       weekly_hours, skills)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [id, c.first_name, c.last_name, c.phone, c.email,
       team_id || null, position || null, contract_type || 'CDD',
       contract_start || new Date().toISOString().split('T')[0],
       c.has_permis_b || false, c.has_caces || false,
       weekly_hours || 35, skills]
    );

    // Logger dans l'historique du candidat
    await client.query(
      'INSERT INTO candidate_history (candidate_id, from_status, to_status, comment, changed_by) VALUES ($1, $2, $3, $4, $5)',
      [id, 'hired', 'converted', `Converti en employé #${employee.rows[0].id}`, req.user.id]
    );

    // Créer automatiquement le diagnostic insertion initial (parcours bénéficiaire)
    const empId = employee.rows[0].id;
    try {
      await client.query(
        `INSERT INTO insertion_diagnostics (employee_id, date_entree, statut,
         mobilite, sante, finances, famille, linguistique, administratif, numerique,
         created_by)
         VALUES ($1, $2, 'actif', 3, 3, 3, 3, 3, 3, 3, $3)
         ON CONFLICT (employee_id) DO NOTHING`,
        [empId, contract_start || new Date().toISOString().split('T')[0], req.user.id]
      );
      // Créer les jalons M1, M6, M12
      const startDate = new Date(contract_start || Date.now());
      for (const [label, months] of [['M1', 1], ['M6', 6], ['M12', 12]]) {
        const milestoneDate = new Date(startDate);
        milestoneDate.setMonth(milestoneDate.getMonth() + months);
        await client.query(
          `INSERT INTO insertion_milestones (employee_id, label, date_prevue, statut)
           VALUES ($1, $2, $3, 'a_planifier') ON CONFLICT DO NOTHING`,
          [empId, label, milestoneDate.toISOString().split('T')[0]]
        );
      }
    } catch (insErr) {
      console.warn('[CANDIDATES] Insertion auto-diagnostic skipped:', insErr.message);
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Candidat converti en employé avec succès',
      employee: employee.rows[0],
      skills_transferred: skills.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[CANDIDATES] Erreur conversion :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════
// TRAME ENTRETIEN DE RECRUTEMENT
// ══════════════════════════════════════════

// GET /api/candidates/:id/interview-form — Récupérer l'entretien structuré
router.get('/:id/interview-form', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM recruitment_interviews WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.params.id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('[CANDIDATES] Erreur récup entretien :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/candidates/:id/interview-form — Sauvegarder l'entretien structuré
router.post('/:id/interview-form', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { id } = req.params;
    const f = req.body;

    // Vérifier que le candidat existe
    const candidate = await pool.query('SELECT id FROM candidates WHERE id = $1', [id]);
    if (candidate.rows.length === 0) return res.status(404).json({ error: 'Candidat non trouvé' });

    // Upsert: supprimer l'ancien si existe, puis insérer
    await pool.query('DELETE FROM recruitment_interviews WHERE candidate_id = $1', [id]);

    const result = await pool.query(
      `INSERT INTO recruitment_interviews (
        candidate_id, interview_date, interviewer_id,
        presentation_mots, parcours_professionnel, experiences_marquantes,
        situation_actuelle, situation_actuelle_autre,
        duree_sans_emploi, difficultes_recherche, difficultes_recherche_autre,
        freins_emploi, freins_emploi_autre,
        contraintes_horaires, contraintes_horaires_detail,
        structure_accompagnement, structure_accompagnement_autre,
        motivation_integration, motivation_reprise, attentes, attentes_autre,
        experience_activite, comportement_equipe, reaction_consigne, travail_physique,
        disponibilite_horaires, disponibilite_autre, organisation_ponctualite,
        idee_metier, idee_metier_detail, amelioration_souhaitee, question_ouverte,
        evaluation_globale, commentaire_evaluateur
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34
      ) RETURNING *`,
      [
        id, f.interview_date || new Date(), req.user.id,
        f.presentation_mots, f.parcours_professionnel, f.experiences_marquantes,
        f.situation_actuelle || null, f.situation_actuelle_autre,
        f.duree_sans_emploi || null, f.difficultes_recherche || [], f.difficultes_recherche_autre,
        f.freins_emploi || [], f.freins_emploi_autre,
        f.contraintes_horaires || null, f.contraintes_horaires_detail,
        f.structure_accompagnement || [], f.structure_accompagnement_autre,
        f.motivation_integration, f.motivation_reprise, f.attentes || [], f.attentes_autre,
        f.experience_activite || [], f.comportement_equipe, f.reaction_consigne, f.travail_physique || null,
        f.disponibilite_horaires || null, f.disponibilite_autre, f.organisation_ponctualite,
        f.idee_metier || null, f.idee_metier_detail, f.amelioration_souhaitee, f.question_ouverte,
        f.evaluation_globale || null, f.commentaire_evaluateur,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur sauvegarde entretien :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// FICHES DE MISE EN SITUATION
// ══════════════════════════════════════════

// GET /api/candidates/:id/mise-en-situation — Récupérer les évaluations
router.get('/:id/mise-en-situation', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.*, u.first_name as evaluator_name, u.last_name as evaluator_lastname
       FROM mise_en_situation m
       LEFT JOIN users u ON m.evaluator_id = u.id
       WHERE m.candidate_id = $1 ORDER BY m.created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[CANDIDATES] Erreur récup mise en situation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/candidates/:id/mise-en-situation — Sauvegarder une évaluation
router.post('/:id/mise-en-situation', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const { id } = req.params;
    const f = req.body;

    const validTypes = ['collecte_manutention', 'craquage', 'qualite'];
    if (!validTypes.includes(f.type)) {
      return res.status(400).json({ error: 'Type invalide. Types valides : ' + validTypes.join(', ') });
    }

    // Upsert par type : une seule évaluation par type par candidat
    await pool.query('DELETE FROM mise_en_situation WHERE candidate_id = $1 AND type = $2', [id, f.type]);

    const result = await pool.query(
      `INSERT INTO mise_en_situation (
        candidate_id, type, evaluator_id, evaluation_date,
        respect_consignes, capacite_physique, endurance, comprehension,
        qualite_travail, rapidite, securite, autonomie,
        resultat, points_forts, points_amelioration, commentaire, duree_minutes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
      [
        id, f.type, req.user.id, f.evaluation_date || new Date(),
        f.respect_consignes, f.capacite_physique, f.endurance, f.comprehension,
        f.qualite_travail, f.rapidite, f.securite, f.autonomie,
        f.resultat || null, f.points_forts, f.points_amelioration, f.commentaire, f.duree_minutes,
      ]
    );

    // Mettre à jour le test pratique du candidat si au moins une évaluation est faite
    await pool.query(
      `UPDATE candidates SET practical_test_done = true, updated_at = NOW() WHERE id = $1`,
      [id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur sauvegarde mise en situation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// PLAN DE RECRUTEMENT MENSUEL
// ══════════════════════════════════════════

// GET /api/candidates/recruitment-plan?from=2026-01&to=2026-12
router.get('/recruitment-plan', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const { from, to } = req.query;
    let query = `
      SELECT rp.*, p.title as position_title, p.type as position_type,
        (SELECT COUNT(*) FROM candidates c WHERE c.position_id = rp.position_id AND c.status = 'hired'
          AND to_char(c.updated_at, 'YYYY-MM') = rp.month) as hired_count
      FROM recruitment_plan rp
      JOIN positions p ON p.id = rp.position_id
    `;
    const params = [];
    if (from && to) {
      query += ' WHERE rp.month >= $1 AND rp.month <= $2';
      params.push(from, to);
    }
    query += ' ORDER BY rp.month, p.title';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[RECRUITMENT-PLAN] Erreur GET :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/candidates/recruitment-plan — Créer/mettre à jour un besoin
router.post('/recruitment-plan', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { position_id, month, slots_needed } = req.body;
    if (!position_id || !month || slots_needed == null) {
      return res.status(400).json({ error: 'position_id, month et slots_needed requis' });
    }
    const result = await pool.query(`
      INSERT INTO recruitment_plan (position_id, month, slots_needed, created_by, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (position_id, month) DO UPDATE SET slots_needed = $3, updated_at = NOW()
      RETURNING *
    `, [position_id, month, slots_needed, req.user.id]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[RECRUITMENT-PLAN] Erreur POST :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/candidates/recruitment-plan/:id
router.delete('/recruitment-plan/:id', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    await pool.query('DELETE FROM recruitment_plan WHERE id = $1', [req.params.id]);
    res.json({ message: 'Supprimé' });
  } catch (err) {
    console.error('[RECRUITMENT-PLAN] Erreur DELETE :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
