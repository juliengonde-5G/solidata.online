const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');

// ══════════════════════════════════════════
// LIAISON CANDIDAT (recrutement) ↔ COLLABORATEUR (RH)
// ──────────────────────────────────────────
// Règle métier : un collaborateur (table `employees`) est créé UNIQUEMENT par
// la synchronisation RH (import du logiciel de paye Malibou, cf.
// services/collaborator-import.js). Le recrutement ne crée jamais de
// collaborateur — il se contente de LIER une fiche de recrutement à un
// collaborateur déjà existant, en renseignant `employees.candidate_id`.
//
// Pourquoi : la base recrutement est saisie à la main, la base RH est alimentée
// par la paye. Sans ce lien, le profil de personnalité PCM passé pendant le
// recrutement ne remonte pas dans le module Insertion (celui-ci joint
// pcm_reports → candidates → employees via `employees.candidate_id`).
// ══════════════════════════════════════════

/** Normalise un nom pour l'appariement (sans accents, minuscules, trim). */
function normName(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

// POST /api/candidates/:id/convert-to-employee — DÉSACTIVÉ (410 Gone)
// Ancien flux qui CRÉAIT un collaborateur depuis le recrutement. Contraire à la
// règle « seul le logiciel RH crée un collaborateur ». Conservé en stub pour
// renvoyer un message explicite aux anciens clients.
router.post('/:id/convert-to-employee', authorize('ADMIN', 'RH'), async (req, res) => {
  return res.status(410).json({
    error: "La création d'un collaborateur depuis le recrutement est désactivée.",
    hint: "Les collaborateurs sont créés uniquement par la synchronisation RH (import du logiciel de paye). Utilisez « Lier à un collaborateur » pour rattacher cette fiche de recrutement à un collaborateur existant.",
  });
});

// GET /api/candidates/:id/employee-matches — collaborateurs candidats à la liaison
// Renvoie le collaborateur déjà lié (le cas échéant) + la liste des
// collaborateurs NON liés, classés par proximité de nom avec le candidat.
router.get('/:id/employee-matches', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { id } = req.params;
    const cand = await pool.query('SELECT id, first_name, last_name FROM candidates WHERE id = $1', [id]);
    if (cand.rows.length === 0) return res.status(404).json({ error: 'Candidat non trouvé' });
    const c = cand.rows[0];

    const linked = await pool.query(
      `SELECT id, first_name, last_name, position, malibou_id, is_active
       FROM employees WHERE candidate_id = $1`, [id]);

    const emps = await pool.query(
      `SELECT id, first_name, last_name, position, malibou_id, is_active
       FROM employees WHERE candidate_id IS NULL
       ORDER BY is_active DESC, last_name, first_name`);

    const cf = normName(c.first_name); const cl = normName(c.last_name);
    const scored = emps.rows.map((e) => {
      const ef = normName(e.first_name); const el = normName(e.last_name);
      let score = 0;
      if (cf && cl && ef === cf && el === cl) score = 100;               // nom + prénom exacts
      else if (cl && el === cl && cf && (ef.startsWith(cf) || cf.startsWith(ef))) score = 80;
      else if (cl && el === cl) score = 60;                             // même nom de famille
      else if (cf && ef === cf) score = 40;                            // même prénom
      else if (el && cl && (el.includes(cl) || cl.includes(el))) score = 20;
      return { ...e, match_score: score };
    }).sort((a, b) => b.match_score - a.match_score
      || String(a.last_name || '').localeCompare(String(b.last_name || '')));

    res.json({
      candidate: c,
      linked_employee: linked.rows[0] || null,
      suggestions: scored,
    });
  } catch (err) {
    console.error('[CANDIDATES] Erreur employee-matches :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/candidates/:id/link-employee { employee_id } — lier à un collaborateur existant
router.post('/:id/link-employee', authorize('ADMIN', 'RH'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const employeeId = parseInt(req.body?.employee_id, 10);
    if (!employeeId) { client.release(); return res.status(400).json({ error: 'employee_id requis' }); }

    const cand = await client.query('SELECT id, first_name, last_name, status, has_permis_b, has_caces FROM candidates WHERE id = $1', [id]);
    if (cand.rows.length === 0) { client.release(); return res.status(404).json({ error: 'Candidat non trouvé' }); }
    const emp = await client.query('SELECT id, candidate_id, first_name, last_name, has_permis_b, has_caces FROM employees WHERE id = $1', [employeeId]);
    if (emp.rows.length === 0) { client.release(); return res.status(404).json({ error: 'Collaborateur non trouvé' }); }

    // Ce collaborateur est-il déjà lié à un AUTRE candidat ?
    if (emp.rows[0].candidate_id && Number(emp.rows[0].candidate_id) !== Number(id)) {
      client.release();
      return res.status(409).json({ error: 'Ce collaborateur est déjà lié à une autre fiche de recrutement.', candidate_id: emp.rows[0].candidate_id });
    }
    // Ce candidat est-il déjà lié à un AUTRE collaborateur ? (candidate_id est UNIQUE)
    const other = await client.query('SELECT id FROM employees WHERE candidate_id = $1 AND id <> $2', [id, employeeId]);
    if (other.rows.length > 0) {
      client.release();
      return res.status(409).json({ error: 'Ce candidat est déjà lié à un autre collaborateur.', employee_id: other.rows[0].id });
    }

    await client.query('BEGIN');
    await client.query('UPDATE employees SET candidate_id = $1, updated_at = NOW() WHERE id = $2', [id, employeeId]);

    // Vague 2 (résiduel v1-2, item 40) — Recopie des compétences opérationnelles
    // (permis B / CACES) du candidat vers le collaborateur AU MOMENT DU LIEN.
    // OR logique : ne remonte que false→true, jamais de rétrogradation d'une
    // valeur déjà saisie côté RH. Le backfill idempotent d'init-db (vague 1)
    // rattrape le stock ; ceci couvre le flux au fil de l'eau. Ces booléens
    // conditionnent l'affectation « chauffeur » / « cariste » du planning hebdo.
    const grantedPermis = !!cand.rows[0].has_permis_b && !emp.rows[0].has_permis_b;
    const grantedCaces = !!cand.rows[0].has_caces && !emp.rows[0].has_caces;
    await client.query(
      `UPDATE employees e
          SET has_permis_b = (COALESCE(e.has_permis_b, false) OR COALESCE(c.has_permis_b, false)),
              has_caces    = (COALESCE(e.has_caces, false)    OR COALESCE(c.has_caces, false)),
              updated_at = NOW()
         FROM candidates c
        WHERE e.id = $1 AND c.id = $2`,
      [employeeId, id]);

    // Squelette de diagnostic d'insertion : garantit que le profil PCM du
    // candidat remonte dans le module Insertion. Best effort — ne bloque pas la
    // liaison si la table/contrainte n'existe pas sur une base ancienne.
    try {
      await client.query(
        `INSERT INTO insertion_diagnostics (employee_id, created_by)
         VALUES ($1, $2) ON CONFLICT (employee_id) DO NOTHING`,
        [employeeId, req.user.id]);
    } catch (e) { /* non bloquant */ }

    const grantedSkills = [];
    if (grantedPermis) grantedSkills.push('permis B');
    if (grantedCaces) grantedSkills.push('CACES');
    const skillNote = grantedSkills.length ? ` — compétences recopiées : ${grantedSkills.join(', ')}` : '';
    await client.query(
      'INSERT INTO candidate_history (candidate_id, to_status, comment, changed_by) VALUES ($1, $2, $3, $4)',
      [id, cand.rows[0].status,
        `Fiche de recrutement liée au collaborateur #${employeeId} (${emp.rows[0].first_name || ''} ${emp.rows[0].last_name || ''})${skillNote}`.trim(),
        req.user.id]);
    await client.query('COMMIT');

    const updated = await pool.query(
      'SELECT id, first_name, last_name, position, malibou_id, candidate_id, is_active FROM employees WHERE id = $1',
      [employeeId]);
    res.json({ message: 'Fiche de recrutement liée au collaborateur.', employee: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[CANDIDATES] Erreur link-employee :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// POST /api/candidates/:id/unlink-employee — délier
router.post('/:id/unlink-employee', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { id } = req.params;
    const emp = await pool.query('SELECT id, first_name, last_name FROM employees WHERE candidate_id = $1', [id]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Aucun collaborateur lié à ce candidat.' });
    const cand = await pool.query('SELECT status FROM candidates WHERE id = $1', [id]);
    await pool.query('UPDATE employees SET candidate_id = NULL, updated_at = NOW() WHERE candidate_id = $1', [id]);
    await pool.query(
      'INSERT INTO candidate_history (candidate_id, to_status, comment, changed_by) VALUES ($1, $2, $3, $4)',
      [id, cand.rows[0]?.status || null, `Liaison au collaborateur #${emp.rows[0].id} supprimée`, req.user.id]);
    res.json({ message: 'Liaison supprimée.', employee_id: emp.rows[0].id });
  } catch (err) {
    console.error('[CANDIDATES] Erreur unlink-employee :', err);
    res.status(500).json({ error: 'Erreur serveur' });
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
