const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

// ══════════════════════════════════════════
// POSTES DE TRAVAIL PAR FILIERE
// ══════════════════════════════════════════

const FILIERES = [
  { code: 'tri', label: 'Tri', color: '#8BC540' },
  { code: 'collecte', label: 'Collecte', color: '#3B82F6' },
  { code: 'logistique', label: 'Logistique', color: '#F59E0B' },
  { code: 'btq', label: 'Boutiques', color: '#EC4899' },
];

// GET /api/planning-hebdo/postes — Tous les postes groupes par filiere
router.get('/postes', async (req, res) => {
  try {
    const postes = [];

    // 1. Postes de tri (depuis postes_operation)
    try {
      const triResult = await pool.query(`
        SELECT po.id, po.nom, po.code, po.competences_requises, po.est_obligatoire,
               op.nom as operation_nom, ch.nom as chaine_nom
        FROM postes_operation po
        JOIN operations_tri op ON po.operation_id = op.id
        JOIN chaines_tri ch ON op.chaine_id = ch.id
        WHERE po.is_active = true
        ORDER BY ch.nom, op.numero, po.nom
      `);
      for (const p of triResult.rows) {
        postes.push({
          id: `tri_${p.id}`,
          source_id: p.id,
          source_table: 'postes_operation',
          filiere: 'tri',
          nom: p.nom,
          code: p.code,
          detail: `${p.chaine_nom} — ${p.operation_nom}`,
          competences_requises: p.competences_requises || [],
          require_permis_b: false,
          require_caces: (p.competences_requises || []).some(c => c.toLowerCase().includes('caces')),
          obligatoire: p.est_obligatoire,
        });
      }
    } catch { /* table may not exist */ }

    // 2. Postes de collecte
    postes.push({
      id: 'collecte_chauffeur',
      source_id: null,
      source_table: null,
      filiere: 'collecte',
      nom: 'Chauffeur collecte',
      code: 'COLL_CHAUFF',
      detail: 'Conduite vehicule de collecte',
      competences_requises: ['permis_b'],
      require_permis_b: true,
      require_caces: false,
      obligatoire: true,
    });
    postes.push({
      id: 'collecte_ripeur',
      source_id: null,
      source_table: null,
      filiere: 'collecte',
      nom: 'Ripeur / Equipier',
      code: 'COLL_RIPEUR',
      detail: 'Manipulation des conteneurs et collecte',
      competences_requises: [],
      require_permis_b: false,
      require_caces: false,
      obligatoire: false,
    });

    // 3. Postes logistique
    postes.push({
      id: 'logistique_cariste',
      source_id: null,
      source_table: null,
      filiere: 'logistique',
      nom: 'Cariste',
      code: 'LOG_CARISTE',
      detail: 'Chargement / dechargement — CACES requis',
      competences_requises: ['caces'],
      require_permis_b: false,
      require_caces: true,
      obligatoire: true,
    });
    postes.push({
      id: 'logistique_preparation',
      source_id: null,
      source_table: null,
      filiere: 'logistique',
      nom: 'Preparateur commande',
      code: 'LOG_PREP',
      detail: 'Preparation des expeditions exutoires',
      competences_requises: [],
      require_permis_b: false,
      require_caces: false,
      obligatoire: false,
    });
    postes.push({
      id: 'logistique_quai',
      source_id: null,
      source_table: null,
      filiere: 'logistique',
      nom: 'Agent de quai',
      code: 'LOG_QUAI',
      detail: 'Reception et expedition sur quai',
      competences_requises: [],
      require_permis_b: false,
      require_caces: false,
      obligatoire: false,
    });

    // 4. Postes boutique
    for (const btq of ['btq_st_sever', 'btq_lhopital']) {
      const label = btq === 'btq_st_sever' ? 'BTQ St-Sever' : "BTQ L'Hopital";
      postes.push({
        id: `${btq}_vendeur`,
        source_id: null,
        source_table: null,
        filiere: 'btq',
        nom: `Vendeur ${label}`,
        code: `${btq.toUpperCase()}_VEND`,
        detail: `Vente et accueil en boutique ${label}`,
        competences_requises: [],
        require_permis_b: false,
        require_caces: false,
        obligatoire: true,
      });
      postes.push({
        id: `${btq}_caisse`,
        source_id: null,
        source_table: null,
        filiere: 'btq',
        nom: `Caissier ${label}`,
        code: `${btq.toUpperCase()}_CAISSE`,
        detail: `Tenue de caisse ${label}`,
        competences_requises: [],
        require_permis_b: false,
        require_caces: false,
        obligatoire: true,
      });
    }

    // 5. Ajouter les postes generiques de la table positions
    try {
      const positionsResult = await pool.query(
        "SELECT * FROM positions WHERE is_active = true ORDER BY team_type, title"
      );
      for (const p of positionsResult.rows) {
        const filiere = p.team_type === 'tri' ? 'tri'
          : p.team_type === 'collecte' ? 'collecte'
          : p.team_type === 'logistique' ? 'logistique'
          : (p.team_type || '').startsWith('btq') ? 'btq'
          : null;
        if (!filiere) continue;
        // Eviter les doublons avec les postes deja ajoutes
        if (postes.some(pp => pp.nom === p.title && pp.filiere === filiere)) continue;
        postes.push({
          id: `pos_${p.id}`,
          source_id: p.id,
          source_table: 'positions',
          filiere,
          nom: p.title,
          code: `POS_${p.id}`,
          detail: p.type || '',
          competences_requises: p.required_skills || [],
          require_permis_b: (p.required_skills || []).some(s => s.toLowerCase().includes('permis')),
          require_caces: (p.required_skills || []).some(s => s.toLowerCase().includes('caces')),
          obligatoire: false,
        });
      }
    } catch { /* positions table may not exist */ }

    res.json({ filieres: FILIERES, postes });
  } catch (err) {
    console.error('[PLANNING-HEBDO] Erreur postes :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/planning-hebdo — Planning de la semaine
router.get('/', async (req, res) => {
  try {
    const { week_start } = req.query;
    // Calculer le lundi de la semaine
    let monday;
    if (week_start) {
      monday = new Date(week_start);
    } else {
      const now = new Date();
      const day = now.getDay();
      monday = new Date(now);
      monday.setDate(now.getDate() - ((day + 6) % 7));
    }
    monday.setHours(0, 0, 0, 0);

    const dates = [];
    for (let i = 0; i < 6; i++) { // lundi → samedi
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }

    const dateFrom = dates[0];
    const dateTo = dates[dates.length - 1];

    // 1. Affectations existantes
    const scheduleResult = await pool.query(`
      SELECT s.id, s.employee_id, s.date, s.status, s.position_id, s.poste_code,
             s.is_provisional,
             e.first_name, e.last_name, e.has_permis_b, e.has_caces, e.skills,
             p.title as position_title
      FROM schedule s
      JOIN employees e ON s.employee_id = e.id
      LEFT JOIN positions p ON s.position_id = p.id
      WHERE s.date >= $1 AND s.date <= $2
      ORDER BY s.date, e.last_name
    `, [dateFrom, dateTo]);

    // 2. Employes actifs avec dispo
    const employeesResult = await pool.query(`
      SELECT e.id, e.first_name, e.last_name, e.has_permis_b, e.has_caces,
             e.skills, e.position, e.weekly_hours, e.contract_type,
             t.name as team_name, t.type as team_type,
             ARRAY_AGG(ea.day_off) FILTER (WHERE ea.day_off IS NOT NULL) as jours_off
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      LEFT JOIN employee_availability ea ON ea.employee_id = e.id
      WHERE e.is_active = true
      GROUP BY e.id, t.name, t.type
      ORDER BY t.type, e.last_name
    `);

    // 3. Absences (conges, maladie) sur la semaine
    const absencesResult = await pool.query(`
      SELECT employee_id, date, type
      FROM work_hours
      WHERE date >= $1 AND date <= $2
        AND type IN ('absence', 'sick', 'holiday')
    `, [dateFrom, dateTo]);

    const absencesByEmpDate = {};
    for (const a of absencesResult.rows) {
      const key = `${a.employee_id}_${new Date(a.date).toISOString().slice(0, 10)}`;
      absencesByEmpDate[key] = a.type;
    }

    // Formatter les affectations par poste_code + date
    const affectations = {};
    for (const s of scheduleResult.rows) {
      const dateStr = new Date(s.date).toISOString().slice(0, 10);
      const key = `${s.position_id || 'none'}_${dateStr}`;
      if (!affectations[key]) affectations[key] = [];
      affectations[key].push({
        schedule_id: s.id,
        employee_id: s.employee_id,
        first_name: s.first_name,
        last_name: s.last_name,
        status: s.status,
        is_provisional: s.is_provisional,
      });
    }

    res.json({
      week_start: dateFrom,
      dates,
      jours: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
      affectations: scheduleResult.rows.map(s => ({
        ...s,
        date: new Date(s.date).toISOString().slice(0, 10),
      })),
      employees: employeesResult.rows.map(e => ({
        ...e,
        jours_off: e.jours_off || [],
      })),
      absences: absencesByEmpDate,
    });
  } catch (err) {
    console.error('[PLANNING-HEBDO] Erreur planning :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/planning-hebdo/affecter — Affecter un employe a un poste sur un jour
router.post('/affecter', async (req, res) => {
  try {
    const { employee_id, date, poste_id, poste_code } = req.body;
    if (!employee_id || !date) {
      return res.status(400).json({ error: 'employee_id et date requis' });
    }

    // Verifier la disponibilite
    const joursFr = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    const dayOfWeek = joursFr[new Date(date).getDay()];
    const dispoResult = await pool.query(
      'SELECT day_off FROM employee_availability WHERE employee_id = $1 AND day_off = $2',
      [employee_id, dayOfWeek]
    );
    if (dispoResult.rows.length > 0) {
      return res.status(400).json({
        error: `Employe indisponible le ${dayOfWeek}`,
        type: 'indisponibilite',
      });
    }

    // Verifier les absences
    const absResult = await pool.query(
      'SELECT type FROM work_hours WHERE employee_id = $1 AND date = $2 AND type IN ($3, $4, $5)',
      [employee_id, date, 'absence', 'sick', 'holiday']
    );
    if (absResult.rows.length > 0) {
      return res.status(400).json({
        error: `Employe en ${absResult.rows[0].type === 'sick' ? 'arret maladie' : absResult.rows[0].type === 'holiday' ? 'conge' : 'absence'} ce jour`,
        type: 'absence',
      });
    }

    // Verifier les competences si un poste est specifie
    if (poste_code) {
      const empResult = await pool.query(
        'SELECT has_permis_b, has_caces, skills FROM employees WHERE id = $1',
        [employee_id]
      );
      if (empResult.rows.length === 0) {
        return res.status(404).json({ error: 'Employe non trouve' });
      }
      const emp = empResult.rows[0];

      // Verifier permis B
      if (poste_code.startsWith('COLL_CHAUFF') && !emp.has_permis_b) {
        return res.status(400).json({
          error: 'Permis B requis pour ce poste',
          type: 'competence',
        });
      }
      // Verifier CACES
      if (poste_code.startsWith('LOG_CARISTE') && !emp.has_caces) {
        return res.status(400).json({
          error: 'CACES requis pour ce poste',
          type: 'competence',
        });
      }
    }

    // Resoudre le position_id pour la table schedule
    let positionId = null;
    if (poste_id && poste_id.startsWith('pos_')) {
      positionId = parseInt(poste_id.replace('pos_', ''));
    }

    // Upsert dans schedule (avec poste_code pour les postes virtuels)
    const result = await pool.query(`
      INSERT INTO schedule (employee_id, date, status, position_id, poste_code, is_provisional)
      VALUES ($1, $2, 'work', $3, $4, true)
      ON CONFLICT (employee_id, date)
      DO UPDATE SET position_id = EXCLUDED.position_id, poste_code = EXCLUDED.poste_code,
                    status = 'work', is_provisional = true
      RETURNING *
    `, [employee_id, date, positionId, poste_code || null]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PLANNING-HEBDO] Erreur affectation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/planning-hebdo/affecter — Supprimer une affectation
router.delete('/affecter', async (req, res) => {
  try {
    const { employee_id, date } = req.body;
    if (!employee_id || !date) {
      return res.status(400).json({ error: 'employee_id et date requis' });
    }

    await pool.query(
      'DELETE FROM schedule WHERE employee_id = $1 AND date = $2',
      [employee_id, date]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[PLANNING-HEBDO] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/planning-hebdo/confirmer — Confirmer le planning de la semaine
router.post('/confirmer', async (req, res) => {
  try {
    const { week_start } = req.body;
    if (!week_start) return res.status(400).json({ error: 'week_start requis' });

    const monday = new Date(week_start);
    const saturday = new Date(monday);
    saturday.setDate(monday.getDate() + 5);

    const result = await pool.query(
      `UPDATE schedule SET is_provisional = false, confirmed_by = $1, confirmed_at = NOW()
       WHERE date >= $2 AND date <= $3 AND is_provisional = true
       RETURNING id`,
      [req.user.id, monday.toISOString().slice(0, 10), saturday.toISOString().slice(0, 10)]
    );

    res.json({ confirmed: result.rowCount });
  } catch (err) {
    console.error('[PLANNING-HEBDO] Erreur confirmation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/planning-hebdo/employes-disponibles — Employes disponibles pour un jour et poste
router.get('/employes-disponibles', async (req, res) => {
  try {
    const { date, require_permis, require_caces } = req.query;
    if (!date) return res.status(400).json({ error: 'date requis' });

    const joursFr = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    const dayOfWeek = joursFr[new Date(date).getDay()];

    let query = `
      SELECT e.id, e.first_name, e.last_name, e.has_permis_b, e.has_caces,
             e.skills, e.position, t.name as team_name, t.type as team_type,
             s.status as schedule_status, s.position_id as schedule_position_id
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      LEFT JOIN schedule s ON s.employee_id = e.id AND s.date = $1
      LEFT JOIN employee_availability ea ON ea.employee_id = e.id AND ea.day_off = $2
      LEFT JOIN work_hours wh ON wh.employee_id = e.id AND wh.date = $1
        AND wh.type IN ('absence', 'sick', 'holiday')
      WHERE e.is_active = true
        AND ea.id IS NULL
        AND wh.id IS NULL
    `;
    const params = [date, dayOfWeek];

    if (require_permis === 'true') {
      query += ' AND e.has_permis_b = true';
    }
    if (require_caces === 'true') {
      query += ' AND e.has_caces = true';
    }

    query += ' ORDER BY t.type, e.last_name';
    const result = await pool.query(query, params);

    res.json(result.rows.map(e => ({
      ...e,
      deja_affecte: e.schedule_status === 'work',
    })));
  } catch (err) {
    console.error('[PLANNING-HEBDO] Erreur employes dispo :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
