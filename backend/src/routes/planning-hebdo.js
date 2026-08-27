const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize, resolveBaseRole } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');

// Lot L5 (26/08/2026) — Refonte du planning hebdomadaire :
//   1. La filière BOUTIQUES est RETIRÉE de cet écran : le planning des boutiques
//      est géré hors logiciel. Les affectations `schedule` historiques `BTQ_*`
//      ne sont NI supprimées NI renvoyées — elles restent en base, intactes.
//   2. Les postes de collecte ne sont plus deux libellés en dur
//      (« Chauffeur »/« Ripeur ») mais UN POSTE PAR VÉHICULE RÉEL : la liste
//      suit la table `vehicles`, donc elle évolue sans toucher au code.
//   3. Les équipages (chauffeur + suiveurs) REMONTENT de la gestion de la
//      collecte (`tours`) : le planning hebdo les AFFICHE en lecture seule,
//      il ne les re-saisit pas — l'équipage s'affecte au Planning tournées.
//
// Lecture : ADMIN / MANAGER / RH (le RH consulte le planning sans l'écrire).
// Écriture (affecter/supprimer/confirmer) et recherche d'employés disponibles :
// ADMIN / MANAGER uniquement. RESP_BTQ conserve un accès en lecture qui renvoie
// une réponse vide MOTIVÉE (jamais un 500) — la page « Planning boutiques »
// affiche le message plutôt qu'une erreur.
router.use(authenticate);

const READ_ROLES = ['ADMIN', 'MANAGER', 'RH', 'RESP_BTQ'];
const WRITE_ROLES = ['ADMIN', 'MANAGER'];
const isRespBtq = (req) => resolveBaseRole(req.user && req.user.role) === 'RESP_BTQ';

const MESSAGE_BOUTIQUES = 'Le planning des boutiques est géré hors logiciel.';

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

// ══════════════════════════════════════════
// DATES — jour civil Europe/Paris
// ══════════════════════════════════════════
// Le conteneur tourne en UTC : « aujourd'hui » calculé sur l'heure UTC bascule
// une heure (deux en été) trop tôt et pouvait désigner la semaine précédente
// pour une consultation faite en soirée. Les dates de semaine sont donc
// calculées sur le JOUR CIVIL de Paris, puis manipulées en arithmétique de
// calendrier pure (UTC) — insensible au fuseau et à l'heure d'été.

/** Jour civil (AAAA-MM-JJ) à Paris pour un instant donné. */
function parisDateStr(instant = new Date()) {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant);
}

/** Lundi (Date UTC minuit) de la semaine contenant `isoDate` (AAAA-MM-JJ). */
function lundiDeLaSemaine(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const ref = new Date(Date.UTC(y, m - 1, d));
  const dow = ref.getUTCDay(); // 0 = dimanche
  ref.setUTCDate(ref.getUTCDate() - ((dow + 6) % 7));
  return ref;
}

/** Les 6 jours (lundi → samedi) de la semaine, en AAAA-MM-JJ. */
function joursDeLaSemaine(lundiUTC) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(lundiUTC.getTime());
    d.setUTCDate(lundiUTC.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Jour civil d'une valeur de colonne DATE PostgreSQL. Le pilote pg construit
 * un Date à MINUIT LOCAL : passer par toISOString() décalerait la date d'un
 * jour si le processus ne tournait pas en UTC. On lit donc les composantes
 * locales, qui sont exactement celles écrites en base.
 */
function jourCivil(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** « NOM Prénom » (règle de nommage projet). Renvoie null si rien à afficher. */
function nomComplet(last, first) {
  const l = String(last == null ? '' : last).trim().toUpperCase();
  const f = String(first == null ? '' : first).trim();
  const nom = [l, f].filter(Boolean).join(' ');
  return nom || null;
}

// ══════════════════════════════════════════
// POSTES DE TRAVAIL PAR FILIERE
// ══════════════════════════════════════════

// Filière `btq` RETIRÉE (planning boutiques géré hors logiciel).
const FILIERES = [
  { code: 'tri', label: 'Tri', color: '#8BC540' },
  { code: 'collecte', label: 'Collecte', color: '#3B82F6' },
  { code: 'logistique', label: 'Logistique', color: '#F59E0B' },
];

const LIB_STATUT_VEHICULE = {
  available: 'Disponible',
  in_use: 'En service',
  maintenance: 'En maintenance',
  out_of_service: 'Hors service',
};

// GET /api/planning-hebdo/postes — Tous les postes groupes par filiere
router.get('/postes', authorize(...READ_ROLES), async (req, res) => {
  try {
    // RESP_BTQ : le planning des boutiques est géré hors logiciel. On répond
    // 200 avec un périmètre VIDE et le motif — jamais un 403 ni un 500, et
    // surtout pas une liste de postes boutique qui n'existent plus ici.
    if (isRespBtq(req)) {
      return res.json({ filieres: [], postes: [], message: MESSAGE_BOUTIQUES });
    }

    const postes = [];

    // 1. Postes de tri (depuis postes_operation)
    try {
      const triResult = await pool.query(`
        SELECT po.id, po.nom, po.code, po.competences_requises, po.est_obligatoire,
               po.permet_doublure,
               op.nom as operation_nom, op.numero as operation_numero, ch.nom as chaine_nom
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
          permet_doublure: p.permet_doublure || false,
        });
      }
    } catch (err) { console.warn('[PLANNING] Table may not exist:', err.message); }

    // 2. Postes de collecte — UN POSTE PAR VÉHICULE RÉEL (liste évolutive).
    //    La collecte s'organise par camion, pas par intitulé générique : la
    //    ligne du planning est le véhicule, et l'équipage qui la sert remonte
    //    des tournées (voir GET / → collecte_tournees). Le parc de démonstration
    //    (formations) et les véhicules hors service en sont exclus.
    let collecteIndisponible = null;
    try {
      const vehiculesResult = await pool.query(`
        SELECT id, registration, name, status
          FROM vehicles
         WHERE COALESCE(is_demo, false) = false
           AND status <> 'out_of_service'
         ORDER BY registration
      `);
      for (const v of vehiculesResult.rows) {
        postes.push({
          id: `collecte_vehicule_${v.id}`,
          source_id: v.id,
          source_table: 'vehicles',
          filiere: 'collecte',
          nom: v.registration,
          code: `COLL_VEH_${v.id}`,
          detail: [v.name, LIB_STATUT_VEHICULE[v.status] || v.status]
            .filter(Boolean).join(' — ') || 'Véhicule de collecte',
          vehicle_id: v.id,
          vehicle_name: v.name || null,
          vehicle_status: v.status,
          competences_requises: [],
          require_permis_b: false, require_caces: false,
          obligatoire: false, permet_doublure: true,
        });
      }
    } catch (err) {
      // Jamais de poste inventé : si le parc n'est pas lisible, on le DIT.
      // Un repli « Chauffeur / Ripeur » afficherait un planning de collecte
      // sans rapport avec les camions réellement disponibles.
      collecteIndisponible = `Le parc de véhicules n'a pas pu être lu (${err.message}).`;
      console.warn('[PLANNING-HEBDO] Véhicules de collecte indisponibles :', err.message);
    }

    // 3. Postes logistique
    postes.push({
      id: 'logistique_cariste',
      source_id: null, source_table: null, filiere: 'logistique',
      nom: 'Cariste', code: 'LOG_CARISTE',
      detail: 'Chargement / dechargement — CACES requis',
      competences_requises: ['caces'],
      require_permis_b: false, require_caces: true,
      obligatoire: true, permet_doublure: false,
    });
    postes.push({
      id: 'logistique_preparation',
      source_id: null, source_table: null, filiere: 'logistique',
      nom: 'Preparateur commande', code: 'LOG_PREP',
      detail: 'Preparation des expeditions exutoires',
      competences_requises: [],
      require_permis_b: false, require_caces: false,
      obligatoire: false, permet_doublure: true,
    });
    postes.push({
      id: 'logistique_quai',
      source_id: null, source_table: null, filiere: 'logistique',
      nom: 'Agent de quai', code: 'LOG_QUAI',
      detail: 'Reception et expedition sur quai',
      competences_requises: [],
      require_permis_b: false, require_caces: false,
      obligatoire: false, permet_doublure: true,
    });

    // 4. (plus de postes boutique — planning des boutiques hors logiciel)

    res.json({ filieres: FILIERES, postes, collecte_indisponible: collecteIndisponible });
  } catch (err) {
    console.error('[PLANNING-HEBDO] Erreur postes :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/planning-hebdo — Planning de la semaine
router.get('/', authorize(...READ_ROLES), async (req, res) => {
  try {
    const { week_start } = req.query;
    let base;
    if (week_start) {
      const iso = String(week_start).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime())) {
        return res.status(400).json({
          error: 'Date de début de semaine invalide (format attendu AAAA-MM-JJ)',
          code: 'WEEK_START_INVALIDE',
        });
      }
      base = iso;
    } else {
      base = parisDateStr(); // jour civil de Paris, pas l'heure UTC du conteneur
    }

    const dates = joursDeLaSemaine(lundiDeLaSemaine(base));
    const dateFrom = dates[0];
    const dateTo = dates[dates.length - 1];

    // RESP_BTQ : périmètre vide et motivé (planning boutiques hors logiciel).
    if (isRespBtq(req)) {
      return res.json({
        week_start: dateFrom, dates, jours: JOURS,
        affectations: [], employees: [], absences: {},
        collecte_tournees: [], message: MESSAGE_BOUTIQUES,
      });
    }

    // 1. Affectations existantes (avec periode).
    //    Les affectations boutique historiques (`BTQ_*`) restent EN BASE — on
    //    ne les supprime pas — mais elles ne sont plus renvoyées : cet écran
    //    ne pilote plus les boutiques.
    const scheduleResult = await pool.query(`
      SELECT s.id, s.employee_id, s.date, s.status, s.position_id, s.poste_code,
             s.is_provisional, COALESCE(s.periode, 'journee') as periode,
             e.first_name, e.last_name, e.has_permis_b, e.has_caces, e.skills,
             e.insertion_status,
             (e.insertion_status IS DISTINCT FROM 'en_parcours') AS est_permanent,
             t.name as team_name, t.type as team_type,
             p.title as position_title
      FROM schedule s
      JOIN employees e ON s.employee_id = e.id
      LEFT JOIN teams t ON e.team_id = t.id
      LEFT JOIN positions p ON s.position_id = p.id
      WHERE s.date >= $1 AND s.date <= $2
        AND (s.poste_code IS NULL OR UPPER(s.poste_code) NOT LIKE 'BTQ!_%' ESCAPE '!')
      ORDER BY s.date, UPPER(e.last_name), UPPER(e.first_name)
    `, [dateFrom, dateTo]);

    // 2. Employes actifs avec dispo.
    //    `est_permanent` distingue les salariés permanents (encadrants,
    //    managers, fonctions support) des salariés EN PARCOURS d'insertion.
    //    Les deux sont affectables ; l'écran les présente séparément.
    const employeesResult = await pool.query(`
      SELECT e.id, e.first_name, e.last_name, e.has_permis_b, e.has_caces,
             e.skills, e.position, e.weekly_hours, e.contract_type,
             e.insertion_status,
             (e.insertion_status IS DISTINCT FROM 'en_parcours') AS est_permanent,
             t.name as team_name, t.type as team_type,
             ARRAY_AGG(ea.day_off) FILTER (WHERE ea.day_off IS NOT NULL) as jours_off
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      LEFT JOIN employee_availability ea ON ea.employee_id = e.id
      WHERE e.is_active = true
      GROUP BY e.id, t.name, t.type
      ORDER BY UPPER(e.last_name), UPPER(e.first_name)
    `);

    // 3. Absences
    const absencesResult = await pool.query(`
      SELECT employee_id, date, type
      FROM work_hours
      WHERE date >= $1 AND date <= $2
        AND type IN ('absence', 'sick', 'holiday')
    `, [dateFrom, dateTo]);

    const absencesByEmpDate = {};
    for (const a of absencesResult.rows) {
      absencesByEmpDate[`${a.employee_id}_${jourCivil(a.date)}`] = a.type;
    }

    // 4. Équipages de collecte de la semaine — LECTURE SEULE.
    //    Source : la gestion de la collecte (`tours`). Le planning hebdo montre
    //    qui roule sur quel camion ; l'affectation de l'équipage, elle, se fait
    //    au Planning tournées. Les tournées de DÉMONSTRATION (formations) sont
    //    exclues : ce ne sont pas des tournées d'exploitation.
    let collecteTournees = [];
    let collecteIndisponible = null;
    try {
      const tourneesResult = await pool.query(`
        SELECT t.id AS tour_id, t.date, t.status, t.vehicle_id,
               v.registration, v.name AS vehicle_name,
               t.driver_employee_id,
               d.first_name  AS driver_first_name,  d.last_name  AS driver_last_name,
               t.suiveur1_employee_id,
               s1.first_name AS suiveur1_first_name, s1.last_name AS suiveur1_last_name,
               t.suiveur2_employee_id,
               s2.first_name AS suiveur2_first_name, s2.last_name AS suiveur2_last_name
          FROM tours t
          JOIN vehicles v ON v.id = t.vehicle_id
          LEFT JOIN employees d  ON d.id  = t.driver_employee_id
          LEFT JOIN employees s1 ON s1.id = t.suiveur1_employee_id
          LEFT JOIN employees s2 ON s2.id = t.suiveur2_employee_id
         WHERE t.date >= $1 AND t.date <= $2
           AND COALESCE(t.is_demo, false) = false
         ORDER BY t.date, v.registration, t.id
      `, [dateFrom, dateTo]);

      collecteTournees = tourneesResult.rows.map(t => {
        const suiveurs = [];
        if (t.suiveur1_employee_id) {
          suiveurs.push({
            employee_id: t.suiveur1_employee_id,
            nom: nomComplet(t.suiveur1_last_name, t.suiveur1_first_name),
            first_name: t.suiveur1_first_name || null,
            last_name: t.suiveur1_last_name || null,
          });
        }
        if (t.suiveur2_employee_id) {
          suiveurs.push({
            employee_id: t.suiveur2_employee_id,
            nom: nomComplet(t.suiveur2_last_name, t.suiveur2_first_name),
            first_name: t.suiveur2_first_name || null,
            last_name: t.suiveur2_last_name || null,
          });
        }
        return {
          date: jourCivil(t.date),
          tour_id: t.tour_id,
          vehicle_id: t.vehicle_id,
          registration: t.registration,
          vehicle_name: t.vehicle_name || null,
          statut: t.status,
          // Chauffeur non identifié = null assumé (« 1 URL = 1 véhicule » :
          // une tournée peut rouler sans fiche employé rattachée).
          chauffeur: t.driver_employee_id ? {
            employee_id: t.driver_employee_id,
            nom: nomComplet(t.driver_last_name, t.driver_first_name),
            first_name: t.driver_first_name || null,
            last_name: t.driver_last_name || null,
          } : null,
          suiveurs,
        };
      });
    } catch (err) {
      // Une liste vide se lirait « aucune tournée planifiée » — un contresens
      // quand la lecture a échoué. On renvoie null + le motif.
      collecteTournees = null;
      collecteIndisponible = `Les tournées de la semaine n'ont pas pu être lues (${err.message}).`;
      console.warn('[PLANNING-HEBDO] Tournées de collecte indisponibles :', err.message);
    }

    const affectations = scheduleResult.rows.map(s => ({ ...s, date: jourCivil(s.date) }));
    const employees = employeesResult.rows.map(e => ({ ...e, jours_off: e.jours_off || [] }));

    res.json({
      week_start: dateFrom,
      dates,
      jours: JOURS,
      affectations,
      employees,
      absences: absencesByEmpDate,
      collecte_tournees: collecteTournees,
      collecte_indisponible: collecteIndisponible,
    });
  } catch (err) {
    console.error('[PLANNING-HEBDO] Erreur planning :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/planning-hebdo/affecter — Affecter un employe a un poste sur un jour
router.post('/affecter', authorize(...WRITE_ROLES), [
  body('employee_id').isInt().withMessage('ID employé requis'),
  body('date').notEmpty().withMessage('Date requise'),
], validate, async (req, res) => {
  try {
    const { employee_id, date, poste_id, poste_code, periode } = req.body;
    if (!employee_id || !date) {
      return res.status(400).json({ error: 'employee_id et date requis' });
    }

    const per = periode || 'journee';

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

    // Verifier les competences
    if (poste_code) {
      const empResult = await pool.query(
        'SELECT has_permis_b, has_caces, skills FROM employees WHERE id = $1',
        [employee_id]
      );
      if (empResult.rows.length === 0) {
        return res.status(404).json({ error: 'Employe non trouve' });
      }
      const emp = empResult.rows[0];
      if (poste_code.startsWith('COLL_CHAUFF') && !emp.has_permis_b) {
        return res.status(400).json({ error: 'Permis B requis pour ce poste', type: 'competence' });
      }
      if (poste_code.startsWith('LOG_CARISTE') && !emp.has_caces) {
        return res.status(400).json({ error: 'CACES requis pour ce poste', type: 'competence' });
      }
    }

    let positionId = null;
    if (poste_id && poste_id.startsWith('pos_')) {
      positionId = parseInt(poste_id.replace('pos_', ''));
    }

    // Écriture ATOMIQUE : la résolution du conflit de période (une journée entière
    // supprime les demi-journées existantes, et une demi-journée supprime une journée
    // entière) et l'upsert de l'affectation doivent être indivisibles. Hors transaction,
    // un échec entre le DELETE et l'INSERT — ou deux requêtes concurrentes sur le même
    // agent/jour — laissaient le planning partiellement effacé. Le SELECT-puis-DELETE
    // conditionnel précédent (journée) est remplacé par un DELETE idempotent (no-op si
    // rien à supprimer) → suppression du TOCTOU.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (per === 'journee') {
        // Supprimer toute affectation existante du jour (demi-journées incluses)
        await client.query('DELETE FROM schedule WHERE employee_id = $1 AND date = $2', [employee_id, date]);
      } else {
        // Affectation demi-journée : retirer une éventuelle journée entière
        await client.query(
          "DELETE FROM schedule WHERE employee_id = $1 AND date = $2 AND periode = 'journee'",
          [employee_id, date]
        );
      }

      const result = await client.query(`
        INSERT INTO schedule (employee_id, date, status, position_id, poste_code, periode, is_provisional)
        VALUES ($1, $2, 'work', $3, $4, $5, true)
        ON CONFLICT (employee_id, date, periode)
        DO UPDATE SET position_id = EXCLUDED.position_id, poste_code = EXCLUDED.poste_code,
                      status = 'work', is_provisional = true
        RETURNING *
      `, [employee_id, date, positionId, poste_code || null, per]);

      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[PLANNING-HEBDO] Erreur affectation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/planning-hebdo/affecter — Supprimer une affectation
router.delete('/affecter', authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const { employee_id, date, periode } = req.body;
    if (!employee_id || !date) {
      return res.status(400).json({ error: 'employee_id et date requis' });
    }

    if (periode) {
      await pool.query(
        'DELETE FROM schedule WHERE employee_id = $1 AND date = $2 AND periode = $3',
        [employee_id, date, periode]
      );
    } else {
      await pool.query(
        'DELETE FROM schedule WHERE employee_id = $1 AND date = $2',
        [employee_id, date]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[PLANNING-HEBDO] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/planning-hebdo/confirmer — Confirmer le planning de la semaine
router.post('/confirmer', authorize(...WRITE_ROLES), [
  body('week_start').notEmpty().withMessage('Date de début de semaine requise'),
], validate, async (req, res) => {
  try {
    const { week_start } = req.body;
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

// GET /api/planning-hebdo/employes-disponibles — Employes disponibles pour un jour
// (recherche pour l'éditeur ADMIN/MANAGER — pas d'accès RESP_BTQ, écriture amont).
router.get('/employes-disponibles', authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const { date, require_permis, require_caces, periode } = req.query;
    if (!date) return res.status(400).json({ error: 'date requis' });

    const joursFr = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    const dayOfWeek = joursFr[new Date(date).getDay()];

    let query = `
      SELECT e.id, e.first_name, e.last_name, e.has_permis_b, e.has_caces,
             e.skills, e.position, e.insertion_status,
             (e.insertion_status IS DISTINCT FROM 'en_parcours') AS est_permanent,
             t.name as team_name, t.type as team_type
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
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

    query += ' ORDER BY t.type, UPPER(e.last_name), UPPER(e.first_name)';
    const result = await pool.query(query, params);

    // Calculer le statut d'affectation par période
    const per = periode || 'journee';
    const scheduleResult = await pool.query(
      "SELECT employee_id, periode FROM schedule WHERE date = $1",
      [date]
    );
    const schedByEmp = {};
    for (const s of scheduleResult.rows) {
      if (!schedByEmp[s.employee_id]) schedByEmp[s.employee_id] = [];
      schedByEmp[s.employee_id].push(s.periode);
    }

    res.json(result.rows.map(e => {
      const periodes = schedByEmp[e.id] || [];
      let deja_affecte = false;
      if (periodes.includes('journee')) {
        deja_affecte = true;
      } else if (per === 'journee') {
        deja_affecte = periodes.length > 0;
      } else {
        deja_affecte = periodes.includes(per);
      }
      return { ...e, deja_affecte, periodes_affectees: periodes };
    }));
  } catch (err) {
    console.error('[PLANNING-HEBDO] Erreur employes dispo :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
