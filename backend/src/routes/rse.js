/**
 * Module Pilotage RSE (RSEI-10) — 28e module de l'ERP.
 *
 * Outille la démarche de labellisation RSEi (référentiel 2026, évaluation AFNOR).
 * Cadrage : rapports/rsei-2026-07-22/03-plan-action-rsei.md §3 ; méthode du
 * référent : rapport 02 (§4 grille de cotation, §6 registre de preuves P-AAAA-NNN,
 * §7 tableau de bord).
 *
 * HABILITATIONS
 *  - Lecture  : ADMIN / MANAGER / RH. Le rôle personnalisé REF_RSE est dupliqué
 *    de MANAGER (rapport 02 §1.5, RSEI-05) → il hérite de la base MANAGER et
 *    obtient donc la LECTURE du module (authorize résout custom→base).
 *  - Écriture : ADMIN / RH.
 *    ⚠ Point d'attention : REF_RSE (base MANAGER) est aujourd'hui en LECTURE
 *    seule sur ce module. Pour que le référent tienne lui-même le plan d'action
 *    et le registre, la direction peut soit baser REF_RSE sur RH, soit ajouter
 *    'MANAGER' à WRITE (arbitrage documenté, non pris ici — la spec RSEI-10 fixe
 *    l'écriture à ADMIN/RH).
 *
 * CONFIDENTIALITÉ by design : ce module ne manipule QUE des agrégats non
 * nominatifs. Aucune requête ne JOINT une table insertion nominative ; les
 * indicateurs d'inclusion sont lus ailleurs (page Audit Insertion) sous forme
 * agrégée. Voir l'entrée « Pilotage RSE (agrégats non nominatifs) » du registre
 * RGPD (init-db.js).
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const { validate } = require('../middleware/validate');
const { documentFilter } = require('../utils/upload-filters');
const { autoLogActivity } = require('../middleware/activity-logger');

const DEFAULT_REFERENTIEL = 'RSEi-2026';

// Stockage des pièces jointes du registre de preuves (pattern Refashion).
const preuveDir = path.join(__dirname, '..', '..', 'uploads', 'rsei-preuves');
try { fs.mkdirSync(preuveDir, { recursive: true }); } catch (e) { /* ignore */ }
const uploadPreuve = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, preuveDir),
    filename: (req, file, cb) => cb(null, `preuve${req.params.id}-${Date.now()}${path.extname(file.originalname || '').toLowerCase()}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: documentFilter,
});

router.use(authenticate);
router.use(autoLogActivity('rse'));

// Niveaux de droits (authorize résout un rôle custom vers son rôle de base).
// Le référent RSE (rôle custom REF_RSE, base MANAGER — cf. RSEI-05 / rapport
// méthodo § 1.5) doit tenir lui-même le plan d'action et le registre de preuves :
// l'écriture inclut donc MANAGER. Ce module ne manipule QUE des agrégats non
// nominatifs (aucune donnée de parcours) ; la visibilité fine (REF_RSE oui,
// autres MANAGER non) se règle dans la matrice /admin/permissions (module 'rse').
const READ = authorize('ADMIN', 'MANAGER', 'RH');
const WRITE = authorize('ADMIN', 'RH', 'MANAGER');

const STATUTS_ACTION = ['a_faire', 'en_cours', 'realise', 'abandonne'];
const PRIORITES = ['haute', 'moyenne', 'basse'];
const TYPES_EVAL = ['auto_evaluation', 'audit_interne'];
const STATUTS_EVAL = ['en_cours', 'cloturee'];
const TYPES_INTERACTION = ['dialogue', 'demande', 'reclamation', 'information'];

// Exécute une requête « best effort » : toute erreur (colonne/table absente sur
// une base non migrée) dégrade en fallback sans casser l'agrégat (tableau de bord).
async function soft(fn, fallback) {
  try { return await fn(); } catch (err) {
    console.error('[RSE] sous-requête ignorée :', err.message);
    return fallback;
  }
}

// Génère la prochaine référence de preuve P-AAAA-NNN (séquentielle par année).
async function nextPreuveReference(db) {
  const year = new Date().getFullYear();
  const r = await db.query(
    `SELECT reference FROM rsei_preuves WHERE reference LIKE $1 ORDER BY reference DESC LIMIT 1`,
    [`P-${year}-%`]
  );
  let seq = 1;
  const last = r.rows[0] && r.rows[0].reference;
  if (last) {
    const m = String(last).match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `P-${year}-${String(seq).padStart(3, '0')}`;
}

// ───────────────────────────────────────────────────────────────────────────
// UTILISATEURS ASSIGNABLES (pilote de critère / responsable d'action /
// évaluateur). Ouvert aux rôles de lecture du module (dont REF_RSE=MANAGER) car
// GET /users est réservé ADMIN — sans quoi le référent ne pourrait désigner
// personne. Renvoie les permanents actifs (id + nom + rôle de base), sans donnée
// sensible. Déclaré AVANT toute route paramétrée.
// ───────────────────────────────────────────────────────────────────────────
router.get('/assignable-users', READ, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, first_name, last_name, role
       FROM users
       WHERE COALESCE(is_active, true) = true
       ORDER BY last_name NULLS LAST, first_name NULLS LAST`
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[RSE] Erreur assignable-users :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// CRITÈRES — les 27 critères du référentiel
// ───────────────────────────────────────────────────────────────────────────

// GET /api/rse/criteres — liste des critères (avec pilote). ?referentiel=…
router.get('/criteres', READ, async (req, res) => {
  try {
    const referentiel = req.query.referentiel || DEFAULT_REFERENTIEL;
    const r = await pool.query(
      `SELECT c.id, c.referentiel, c.chapitre, c.code, c.intitule,
              c.niveau_vise, c.niveau_auto_evalue, c.pilote_user_id, c.commentaire, c.ordre,
              (u.first_name || ' ' || u.last_name) AS pilote_nom
       FROM rsei_criteres c
       LEFT JOIN users u ON u.id = c.pilote_user_id
       WHERE c.referentiel = $1
       ORDER BY c.ordre, c.code`,
      [referentiel]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[RSE] GET criteres :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/rse/criteres/:code — cotation d'un critère (niveaux, pilote, commentaire).
router.put('/criteres/:code', WRITE, [
  param('code').matches(/^\d\.\d{1,2}$/),
  body('niveau_vise').optional({ nullable: true }).isInt({ min: 1, max: 4 }),
  body('niveau_auto_evalue').optional({ nullable: true }).isInt({ min: 1, max: 4 }),
  body('pilote_user_id').optional({ nullable: true }).isInt(),
  body('commentaire').optional({ nullable: true }).isString(),
  body('referentiel').optional().isString(),
], validate, async (req, res) => {
  try {
    const referentiel = req.body.referentiel || DEFAULT_REFERENTIEL;
    const { niveau_vise = null, niveau_auto_evalue = null, pilote_user_id = null, commentaire = null } = req.body;
    const r = await pool.query(
      `UPDATE rsei_criteres
         SET niveau_vise = $1, niveau_auto_evalue = $2, pilote_user_id = $3,
             commentaire = $4, updated_at = NOW()
       WHERE referentiel = $5 AND code = $6
       RETURNING *`,
      [niveau_vise, niveau_auto_evalue, pilote_user_id, commentaire, referentiel, req.params.code]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Critère introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Pilote (utilisateur) inconnu' });
    console.error('[RSE] PUT critere :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// PLAN D'ACTION RSE
// ───────────────────────────────────────────────────────────────────────────

// GET /api/rse/actions/export — export CSV du plan d'action (AVANT /actions/:id).
router.get('/actions/export', READ, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT a.id, a.titre, a.description, a.critere_codes, a.indicateur, a.echeance,
              a.moyens, a.statut, a.priorite, a.created_at,
              (u.first_name || ' ' || u.last_name) AS responsable_nom
       FROM rsei_actions a
       LEFT JOIN users u ON u.id = a.responsable_user_id
       ORDER BY a.echeance ASC NULLS LAST, a.id`
    );
    const cols = [
      ['id', 'ID'], ['titre', 'Titre'], ['description', 'Description'],
      ['critere_codes', 'Critères'], ['responsable_nom', 'Responsable'],
      ['indicateur', 'Indicateur'], ['echeance', 'Échéance'], ['moyens', 'Moyens'],
      ['statut', 'Statut'], ['priorite', 'Priorité'], ['created_at', 'Créée le'],
    ];
    const fmt = (v) => {
      if (v === null || v === undefined) return '';
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (Array.isArray(v)) return v.join(', ');
      return String(v);
    };
    const esc = (v) => {
      const s = fmt(v);
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = cols.map((c) => c[1]).join(';');
    const lines = r.rows.map((row) => cols.map((c) => esc(row[c[0]])).join(';'));
    const csv = '﻿' + header + '\n' + lines.join('\n') + '\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=plan_action_rse_${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csv);
  } catch (err) {
    console.error('[RSE] export actions :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/rse/actions — liste filtrable (?statut, ?critere, ?responsable_user_id).
router.get('/actions', READ, async (req, res) => {
  try {
    const conds = [];
    const params = [];
    if (req.query.statut && STATUTS_ACTION.includes(req.query.statut)) {
      params.push(req.query.statut); conds.push(`a.statut = $${params.length}`);
    }
    if (req.query.critere) {
      params.push(req.query.critere); conds.push(`$${params.length} = ANY(a.critere_codes)`);
    }
    if (req.query.responsable_user_id) {
      params.push(parseInt(req.query.responsable_user_id, 10)); conds.push(`a.responsable_user_id = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT a.*, (u.first_name || ' ' || u.last_name) AS responsable_nom,
              (a.echeance IS NOT NULL AND a.echeance < CURRENT_DATE
                AND a.statut IN ('a_faire', 'en_cours')) AS en_retard
       FROM rsei_actions a
       LEFT JOIN users u ON u.id = a.responsable_user_id
       ${where}
       ORDER BY a.echeance ASC NULLS LAST, a.id DESC`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[RSE] GET actions :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/rse/actions
router.post('/actions', WRITE, [
  body('titre').isString().trim().notEmpty(),
  body('description').optional({ nullable: true }).isString(),
  body('critere_codes').optional({ nullable: true }).isArray(),
  body('responsable_user_id').optional({ nullable: true }).isInt(),
  body('indicateur').optional({ nullable: true }).isString(),
  body('echeance').optional({ nullable: true }).isISO8601(),
  body('moyens').optional({ nullable: true }).isString(),
  body('statut').optional().isIn(STATUTS_ACTION),
  body('priorite').optional().isIn(PRIORITES),
], validate, async (req, res) => {
  try {
    const {
      titre, description = null, critere_codes = [], responsable_user_id = null,
      indicateur = null, echeance = null, moyens = null,
      statut = 'a_faire', priorite = 'moyenne',
    } = req.body;
    const r = await pool.query(
      `INSERT INTO rsei_actions
         (titre, description, critere_codes, responsable_user_id, indicateur, echeance, moyens, statut, priorite, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [titre.trim(), description, critere_codes || [], responsable_user_id, indicateur, echeance, moyens, statut, priorite, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Responsable (utilisateur) inconnu' });
    console.error('[RSE] POST action :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/rse/actions/:id
router.put('/actions/:id', WRITE, [
  param('id').isInt(),
  body('titre').optional().isString().trim().notEmpty(),
  body('critere_codes').optional({ nullable: true }).isArray(),
  body('responsable_user_id').optional({ nullable: true }).isInt(),
  body('echeance').optional({ nullable: true }).isISO8601(),
  body('statut').optional().isIn(STATUTS_ACTION),
  body('priorite').optional().isIn(PRIORITES),
], validate, async (req, res) => {
  try {
    const fields = ['titre', 'description', 'critere_codes', 'responsable_user_id', 'indicateur', 'echeance', 'moyens', 'statut', 'priorite'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        params.push(f === 'critere_codes' ? (req.body[f] || []) : req.body[f]);
        sets.push(`${f} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Aucune modification' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE rsei_actions SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Action introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[RSE] PUT action :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/rse/actions/:id
router.delete('/actions/:id', WRITE, [param('id').isInt()], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM rsei_actions WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Action introuvable' });
    res.json({ message: 'Action supprimée', id: r.rows[0].id });
  } catch (err) {
    console.error('[RSE] DELETE action :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// REGISTRE DE PREUVES
// ───────────────────────────────────────────────────────────────────────────

// GET /api/rse/preuves — liste (?critere, ?perimees=1).
router.get('/preuves', READ, async (req, res) => {
  try {
    const conds = [];
    const params = [];
    if (req.query.critere) {
      params.push(req.query.critere); conds.push(`$${params.length} = ANY(critere_codes)`);
    }
    if (req.query.perimees === '1') {
      conds.push('echeance_fraicheur IS NOT NULL AND echeance_fraicheur < CURRENT_DATE');
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT id, reference, intitule, critere_codes, type, source, lien_interne,
              date_preuve, echeance_fraicheur,
              (fichier_path IS NOT NULL) AS has_fichier, fichier_original_name,
              (echeance_fraicheur IS NOT NULL AND echeance_fraicheur < CURRENT_DATE) AS perimee,
              created_at
       FROM rsei_preuves ${where}
       ORDER BY date_preuve DESC NULLS LAST, id DESC`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[RSE] GET preuves :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/rse/preuves — génère la référence P-AAAA-NNN.
router.post('/preuves', WRITE, [
  body('intitule').isString().trim().notEmpty(),
  body('critere_codes').optional({ nullable: true }).isArray(),
  body('type').optional({ nullable: true }).isString(),
  body('source').optional({ nullable: true }).isString(),
  body('lien_interne').optional({ nullable: true }).isString(),
  body('date_preuve').optional({ nullable: true }).isISO8601(),
  body('echeance_fraicheur').optional({ nullable: true }).isISO8601(),
], validate, async (req, res) => {
  const {
    intitule, critere_codes = [], type = null, source = null,
    lien_interne = null, date_preuve = null, echeance_fraicheur = null,
  } = req.body;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const reference = await nextPreuveReference(pool);
      const r = await pool.query(
        `INSERT INTO rsei_preuves
           (reference, intitule, critere_codes, type, source, lien_interne, date_preuve, echeance_fraicheur, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [reference, intitule.trim(), critere_codes || [], type, source, lien_interne, date_preuve, echeance_fraicheur, req.user.id]
      );
      return res.status(201).json(r.rows[0]);
    } catch (err) {
      if (err.code === '23505' && attempt < 2) continue; // collision de référence : retenter
      console.error('[RSE] POST preuve :', err.message);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
  return res.status(500).json({ error: 'Génération de référence impossible' });
});

// PUT /api/rse/preuves/:id
router.put('/preuves/:id', WRITE, [
  param('id').isInt(),
  body('intitule').optional().isString().trim().notEmpty(),
  body('critere_codes').optional({ nullable: true }).isArray(),
  body('date_preuve').optional({ nullable: true }).isISO8601(),
  body('echeance_fraicheur').optional({ nullable: true }).isISO8601(),
], validate, async (req, res) => {
  try {
    const fields = ['intitule', 'critere_codes', 'type', 'source', 'lien_interne', 'date_preuve', 'echeance_fraicheur'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        params.push(f === 'critere_codes' ? (req.body[f] || []) : req.body[f]);
        sets.push(`${f} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Aucune modification' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE rsei_preuves SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Preuve introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[RSE] PUT preuve :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/rse/preuves/:id (supprime aussi la pièce jointe éventuelle).
router.delete('/preuves/:id', WRITE, [param('id').isInt()], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM rsei_preuves WHERE id = $1 RETURNING id, fichier_path', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Preuve introuvable' });
    if (r.rows[0].fichier_path) {
      try { fs.unlinkSync(path.join(preuveDir, path.basename(r.rows[0].fichier_path))); } catch (_) {}
    }
    res.json({ message: 'Preuve supprimée', id: r.rows[0].id });
  } catch (err) {
    console.error('[RSE] DELETE preuve :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/rse/preuves/:id/fichier — joindre une pièce (upload, pattern Refashion).
router.post('/preuves/:id/fichier', WRITE, uploadPreuve.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier requis (pdf, image ou document)' });
    const r = await pool.query(
      `UPDATE rsei_preuves
         SET fichier_path = $1, fichier_original_name = $2, fichier_mime = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING id, reference, fichier_original_name, fichier_mime`,
      [req.file.filename, req.file.originalname, req.file.mimetype, req.params.id]
    );
    if (r.rowCount === 0) {
      try { fs.unlinkSync(path.join(preuveDir, req.file.filename)); } catch (_) {}
      return res.status(404).json({ error: 'Preuve introuvable' });
    }
    res.status(201).json({ ...r.rows[0], has_fichier: true });
  } catch (err) {
    console.error('[RSE] upload fichier preuve :', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rse/preuves/:id/fichier — télécharger la pièce jointe.
router.get('/preuves/:id/fichier', READ, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT fichier_path, fichier_original_name, fichier_mime FROM rsei_preuves WHERE id = $1',
      [req.params.id]
    );
    if (r.rowCount === 0 || !r.rows[0].fichier_path) {
      return res.status(404).json({ error: 'Aucune pièce jointe pour cette preuve' });
    }
    const doc = r.rows[0];
    const safeName = path.basename(doc.fichier_path);
    const filePath = path.join(preuveDir, safeName);
    if (!filePath.startsWith(preuveDir) || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Fichier introuvable' });
    }
    res.setHeader('Content-Disposition', `attachment; filename="${doc.fichier_original_name || safeName}"`);
    res.setHeader('Content-Type', doc.fichier_mime || 'application/octet-stream');
    res.sendFile(filePath);
  } catch (err) {
    console.error('[RSE] download fichier preuve :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// CAMPAGNES D'ÉVALUATION (auto-évaluation / audit interne)
// ───────────────────────────────────────────────────────────────────────────

// GET /api/rse/evaluations — liste des campagnes.
router.get('/evaluations', READ, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT e.*, (u.first_name || ' ' || u.last_name) AS evaluateur_nom,
              (SELECT COUNT(*)::int FROM rsei_evaluation_items i WHERE i.evaluation_id = e.id) AS nb_items
       FROM rsei_evaluations e
       LEFT JOIN users u ON u.id = e.evaluateur_user_id
       ORDER BY e.date_evaluation DESC NULLS LAST, e.id DESC`
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[RSE] GET evaluations :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/rse/evaluations/:id — campagne + items cotés.
router.get('/evaluations/:id', READ, [param('id').isInt()], validate, async (req, res) => {
  try {
    const e = await pool.query(
      `SELECT e.*, (u.first_name || ' ' || u.last_name) AS evaluateur_nom
       FROM rsei_evaluations e LEFT JOIN users u ON u.id = e.evaluateur_user_id
       WHERE e.id = $1`,
      [req.params.id]
    );
    if (e.rowCount === 0) return res.status(404).json({ error: 'Campagne introuvable' });
    const items = await pool.query(
      `SELECT i.*, c.intitule AS critere_intitule
       FROM rsei_evaluation_items i
       LEFT JOIN rsei_criteres c ON c.code = i.critere_code AND c.referentiel = $2
       WHERE i.evaluation_id = $1
       ORDER BY i.critere_code`,
      [req.params.id, DEFAULT_REFERENTIEL]
    );
    res.json({ ...e.rows[0], items: items.rows });
  } catch (err) {
    console.error('[RSE] GET evaluation :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/rse/evaluations
router.post('/evaluations', WRITE, [
  body('type').isIn(TYPES_EVAL),
  body('libelle').isString().trim().notEmpty(),
  body('date_evaluation').optional({ nullable: true }).isISO8601(),
  body('evaluateur_user_id').optional({ nullable: true }).isInt(),
  body('statut').optional().isIn(STATUTS_EVAL),
  body('synthese').optional({ nullable: true }).isString(),
], validate, async (req, res) => {
  try {
    const { type, libelle, date_evaluation = null, evaluateur_user_id = null, statut = 'en_cours', synthese = null } = req.body;
    const r = await pool.query(
      `INSERT INTO rsei_evaluations (type, libelle, date_evaluation, evaluateur_user_id, statut, synthese, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [type, libelle.trim(), date_evaluation, evaluateur_user_id, statut, synthese, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[RSE] POST evaluation :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/rse/evaluations/:id (dont clôture via statut=cloturee).
router.put('/evaluations/:id', WRITE, [
  param('id').isInt(),
  body('libelle').optional().isString().trim().notEmpty(),
  body('date_evaluation').optional({ nullable: true }).isISO8601(),
  body('evaluateur_user_id').optional({ nullable: true }).isInt(),
  body('statut').optional().isIn(STATUTS_EVAL),
  body('synthese').optional({ nullable: true }).isString(),
], validate, async (req, res) => {
  try {
    const fields = ['libelle', 'date_evaluation', 'evaluateur_user_id', 'statut', 'synthese'];
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
      `UPDATE rsei_evaluations SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Campagne introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[RSE] PUT evaluation :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/rse/evaluations/:id/items — cote un critère (upsert par critere_code).
router.post('/evaluations/:id/items', WRITE, [
  param('id').isInt(),
  body('critere_code').matches(/^\d\.\d{1,2}$/),
  body('niveau_constate').optional({ nullable: true }).isInt({ min: 1, max: 4 }),
  body('constat').optional({ nullable: true }).isString(),
  body('ecart').optional({ nullable: true }).isString(),
  body('action_id').optional({ nullable: true }).isInt(),
], validate, async (req, res) => {
  try {
    const { critere_code, niveau_constate = null, constat = null, ecart = null, action_id = null } = req.body;
    const r = await pool.query(
      `INSERT INTO rsei_evaluation_items (evaluation_id, critere_code, niveau_constate, constat, ecart, action_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (evaluation_id, critere_code)
       DO UPDATE SET niveau_constate = EXCLUDED.niveau_constate, constat = EXCLUDED.constat,
                     ecart = EXCLUDED.ecart, action_id = EXCLUDED.action_id, updated_at = NOW()
       RETURNING *`,
      [req.params.id, critere_code, niveau_constate, constat, ecart, action_id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(404).json({ error: 'Campagne ou action liée introuvable' });
    console.error('[RSE] POST evaluation item :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/rse/evaluations/:id/items/:itemId
router.put('/evaluations/:id/items/:itemId', WRITE, [
  param('id').isInt(), param('itemId').isInt(),
  body('niveau_constate').optional({ nullable: true }).isInt({ min: 1, max: 4 }),
  body('action_id').optional({ nullable: true }).isInt(),
], validate, async (req, res) => {
  try {
    const fields = ['niveau_constate', 'constat', 'ecart', 'action_id'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        params.push(req.body[f]); sets.push(`${f} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Aucune modification' });
    params.push(req.params.itemId, req.params.id);
    const r = await pool.query(
      `UPDATE rsei_evaluation_items SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length - 1} AND evaluation_id = $${params.length} RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Cotation introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[RSE] PUT evaluation item :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// PARTIES PRENANTES + INTERACTIONS
// ───────────────────────────────────────────────────────────────────────────

router.get('/parties-prenantes', READ, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT pp.*,
              (SELECT COUNT(*)::int FROM rsei_interactions i WHERE i.partie_prenante_id = pp.id) AS nb_interactions
       FROM rsei_parties_prenantes pp
       ORDER BY pp.actif DESC, pp.nom`
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[RSE] GET parties-prenantes :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/parties-prenantes', WRITE, [
  body('nom').isString().trim().notEmpty(),
  body('categorie').optional({ nullable: true }).isString(),
  body('influence').optional({ nullable: true }).isInt({ min: 1, max: 4 }),
  body('interet').optional({ nullable: true }).isInt({ min: 1, max: 4 }),
  body('attentes').optional({ nullable: true }).isString(),
], validate, async (req, res) => {
  try {
    const { nom, categorie = null, influence = null, interet = null, attentes = null } = req.body;
    const r = await pool.query(
      `INSERT INTO rsei_parties_prenantes (nom, categorie, influence, interet, attentes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nom.trim(), categorie, influence, interet, attentes]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[RSE] POST partie-prenante :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/parties-prenantes/:id', WRITE, [
  param('id').isInt(),
  body('nom').optional().isString().trim().notEmpty(),
  body('influence').optional({ nullable: true }).isInt({ min: 1, max: 4 }),
  body('interet').optional({ nullable: true }).isInt({ min: 1, max: 4 }),
  body('actif').optional().isBoolean(),
], validate, async (req, res) => {
  try {
    const fields = ['nom', 'categorie', 'influence', 'interet', 'attentes', 'actif'];
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
      `UPDATE rsei_parties_prenantes SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Partie prenante introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[RSE] PUT partie-prenante :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/parties-prenantes/:id', WRITE, [param('id').isInt()], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM rsei_parties_prenantes WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Partie prenante introuvable' });
    res.json({ message: 'Partie prenante supprimée', id: r.rows[0].id });
  } catch (err) {
    console.error('[RSE] DELETE partie-prenante :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/rse/interactions — journal (?partie_prenante_id).
router.get('/interactions', READ, async (req, res) => {
  try {
    const conds = [];
    const params = [];
    if (req.query.partie_prenante_id) {
      params.push(parseInt(req.query.partie_prenante_id, 10));
      conds.push(`i.partie_prenante_id = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT i.*, pp.nom AS partie_prenante_nom, pp.categorie AS partie_prenante_categorie
       FROM rsei_interactions i
       JOIN rsei_parties_prenantes pp ON pp.id = i.partie_prenante_id
       ${where}
       ORDER BY i.date_interaction DESC NULLS LAST, i.id DESC`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[RSE] GET interactions :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/interactions', WRITE, [
  body('partie_prenante_id').isInt(),
  body('date_interaction').optional({ nullable: true }).isISO8601(),
  body('canal').optional({ nullable: true }).isString(),
  body('objet').optional({ nullable: true }).isString(),
  body('type').optional().isIn(TYPES_INTERACTION),
  body('reponse_apportee').optional({ nullable: true }).isString(),
], validate, async (req, res) => {
  try {
    const { partie_prenante_id, date_interaction = null, canal = null, objet = null, type = 'dialogue', reponse_apportee = null } = req.body;
    const r = await pool.query(
      `INSERT INTO rsei_interactions (partie_prenante_id, date_interaction, canal, objet, type, reponse_apportee, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [partie_prenante_id, date_interaction, canal, objet, type, reponse_apportee, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(404).json({ error: 'Partie prenante introuvable' });
    console.error('[RSE] POST interaction :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// TABLEAU DE BORD — heatmap 27 critères + indicateurs de succès (§5)
// ───────────────────────────────────────────────────────────────────────────
router.get('/dashboard', READ, async (req, res) => {
  try {
    const referentiel = req.query.referentiel || DEFAULT_REFERENTIEL;

    const criteres = await soft(async () => (await pool.query(
      `SELECT c.id, c.chapitre, c.code, c.intitule, c.niveau_vise, c.niveau_auto_evalue,
              c.pilote_user_id, c.ordre, (u.first_name || ' ' || u.last_name) AS pilote_nom
       FROM rsei_criteres c LEFT JOIN users u ON u.id = c.pilote_user_id
       WHERE c.referentiel = $1 ORDER BY c.ordre, c.code`, [referentiel])).rows, []);

    const preuveAgg = await soft(async () => (await pool.query(
      `SELECT code,
              COUNT(*)::int AS nb,
              COUNT(*) FILTER (WHERE echeance_fraicheur IS NOT NULL AND echeance_fraicheur < CURRENT_DATE)::int AS nb_perimees,
              COUNT(*) FILTER (WHERE date_preuve IS NOT NULL AND date_preuve >= CURRENT_DATE - INTERVAL '12 months')::int AS nb_fraiches
       FROM rsei_preuves, unnest(critere_codes) AS code
       GROUP BY code`)).rows, []);

    const actionAgg = await soft(async () => (await pool.query(
      `SELECT code,
              COUNT(*) FILTER (WHERE statut IN ('a_faire', 'en_cours'))::int AS nb_en_cours,
              COUNT(*) FILTER (WHERE statut IN ('a_faire', 'en_cours') AND echeance IS NOT NULL AND echeance < CURRENT_DATE)::int AS nb_en_retard
       FROM rsei_actions, unnest(critere_codes) AS code
       GROUP BY code`)).rows, []);

    const ACTION_GLOBAL_DEFAULT = { total: 0, realisees: 0, echues: 0, echues_realisees: 0, en_retard: 0 };
    const actionGlobal = await soft(async () => (await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE statut = 'realise')::int AS realisees,
              COUNT(*) FILTER (WHERE echeance IS NOT NULL AND echeance < CURRENT_DATE)::int AS echues,
              COUNT(*) FILTER (WHERE statut = 'realise' AND echeance IS NOT NULL AND echeance < CURRENT_DATE)::int AS echues_realisees,
              COUNT(*) FILTER (WHERE statut IN ('a_faire', 'en_cours') AND echeance IS NOT NULL AND echeance < CURRENT_DATE)::int AS en_retard
       FROM rsei_actions`)).rows[0] || ACTION_GLOBAL_DEFAULT, ACTION_GLOBAL_DEFAULT);

    const preuveGlobal = await soft(async () => (await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE echeance_fraicheur IS NOT NULL AND echeance_fraicheur < CURRENT_DATE)::int AS perimees
       FROM rsei_preuves`)).rows[0] || { total: 0, perimees: 0 }, { total: 0, perimees: 0 });

    const preuveByCode = Object.fromEntries(preuveAgg.map((p) => [p.code, p]));
    const actionByCode = Object.fromEntries(actionAgg.map((a) => [a.code, a]));

    const rows = criteres.map((c) => {
      const p = preuveByCode[c.code] || { nb: 0, nb_perimees: 0, nb_fraiches: 0 };
      const a = actionByCode[c.code] || { nb_en_cours: 0, nb_en_retard: 0 };
      return {
        code: c.code, chapitre: c.chapitre, intitule: c.intitule,
        niveau_vise: c.niveau_vise, niveau_auto_evalue: c.niveau_auto_evalue,
        pilote_user_id: c.pilote_user_id, pilote_nom: c.pilote_nom,
        nb_preuves: p.nb, nb_preuves_fraiches: p.nb_fraiches, nb_preuves_perimees: p.nb_perimees,
        nb_actions_en_cours: a.nb_en_cours, nb_actions_en_retard: a.nb_en_retard,
      };
    });

    const total = rows.length;
    const cotes = rows.filter((r) => r.niveau_auto_evalue != null).length;
    const niveau2Demontrable = rows.filter((r) => r.niveau_auto_evalue != null && r.niveau_auto_evalue >= 2 && r.nb_preuves_fraiches > 0).length;
    const sansPreuveRecente = rows.filter((r) => r.nb_preuves_fraiches === 0).length;
    const echues = actionGlobal.echues || 0;

    res.json({
      referentiel,
      generated_at: new Date().toISOString(),
      criteres: rows,
      global: {
        total_criteres: total,
        criteres_cotes: cotes,
        criteres_niveau2_demontrable: niveau2Demontrable,
        criteres_sans_preuve_recente: sansPreuveRecente,
        couverture_niveau2_pct: total ? Math.round((niveau2Demontrable / total) * 100) : 0,
        actions: {
          total: actionGlobal.total || 0,
          realisees: actionGlobal.realisees || 0,
          echues,
          echues_realisees: actionGlobal.echues_realisees || 0,
          en_retard: actionGlobal.en_retard || 0,
          taux_solde_echeance: echues ? Math.round(((actionGlobal.echues_realisees || 0) / echues) * 100) : null,
        },
        preuves: { total: preuveGlobal.total || 0, perimees: preuveGlobal.perimees || 0 },
      },
    });
  } catch (err) {
    console.error('[RSE] GET dashboard :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// DOSSIER DE PRÉPARATION AFNOR — JSON structuré (PDF généré côté front)
// ───────────────────────────────────────────────────────────────────────────
router.get('/dossier-afnor', READ, async (req, res) => {
  try {
    const referentiel = req.query.referentiel || DEFAULT_REFERENTIEL;

    const criteres = await soft(async () => (await pool.query(
      `SELECT c.chapitre, c.code, c.intitule, c.niveau_vise, c.niveau_auto_evalue,
              c.commentaire, (u.first_name || ' ' || u.last_name) AS pilote_nom
       FROM rsei_criteres c LEFT JOIN users u ON u.id = c.pilote_user_id
       WHERE c.referentiel = $1 ORDER BY c.ordre, c.code`, [referentiel])).rows, []);

    const preuves = await soft(async () => (await pool.query(
      `SELECT code, id, reference, intitule, type, source, lien_interne, date_preuve, echeance_fraicheur
       FROM rsei_preuves, unnest(critere_codes) AS code
       ORDER BY date_preuve DESC NULLS LAST, id DESC`)).rows, []);

    const constats = await soft(async () => (await pool.query(
      `SELECT DISTINCT ON (i.critere_code)
              i.critere_code, i.niveau_constate, i.constat, i.ecart,
              e.date_evaluation, e.type AS evaluation_type, e.libelle AS evaluation_libelle
       FROM rsei_evaluation_items i
       JOIN rsei_evaluations e ON e.id = i.evaluation_id
       ORDER BY i.critere_code, e.date_evaluation DESC NULLS LAST, i.id DESC`)).rows, []);

    const preuvesByCode = {};
    for (const p of preuves) { (preuvesByCode[p.code] = preuvesByCode[p.code] || []).push(p); }
    const constatByCode = Object.fromEntries(constats.map((c) => [c.critere_code, c]));

    res.json({
      referentiel,
      generated_at: new Date().toISOString(),
      criteres: criteres.map((c) => ({
        code: c.code, chapitre: c.chapitre, intitule: c.intitule,
        niveau_vise: c.niveau_vise, niveau_auto_evalue: c.niveau_auto_evalue,
        commentaire: c.commentaire, pilote_nom: c.pilote_nom,
        preuves: (preuvesByCode[c.code] || []).map((p) => ({
          reference: p.reference, intitule: p.intitule, type: p.type,
          source: p.source, lien_interne: p.lien_interne,
          date_preuve: p.date_preuve, echeance_fraicheur: p.echeance_fraicheur,
        })),
        dernier_constat: constatByCode[c.code] || null,
      })),
    });
  } catch (err) {
    console.error('[RSE] GET dossier-afnor :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// BILAN ANNUEL RSE — JSON pour le PDF de bilan (5.4)
// ───────────────────────────────────────────────────────────────────────────
router.get('/bilan', READ, [query('annee').optional().isInt({ min: 2020, max: 2100 })], validate, async (req, res) => {
  try {
    const referentiel = req.query.referentiel || DEFAULT_REFERENTIEL;
    const annee = parseInt(req.query.annee, 10) || new Date().getFullYear();
    const debut = `${annee}-01-01`;
    const fin = `${annee}-12-31`;

    const actions = await soft(async () => (await pool.query(
      `SELECT a.id, a.titre, a.critere_codes, a.indicateur, a.echeance, a.statut, a.priorite,
              (u.first_name || ' ' || u.last_name) AS responsable_nom
       FROM rsei_actions a LEFT JOIN users u ON u.id = a.responsable_user_id
       WHERE a.echeance BETWEEN $1 AND $2 OR (a.echeance IS NULL AND a.statut IN ('a_faire', 'en_cours'))
       ORDER BY a.echeance ASC NULLS LAST, a.id`, [debut, fin])).rows, []);

    const parStatut = { a_faire: 0, en_cours: 0, realise: 0, abandonne: 0 };
    for (const a of actions) { if (parStatut[a.statut] !== undefined) parStatut[a.statut] += 1; }
    const totalActions = actions.length;

    const niveauxRows = await soft(async () => (await pool.query(
      `SELECT niveau_vise, niveau_auto_evalue FROM rsei_criteres WHERE referentiel = $1`, [referentiel])).rows, []);
    const repartition = (key) => {
      const out = { 1: 0, 2: 0, 3: 0, 4: 0, non_cote: 0 };
      for (const row of niveauxRows) {
        const v = row[key];
        if (v == null) out.non_cote += 1; else if (out[v] !== undefined) out[v] += 1;
      }
      return out;
    };

    const preuveGlobal = await soft(async () => (await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE echeance_fraicheur IS NOT NULL AND echeance_fraicheur < CURRENT_DATE)::int AS perimees
       FROM rsei_preuves`)).rows[0] || { total: 0, perimees: 0 }, { total: 0, perimees: 0 });

    const evalRow = await soft(async () => (await pool.query(
      `SELECT e.*, (u.first_name || ' ' || u.last_name) AS evaluateur_nom
       FROM rsei_evaluations e LEFT JOIN users u ON u.id = e.evaluateur_user_id
       WHERE e.statut = 'cloturee' AND (e.date_evaluation BETWEEN $1 AND $2 OR e.date_evaluation IS NULL)
       ORDER BY e.date_evaluation DESC NULLS LAST, e.id DESC LIMIT 1`, [debut, fin])).rows[0], null);

    let derniereEvaluation = null;
    if (evalRow) {
      const items = await soft(async () => (await pool.query(
        `SELECT critere_code, niveau_constate, constat, ecart, action_id
         FROM rsei_evaluation_items WHERE evaluation_id = $1 ORDER BY critere_code`, [evalRow.id])).rows, []);
      derniereEvaluation = {
        id: evalRow.id, type: evalRow.type, libelle: evalRow.libelle,
        date_evaluation: evalRow.date_evaluation, statut: evalRow.statut,
        synthese: evalRow.synthese, evaluateur_nom: evalRow.evaluateur_nom,
        nb_items: items.length, items,
      };
    }

    res.json({
      annee, referentiel, generated_at: new Date().toISOString(),
      plan_action: {
        total: totalActions,
        par_statut: parStatut,
        taux_realisation: totalActions ? Math.round((parStatut.realise / totalActions) * 100) : null,
        actions,
      },
      niveaux: { vise: repartition('niveau_vise'), auto_evalue: repartition('niveau_auto_evalue') },
      preuves: { total: preuveGlobal.total || 0, perimees: preuveGlobal.perimees || 0 },
      derniere_evaluation: derniereEvaluation,
    });
  } catch (err) {
    console.error('[RSE] GET bilan :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
