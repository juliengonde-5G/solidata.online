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
 * IMPORT DES ÉTATS ASP : les états mensuels de présence (PDF) sont importés par
 * /asp/import (services/asp-parser.js) et rapprochés salarié par salarié
 * (services/asp-rapprochement.js) — voir la section « COMPARAISON ASP » plus
 * bas. DOCTRINE : quand un état ASP existe pour un mois, LE CHIFFRE ASP FAIT
 * FOI ; le calcul SOLIDATA reste un CONTRÔLE, jamais la vérité conventionnelle.
 * Aucune fiche salarié n'est créée depuis un état ASP (RGPD) : on EXPLIQUE
 * l'écart, on ne le comble pas artificiellement.
 *
 * HABILITATIONS : lecture ADMIN/RH/MANAGER ; écritures ADMIN/RH
 * (suppression d'une validation ASP : ADMIN).
 *
 * POPULATION : salariés dont au moins un contrat entre dans le périmètre
 * conventionné (voir keepContractForInsertion — CDDI, CDI « Inclusion »,
 * CDD requalifié). Seules les personnes couvrant au moins une semaine de
 * l'année demandée apparaissent.
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const ExcelJS = require('exceljs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { query: q, param, body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');
const { documentFilter } = require('../utils/upload-filters');
const engine = require('../services/effectifs-engine');
const aspParser = require('../services/asp-parser');
const aspMatch = require('../services/asp-rapprochement');

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

const stripAccents = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');

const isCddi = (t) => String(t || '').toUpperCase() === 'CDDI';
const isCdi = (t) => String(t || '').toUpperCase() === 'CDI';
const isCdd = (t) => String(t || '').toUpperCase() === 'CDD';
/** Le salarié a (ou a eu) un parcours d'insertion dans l'ERP. */
const hasParcours = (emp) => !!emp.insertion_status && emp.insertion_status !== 'none';

/**
 * Types de contrat JAMAIS conventionnés à l'aide au poste, quel que soit le
 * statut de la personne : apprentissage, stage, contrat de professionnalisation,
 * intérim. (Le libellé Malibou brut est parfois conservé tel quel à l'import —
 * on teste donc de façon insensible aux accents et à la casse.)
 */
function typeHorsInsertion(contractType) {
  const s = stripAccents(String(contractType || '')).toLowerCase();
  return /appren|stage|stagiaire|profession|interim/.test(s);
}

/** Intitulé de poste marquant l'insertion (« … Cddi », « CDI Inclusion »). */
function posteInsertion(positionTitle) {
  return /cddi|inclusion/i.test(stripAccents(String(positionTitle || '')));
}

/**
 * RÈGLE DE PÉRIMÈTRE — quels contrats entrent dans le décompte des ETP
 * conventionnés (correction 2026-08 : le décompte comptait des personnes qui
 * NE SONT PAS en insertion, d'où une SURESTIMATION des mois récents face aux
 * états ASP).
 *
 *   (a) EXCLUSION ABSOLUE des contrats d'apprentissage / stage / contrat de
 *       professionnalisation / intérim : ces contrats ne sont jamais
 *       conventionnés au titre de l'aide au poste, même si la personne a par
 *       ailleurs un parcours d'insertion dans l'ERP.
 *   (b) CDI : retenu UNIQUEMENT si l'intitulé de poste porte la marque de
 *       l'insertion (« … Cddi », « CDI Inclusion ») ou si la fiche porte le
 *       motif explicite `cdi_inclusion`. Un CDI ordinaire ne compte jamais —
 *       y compris pour un ancien salarié en parcours : l'avenant de passage en
 *       CDI (dont l'intitulé perd la mention « Cddi ») fait sortir la personne
 *       du décompte À PARTIR DE SA DATE D'EFFET, les périodes CDDI antérieures
 *       restant comptées (le filtrage est fait ligne à ligne sur les périodes
 *       effectives chaînées d'employee_contracts).
 *   (c) CDD : requalification en CDDI de fait (données héritées d'avant
 *       l'import 2.20.0, qui stockait le type brut Malibou « CDD »)
 *       UNIQUEMENT si l'intitulé de poste contient « Cddi » OU si le salarié
 *       est déclaré à l'ASP (`emp.declare_asp`, jointure etp_asp_salaries).
 *       L'ancienne règle « tout CDD d'un salarié ayant un parcours » était
 *       trop large : elle faisait entrer des CDD ordinaires (poste de
 *       manutention, remplacement) et les permanents issus d'un parcours
 *       clôturé.
 *
 * @param {Object} contrat { contract_type, position_title }
 * @param {Object} emp     { cddi_derogation_motif, declare_asp, … }
 */
function keepContractForInsertion(contrat, emp) {
  const type = contrat && contrat.contract_type;
  const poste = contrat && contrat.position_title;
  if (typeHorsInsertion(type)) return false;                            // (a)
  if (isCddi(type)) return true;
  if (isCdi(type)) {                                                    // (b)
    return posteInsertion(poste) || (emp && emp.cddi_derogation_motif === 'cdi_inclusion');
  }
  if (isCdd(type)) return posteInsertion(poste) || !!(emp && emp.declare_asp); // (c)
  return false;
}

/**
 * Requête SOUPLE : renvoie `{ rows: [] }` au lieu de propager l'erreur (mêmes
 * motifs que le helper `soft()` du module Insertion — une table d'import ASP
 * absente sur une base non migrée ne doit pas casser la grille).
 */
async function soft(text, params, label) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.warn(`[EFFECTIFS] requête « ${label} » ignorée (${err.code || '?'}) : ${err.message}`);
    return { rows: [] };
  }
}

/** Identifiants des salariés rapprochés d'au moins une ligne d'état ASP. */
async function loadEmployeeIdsDeclaresAsp() {
  const r = await soft(
    'SELECT DISTINCT employee_id FROM etp_asp_salaries WHERE employee_id IS NOT NULL',
    [], 'employés déclarés ASP'
  );
  return r.rows.map((x) => x.employee_id);
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

  // Salariés déclarés à l'ASP (au moins une ligne d'état importée). Requête
  // SOUPLE : une base dont la migration d'import ASP n'est pas encore passée
  // ne doit pas casser la grille (dégradation → aucun salarié « déclaré ASP »).
  const declaresAsp = await loadEmployeeIdsDeclaresAsp();

  const empRes = await pool.query(`
    SELECT e.id, e.first_name, e.last_name, e.team_id, t.name AS team_name,
           e.insertion_status, e.cddi_derogation_motif,
           e.pass_iae_end::text AS pass_iae_end,
           e.position AS fiche_position,
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
       OR e.id = ANY($1)
       OR EXISTS (
            SELECT 1 FROM employee_contracts ec
            WHERE ec.employee_id = e.id AND UPPER(ec.contract_type) = 'CDDI'
          )
    ORDER BY UPPER(e.last_name), UPPER(e.first_name)
  `, [declaresAsp]);
  // NB : cette clause est un PRÉ-FILTRE large ; le périmètre réel est décidé
  // contrat par contrat par keepContractForInsertion (une personne sans aucun
  // contrat retenu est écartée plus bas).
  for (const e of empRes.rows) e.declare_asp = declaresAsp.includes(e.id);

  const ids = empRes.rows.map((r) => r.id);
  let contractRows = [];
  let leaveRows = [];
  if (ids.length > 0) {
    const cRes = await pool.query(`
      SELECT ec.employee_id, ec.contract_type, ec.position_title,
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
      // L'intitulé de poste de la LIGNE prime ; à défaut (ligne héritée sans
      // position_title), repli sur le poste de la fiche — meilleure information
      // disponible, jamais une valeur inventée.
      .filter((c) => keepContractForInsertion(
        { contract_type: c.contract_type, position_title: c.position_title || e.fiche_position }, e
      ) && c.start_date);

    let contrats = rows.map((c) => ({
      start: engine.isoOrNull(c.start_date),
      end: engine.isoOrNull(c.end_date),
      weeklyHours: c.weekly_hours,
      type: String(c.contract_type || '').toUpperCase(),
      official: engine.isoOrNull(c.official_start_date) || engine.isoOrNull(c.start_date),
    }));

    // Repli fiche (salarié sans historique employee_contracts) : contrat unique
    // reconstitué depuis employees.contract_* — pattern « repli fiche » existant.
    if (contrats.length === 0
        && keepContractForInsertion({ contract_type: e.fiche_contract_type, position_title: e.fiche_position }, e)
        && e.fiche_contract_start) {
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

// ═══════════════════════════════════════════════════════════════════════════
// COMPARAISON ASP — import des états mensuels de présence et lecture des écarts
// ───────────────────────────────────────────────────────────────────────────
// POURQUOI : la synthèse SOLIDATA ne coïncide pas avec les états ASP, pour DEUX
// raisons structurelles qu'il faut rendre LISIBLES (et non masquer) :
//   1. SOUS-ESTIMATION des mois passés — l'export de paie ne contient JAMAIS
//      les salariés SORTIS, même quand on demande un mois écoulé. Les lignes
//      ASP correspondantes n'ont donc aucune contrepartie dans l'ERP : motif
//      `absent_import_paie`. Ce n'est ni une erreur de l'ASP, ni une erreur de
//      saisie de l'utilisateur : c'est une limite de la source.
//   2. SURESTIMATION des mois récents — des personnes hors insertion étaient
//      comptées (apprentis, CDI hors insertion après avenant, CDD ordinaires) :
//      corrigé par keepContractForInsertion (voir la règle de périmètre).
//
// DOCTRINE : pour un mois disposant d'un état ASP, LE CHIFFRE ASP FAIT FOI
// (etp_asp_mensuel.etp_asp alimenté par l'import). Le calcul SOLIDATA est
// présenté comme un CONTRÔLE. Aucune fiche salarié n'est créée depuis un état
// ASP (RGPD) : on explique l'écart, on ne le comble pas artificiellement.
// ═══════════════════════════════════════════════════════════════════════════

/** Heures mensuelles d'un ETP à l'ASP (base 1 820 h / 12). */
const HEURES_MOIS_ETP = aspParser.HEURES_MENSUELLES_ETP;

/** Heures d'un mois → ETP ASP (2 déc.). */
const etpDepuisHeures = (h) => (h == null ? null : engine.round2(Number(h) / HEURES_MOIS_ETP));

// L'état ASP est un PDF de quelques dizaines de Ko ; 15 Mo est une borne large.
const uploadAspPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: documentFilter,
});
// Convertit les erreurs multer (type/taille) en 400 JSON (pattern employees.js).
const runUpload = (mw) => (req, res, next) => mw(req, res, (err) => {
  if (err) return res.status(400).json({ error: err.message || 'Fichier invalide' });
  next();
});

/**
 * Pré-filtre SQL des salariés « potentiellement conventionnés » (miroir de la
 * clause de buildGrilleData). $1 = identifiants déclarés à l'ASP.
 */
const PREFILTRE_INSERTION = `(
  UPPER(COALESCE(e.contract_type, '')) = 'CDDI'
  OR e.cddi_derogation_motif = 'cdi_inclusion'
  OR (e.insertion_status IS NOT NULL AND e.insertion_status <> 'none')
  OR e.id = ANY($1)
  OR EXISTS (SELECT 1 FROM employee_contracts ec2
             WHERE ec2.employee_id = e.id AND UPPER(ec2.contract_type) = 'CDDI')
)`;

const MOIS_LIBELLES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const premierJourMois = (annee, mois) => `${annee}-${String(mois).padStart(2, '0')}-01`;
const dernierJourMois = (annee, mois) => engine.addDaysISO(
  mois === 12 ? `${annee + 1}-01-01` : premierJourMois(annee, mois + 1), -1
);

/** Tous les collaborateurs (base du rapprochement des noms d'usage). */
async function loadEmployeesForMatching() {
  const r = await pool.query(`
    SELECT id, first_name, last_name, birth_date::text AS birth_date
    FROM employees
    ORDER BY UPPER(last_name), UPPER(first_name)
  `);
  return r.rows;
}

/** Liaisons manuelles nom ASP ↔ collaborateur (souple : table éventuellement absente). */
async function loadLiaisons() {
  const r = await soft(`
    SELECT id, nom_asp, date_naissance::text AS date_naissance, employee_id, cree_le
    FROM etp_asp_liaisons ORDER BY nom_asp
  `, [], 'liaisons ASP');
  return r.rows;
}

/** Lignes salarié des états ASP d'une année (et, optionnellement, d'un mois). */
async function loadAspSalaries(annee, mois) {
  const cols = `id, annee, mois, nom_asp, date_naissance::text AS date_naissance, forme_contrat,
                heures::float AS heures, salaire_brut::float AS salaire_brut,
                contrat_debut::text AS contrat_debut, contrat_fin::text AS contrat_fin,
                date_sortie::text AS date_sortie, motif_sortie, employee_id`;
  const r = mois
    ? await soft(`SELECT ${cols} FROM etp_asp_salaries WHERE annee = $1 AND mois = $2 ORDER BY nom_asp`, [annee, mois], 'lignes ASP du mois')
    : await soft(`SELECT ${cols} FROM etp_asp_salaries WHERE annee = $1 ORDER BY mois, nom_asp`, [annee], 'lignes ASP de l\'année');
  return r.rows;
}

/** Validations mensuelles ASP de l'année (SELECT * : tolérant aux colonnes d'import absentes). */
async function loadAspMensuel(annee) {
  const r = await soft('SELECT * FROM etp_asp_mensuel WHERE annee = $1 ORDER BY mois', [annee], 'validations ASP');
  return r.rows;
}

/** 'importe' (état PDF importé) | 'saisi' (chiffre saisi à la main) | 'absent'. */
function statutMois(row) {
  if (!row) return 'absent';
  return row.source === 'import_pdf' ? 'importe' : 'saisi';
}

/**
 * ETP SOLIDATA d'UNE personne sur UN mois (mêmes conventions que /ecarts :
 * moyenne des quotités des semaines rattachées au mois ; le réalisé n'est
 * calculé que sur les semaines entièrement écoulées, et vaut 0 quand aucun
 * contrat SIGNÉ ne couvre la semaine).
 */
function etpPersonneMois(semaines, p, mois, today) {
  const prev = []; const real = [];
  semaines.forEach((w, i) => {
    if (w.mois !== mois) return;
    prev.push(p.prev[i].q != null ? p.prev[i].q : 0);
    if (engine.addDaysISO(w.lundi, 6) < today) real.push(p.real[i].q != null ? p.real[i].q : 0);
  });
  return {
    previsionnel: engine.moyenne2(prev),
    realise: engine.moyenne2(real),
    couvert: prev.some((x) => x > 0),
  };
}

/** ETP retenu pour la comparaison : le réalisé s'il est mesurable, sinon le prévisionnel. */
function etpRetenu(mesures) {
  return mesures.realise != null ? mesures.realise : mesures.previsionnel;
}

/**
 * Contrats couvrant l'année, restreints aux salariés du pré-filtre insertion.
 * Sert l'analyse « présent dans SOLIDATA, absent de l'état ASP » : c'est ici
 * qu'on nomme le MOTIF d'exclusion (apprenti, CDI hors insertion, …) plutôt
 * que de laisser une différence inexpliquée.
 */
async function loadContratsAnnee(annee, declaresAsp) {
  const debut = `${annee}-01-01`;
  const fin = `${annee}-12-31`;
  const parEmploye = new Map();
  const push = (row) => {
    if (!parEmploye.has(row.id)) {
      parEmploye.set(row.id, {
        id: row.id,
        nom: formatNom(row.last_name, row.first_name),
        cddi_derogation_motif: row.cddi_derogation_motif,
        declare_asp: declaresAsp.includes(row.id),
        fiche_position: row.fiche_position,
        contrats: [],
      });
    }
    parEmploye.get(row.id).contrats.push({
      contract_type: row.contract_type,
      position_title: row.position_title || row.fiche_position,
      start: engine.isoOrNull(row.start_date),
      end: engine.isoOrNull(row.end_date),
    });
  };

  const r1 = await soft(`
    SELECT e.id, e.first_name, e.last_name, e.cddi_derogation_motif, e.position AS fiche_position,
           ec.contract_type, ec.position_title,
           ec.start_date::text AS start_date, ec.end_date::text AS end_date
    FROM employees e
    JOIN employee_contracts ec ON ec.employee_id = e.id
    WHERE ${PREFILTRE_INSERTION}
      AND ec.start_date <= $3 AND (ec.end_date IS NULL OR ec.end_date >= $2)
    ORDER BY UPPER(e.last_name), UPPER(e.first_name), ec.start_date
  `, [declaresAsp, debut, fin], 'contrats couvrant l\'année');
  r1.rows.forEach(push);

  // Repli fiche : salariés sans aucune ligne employee_contracts.
  const r2 = await soft(`
    SELECT e.id, e.first_name, e.last_name, e.cddi_derogation_motif, e.position AS fiche_position,
           e.contract_type, e.position AS position_title,
           e.contract_start::text AS start_date, e.contract_end::text AS end_date
    FROM employees e
    WHERE ${PREFILTRE_INSERTION}
      AND NOT EXISTS (SELECT 1 FROM employee_contracts ec WHERE ec.employee_id = e.id)
      AND e.contract_start IS NOT NULL
      AND e.contract_start <= $3 AND (e.contract_end IS NULL OR e.contract_end >= $2)
    ORDER BY UPPER(e.last_name), UPPER(e.first_name)
  `, [declaresAsp, debut, fin], 'contrats fiche couvrant l\'année');
  r2.rows.forEach(push);

  return [...parEmploye.values()];
}

/** Motif d'exclusion du périmètre conventionné pour un contrat non retenu. */
function motifHorsPerimetre(contrat) {
  const type = contrat && contrat.contract_type;
  if (typeHorsInsertion(type)) return 'apprenti';
  if (isCdi(type)) return 'cdi_hors_insertion';
  return 'cdd_hors_insertion';
}

const MOTIF_SOLIDATA_LIBELLES = {
  apprenti: 'Contrat d\'apprentissage / stage — jamais conventionné à l\'aide au poste',
  cdi_hors_insertion: 'CDI hors insertion (l\'avenant fait sortir la personne du décompte à sa date d\'effet)',
  cdd_hors_insertion: 'CDD hors insertion (poste non « Cddi », non déclaré à l\'ASP)',
  non_declare: 'Dans le périmètre SOLIDATA mais absent de l\'état ASP du mois',
};

/**
 * Bloc « présents dans SOLIDATA / absents de l'état ASP » d'un mois.
 * @param {Set<number>} idsDeclares employee_id rapprochés d'une ligne ASP du mois
 */
function analyseSolidataSeul({ contratsAnnee, personnes, semaines, annee, mois, today, idsDeclares }) {
  const debut = premierJourMois(annee, mois);
  const fin = dernierJourMois(annee, mois);
  const parId = new Map(personnes.map((p) => [p.employee_id, p]));
  const out = [];

  for (const emp of contratsAnnee) {
    if (idsDeclares.has(emp.id)) continue; // déjà dans « concordants »
    const couvrants = emp.contrats.filter((c) => c.start && c.start <= fin && (!c.end || c.end >= debut));
    if (couvrants.length === 0) continue;

    const retenus = couvrants.filter((c) => keepContractForInsertion(c, emp));
    const p = parId.get(emp.id);
    const mesures = p ? etpPersonneMois(semaines, p, mois, today) : null;
    const etp = mesures ? etpRetenu(mesures) : null;

    if (retenus.length > 0) {
      // Dans le périmètre mais pas sur l'état : à investiguer côté déclaration.
      if (!mesures || !mesures.couvert) continue;
      out.push({
        employee_id: emp.id, nom: emp.nom,
        etp_solidata: etp, type_contrat: retenus[0].contract_type,
        poste: retenus[0].position_title || null,
        motif: 'non_declare', motif_libelle: MOTIF_SOLIDATA_LIBELLES.non_declare,
        dans_le_calcul: true,
      });
      continue;
    }
    // Hors périmètre : la personne est en paie ce mois-là mais n'est pas (ou
    // plus) conventionnée — c'est la moitié « surestimation » de l'écart.
    const c = couvrants[0];
    const motif = motifHorsPerimetre(c);
    out.push({
      employee_id: emp.id, nom: emp.nom,
      etp_solidata: 0, type_contrat: c.contract_type, poste: c.position_title || null,
      motif, motif_libelle: MOTIF_SOLIDATA_LIBELLES[motif],
      dans_le_calcul: false,
    });
  }
  return out.sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr', { sensitivity: 'base' }));
}

/**
 * Assemble la comparaison annuelle ASP ↔ SOLIDATA (partagée par
 * /asp/comparaison et /asp/export).
 */
async function computeComparaisonAnnuelle(annee, today) {
  const declaresAsp = await loadEmployeeIdsDeclaresAsp();
  const [{ semaines, personnes }, convention, aspMensuel, lignes, employees, liaisons] = await Promise.all([
    buildGrilleData(annee, today),
    readConvention(annee),
    loadAspMensuel(annee),
    loadAspSalaries(annee),
    loadEmployeesForMatching(),
    loadLiaisons(),
  ]);

  // Rapprochement RECALCULÉ à la lecture : une liaison ajoutée ou un import de
  // paie plus récent améliore aussitôt l'explication de l'écart.
  const rapprochees = aspMatch.rapprocherSalaries(lignes, employees, liaisons);
  const parMois = new Map();
  for (const l of rapprochees) {
    const m = Number(l.mois);
    if (!parMois.has(m)) parMois.set(m, []);
    parMois.get(m).push(l);
  }

  const prevTotaux = computeTotaux(semaines, personnes, 'prev', today);
  const realTotaux = computeTotaux(semaines, personnes, 'real', today);
  const aspByMois = new Map(aspMensuel.map((r) => [Number(r.mois), r]));

  const mois = [];
  for (let m = 1; m <= 12; m++) {
    const row = aspByMois.get(m) || null;
    const lignesMois = parMois.get(m) || [];
    const nonRapprochees = lignesMois.filter((l) => !l.employee_id);
    const heuresNonCouvertes = nonRapprochees.reduce((a, l) => a + (Number(l.heures) || 0), 0);

    const prev = prevTotaux.par_mois.find((x) => x.mois === m).etp;
    const real = realTotaux.par_mois.find((x) => x.mois === m).etp;
    const etpAsp = row && row.etp_asp != null ? engine.round2(Number(row.etp_asp)) : null;
    const base = real != null ? real : prev;
    const ecart = etpAsp != null && base != null ? engine.round2(base - etpAsp) : null;
    const nbSolidata = personnes.filter((p) => etpPersonneMois(semaines, p, m, today).couvert).length;

    mois.push({
      mois: m,
      mois_libelle: MOIS_LIBELLES[m - 1],
      etp_asp: etpAsp,
      heures_asp: row && row.heures_declarees != null ? Number(row.heures_declarees) : null,
      etp_solidata_previsionnel: prev,
      etp_solidata_realise: real,
      // Écart = SOLIDATA − ASP, calculé sur le réalisé quand il est mesurable,
      // sinon sur le prévisionnel (base exposée pour lever toute ambiguïté).
      ecart_etp: ecart,
      ecart_base: real != null ? 'realise' : 'previsionnel',
      // Pourcentage DÉJÀ multiplié par 100 (à afficher tel quel avec « % »).
      ecart_pct: ecart != null && etpAsp ? engine.round2((ecart / etpAsp) * 100) : null,
      nb_salaries_asp: lignesMois.length || (row && row.nb_salaries_asp != null ? Number(row.nb_salaries_asp) : null),
      nb_salaries_solidata: nbSolidata,
      statut: statutMois(row),
      // Lecture d'un coup d'œil : « X ETP d'écart, dont Y portés par des
      // salariés absents de l'import de paie ».
      couverture: {
        nb_asp: lignesMois.length,
        nb_solidata: nbSolidata,
        nb_absents_import: nonRapprochees.filter((l) => l.motif === 'absent_import_paie').length,
        nb_a_lier: nonRapprochees.filter((l) => l.motif === 'non_apparie').length,
        etp_asp_non_couvert: lignesMois.length ? etpDepuisHeures(heuresNonCouvertes) : null,
      },
    });
  }

  return { annee, convention, mois, semaines, personnes, parMois, declaresAsp, today };
}

// ── POST /api/effectifs/asp/import (ADMIN/RH) ──────────────────────────────
// multipart `fichier` = état mensuel de présence ASP (PDF).
// SANS ?confirm=1 → PRÉVISUALISATION : aucune écriture, on montre ce qui sera
// importé et comment chaque ligne se rapproche d'un collaborateur.
// AVEC ?confirm=1 → upsert transactionnel etp_asp_mensuel + etp_asp_salaries,
// journalisé dans rgpd_audit_log DANS la transaction.
router.post('/asp/import', WRITE, runUpload(uploadAspPdf.single('fichier')), [
  q('confirm').optional().isIn(['0', '1']).withMessage('confirm invalide (0 ou 1)'),
], validate, async (req, res) => {
  const client = null;
  try {
    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
      return res.status(400).json({ error: 'Fichier manquant (champ « fichier »).' });
    }
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const mime = String(req.file.mimetype || '').toLowerCase();
    if (ext !== '.pdf' || mime !== 'application/pdf') {
      return res.status(400).json({ error: 'Un état mensuel de présence ASP au format PDF est attendu.' });
    }

    let etat;
    try {
      etat = await aspParser.parseAspPdf(req.file.buffer);
    } catch (err) {
      if (err && err.code === 'ASP_PARSE') {
        return res.status(400).json({ error: err.message, details: err.details || null });
      }
      throw err;
    }

    const [employees, liaisons, dejaRes] = await Promise.all([
      loadEmployeesForMatching(),
      loadLiaisons(),
      soft('SELECT id, source, valide_le FROM etp_asp_mensuel WHERE annee = $1 AND mois = $2',
        [etat.annee, etat.mois], 'état ASP existant'),
    ]);
    const rapprochees = aspMatch.rapprocherSalaries(etat.salaries, employees, liaisons);
    const concordants = rapprochees.filter((l) => l.employee_id).length;
    const nonApparies = rapprochees.length - concordants;

    const payload = {
      annee: etat.annee,
      mois: etat.mois,
      mois_libelle: etat.mois_libelle,
      fichier_nom: req.file.originalname || null,
      siret: etat.siret,
      num_annexe: etat.num_annexe,
      confirme: false,
      entetes: {
        heures_declarees: etat.entetes.heures_declarees,
        heures_eligibles: etat.entetes.heures_eligibles,
        etp_realises: etat.entetes.etp_realises,
        etp_conventionnes: etat.entetes.etp_conventionnes,
        taux: etat.entetes.taux,
        nb_salaries: etat.entetes.nb_salaries,
        montant_forfaitaire: etat.entetes.montant_forfaitaire,
        nb_brsa: etat.entetes.nb_brsa,
      },
      coherence: etat.coherence,
      salaries: rapprochees.map((l) => ({
        nom_asp: l.nom_asp,
        date_naissance: l.date_naissance,
        forme_contrat: l.forme_contrat,
        heures: l.heures,
        salaire_brut: l.salaire_brut,
        contrat_debut: l.contrat_debut,
        contrat_fin: l.contrat_fin,
        date_sortie: l.date_sortie,
        motif_sortie: l.motif_sortie,
        employee_id: l.employee_id,
        employee_nom: l.employee_nom,
        mode_appariement: l.mode_appariement,
        score: l.score,
        motif: l.motif,
        motif_libelle: l.motif ? aspMatch.MOTIF_LIBELLES[l.motif] : null,
        candidats: l.candidats,
      })),
      rapprochement: {
        concordants,
        asp_non_apparies: nonApparies,
        absents_import_paie: rapprochees.filter((l) => l.motif === 'absent_import_paie').length,
        a_lier: rapprochees.filter((l) => l.motif === 'non_apparie').length,
        deja_importe: dejaRes.rows.length > 0,
      },
      avertissements: etat.avertissements,
    };

    if (req.query.confirm !== '1') return res.json(payload); // prévisualisation
    if (etat.entetes.etp_realises == null) {
      return res.status(400).json({ error: "En-tête « Nb ETP réalisés » illisible : import refusé (le chiffre ASP doit faire foi)." });
    }

    const cx = await pool.connect();
    try {
      await cx.query('BEGIN');
      const up = await cx.query(`
        INSERT INTO etp_asp_mensuel (annee, mois, etp_asp, heures_declarees, heures_eligibles,
          etp_conventionnes_asp, taux_asp, nb_salaries_asp, montant_forfaitaire,
          source, fichier_nom, saisi_par, valide_le)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'import_pdf',$10,$11,NOW())
        ON CONFLICT (annee, mois) DO UPDATE SET
          etp_asp = EXCLUDED.etp_asp,
          heures_declarees = EXCLUDED.heures_declarees,
          heures_eligibles = EXCLUDED.heures_eligibles,
          etp_conventionnes_asp = EXCLUDED.etp_conventionnes_asp,
          taux_asp = EXCLUDED.taux_asp,
          nb_salaries_asp = EXCLUDED.nb_salaries_asp,
          montant_forfaitaire = EXCLUDED.montant_forfaitaire,
          source = 'import_pdf',
          fichier_nom = EXCLUDED.fichier_nom,
          saisi_par = EXCLUDED.saisi_par,
          valide_le = NOW()
        RETURNING id`,
      [etat.annee, etat.mois, etat.entetes.etp_realises, etat.entetes.heures_declarees,
        etat.entetes.heures_eligibles, etat.entetes.etp_conventionnes, etat.entetes.taux,
        etat.entetes.nb_salaries, etat.entetes.montant_forfaitaire,
        req.file.originalname || null, req.user.id]);

      // Réimport du même mois : on remplace le détail (idempotent).
      await cx.query('DELETE FROM etp_asp_salaries WHERE annee = $1 AND mois = $2', [etat.annee, etat.mois]);
      for (const l of rapprochees) {
        await cx.query(`
          INSERT INTO etp_asp_salaries (annee, mois, nom_asp, date_naissance, forme_contrat,
            heures, salaire_brut, contrat_debut, contrat_fin, date_sortie, motif_sortie, employee_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [etat.annee, etat.mois, l.nom_asp, l.date_naissance, l.forme_contrat, l.heures,
          l.salaire_brut, l.contrat_debut, l.contrat_fin, l.date_sortie, l.motif_sortie, l.employee_id]);
      }

      await cx.query(
        'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
        [req.user.id, 'ASP_IMPORT', 'etp_asp_mensuel', up.rows[0].id, JSON.stringify({
          annee: etat.annee, mois: etat.mois, fichier: req.file.originalname || null,
          heures_declarees: etat.entetes.heures_declarees, etp_asp: etat.entetes.etp_realises,
          nb_lignes: rapprochees.length, concordants, non_apparies: nonApparies,
          requested_by: req.user.id,
        })]
      );
      await cx.query('COMMIT');
      payload.confirme = true;
      payload.etp_asp_enregistre = etat.entetes.etp_realises;
      res.json(payload);
    } catch (err) {
      try { await cx.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
      throw err;
    } finally {
      cx.release();
    }
  } catch (err) {
    console.error('[EFFECTIFS] Erreur import ASP :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    if (client) client.release();
  }
});

// ── GET /api/effectifs/asp/comparaison?annee= ──────────────────────────────
router.get('/asp/comparaison', READ, [
  q('annee').optional().isInt({ min: 2000, max: 2100 }).withMessage('annee invalide'),
], validate, async (req, res) => {
  try {
    const annee = req.query.annee ? parseInt(req.query.annee, 10) : anneeParDefaut();
    const { convention, mois } = await computeComparaisonAnnuelle(annee, parisToday());
    res.json({ annee, convention, mois });
  } catch (err) {
    console.error('[EFFECTIFS] Erreur comparaison ASP :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── GET /api/effectifs/asp/comparaison/:mois?annee= ────────────────────────
// Détail d'un mois : qui concorde, qui n'est QUE dans l'état ASP, qui n'est QUE
// dans SOLIDATA — chaque ligne portant son MOTIF (c'est ce qui rend l'écart
// lisible d'un coup d'œil).
router.get('/asp/comparaison/:mois', READ, [
  param('mois').isInt({ min: 1, max: 12 }).withMessage('mois invalide (1-12)'),
  q('annee').optional().isInt({ min: 2000, max: 2100 }).withMessage('annee invalide'),
], validate, async (req, res) => {
  try {
    const annee = req.query.annee ? parseInt(req.query.annee, 10) : anneeParDefaut();
    const mois = parseInt(req.params.mois, 10);
    const today = parisToday();

    const { semaines, personnes, parMois, declaresAsp, convention } = await computeComparaisonAnnuelle(annee, today);
    const lignes = parMois.get(mois) || [];
    const contratsAnnee = await loadContratsAnnee(annee, declaresAsp);
    const parId = new Map(personnes.map((p) => [p.employee_id, p]));

    const concordants = [];
    const aspSeul = [];
    const idsDeclares = new Set();
    for (const l of lignes) {
      if (!l.employee_id) {
        aspSeul.push({
          nom_asp: l.nom_asp,
          date_naissance: l.date_naissance,
          heures_asp: l.heures,
          etp_asp: etpDepuisHeures(l.heures),
          date_sortie: l.date_sortie,
          motif: l.motif,
          motif_libelle: aspMatch.MOTIF_LIBELLES[l.motif] || null,
          candidats: l.candidats,
        });
        continue;
      }
      idsDeclares.add(l.employee_id);
      const p = parId.get(l.employee_id);
      const mesures = p ? etpPersonneMois(semaines, p, mois, today) : null;
      const etpSolidata = mesures ? etpRetenu(mesures) : 0;
      const etpAsp = etpDepuisHeures(l.heures);
      concordants.push({
        employee_id: l.employee_id,
        nom: l.employee_nom || (p ? p.nom : l.nom_asp),
        nom_asp: l.nom_asp,
        heures_asp: l.heures,
        etp_asp: etpAsp,
        etp_solidata: etpSolidata,
        etp_solidata_previsionnel: mesures ? mesures.previsionnel : null,
        etp_solidata_realise: mesures ? mesures.realise : null,
        ecart: etpAsp != null && etpSolidata != null ? engine.round2(etpSolidata - etpAsp) : null,
        mode_appariement: l.mode_appariement,
        score: l.score,
        // false = déclaré à l'ASP mais HORS du périmètre calculé par SOLIDATA
        // (ex. CDI Inclusion non marqué sur la fiche) : l'écart est alors porté
        // par le périmètre, pas par l'absentéisme.
        dans_le_calcul: !!(mesures && mesures.couvert),
      });
    }

    const solidataSeul = analyseSolidataSeul({
      contratsAnnee, personnes, semaines, annee, mois, today, idsDeclares,
    });

    res.json({
      annee,
      mois,
      mois_libelle: MOIS_LIBELLES[mois - 1],
      convention,
      concordants: concordants.sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr', { sensitivity: 'base' })),
      asp_seul: aspSeul.sort((a, b) => String(a.nom_asp).localeCompare(String(b.nom_asp), 'fr', { sensitivity: 'base' })),
      solidata_seul: solidataSeul,
    });
  } catch (err) {
    console.error('[EFFECTIFS] Erreur détail comparaison ASP :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── GET /api/effectifs/asp/liaisons ────────────────────────────────────────
router.get('/asp/liaisons', READ, async (req, res) => {
  try {
    const r = await soft(`
      SELECT l.id, l.nom_asp, l.date_naissance::text AS date_naissance, l.employee_id,
             l.cree_le, e.first_name, e.last_name
      FROM etp_asp_liaisons l
      LEFT JOIN employees e ON e.id = l.employee_id
      ORDER BY l.nom_asp
    `, [], 'liste des liaisons ASP');
    res.json(r.rows.map((x) => ({
      id: x.id, nom_asp: x.nom_asp, date_naissance: x.date_naissance,
      employee_id: x.employee_id, employee_nom: formatNom(x.last_name, x.first_name) || null,
      cree_le: x.cree_le,
    })));
  } catch (err) {
    console.error('[EFFECTIFS] Erreur liaisons ASP :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * Re-rapproche les lignes ASP stockées après création/suppression d'une
 * liaison : recalcule l'appariement des lignes portant ce nom et met à jour
 * `employee_id` (qui peut redevenir NULL après une suppression).
 */
async function reRapprocherNom(cx, nomAsp) {
  const cible = aspMatch.normalizeNom(nomAsp);
  const [rows, employees, liaisons] = await Promise.all([
    cx.query('SELECT id, nom_asp, date_naissance::text AS date_naissance, employee_id FROM etp_asp_salaries'),
    loadEmployeesForMatching(),
    (async () => (await cx.query('SELECT id, nom_asp, date_naissance::text AS date_naissance, employee_id FROM etp_asp_liaisons')).rows)(),
  ]);
  const concernees = rows.rows.filter((r) => aspMatch.normalizeNom(r.nom_asp) === cible);
  const rapprochees = aspMatch.rapprocherSalaries(concernees, employees, liaisons);
  let n = 0;
  for (let i = 0; i < concernees.length; i++) {
    const avant = concernees[i].employee_id;
    const apres = rapprochees[i].employee_id;
    if (avant === apres) continue;
    await cx.query('UPDATE etp_asp_salaries SET employee_id = $1 WHERE id = $2', [apres, concernees[i].id]);
    n += 1;
  }
  return n;
}

// ── POST /api/effectifs/asp/liaison (ADMIN/RH) ─────────────────────────────
// Correspondance manuelle « nom d'usage ASP » ↔ collaborateur : elle FAIT FOI
// et vaut pour tous les mois (passés et à venir).
router.post('/asp/liaison', WRITE, [
  body('nom_asp').isString().trim().isLength({ min: 2, max: 200 }).withMessage('nom_asp requis (2-200 caractères)'),
  body('employee_id').isInt({ min: 1 }).withMessage('employee_id requis'),
  body('date_naissance').optional({ nullable: true }).matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('date_naissance : AAAA-MM-JJ attendu'),
], validate, async (req, res) => {
  const cx = await pool.connect();
  try {
    const nomAsp = String(req.body.nom_asp).trim();
    const employeeId = parseInt(req.body.employee_id, 10);
    const naissance = req.body.date_naissance ? String(req.body.date_naissance) : null;

    const emp = await cx.query('SELECT id, first_name, last_name FROM employees WHERE id = $1', [employeeId]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Collaborateur introuvable' });

    await cx.query('BEGIN');
    // UNIQUE(nom_asp, date_naissance) ne détecte pas les conflits sur NULL :
    // on remplace explicitement l'éventuelle liaison existante.
    await cx.query(
      'DELETE FROM etp_asp_liaisons WHERE nom_asp = $1 AND date_naissance IS NOT DISTINCT FROM $2::date',
      [nomAsp, naissance]
    );
    const ins = await cx.query(`
      INSERT INTO etp_asp_liaisons (nom_asp, date_naissance, employee_id, cree_par)
      VALUES ($1, $2, $3, $4)
      RETURNING id, nom_asp, date_naissance::text AS date_naissance, employee_id, cree_le`,
    [nomAsp, naissance, employeeId, req.user.id]);
    const rapprochees = await reRapprocherNom(cx, nomAsp);
    await cx.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'ASP_LIAISON', 'etp_asp_liaisons', ins.rows[0].id,
        JSON.stringify({ nom_asp: nomAsp, date_naissance: naissance, employee_id: employeeId, lignes_rapprochees: rapprochees, requested_by: req.user.id })]
    );
    await cx.query('COMMIT');
    res.json({
      ...ins.rows[0],
      employee_nom: formatNom(emp.rows[0].last_name, emp.rows[0].first_name),
      lignes_rapprochees: rapprochees,
    });
  } catch (err) {
    try { await cx.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
    console.error('[EFFECTIFS] Erreur liaison ASP :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    cx.release();
  }
});

// ── DELETE /api/effectifs/asp/liaison/:id (ADMIN/RH) ───────────────────────
router.delete('/asp/liaison/:id', WRITE, [
  param('id').isInt({ min: 1 }).withMessage('id invalide'),
], validate, async (req, res) => {
  const cx = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    await cx.query('BEGIN');
    const del = await cx.query('DELETE FROM etp_asp_liaisons WHERE id = $1 RETURNING nom_asp', [id]);
    if (del.rows.length === 0) {
      await cx.query('ROLLBACK');
      return res.status(404).json({ error: 'Liaison introuvable' });
    }
    const rapprochees = await reRapprocherNom(cx, del.rows[0].nom_asp);
    await cx.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'ASP_LIAISON_SUPPRESSION', 'etp_asp_liaisons', id,
        JSON.stringify({ nom_asp: del.rows[0].nom_asp, lignes_rapprochees: rapprochees, requested_by: req.user.id })]
    );
    await cx.query('COMMIT');
    res.json({ deleted: true, id, lignes_rapprochees: rapprochees });
  } catch (err) {
    try { await cx.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
    console.error('[EFFECTIFS] Erreur suppression liaison ASP :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    cx.release();
  }
});

// ── GET /api/effectifs/asp/export?annee= — classeur .xlsx (exceljs) ────────
// Feuille 1 : comparaison mensuelle ASP ↔ SOLIDATA.
// Feuille 2 : détail des écarts (une ligne par salarié ET par mois, avec motif).
router.get('/asp/export', READ, [
  q('annee').optional().isInt({ min: 2000, max: 2100 }).withMessage('annee invalide'),
], validate, async (req, res) => {
  try {
    const annee = req.query.annee ? parseInt(req.query.annee, 10) : anneeParDefaut();
    const today = parisToday();
    const { mois, convention, semaines, personnes, parMois, declaresAsp } =
      await computeComparaisonAnnuelle(annee, today);
    const contratsAnnee = await loadContratsAnnee(annee, declaresAsp);
    const parId = new Map(personnes.map((p) => [p.employee_id, p]));

    const workbook = new ExcelJS.Workbook();
    const cmp = workbook.addWorksheet('Comparaison mensuelle');
    cmp.columns = [
      { header: 'Mois', key: 'mois_libelle', width: 12 },
      { header: 'ETP ASP (fait foi)', key: 'etp_asp', width: 18 },
      { header: 'Heures déclarées ASP', key: 'heures_asp', width: 20 },
      { header: 'ETP SOLIDATA prévisionnel', key: 'etp_solidata_previsionnel', width: 24 },
      { header: 'ETP SOLIDATA réalisé', key: 'etp_solidata_realise', width: 22 },
      { header: 'Écart (SOLIDATA − ASP)', key: 'ecart_etp', width: 22 },
      { header: 'Écart %', key: 'ecart_pct', width: 10 },
      { header: 'Salariés ASP', key: 'nb_salaries_asp', width: 14 },
      { header: 'Salariés SOLIDATA', key: 'nb_salaries_solidata', width: 18 },
      { header: 'Dont absents de l\'import de paie', key: 'nb_absents_import', width: 30 },
      { header: 'ETP ASP non couvert', key: 'etp_asp_non_couvert', width: 20 },
      { header: 'Source', key: 'statut', width: 12 },
    ];
    for (const m of mois) {
      cmp.addRow({
        ...m,
        nb_absents_import: m.couverture.nb_absents_import,
        etp_asp_non_couvert: m.couverture.etp_asp_non_couvert,
      });
    }
    cmp.getRow(1).font = { bold: true };
    cmp.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8BC540' } };

    const det = workbook.addWorksheet('Détail des écarts');
    det.columns = [
      { header: 'Mois', key: 'mois_libelle', width: 12 },
      { header: 'Bloc', key: 'bloc', width: 18 },
      { header: 'Nom', key: 'nom', width: 32 },
      { header: 'Nom ASP', key: 'nom_asp', width: 32 },
      { header: 'Heures ASP', key: 'heures_asp', width: 12 },
      { header: 'ETP ASP', key: 'etp_asp', width: 10 },
      { header: 'ETP SOLIDATA', key: 'etp_solidata', width: 14 },
      { header: 'Écart', key: 'ecart', width: 10 },
      { header: 'Appariement', key: 'mode_appariement', width: 14 },
      { header: 'Motif', key: 'motif', width: 22 },
      { header: 'Explication', key: 'motif_libelle', width: 70 },
      { header: 'Date de sortie ASP', key: 'date_sortie', width: 18 },
    ];
    for (let m = 1; m <= 12; m++) {
      const libelle = MOIS_LIBELLES[m - 1];
      const lignes = parMois.get(m) || [];
      const idsDeclares = new Set(lignes.filter((l) => l.employee_id).map((l) => l.employee_id));
      for (const l of lignes) {
        const p = l.employee_id ? parId.get(l.employee_id) : null;
        const mesures = p ? etpPersonneMois(semaines, p, m, today) : null;
        const etpSolidata = mesures ? etpRetenu(mesures) : (l.employee_id ? 0 : null);
        const etpAsp = etpDepuisHeures(l.heures);
        det.addRow({
          mois_libelle: libelle,
          bloc: l.employee_id ? 'Concordant' : 'ASP seul',
          nom: l.employee_nom || '',
          nom_asp: l.nom_asp,
          heures_asp: l.heures,
          etp_asp: etpAsp,
          etp_solidata: etpSolidata,
          ecart: etpSolidata != null && etpAsp != null ? engine.round2(etpSolidata - etpAsp) : '',
          mode_appariement: l.mode_appariement || '',
          motif: l.motif || '',
          motif_libelle: l.motif ? (aspMatch.MOTIF_LIBELLES[l.motif] || '') : '',
          date_sortie: l.date_sortie || '',
        });
      }
      for (const s of analyseSolidataSeul({ contratsAnnee, personnes, semaines, annee, mois: m, today, idsDeclares })) {
        det.addRow({
          mois_libelle: libelle,
          bloc: 'SOLIDATA seul',
          nom: s.nom,
          etp_solidata: s.etp_solidata,
          motif: s.motif,
          motif_libelle: s.motif_libelle,
        });
      }
    }
    det.getRow(1).font = { bold: true };
    det.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8BC540' } };
    det.views = [{ state: 'frozen', ySplit: 1 }];

    cmp.addRow([]);
    cmp.addRow([`Généré le ${today}. Le chiffre ASP fait foi ; l'ETP SOLIDATA est un contrôle. Convention : ${convention.etp_conventionnes ?? 'non paramétrée'} ETP (source ${convention.source}).`]);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=comparaison_asp_${annee}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[EFFECTIFS] Erreur export comparaison ASP :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── POST /api/effectifs/asp/:annee/:mois (ADMIN/RH) ────────────────────────
// Validation ASP mensuelle SAISIE À LA MAIN : upsert horodaté + journal
// rgpd_audit_log DANS la même transaction (pas de validation non tracée —
// pattern export freins). Une saisie manuelle bascule `source` à 'saisie' :
// le chiffre vient alors d'un humain, pas de l'état importé (les en-têtes de
// l'état éventuellement importé sont conservés à titre documentaire).
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
