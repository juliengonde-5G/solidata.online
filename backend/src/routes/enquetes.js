/**
 * Module Enquêtes (RSEI-13) — 30e module de l'ERP.
 *
 * Mini-moteur GÉNÉRIQUE de questionnaires ANONYMES : modèles administrables
 * (échelles + texte libre), campagnes diffusées par lien/QR (token de campagne,
 * pattern qr_token véhicule), mode kiosque FALC côté front, restitution AGRÉGÉE
 * avec SEUIL D'ANONYMAT n ≥ 5, archivage des campagnes = preuve datée.
 * Cadrage : rapports/rsei-2026-07-22/03-plan-action-rsei.md §2.2 (RSEI-13).
 * Sert les critères RSEi 2.5 (QVCT), 5.3 (satisfaction PP), 3.2 (intégration M1),
 * 4.4 (participation aux sensibilisations).
 *
 * DEUX SURFACES :
 *  1. ADMINISTRATION (authentifiée) — modèles, questions, campagnes, résultats.
 *  2. RÉPONSE PUBLIQUE (SANS authentification) — GET/POST /public/:token, montés
 *     AVANT `router.use(authenticate)` (même pattern que le webhook SumUp de vak.js).
 *
 * HABILITATIONS (administration)
 *  - Lecture  : ADMIN / MANAGER / RH / QHSE (REF_RSE hérite de MANAGER ; QHSE lit
 *    les résultats des enquêtes QVCT qu'il pilote).
 *  - Écriture : ADMIN / RH / MANAGER / QHSE (le référent REF_RSE=MANAGER tient les
 *    enquêtes RSE ; le QHSE porte l'enquête conditions de travail/QVCT — 2.5).
 *  NB : la spec RSEI-13 fixe la lecture à ADMIN/MANAGER/RH et l'écriture à
 *  ADMIN/RH/MANAGER + QHSE ; QHSE est ajouté À LA LECTURE pour cohérence (un rôle
 *  qui crée une campagne doit pouvoir en lire les résultats). La visibilité fine se
 *  règle dans la matrice /admin/permissions (module 'enquetes').
 *
 * ANONYMAT RÉEL by design : la table enquete_reponses ne porte AUCUNE FK vers
 * users/employees. Le seuil n ≥ 5 est appliqué à la RESTITUTION (jamais de détail
 * en deçà). Les verbatims bruts ne sont exposés QUE si le modèle est `anonyme` ET
 * n ≥ 5. Registre RGPD « Enquêtes internes » (init-db.js).
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');

const CATEGORIES = ['qvct', 'satisfaction', 'integration', 'sensibilisation', 'parties_prenantes', 'autre'];
const TYPES_QUESTION = ['echelle', 'choix_unique', 'choix_multiple', 'texte', 'oui_non', 'note_10'];
const STATUTS_CAMPAGNE = ['brouillon', 'ouverte', 'close'];
// Transitions de statut autorisées (forward-only : brouillon → ouverte → close).
const TRANSITIONS = { brouillon: ['ouverte'], ouverte: ['close'], close: [] };

// SEUIL D'ANONYMAT : en deçà de 5 réponses, AUCUN détail n'est restitué (strict).
const SEUIL_ANONYMAT = 5;

// Base publique pour construire le lien de réponse (diffusion lien/QR). Le front
// exposera une route /enquete/:token en mode kiosque FALC.
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || process.env.MOBILE_BASE_URL || 'https://solidata.online').replace(/\/+$/, '');
const lienPublic = (token) => `${PUBLIC_BASE}/enquete/${token}`;

// ───────────────────────────────────────────────────────────────────────────
// ORACLES DE RESTITUTION (spécification exécutable, verrouillée par les tests) —
// exposés sur le router (comme energie.computeConsommation100km).
// ───────────────────────────────────────────────────────────────────────────

// Une réponse est « donnée » si non nulle / non vide (tolère 0 et false).
function isAnswered(val, type) {
  if (val === undefined || val === null) return false;
  if (type === 'choix_multiple') return Array.isArray(val) && val.length > 0;
  if (typeof val === 'string') return val.trim() !== '';
  return true; // nombres (dont 0), booléens (dont false)
}

// Distribution (comptage) d'une liste de valeurs scalaires.
function distribution(values) {
  const d = {};
  for (const v of values) { const k = String(v); d[k] = (d[k] || 0) + 1; }
  return d;
}

// Normalise une réponse oui/non hétérogène (true/1/'oui'/'true' → 'oui').
function normOuiNon(v) {
  if (v === true || v === 1 || v === '1') return 'oui';
  if (v === false || v === 0 || v === '0') return 'non';
  const s = String(v).toLowerCase().trim();
  if (['oui', 'yes', 'true', 'o'].includes(s)) return 'oui';
  if (['non', 'no', 'false', 'n'].includes(s)) return 'non';
  return s || 'non_renseigne';
}

const STOP_MOTS = new Set([
  'les', 'des', 'une', 'un', 'pour', 'avec', 'dans', 'pas', 'que', 'qui', 'est',
  'sur', 'plus', 'mais', 'tres', 'the', 'and', 'nous', 'vous', 'par', 'aux', 'ont',
  'son', 'ses', 'mes', 'nos', 'cette', 'cet', 'ces', 'sont', 'fait', 'bien', 'trop',
  'tout', 'toute', 'toutes', 'tous', 'ils', 'elle', 'elles', 'avoir', 'etre', 'cela',
  'donc', 'car', 'ainsi', 'sans', 'chez', 'entre', 'quand', 'comme',
]);

// Nuage de mots (fréquence), accents normalisés, mots > 2 lettres hors stop-mots.
function nuageMots(texts, topN = 30) {
  const freq = {};
  for (const t of texts) {
    const mots = String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/);
    for (const m of mots) {
      if (m.length <= 2 || STOP_MOTS.has(m)) continue;
      freq[m] = (freq[m] || 0) + 1;
    }
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, topN).map(([mot, count]) => ({ mot, count }));
}

const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

/**
 * Restitution AGRÉGÉE d'une campagne, avec seuil d'anonymat.
 * @param {Array} questions  lignes enquete_questions (id, libelle, type, options, ordre)
 * @param {Array<object>} reponsesRows  tableau des objets `reponses` (JSONB) des réponses
 * @param {boolean} anonyme  le modèle est-il anonyme (verbatims bruts autorisés si oui)
 * @returns {object} { n, seuil, sous_seuil, anonyme, questions? }
 *   - si n < SEUIL_ANONYMAT : { n, seuil, sous_seuil: true } SANS aucune distribution.
 *   - sinon : distribution par question (comptages/moyennes ; texte → nuage de mots,
 *     + liste brute UNIQUEMENT si `anonyme`).
 */
function computeResultats(questions, reponsesRows, anonyme) {
  const n = reponsesRows.length;
  if (n < SEUIL_ANONYMAT) {
    return { n, seuil: SEUIL_ANONYMAT, sous_seuil: true };
  }

  const out = (questions || []).slice().sort((a, b) => (a.ordre || 0) - (b.ordre || 0)).map((q) => {
    const key = String(q.id);
    const raw = reponsesRows.map((r) => (r ? r[key] : undefined)).filter((v) => isAnswered(v, q.type));
    const base = { question_id: q.id, libelle: q.libelle, type: q.type, n_reponses: raw.length };

    if (q.type === 'echelle' || q.type === 'note_10') {
      const nums = raw.map(Number).filter((x) => Number.isFinite(x));
      const moyenne = nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : null;
      return {
        ...base, n_reponses: nums.length,
        moyenne: r2(moyenne),
        min: nums.length ? Math.min(...nums) : null,
        max: nums.length ? Math.max(...nums) : null,
        distribution: distribution(nums),
      };
    }
    if (q.type === 'oui_non') {
      return { ...base, distribution: distribution(raw.map(normOuiNon)) };
    }
    if (q.type === 'choix_unique') {
      return { ...base, distribution: distribution(raw.map((v) => String(v))) };
    }
    if (q.type === 'choix_multiple') {
      const flat = [];
      for (const v of raw) { if (Array.isArray(v)) for (const x of v) flat.push(String(x)); }
      return { ...base, distribution: distribution(flat) };
    }
    // texte : agrégat (nuage de mots) toujours ; liste brute SEULEMENT si anonyme.
    const textes = raw.map((v) => String(v));
    const q_out = { ...base, nuage_mots: nuageMots(textes) };
    if (anonyme) q_out.reponses_texte = textes;
    return q_out;
  });

  return { n, seuil: SEUIL_ANONYMAT, sous_seuil: false, anonyme: !!anonyme, questions: out };
}

// ═══════════════════════════════════════════════════════════════════════════
// SURFACE PUBLIQUE — réponse anonyme SANS authentification.
// IMPORTANT : montée AVANT `router.use(authenticate)` (pattern webhook SumUp).
// AUCUNE donnée d'identité n'est collectée pour une campagne anonyme.
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/enquetes/public/:token — modèle + questions d'une campagne OUVERTE.
// 404 si token inconnu ou campagne non ouverte (brouillon/close).
router.get('/public/:token', [param('token').isString().isLength({ min: 8, max: 64 })], validate, async (req, res) => {
  try {
    const c = await pool.query(
      `SELECT c.id, c.titre, c.public_cible, c.statut, c.date_ouverture, c.date_cloture,
              m.id AS modele_id, m.titre AS modele_titre, m.description AS modele_description,
              m.categorie AS modele_categorie, m.anonyme AS modele_anonyme
       FROM enquete_campagnes c
       JOIN enquete_modeles m ON m.id = c.modele_id
       WHERE c.token = $1 AND c.statut = 'ouverte'`,
      [req.params.token]
    );
    if (c.rowCount === 0) return res.status(404).json({ error: 'Enquête introuvable ou clôturée' });
    const camp = c.rows[0];
    const q = await pool.query(
      `SELECT id, ordre, libelle, type, options, obligatoire
       FROM enquete_questions WHERE modele_id = $1 ORDER BY ordre, id`,
      [camp.modele_id]
    );
    res.json({
      campagne: {
        id: camp.id, titre: camp.titre, public_cible: camp.public_cible,
        statut: camp.statut, date_ouverture: camp.date_ouverture, date_cloture: camp.date_cloture,
      },
      modele: {
        id: camp.modele_id, titre: camp.modele_titre, description: camp.modele_description,
        categorie: camp.modele_categorie, anonyme: camp.modele_anonyme,
      },
      questions: q.rows,
    });
  } catch (err) {
    console.error('[ENQUETES] GET public :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/enquetes/public/:token — enregistre une réponse ANONYME.
// Refuse si campagne non 'ouverte' (403) ; valide les questions obligatoires (400) ;
// jeton d'unicité facultatif anti-doublon (409). Aucune identité collectée.
router.post('/public/:token', [
  param('token').isString().isLength({ min: 8, max: 64 }),
  body('reponses').isObject(),
  body('jeton_unicite').optional({ nullable: true }).isString().isLength({ max: 80 }),
], validate, async (req, res) => {
  try {
    const c = await pool.query(
      `SELECT c.id, c.statut, c.modele_id, m.anonyme
       FROM enquete_campagnes c JOIN enquete_modeles m ON m.id = c.modele_id
       WHERE c.token = $1`,
      [req.params.token]
    );
    if (c.rowCount === 0) return res.status(404).json({ error: 'Enquête introuvable' });
    const camp = c.rows[0];
    if (camp.statut !== 'ouverte') return res.status(403).json({ error: 'Cette enquête n\'est pas ouverte aux réponses' });

    const q = await pool.query(
      `SELECT id, libelle, type, obligatoire FROM enquete_questions WHERE modele_id = $1`,
      [camp.modele_id]
    );
    const reponses = req.body.reponses || {};
    // Validation des questions obligatoires (côté serveur, anti-contournement UI).
    const manquantes = q.rows
      .filter((qq) => qq.obligatoire && !isAnswered(reponses[String(qq.id)], qq.type))
      .map((qq) => ({ question_id: qq.id, libelle: qq.libelle }));
    if (manquantes.length) {
      return res.status(400).json({ error: 'Des questions obligatoires sont sans réponse', manquantes });
    }

    const jeton = req.body.jeton_unicite || null;
    const r = await pool.query(
      `INSERT INTO enquete_reponses (campagne_id, jeton_unicite, reponses)
       VALUES ($1, $2, $3::jsonb) RETURNING id, submitted_at`,
      [camp.id, jeton, JSON.stringify(reponses)]
    );
    res.status(201).json({ received: true, id: r.rows[0].id, submitted_at: r.rows[0].submitted_at });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Une réponse a déjà été enregistrée avec ce jeton' });
    console.error('[ENQUETES] POST public :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// À partir d'ici : AUTHENTIFICATION obligatoire (administration des enquêtes).
// ═══════════════════════════════════════════════════════════════════════════
router.use(authenticate);
router.use(autoLogActivity('enquetes'));

const READ = authorize('ADMIN', 'MANAGER', 'RH', 'QHSE');
const WRITE = authorize('ADMIN', 'RH', 'MANAGER', 'QHSE');

// ───────────────────────────────────────────────────────────────────────────
// MODÈLES
// ───────────────────────────────────────────────────────────────────────────
router.get('/modeles', READ, async (req, res) => {
  try {
    const conds = [];
    const params = [];
    if (req.query.categorie && CATEGORIES.includes(req.query.categorie)) {
      params.push(req.query.categorie); conds.push(`m.categorie = $${params.length}`);
    }
    if (req.query.actif === '1' || req.query.actif === '0') {
      params.push(req.query.actif === '1'); conds.push(`m.actif = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT m.*,
              (SELECT COUNT(*)::int FROM enquete_questions q WHERE q.modele_id = m.id) AS nb_questions,
              (SELECT COUNT(*)::int FROM enquete_campagnes c WHERE c.modele_id = m.id) AS nb_campagnes
       FROM enquete_modeles m ${where}
       ORDER BY m.actif DESC, m.created_at DESC, m.id DESC`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[ENQUETES] GET modeles :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/modeles/:id', READ, [param('id').isInt()], validate, async (req, res) => {
  try {
    const m = await pool.query('SELECT * FROM enquete_modeles WHERE id = $1', [req.params.id]);
    if (m.rowCount === 0) return res.status(404).json({ error: 'Modèle introuvable' });
    const q = await pool.query(
      `SELECT id, ordre, libelle, type, options, obligatoire FROM enquete_questions
       WHERE modele_id = $1 ORDER BY ordre, id`,
      [req.params.id]
    );
    res.json({ ...m.rows[0], questions: q.rows });
  } catch (err) {
    console.error('[ENQUETES] GET modele :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/modeles', WRITE, [
  body('titre').isString().trim().notEmpty(),
  body('description').optional({ nullable: true }).isString(),
  body('categorie').optional().isIn(CATEGORIES),
  body('anonyme').optional().isBoolean(),
  body('actif').optional().isBoolean(),
], validate, async (req, res) => {
  try {
    const { titre, description = null, categorie = 'autre', anonyme = true, actif = true } = req.body;
    const r = await pool.query(
      `INSERT INTO enquete_modeles (titre, description, categorie, anonyme, actif, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [titre.trim(), description, categorie, anonyme, actif, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[ENQUETES] POST modele :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/modeles/:id', WRITE, [
  param('id').isInt(),
  body('titre').optional().isString().trim().notEmpty(),
  body('categorie').optional().isIn(CATEGORIES),
  body('anonyme').optional().isBoolean(),
  body('actif').optional().isBoolean(),
], validate, async (req, res) => {
  try {
    const fields = ['titre', 'description', 'categorie', 'anonyme', 'actif'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        params.push(req.body[f]); sets.push(`${f} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Aucune modification' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE enquete_modeles SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Modèle introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[ENQUETES] PUT modele :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/modeles/:id', WRITE, [param('id').isInt()], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM enquete_modeles WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Modèle introuvable' });
    res.json({ message: 'Modèle supprimé', id: r.rows[0].id });
  } catch (err) {
    // 23503 : des campagnes (preuve datée) référencent ce modèle → suppression refusée.
    if (err.code === '23503') return res.status(409).json({ error: 'Des campagnes utilisent ce modèle — supprimez-les d\'abord' });
    console.error('[ENQUETES] DELETE modele :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// QUESTIONS (imbriquées sous un modèle)
// ───────────────────────────────────────────────────────────────────────────
router.post('/modeles/:id/questions', WRITE, [
  param('id').isInt(),
  body('libelle').isString().trim().notEmpty(),
  body('type').isIn(TYPES_QUESTION),
  body('ordre').optional().isInt(),
  body('options').optional({ nullable: true }).isArray(),
  body('obligatoire').optional().isBoolean(),
], validate, async (req, res) => {
  try {
    const { libelle, type, ordre = 0, options = [], obligatoire = false } = req.body;
    const r = await pool.query(
      `INSERT INTO enquete_questions (modele_id, ordre, libelle, type, options, obligatoire)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *`,
      [req.params.id, ordre, libelle.trim(), type, JSON.stringify(options || []), obligatoire]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(404).json({ error: 'Modèle introuvable' });
    console.error('[ENQUETES] POST question :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/modeles/:id/questions/:qid', WRITE, [
  param('id').isInt(), param('qid').isInt(),
  body('type').optional().isIn(TYPES_QUESTION),
  body('options').optional({ nullable: true }).isArray(),
  body('obligatoire').optional().isBoolean(),
  body('ordre').optional().isInt(),
], validate, async (req, res) => {
  try {
    const fields = ['ordre', 'libelle', 'type', 'obligatoire'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        params.push(req.body[f]); sets.push(`${f} = $${params.length}`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'options')) {
      params.push(JSON.stringify(req.body.options || [])); sets.push(`options = $${params.length}::jsonb`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Aucune modification' });
    params.push(req.params.qid, req.params.id);
    const r = await pool.query(
      `UPDATE enquete_questions SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length - 1} AND modele_id = $${params.length} RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Question introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[ENQUETES] PUT question :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/modeles/:id/questions/:qid', WRITE, [param('id').isInt(), param('qid').isInt()], validate, async (req, res) => {
  try {
    const r = await pool.query(
      'DELETE FROM enquete_questions WHERE id = $1 AND modele_id = $2 RETURNING id',
      [req.params.qid, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Question introuvable' });
    res.json({ message: 'Question supprimée', id: r.rows[0].id });
  } catch (err) {
    console.error('[ENQUETES] DELETE question :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// CAMPAGNES
// ───────────────────────────────────────────────────────────────────────────
router.get('/campagnes', READ, async (req, res) => {
  try {
    const conds = [];
    const params = [];
    if (req.query.statut && STATUTS_CAMPAGNE.includes(req.query.statut)) {
      params.push(req.query.statut); conds.push(`c.statut = $${params.length}`);
    }
    if (req.query.modele_id) {
      params.push(parseInt(req.query.modele_id, 10)); conds.push(`c.modele_id = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT c.*, m.titre AS modele_titre, m.categorie AS modele_categorie, m.anonyme AS modele_anonyme,
              (SELECT COUNT(*)::int FROM enquete_reponses rp WHERE rp.campagne_id = c.id) AS nb_reponses
       FROM enquete_campagnes c
       JOIN enquete_modeles m ON m.id = c.modele_id
       ${where}
       ORDER BY c.created_at DESC, c.id DESC`,
      params
    );
    res.json(r.rows.map((row) => ({ ...row, lien_public: lienPublic(row.token) })));
  } catch (err) {
    console.error('[ENQUETES] GET campagnes :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/campagnes/:id', READ, [param('id').isInt()], validate, async (req, res) => {
  try {
    const c = await pool.query(
      `SELECT c.*, m.titre AS modele_titre, m.description AS modele_description,
              m.categorie AS modele_categorie, m.anonyme AS modele_anonyme,
              (SELECT COUNT(*)::int FROM enquete_reponses rp WHERE rp.campagne_id = c.id) AS nb_reponses
       FROM enquete_campagnes c JOIN enquete_modeles m ON m.id = c.modele_id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (c.rowCount === 0) return res.status(404).json({ error: 'Campagne introuvable' });
    const q = await pool.query(
      `SELECT id, ordre, libelle, type, options, obligatoire FROM enquete_questions
       WHERE modele_id = $1 ORDER BY ordre, id`,
      [c.rows[0].modele_id]
    );
    res.json({ ...c.rows[0], lien_public: lienPublic(c.rows[0].token), questions: q.rows });
  } catch (err) {
    console.error('[ENQUETES] GET campagne :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/campagnes', WRITE, [
  body('modele_id').isInt(),
  body('titre').isString().trim().notEmpty(),
  body('public_cible').optional({ nullable: true }).isString(),
  body('date_ouverture').optional({ nullable: true }).isISO8601(),
  body('date_cloture').optional({ nullable: true }).isISO8601(),
  body('statut').optional().isIn(STATUTS_CAMPAGNE),
], validate, async (req, res) => {
  try {
    const { modele_id, titre, public_cible = null, date_ouverture = null, date_cloture = null, statut = 'brouillon' } = req.body;
    // Token de campagne imprévisible (hex 32 = 128 bits). La colonne a un DEFAULT
    // gen_random_bytes en repli, mais on le fixe côté applicatif (prévisible/testable).
    const token = crypto.randomBytes(16).toString('hex');
    const r = await pool.query(
      `INSERT INTO enquete_campagnes (modele_id, titre, public_cible, token, date_ouverture, date_cloture, statut, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [modele_id, titre.trim(), public_cible, token, date_ouverture, date_cloture, statut, req.user.id]
    );
    res.status(201).json({ ...r.rows[0], lien_public: lienPublic(r.rows[0].token) });
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Modèle inconnu' });
    console.error('[ENQUETES] POST campagne :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/campagnes/:id', WRITE, [
  param('id').isInt(),
  body('titre').optional().isString().trim().notEmpty(),
  body('public_cible').optional({ nullable: true }).isString(),
  body('date_ouverture').optional({ nullable: true }).isISO8601(),
  body('date_cloture').optional({ nullable: true }).isISO8601(),
  body('statut').optional().isIn(STATUTS_CAMPAGNE),
], validate, async (req, res) => {
  try {
    // Contrôle de transition de statut (brouillon → ouverte → close).
    if (Object.prototype.hasOwnProperty.call(req.body, 'statut')) {
      const cur = await pool.query('SELECT statut FROM enquete_campagnes WHERE id = $1', [req.params.id]);
      if (cur.rowCount === 0) return res.status(404).json({ error: 'Campagne introuvable' });
      const from = cur.rows[0].statut;
      const to = req.body.statut;
      if (from !== to && !(TRANSITIONS[from] || []).includes(to)) {
        return res.status(409).json({ error: `Transition de statut invalide (${from} → ${to})` });
      }
    }
    const fields = ['titre', 'public_cible', 'date_ouverture', 'date_cloture', 'statut'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        params.push(req.body[f]); sets.push(`${f} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Aucune modification' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE enquete_campagnes SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Campagne introuvable' });
    res.json({ ...r.rows[0], lien_public: lienPublic(r.rows[0].token) });
  } catch (err) {
    console.error('[ENQUETES] PUT campagne :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/campagnes/:id', WRITE, [param('id').isInt()], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM enquete_campagnes WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Campagne introuvable' });
    res.json({ message: 'Campagne supprimée', id: r.rows[0].id });
  } catch (err) {
    console.error('[ENQUETES] DELETE campagne :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// RÉSULTATS — restitution AGRÉGÉE avec SEUIL D'ANONYMAT n ≥ 5
// ───────────────────────────────────────────────────────────────────────────

// Charge campagne + questions + réponses ; renvoie { camp, questions, reponsesRows }.
async function loadCampagneResultats(id) {
  const c = await pool.query(
    `SELECT c.id, c.titre, c.public_cible, c.statut, c.date_ouverture, c.date_cloture, c.modele_id,
            m.titre AS modele_titre, m.categorie AS modele_categorie, m.anonyme AS modele_anonyme
     FROM enquete_campagnes c JOIN enquete_modeles m ON m.id = c.modele_id
     WHERE c.id = $1`,
    [id]
  );
  if (c.rowCount === 0) return null;
  const camp = c.rows[0];
  const q = await pool.query(
    'SELECT id, ordre, libelle, type, options FROM enquete_questions WHERE modele_id = $1 ORDER BY ordre, id',
    [camp.modele_id]
  );
  const rp = await pool.query('SELECT reponses FROM enquete_reponses WHERE campagne_id = $1', [id]);
  return { camp, questions: q.rows, reponsesRows: rp.rows.map((x) => x.reponses || {}) };
}

// GET /campagnes/:id/resultats/export?format=csv — export CSV agrégé (AVANT :id/resultats
// n'est pas nécessaire, segments distincts — mais placé avant par lisibilité).
router.get('/campagnes/:id/resultats/export', READ, [param('id').isInt()], validate, async (req, res) => {
  try {
    const data = await loadCampagneResultats(req.params.id);
    if (!data) return res.status(404).json({ error: 'Campagne introuvable' });
    const agg = computeResultats(data.questions, data.reponsesRows, data.camp.modele_anonyme);

    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    let lines;
    if (agg.sous_seuil) {
      // Seuil d'anonymat : aucun détail restitué.
      lines = [['Information'], [`Sous le seuil d'anonymat (n=${agg.n} < ${agg.seuil}) : aucun détail restitué`]];
    } else {
      lines = [['Question', 'Type', 'Nb réponses', 'Valeur/Modalité', 'Compte/Moyenne']];
      for (const qq of agg.questions) {
        if (qq.type === 'echelle' || qq.type === 'note_10') {
          lines.push([qq.libelle, qq.type, qq.n_reponses, 'moyenne', qq.moyenne]);
          for (const [val, cnt] of Object.entries(qq.distribution || {})) lines.push([qq.libelle, qq.type, qq.n_reponses, val, cnt]);
        } else if (qq.type === 'texte') {
          lines.push([qq.libelle, qq.type, qq.n_reponses, 'nuage de mots', (qq.nuage_mots || []).map((w) => `${w.mot}(${w.count})`).join(' ')]);
        } else {
          for (const [val, cnt] of Object.entries(qq.distribution || {})) lines.push([qq.libelle, qq.type, qq.n_reponses, val, cnt]);
        }
      }
    }
    const csv = '﻿' + lines.map((row) => row.map(esc).join(';')).join('\n') + '\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=enquete_resultats_${req.params.id}_${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csv);
  } catch (err) {
    console.error('[ENQUETES] export resultats :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /campagnes/:id/resultats — restitution agrégée (seuil n ≥ 5).
router.get('/campagnes/:id/resultats', READ, [param('id').isInt()], validate, async (req, res) => {
  try {
    const data = await loadCampagneResultats(req.params.id);
    if (!data) return res.status(404).json({ error: 'Campagne introuvable' });
    const agg = computeResultats(data.questions, data.reponsesRows, data.camp.modele_anonyme);
    res.json({
      campagne: {
        id: data.camp.id, titre: data.camp.titre, public_cible: data.camp.public_cible,
        statut: data.camp.statut, date_ouverture: data.camp.date_ouverture, date_cloture: data.camp.date_cloture,
        modele_titre: data.camp.modele_titre, categorie: data.camp.modele_categorie, anonyme: data.camp.modele_anonyme,
      },
      generated_at: new Date().toISOString(),
      ...agg,
    });
  } catch (err) {
    console.error('[ENQUETES] GET resultats :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Oracles exposés pour les tests (comme energie.computeConsommation100km).
router.computeResultats = computeResultats;
router.nuageMots = nuageMots;
router.SEUIL_ANONYMAT = SEUIL_ANONYMAT;

module.exports = router;
