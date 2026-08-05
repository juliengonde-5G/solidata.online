/**
 * Module « Effectifs conventionnés (ETP) » — suivi prévisionnel/réalisé des ETP
 * d'insertion vs convention ACI (annexe financière).
 *
 * Grille hebdomadaire S1→S52/53 par salarié en insertion (CDDI / CDI Inclusion),
 * sections = équipes (proxy filière), pivot mois = JEUDI de la semaine ISO.
 * Moteur de calcul PUR : services/effectifs-engine.js (voir les règles métier
 * documentées en tête de ce service).
 *
 * PARAMÈTRES DE CONVENTION — jamais en dur (« jamais de valeur inventée ») :
 *   settings clé `effectifs.convention_<annee>` (JSON { etp_conventionnes,
 *   etp_cdi_inclusion, heures_annuelles_etp, date_debut, date_fin }).
 *   Repli LECTURE SEULE sur `insertion.cible_etp_conventionnes` (cohérence
 *   AuditInsertion) pour etp_conventionnes si la clé annuelle est absente ;
 *   sinon null + source 'defaut'.
 *
 * VALIDATION ASP : table etp_asp_mensuel (init-db.js) — la CIP saisit le chiffre
 * ASP mensuel (états mensuels de présence, base 1 820 h) : validation horodatée
 * + journalisée dans rgpd_audit_log (même pattern que les exports insertion —
 * l'écriture du journal est DANS la transaction : pas de validation non tracée).
 * Le chiffre ASP validé FAIT FOI dans la synthèse.
 *
 * HABILITATIONS : lecture ADMIN/RH/MANAGER ; écritures ADMIN/RH
 * (suppression d'une validation ASP : ADMIN).
 *
 * POPULATION : salariés ayant au moins un contrat CDDI (employee_contracts,
 * repli fiche employees.contract_type) OU un CDI « Inclusion » — détecté par
 * cddi_derogation_motif = 'cdi_inclusion' ou un CDI porté par un salarié
 * en_parcours (les CDI hors insertion ne comptent jamais). Seules les personnes
 * couvrant au moins une semaine de l'année demandée apparaissent.
 */
const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { query: q, param, body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');
const engine = require('../services/effectifs-engine');

router.use(authenticate);
router.use(autoLogActivity('effectifs'));

const READ = authorize('ADMIN', 'RH', 'MANAGER');
const WRITE = authorize('ADMIN', 'RH');
const ADMIN_ONLY = authorize('ADMIN');

const CONVENTION_KEY = (annee) => `effectifs.convention_${annee}`;
const CIBLE_INSERTION_KEY = 'insertion.cible_etp_conventionnes'; // repli lecture (AuditInsertion)

// ── Helpers ────────────────────────────────────────────────────────────────

const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const isoDateOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};

/** Date civile du jour en heure de Paris (doctrine 2.20.0). */
function parisToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

/** « NOM Prénom » (nom de famille en MAJUSCULES — règle 2.20.0). */
function formatNom(lastName, firstName) {
  return [String(lastName || '').toUpperCase(), String(firstName || '').trim()]
    .filter(Boolean).join(' ').trim();
}

const anneeParDefaut = () => Number(parisToday().slice(0, 4));

/**
 * Lit la convention de l'année. Source explicite :
 *  'annee'          → clé annuelle effectifs.convention_<annee> paramétrée ;
 *  'cible_insertion'→ repli insertion.cible_etp_conventionnes (etp seul) ;
 *  'defaut'         → rien de paramétré → tout null (jamais de valeur inventée).
 */
async function readConvention(annee) {
  const out = {
    annee,
    etp_conventionnes: null,
    etp_cdi_inclusion: null,
    heures_annuelles_etp: null,
    date_debut: null,
    date_fin: null,
    source: 'defaut',
  };
  const r = await pool.query('SELECT value FROM settings WHERE key = $1', [CONVENTION_KEY(annee)]);
  if (r.rows[0] && r.rows[0].value) {
    try {
      const j = JSON.parse(r.rows[0].value);
      out.etp_conventionnes = numOrNull(j.etp_conventionnes);
      out.etp_cdi_inclusion = numOrNull(j.etp_cdi_inclusion);
      out.heures_annuelles_etp = numOrNull(j.heures_annuelles_etp);
      out.date_debut = isoDateOrNull(j.date_debut);
      out.date_fin = isoDateOrNull(j.date_fin);
      out.source = 'annee';
      return out;
    } catch (_) { /* JSON invalide → repli comme si absent */ }
  }
  const c = await pool.query('SELECT value FROM settings WHERE key = $1', [CIBLE_INSERTION_KEY]);
  const cible = c.rows[0] ? numOrNull(c.rows[0].value) : null;
  if (cible != null) {
    out.etp_conventionnes = cible;
    out.source = 'cible_insertion';
  }
  return out;
}

const isCddi = (t) => String(t || '').toUpperCase() === 'CDDI';
const isCdi = (t) => String(t || '').toUpperCase() === 'CDI';
const isCdd = (t) => String(t || '').toUpperCase() === 'CDD';
/** Le salarié a (ou a eu) un parcours d'insertion dans l'ERP. */
const hasParcours = (emp) => !!emp.insertion_status && emp.insertion_status !== 'none';
/**
 * Contrats retenus pour la grille ETP :
 * - CDDI : toujours ;
 * - CDI « Inclusion » : CDI porté par un salarié flagué cdi_inclusion ou en parcours ;
 * - CDD porté par un salarié avec parcours d'insertion : requalifié CDDI de fait
 *   (données HÉRITÉES d'avant l'import 2.20.0, qui stockait le type brut Malibou
 *   « CDD » — la requalification « poste … Cddi » n'existe qu'au réimport). Sans
 *   cette lecture, une base non réimportée affiche une grille vide.
 */
function keepContractForInsertion(contractType, emp) {
  if (isCddi(contractType)) return true;
  if (isCdd(contractType)) return hasParcours(emp);
  if (!isCdi(contractType)) return false;
  return emp.cddi_derogation_motif === 'cdi_inclusion' || emp.insertion_status === 'en_parcours';
}

/**
 * Charge et calcule la grille annuelle (données partagées par /grille, /ecarts,
 * /synthese, /export). Retour :
 * { semaines, personnes: [{ employee_id, nom, team_id, team_name, pass_iae_end,
 *   fin_dernier_contrat, prev: [{s,q,statut}], real: [{s,q,statut,jours_absence}] }] }
 *
 * prev : statut 'signe'|'presume'|null (q null = semaine non couverte).
 * real : semaines ENTIÈREMENT écoulées (dimanche < aujourd'hui) et couvertes
 *   par un contrat SIGNÉ → statut 'realise' ; semaines futures/en cours →
 *   q null + statut 'a_venir' (si couverture prévisionnelle) ; le présumé ne
 *   produit JAMAIS de réalisé.
 */
async function buildGrilleData(annee, today) {
  const semaines = engine.isoWeeksOfYear(annee);
  const periodeDebut = semaines[0].lundi;
  const periodeFin = engine.addDaysISO(semaines[semaines.length - 1].lundi, 6);

  const empRes = await pool.query(`
    SELECT e.id, e.first_name, e.last_name, e.team_id, t.name AS team_name,
           e.insertion_status, e.cddi_derogation_motif,
           e.pass_iae_end::text AS pass_iae_end,
           e.contract_type AS fiche_contract_type,
           e.contract_start::text AS fiche_contract_start,
           e.contract_end::text AS fiche_contract_end,
           e.weekly_hours AS fiche_weekly_hours
    FROM employees e
    LEFT JOIN teams t ON t.id = e.team_id
    WHERE UPPER(COALESCE(e.contract_type, '')) = 'CDDI'
       OR e.cddi_derogation_motif = 'cdi_inclusion'
       -- Miroir SQL de hasParcours() : tout parcours d'insertion, y compris
       -- clôturé (termine/abandon) — un CDD hérité d'un parcours passé doit
       -- apparaître dans les grilles historiques (revue Codex PR#87).
       OR (e.insertion_status IS NOT NULL AND e.insertion_status <> 'none')
       OR EXISTS (
            SELECT 1 FROM employee_contracts ec
            WHERE ec.employee_id = e.id AND UPPER(ec.contract_type) = 'CDDI'
          )
    ORDER BY UPPER(e.last_name), UPPER(e.first_name)
  `);

  const ids = empRes.rows.map((r) => r.id);
  let contractRows = [];
  let leaveRows = [];
  if (ids.length > 0) {
    const cRes = await pool.query(`
      SELECT ec.employee_id, ec.contract_type,
             ec.start_date::text AS start_date,
             ec.end_date::text AS end_date,
             ec.official_start_date::text AS official_start_date,
             ec.weekly_hours
      FROM employee_contracts ec
      WHERE ec.employee_id = ANY($1)
      ORDER BY ec.employee_id, ec.start_date
    `, [ids]);
    contractRows = cRes.rows;
    const lRes = await pool.query(`
      SELECT el.employee_id, el.type_category,
             el.start_date::text AS start_date,
             COALESCE(el.end_date, el.start_date)::text AS end_date
      FROM employee_leaves el
      WHERE el.employee_id = ANY($1)
        AND el.type_category IN ('sick', 'absence')
        AND el.start_date <= $2
        AND COALESCE(el.end_date, el.start_date) >= $3
    `, [ids, periodeFin, periodeDebut]);
    leaveRows = lRes.rows;
  }

  const contractsByEmp = new Map();
  for (const c of contractRows) {
    if (!contractsByEmp.has(c.employee_id)) contractsByEmp.set(c.employee_id, []);
    contractsByEmp.get(c.employee_id).push(c);
  }
  const leavesByEmp = new Map();
  for (const l of leaveRows) {
    if (!leavesByEmp.has(l.employee_id)) leavesByEmp.set(l.employee_id, []);
    leavesByEmp.get(l.employee_id).push({
      type_category: l.type_category,
      start: engine.isoOrNull(l.start_date),
      end: engine.isoOrNull(l.end_date),
    });
  }

  const personnes = [];
  for (const e of empRes.rows) {
    const rows = (contractsByEmp.get(e.id) || [])
      .filter((c) => keepContractForInsertion(c.contract_type, e) && c.start_date);

    let contrats = rows.map((c) => ({
      start: engine.isoOrNull(c.start_date),
      end: engine.isoOrNull(c.end_date),
      weeklyHours: c.weekly_hours,
      type: String(c.contract_type || '').toUpperCase(),
      official: engine.isoOrNull(c.official_start_date) || engine.isoOrNull(c.start_date),
    }));

    // Repli fiche (salarié sans historique employee_contracts) : contrat unique
    // reconstitué depuis employees.contract_* — pattern « repli fiche » existant.
    if (contrats.length === 0 && keepContractForInsertion(e.fiche_contract_type, e) && e.fiche_contract_start) {
      contrats = [{
        start: engine.isoOrNull(e.fiche_contract_start),
        end: engine.isoOrNull(e.fiche_contract_end),
        weeklyHours: e.fiche_weekly_hours || 35,
        type: String(e.fiche_contract_type || '').toUpperCase(),
        official: engine.isoOrNull(e.fiche_contract_start),
      }];
    }
    if (contrats.length === 0) continue;

    // Borne légale des 24 mois : début du 1er CDDI = date d'embauche OFFICIELLE
    // du premier contrat CDDI (official_start_date lot 3, repli période effective).
    // Les CDD retenus par keepContractForInsertion sont des CDDI de fait
    // (données héritées) : ils portent la même borne.
    let premierCddiDebut = null;
    for (const c of contrats) {
      if ((c.type !== 'CDDI' && c.type !== 'CDD') || !c.official) continue;
      if (premierCddiDebut == null || c.official < premierCddiDebut) premierCddiDebut = c.official;
    }

    const { segments, finDernierContrat } = engine.buildSegments({
      contrats,
      insertionStatus: e.insertion_status,
      passIaeEnd: engine.isoOrNull(e.pass_iae_end),
      premierCddiDebut,
    });

    const prev = semaines.map((w) => {
      const { q: quot, statut } = engine.quotiteSemaine(w.jeudi, segments);
      return { s: w.num, q: quot, statut };
    });
    if (prev.every((c) => c.q == null)) continue; // aucune couverture cette année

    const leaves = leavesByEmp.get(e.id) || [];
    const real = semaines.map((w, i) => {
      const dimanche = engine.addDaysISO(w.lundi, 6);
      if (dimanche >= today) {
        // Semaine future (ou en cours) : jamais de réalisé.
        return { s: w.num, q: null, statut: prev[i].q != null ? 'a_venir' : null, jours_absence: 0 };
      }
      if (prev[i].q == null || prev[i].statut !== 'signe') {
        // Pas de contrat SIGNÉ couvrant le jeudi → pas de réalisé (le présumé
        // ne compte jamais dans le réalisé).
        return { s: w.num, q: null, statut: null, jours_absence: 0 };
      }
      const ja = engine.joursOuvresAbsents(w.lundi, leaves);
      return { s: w.num, q: engine.quotiteRealisee(prev[i].q, ja), statut: 'realise', jours_absence: ja };
    });

    personnes.push({
      employee_id: e.id,
      nom: formatNom(e.last_name, e.first_name),
      team_id: e.team_id,
      team_name: e.team_name || 'Sans équipe',
      pass_iae_end: engine.isoOrNull(e.pass_iae_end),
      fin_dernier_contrat: finDernierContrat,
      prev,
      real,
    });
  }

  return { semaines, personnes };
}

/** Sections (équipes) triées par nom, « Sans équipe » en dernier. */
function groupSections(personnes) {
  const map = new Map();
  for (const p of personnes) {
    const key = `${p.team_id == null ? '' : p.team_id}|${p.team_name}`;
    if (!map.has(key)) map.set(key, { team_id: p.team_id, team_name: p.team_name, personnes: [] });
    map.get(key).personnes.push(p);
  }
  return [...map.values()].sort((a, b) => {
    if (a.team_id == null && b.team_id != null) return 1;
    if (b.team_id == null && a.team_id != null) return -1;
    return String(a.team_name).localeCompare(String(b.team_name), 'fr', { sensitivity: 'base' });
  });
}

/**
 * Totaux hebdo/mensuels d'une liste de personnes pour une vue donnée.
 * @param {'prev'|'real'} champ
 * En vue réalisée, une semaine non écoulée rend etp null (pas 0) ; l'ETP
 * mensuel = moyenne des sommes hebdo des semaines OBSERVÉES du mois (null si
 * aucune). En prévisionnel, toutes les semaines comptent (personne absente = 0).
 */
function computeTotaux(semaines, personnes, champ, today) {
  const parSemaine = semaines.map((w, i) => {
    if (champ === 'real') {
      const dimanche = engine.addDaysISO(w.lundi, 6);
      if (dimanche >= today) return { s: w.num, etp: null }; // semaine non écoulée
    }
    let somme = 0;
    for (const p of personnes) {
      const cell = p[champ][i];
      if (cell && cell.q != null) somme += cell.q;
    }
    return { s: w.num, etp: engine.round2(somme) };
  });

  const parMoisMap = new Map();
  semaines.forEach((w, i) => {
    if (!parMoisMap.has(w.mois)) parMoisMap.set(w.mois, []);
    if (parSemaine[i].etp != null) parMoisMap.get(w.mois).push(parSemaine[i].etp);
  });
  const parMois = [];
  for (let m = 1; m <= 12; m++) {
    parMois.push({ mois: m, etp: engine.moyenne2(parMoisMap.get(m) || []) });
  }
  return { par_semaine: parSemaine, par_mois: parMois };
}

// ── GET /api/effectifs/parametres?annee= ───────────────────────────────────
router.get('/parametres', READ, [
  q('annee').optional().isInt({ min: 2000, max: 2100 }).withMessage('annee invalide'),
], validate, async (req, res) => {
  try {
    const annee = req.query.annee ? parseInt(req.query.annee, 10) : anneeParDefaut();
    res.json(await readConvention(annee));
  } catch (err) {
    console.error('[EFFECTIFS] Erreur parametres GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/effectifs/parametres (ADMIN/RH) ───────────────────────────────
// Upsert du setting annuel effectifs.convention_<annee>. Valeurs nullables
// (null / '' = non paramétré). Renvoie l'objet RELU (source 'annee').
router.put('/parametres', WRITE, [
  body('annee').isInt({ min: 2000, max: 2100 }).withMessage('annee requise (2000-2100)'),
], validate, async (req, res) => {
  try {
    const d = req.body || {};
    const annee = parseInt(d.annee, 10);

    // Validation applicative des champs nullables (pattern cibles insertion).
    const nums = {};
    for (const f of ['etp_conventionnes', 'etp_cdi_inclusion', 'heures_annuelles_etp']) {
      const raw = d[f];
      if (raw === null || raw === undefined || raw === '') { nums[f] = null; continue; }
      const n = parseFloat(raw);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: `${f} : nombre positif attendu (ou null pour effacer)` });
      }
      nums[f] = n;
    }
    const dates = {};
    for (const f of ['date_debut', 'date_fin']) {
      const raw = d[f];
      if (raw === null || raw === undefined || raw === '') { dates[f] = null; continue; }
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return res.status(400).json({ error: `${f} : date YYYY-MM-DD attendue (ou null)` });
      }
      dates[f] = raw;
    }
    if (dates.date_debut && dates.date_fin && dates.date_fin < dates.date_debut) {
      return res.status(400).json({ error: 'date_fin antérieure à date_debut' });
    }

    const value = JSON.stringify({
      etp_conventionnes: nums.etp_conventionnes,
      etp_cdi_inclusion: nums.etp_cdi_inclusion,
      heures_annuelles_etp: nums.heures_annuelles_etp,
      date_debut: dates.date_debut,
      date_fin: dates.date_fin,
    });
    await pool.query(
      `INSERT INTO settings (key, value, category, updated_at)
       VALUES ($1, $2, 'effectifs', NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [CONVENTION_KEY(annee), value]
    );
    res.json(await readConvention(annee));
  } catch (err) {
    console.error('[EFFECTIFS] Erreur parametres PUT :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── GET /api/effectifs/grille?annee=&vue=previsionnel|realise ──────────────
router.get('/grille', READ, [
  q('annee').optional().isInt({ min: 2000, max: 2100 }).withMessage('annee invalide'),
  q('vue').optional().isIn(['previsionnel', 'realise']).withMessage('vue invalide (previsionnel ou realise)'),
], validate, async (req, res) => {
  try {
    const annee = req.query.annee ? parseInt(req.query.annee, 10) : anneeParDefaut();
    const vue = req.query.vue === 'realise' ? 'realise' : 'previsionnel';
    const champ = vue === 'realise' ? 'real' : 'prev';
    const today = parisToday();

    const [{ semaines, personnes }, convention] = await Promise.all([
      buildGrilleData(annee, today),
      readConvention(annee),
    ]);

    const sections = groupSections(personnes).map((sec) => ({
      team_id: sec.team_id,
      team_name: sec.team_name,
      personnes: sec.personnes.map((p) => ({
        employee_id: p.employee_id,
        nom: p.nom,
        pass_iae_end: p.pass_iae_end,
        fin_dernier_contrat: p.fin_dernier_contrat,
        quotites: p[champ].map((c) => ({ s: c.s, q: c.q, statut: c.statut })),
      })),
      totaux_semaine: computeTotaux(semaines, sec.personnes, champ, today).par_semaine,
    }));

    const totaux = computeTotaux(semaines, personnes, champ, today);

    res.json({
      annee,
      vue,
      semaines: semaines.map((w) => ({ num: w.num, lundi: w.lundi, mois: w.mois })),
      sections,
      totaux,
      convention,
    });
  } catch (err) {
    console.error('[EFFECTIFS] Erreur grille :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * Écarts mensuels par personne, calculés sur les semaines OBSERVÉES (entièrement
 * écoulées) du mois : previsionnel = moyenne des quotités prévues des contrats
 * SIGNÉS (0 si non couvert — le renouvellement PRÉSUMÉ est NEUTRALISÉ ici, car
 * il ne produit jamais de réalisé : le comparer créerait des écarts artificiels
 * non liés à l'absentéisme), realise = moyenne des quotités réalisées,
 * ecart = realise − previsionnel, jours_absence = somme des jours ouvrés
 * déduits. Mois sans semaine observée → valeurs null.
 */
function computeEcartsPersonne(semaines, p, today) {
  const parMois = new Map();
  semaines.forEach((w, i) => {
    const dimanche = engine.addDaysISO(w.lundi, 6);
    if (dimanche >= today) return; // semaine non écoulée : pas d'écart mesurable
    if (!parMois.has(w.mois)) parMois.set(w.mois, { prev: [], real: [], ja: 0 });
    const bucket = parMois.get(w.mois);
    bucket.prev.push(p.prev[i].statut === 'signe' && p.prev[i].q != null ? p.prev[i].q : 0);
    bucket.real.push(p.real[i].q != null ? p.real[i].q : 0);
    bucket.ja += p.real[i].jours_absence || 0;
  });
  const mois = [];
  for (let m = 1; m <= 12; m++) {
    const b = parMois.get(m);
    if (!b || b.prev.length === 0) {
      mois.push({ mois: m, previsionnel: null, realise: null, ecart: null, jours_absence: 0 });
      continue;
    }
    const previsionnel = engine.moyenne2(b.prev);
    const realise = engine.moyenne2(b.real);
    mois.push({
      mois: m,
      previsionnel,
      realise,
      ecart: previsionnel != null && realise != null ? engine.round2(realise - previsionnel) : null,
      jours_absence: b.ja,
    });
  }
  return mois;
}

// ── GET /api/effectifs/ecarts?annee=&tous=1 ────────────────────────────────
// → tableau par personne (uniquement écart ≠ 0, sauf ?tous=1).
router.get('/ecarts', READ, [
  q('annee').optional().isInt({ min: 2000, max: 2100 }).withMessage('annee invalide'),
  q('tous').optional().isIn(['0', '1']).withMessage('tous invalide (0 ou 1)'),
], validate, async (req, res) => {
  try {
    const annee = req.query.annee ? parseInt(req.query.annee, 10) : anneeParDefaut();
    const tous = req.query.tous === '1';
    const today = parisToday();
    const { semaines, personnes } = await buildGrilleData(annee, today);

    const out = [];
    for (const p of personnes) {
      const mois = computeEcartsPersonne(semaines, p, today);
      const aEcart = mois.some((m) => m.ecart != null && m.ecart !== 0);
      if (!tous && !aEcart) continue;
      out.push({ employee_id: p.employee_id, nom: p.nom, team_name: p.team_name, mois });
    }
    res.json(out);
  } catch (err) {
    console.error('[EFFECTIFS] Erreur ecarts :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** Synthèse mensuelle partagée par /synthese et /export (feuille 2). */
async function computeSynthese(annee, today) {
  const [{ semaines, personnes }, convention, aspRes] = await Promise.all([
    buildGrilleData(annee, today),
    readConvention(annee),
    pool.query(`
      SELECT a.mois, a.etp_asp::float AS etp_asp, a.commentaire, a.valide_le,
             u.first_name AS valide_first_name, u.last_name AS valide_last_name
      FROM etp_asp_mensuel a
      LEFT JOIN users u ON u.id = a.saisi_par
      WHERE a.annee = $1
    `, [annee]),
  ]);

  const prevTotaux = computeTotaux(semaines, personnes, 'prev', today);
  const realTotaux = computeTotaux(semaines, personnes, 'real', today);
  const aspByMois = new Map(aspRes.rows.map((r) => [Number(r.mois), r]));
  const conv = convention.etp_conventionnes;

  const mois = [];
  const besoins = [];
  for (let m = 1; m <= 12; m++) {
    const prev = prevTotaux.par_mois.find((x) => x.mois === m).etp;
    const real = realTotaux.par_mois.find((x) => x.mois === m).etp;
    const asp = aspByMois.get(m) || null;
    const etpAsp = asp ? engine.round2(Number(asp.etp_asp)) : null;
    mois.push({
      mois: m,
      etp_previsionnel: prev,
      etp_realise: real,
      etp_asp: etpAsp,
      asp_statut: asp ? 'valide' : null,
      asp_valide_par: asp && (asp.valide_last_name || asp.valide_first_name)
        ? formatNom(asp.valide_last_name, asp.valide_first_name) : null,
      asp_valide_le: asp ? asp.valide_le : null,
      asp_commentaire: asp ? (asp.commentaire || null) : null,
      ecart_convention_prev: conv != null && prev != null ? engine.round2(prev - conv) : null,
      // Le chiffre ASP validé FAIT FOI : l'écart à la convention se lit sur l'ASP.
      ecart_convention_asp: conv != null && etpAsp != null ? engine.round2(etpAsp - conv) : null,
      taux_realisation: prev != null && prev > 0 && real != null ? engine.round3(real / prev) : null,
    });
    besoins.push({
      mois: m,
      etp_manquants: conv != null && prev != null ? engine.round2(Math.max(0, conv - prev)) : null,
    });
  }
  return { mois, convention, besoins_recrutement: besoins, semaines, personnes };
}

// ── GET /api/effectifs/synthese?annee= ─────────────────────────────────────
router.get('/synthese', READ, [
  q('annee').optional().isInt({ min: 2000, max: 2100 }).withMessage('annee invalide'),
], validate, async (req, res) => {
  try {
    const annee = req.query.annee ? parseInt(req.query.annee, 10) : anneeParDefaut();
    const { mois, convention, besoins_recrutement } = await computeSynthese(annee, parisToday());
    res.json({ annee, mois, convention, besoins_recrutement });
  } catch (err) {
    console.error('[EFFECTIFS] Erreur synthese :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── POST /api/effectifs/asp/:annee/:mois (ADMIN/RH) ────────────────────────
// Validation ASP mensuelle : upsert horodaté + journal rgpd_audit_log DANS la
// même transaction (pas de validation non tracée — pattern export freins).
router.post('/asp/:annee/:mois', WRITE, [
  param('annee').isInt({ min: 2000, max: 2100 }).withMessage('annee invalide'),
  param('mois').isInt({ min: 1, max: 12 }).withMessage('mois invalide (1-12)'),
  body('etp_asp').isFloat({ min: 0, max: 9999.99 }).withMessage('etp_asp : nombre positif attendu (max 9999.99)'),
  body('commentaire').optional({ nullable: true }).isString().isLength({ max: 2000 }).withMessage('commentaire trop long'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const annee = parseInt(req.params.annee, 10);
    const mois = parseInt(req.params.mois, 10);
    const etpAsp = parseFloat(req.body.etp_asp);
    const commentaire = req.body.commentaire ? String(req.body.commentaire) : null;

    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO etp_asp_mensuel (annee, mois, etp_asp, commentaire, saisi_par, valide_le)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (annee, mois) DO UPDATE
         SET etp_asp = EXCLUDED.etp_asp,
             commentaire = EXCLUDED.commentaire,
             saisi_par = EXCLUDED.saisi_par,
             valide_le = NOW()
       RETURNING *`,
      [annee, mois, etpAsp, commentaire, req.user.id]
    );
    await client.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'ETP_ASP_VALIDATION', 'etp_asp_mensuel', r.rows[0].id,
        JSON.stringify({ annee, mois, etp_asp: etpAsp, commentaire, requested_by: req.user.id })]
    );
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
    console.error('[EFFECTIFS] Erreur validation ASP :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ── DELETE /api/effectifs/asp/:annee/:mois (ADMIN) ─────────────────────────
router.delete('/asp/:annee/:mois', ADMIN_ONLY, [
  param('annee').isInt({ min: 2000, max: 2100 }).withMessage('annee invalide'),
  param('mois').isInt({ min: 1, max: 12 }).withMessage('mois invalide (1-12)'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const annee = parseInt(req.params.annee, 10);
    const mois = parseInt(req.params.mois, 10);
    await client.query('BEGIN');
    const r = await client.query(
      'DELETE FROM etp_asp_mensuel WHERE annee = $1 AND mois = $2 RETURNING id, etp_asp',
      [annee, mois]
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Aucune validation ASP pour ce mois' });
    }
    await client.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'ETP_ASP_SUPPRESSION', 'etp_asp_mensuel', r.rows[0].id,
        JSON.stringify({ annee, mois, etp_asp_supprime: r.rows[0].etp_asp, requested_by: req.user.id })]
    );
    await client.query('COMMIT');
    res.json({ deleted: true, annee, mois });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
    console.error('[EFFECTIFS] Erreur suppression ASP :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ── GET /api/effectifs/export?annee= — classeur .xlsx (exceljs) ────────────
// Feuille 1 : grille PRÉVISIONNELLE par sections (lignes personnes, colonnes
// S1→S52/53, totaux par section + total général + ligne convention).
// Feuille 2 : synthèse mensuelle.
router.get('/export', READ, [
  q('annee').optional().isInt({ min: 2000, max: 2100 }).withMessage('annee invalide'),
], validate, async (req, res) => {
  try {
    const annee = req.query.annee ? parseInt(req.query.annee, 10) : anneeParDefaut();
    const today = parisToday();
    const { mois, convention, besoins_recrutement, semaines, personnes } = await computeSynthese(annee, today);
    const sections = groupSections(personnes);
    const totaux = computeTotaux(semaines, personnes, 'prev', today);

    const workbook = new ExcelJS.Workbook();

    // ── Feuille 1 : grille prévisionnelle ────────────────────────────────
    const grid = workbook.addWorksheet(`Grille ${annee}`);
    grid.columns = [
      { header: 'Salarié', key: 'nom', width: 30 },
      ...semaines.map((w) => ({ header: `S${w.num}`, key: `s${w.num}`, width: 6 })),
    ];
    // Ligne 2 : mois de rattachement (pivot jeudi) pour lecture.
    grid.addRow(['Mois (pivot jeudi)', ...semaines.map((w) => w.mois)]);

    const cellVal = (c) => (c.q == null ? '' : c.q);
    for (const sec of sections) {
      const headerRow = grid.addRow([sec.team_name, ...semaines.map(() => '')]);
      headerRow.font = { bold: true };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
      for (const p of sec.personnes) {
        const row = grid.addRow([p.nom, ...p.prev.map(cellVal)]);
        // Cellules présumées en italique (repérage visuel du renouvellement présumé).
        p.prev.forEach((c, i) => {
          if (c.statut === 'presume') row.getCell(i + 2).font = { italic: true, color: { argb: 'FF9C6500' } };
        });
      }
      const secTotaux = computeTotaux(semaines, sec.personnes, 'prev', today).par_semaine;
      const totalRow = grid.addRow([`TOTAL ${String(sec.team_name).toUpperCase()}`, ...secTotaux.map((t) => (t.etp == null ? '' : t.etp))]);
      totalRow.font = { bold: true };
    }
    const generalRow = grid.addRow(['TOTAL GÉNÉRAL', ...totaux.par_semaine.map((t) => (t.etp == null ? '' : t.etp))]);
    generalRow.font = { bold: true };
    generalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8BC540' } };
    const convRow = grid.addRow([
      'Convention (ETP conventionnés)',
      ...semaines.map(() => (convention.etp_conventionnes == null ? '' : convention.etp_conventionnes)),
    ]);
    convRow.font = { bold: true, color: { argb: 'FF2D8C4E' } };
    grid.addRow([]);
    grid.addRow([`Généré le ${today} — quotités prévisionnelles (contrats signés + renouvellement présumé en italique). Convention : ${convention.source === 'defaut' ? 'non paramétrée' : `source ${convention.source}`}.`]);
    grid.getRow(1).font = { bold: true };
    grid.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8BC540' } };
    grid.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }];

    // ── Feuille 2 : synthèse mensuelle ───────────────────────────────────
    const syn = workbook.addWorksheet('Synthèse mensuelle');
    syn.columns = [
      { header: 'Mois', key: 'mois', width: 8 },
      { header: 'ETP prévisionnel', key: 'etp_previsionnel', width: 16 },
      { header: 'ETP réalisé', key: 'etp_realise', width: 14 },
      { header: 'ETP ASP (validé)', key: 'etp_asp', width: 16 },
      { header: 'Validé par', key: 'asp_valide_par', width: 24 },
      { header: 'Validé le', key: 'asp_valide_le', width: 20 },
      { header: 'Écart convention (prév.)', key: 'ecart_convention_prev', width: 20 },
      { header: 'Écart convention (ASP)', key: 'ecart_convention_asp', width: 20 },
      { header: 'Taux de réalisation', key: 'taux_realisation', width: 18 },
      { header: 'ETP manquants (besoin recrutement)', key: 'etp_manquants', width: 28 },
      { header: 'Commentaire ASP', key: 'asp_commentaire', width: 40 },
    ];
    for (const m of mois) {
      const besoin = besoins_recrutement.find((b) => b.mois === m.mois);
      syn.addRow({
        ...m,
        asp_valide_le: m.asp_valide_le ? new Date(m.asp_valide_le) : '',
        etp_manquants: besoin && besoin.etp_manquants != null ? besoin.etp_manquants : '',
      });
    }
    syn.addRow([]);
    syn.addRow(['Convention', `ETP conventionnés : ${convention.etp_conventionnes ?? 'non paramétré'}`,
      `dont CDI Inclusion : ${convention.etp_cdi_inclusion ?? 'non paramétré'}`,
      `Heures/ETP : ${convention.heures_annuelles_etp ?? 'non paramétré'}`,
      `Période : ${convention.date_debut ?? '?'} → ${convention.date_fin ?? '?'}`,
      `Source : ${convention.source}`]);
    syn.getRow(1).font = { bold: true };
    syn.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8BC540' } };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=effectifs_etp_${annee}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[EFFECTIFS] Erreur export :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
