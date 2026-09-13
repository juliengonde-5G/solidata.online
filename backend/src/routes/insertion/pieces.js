/**
 * Pièces du dossier d'insertion (`/api/insertion/pieces`) — PR A, lot 1.
 *
 * ⚠ PÉRIMÈTRE VOLONTAIREMENT ÉTROIT — la liste des types est FERMÉE et ne
 * comporte AUCUN justificatif d'éligibilité (amendement du plan 07 § 9) :
 * ces pièces vivent sur « Les Emplois de l'inclusion », et une notification de
 * droits porte bien plus que le critère qu'elle prouve (montant, composition du
 * foyer, parfois la santé). L'outil n'en garde que la RÉFÉRENCE, saisie dans le
 * dossier administratif. Ne restent ici que les pièces dont la structure est
 * SEULE dépositaire : l'exemplaire signé d'un entretien (RES-03), une
 * convention PMSMP, un accusé de remise de document.
 *
 * Trois décisions de stockage, et pourquoi :
 *  1. CONTENU EN BASE (BYTEA) et non sous `/uploads` — ce répertoire est servi
 *     statiquement : un entretien signé y serait accessible par simple URL.
 *     Même arbitrage que les signatures de bordereaux de déchèterie (2.50.0).
 *  2. TYPE VÉRIFIÉ PAR LES OCTETS D'EN-TÊTE, pas par le type déclaré : le MIME
 *     d'un envoi multipart est fourni par le navigateur, donc par l'appelant.
 *     Un fichier HTML annoncé « application/pdf » passerait un filtre MIME seul
 *     et deviendrait une chaîne stored XSS (audit T1.1) ; les en-têtes
 *     `nosniff` protègent le service, la vérification protège le stock.
 *  3. `no-store` au service : une pièce signée n'a rien à faire dans un cache
 *     partagé, ni dans l'historique d'un poste mutualisé.
 *
 * Habilitations : ADMIN/RH sur les quatre routes. Un MANAGER n'atteint aucune
 * pièce — un entretien signé est du texte libre scanné, le masquage par champ
 * ne peut rien contre une image (doctrine des notes de suivi, 2.47.0).
 */

'use strict';

const express = require('express');

const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { param } = require('express-validator');
const { validate } = require('../../middleware/validate');

const ADMIN_RH = authorize('ADMIN', 'RH');
const TAILLE_MAX = 5 * 1024 * 1024; // 5 Mo — doublé par un CHECK en base
const TYPES_PIECE = ['entretien_signe', 'convention_pmsmp', 'accuse_remise', 'autre'];

/** Libellés d'écran (le front les reprend tels quels). */
const TYPE_LABELS = {
  entretien_signe: 'Exemplaire signé d\'un entretien',
  convention_pmsmp: 'Convention PMSMP',
  accuse_remise: 'Accusé de remise de document',
  autre: 'Autre pièce',
};

/**
 * Signatures d'en-tête des trois seuls formats acceptés. On lit les OCTETS,
 * jamais l'extension ni le MIME déclaré : les deux sont fournis par l'appelant.
 */
const SIGNATURES = [
  { mime: 'application/pdf', magic: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]) }, // %PDF-
  { mime: 'image/jpeg', magic: Buffer.from([0xff, 0xd8, 0xff]) },
  { mime: 'image/png', magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
];

/**
 * Type RÉEL d'un tampon, ou null s'il n'est pas l'un des trois formats admis.
 * Module de décision PUR : aucune E/S, testable seul.
 * @param {Buffer} buf
 * @returns {'application/pdf'|'image/jpeg'|'image/png'|null}
 */
function typeReel(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return null;
  for (const s of SIGNATURES) {
    if (buf.length >= s.magic.length && buf.subarray(0, s.magic.length).equals(s.magic)) return s.mime;
  }
  return null;
}

// Stockage MÉMOIRE : le fichier ne touche jamais le disque du conteneur — il
// n'y aurait aucun moment où il serait à la fois écrit et protégé.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: TAILLE_MAX, files: 1 } });

/** Exécute multer en transformant ses erreurs en 400 français. */
function runUpload(req, res, next) {
  upload.single('fichier')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Fichier trop volumineux : 5 Mo maximum.' });
    }
    return res.status(400).json({ error: `Envoi refusé : ${err.message}` });
  });
}

/** Journal RGPD des pièces — jamais le contenu, jamais le fichier. */
async function journaliser(req, action, employeeId, details) {
  try {
    await pool.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user && req.user.id != null ? req.user.id : null, action, 'insertion_pieces', employeeId,
        JSON.stringify({ employee_id: employeeId, ...(details || {}) })]
    );
  } catch (e) {
    console.error(`[INSERTION] Journalisation ${action} impossible :`, e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/insertion/pieces/:employeeId — métadonnées SEULEMENT
// ═══════════════════════════════════════════════════════════════════════════
router.get('/:employeeId', ADMIN_RH, [
  param('employeeId').isInt().withMessage('Identifiant de salarié invalide'),
], validate, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.id, p.type, p.nom_fichier, p.mime, p.taille, p.milestone_id, p.pmsmp_id, p.created_at,
              NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS depose_par_nom
         FROM insertion_pieces p
         LEFT JOIN users u ON u.id = p.depose_par
        WHERE p.employee_id = $1
        ORDER BY p.created_at DESC, p.id DESC`,
      [parseInt(req.params.employeeId, 10)]
    );
    res.json(r.rows);
  } catch (err) {
    if (err.code === '42P01') return res.json([]); // base non migrée : l'écran s'ouvre
    console.error('[INSERTION] Erreur pièces GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/insertion/pieces/:employeeId — dépôt
// ═══════════════════════════════════════════════════════════════════════════
router.post('/:employeeId', ADMIN_RH, [
  param('employeeId').isInt().withMessage('Identifiant de salarié invalide'),
], validate, runUpload, async (req, res) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const f = req.file;
  if (!f || !f.buffer || f.buffer.length === 0) {
    return res.status(400).json({ error: 'Fichier manquant (champ « fichier »).' });
  }

  const type = String((req.body && req.body.type) || '').trim();
  if (!TYPES_PIECE.includes(type)) {
    return res.status(400).json({
      error: 'Type de pièce invalide. Seules les pièces dont la structure est seule dépositaire sont acceptées : entretien signé, convention PMSMP, accusé de remise, autre.',
    });
  }

  // Vérification par les octets : c'est elle qui fait foi, pas `f.mimetype`.
  const mime = typeReel(f.buffer);
  if (!mime) {
    return res.status(400).json({ error: 'Format non reconnu : seuls les fichiers PDF, JPEG et PNG sont acceptés (le contenu réel du fichier est vérifié, pas son extension).' });
  }
  if (f.buffer.length > TAILLE_MAX) {
    return res.status(400).json({ error: 'Fichier trop volumineux : 5 Mo maximum.' });
  }

  const lien = (v) => {
    if (v == null || v === '') return null;
    const n = parseInt(v, 10);
    return Number.isInteger(n) ? n : null;
  };
  const nom = String(f.originalname || 'piece').trim().slice(0, 200) || 'piece';
  const sha = crypto.createHash('sha256').update(f.buffer).digest('hex');

  try {
    const ins = await pool.query(
      `INSERT INTO insertion_pieces
         (employee_id, type, milestone_id, pmsmp_id, nom_fichier, mime, taille, contenu, sha256, depose_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, type, nom_fichier, mime, taille, milestone_id, pmsmp_id, created_at`,
      [employeeId, type, lien(req.body.milestone_id), lien(req.body.pmsmp_id),
        nom, mime, f.buffer.length, f.buffer, sha, req.user.id]
    );
    // La trace porte le nom du fichier et son empreinte, jamais son contenu :
    // l'empreinte permet de prouver plus tard qu'une pièce consultée est bien
    // celle qui a été déposée.
    await journaliser(req, 'INSERTION_PIECE_DEPOT', employeeId, {
      piece_id: ins.rows[0].id, type, nom_fichier: nom, taille: f.buffer.length, sha256: sha,
    });
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Référence invalide (salarié, entretien ou PMSMP inexistant).' });
    if (err.code === '42P01') return res.status(503).json({ error: 'Pièces indisponibles : base non migrée.' });
    console.error('[INSERTION] Erreur pièces POST :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/insertion/pieces/fichier/:id — le document lui-même
// ═══════════════════════════════════════════════════════════════════════════
router.get('/fichier/:id', ADMIN_RH, [
  param('id').isInt().withMessage('Identifiant de pièce invalide'),
], validate, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, employee_id, type, nom_fichier, mime, contenu FROM insertion_pieces WHERE id = $1',
      [parseInt(req.params.id, 10)]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Pièce non trouvée' });
    const p = r.rows[0];
    if (!p.contenu) return res.status(404).json({ error: 'Document indisponible pour cette pièce' });

    await journaliser(req, 'INSERTION_PIECE_CONSULTATION', p.employee_id, {
      piece_id: p.id, type: p.type, nom_fichier: p.nom_fichier,
    });

    // Le MIME servi est celui STOCKÉ, qui a été déterminé par les octets au
    // dépôt — jamais une valeur redéduite ici (elle pourrait diverger).
    res.setHeader('Content-Type', p.mime);
    // Nom de fichier assaini : un guillemet ou un retour ligne dans
    // `originalname` casserait l'en-tête (injection de header).
    const nomSur = String(p.nom_fichier || 'piece').replace(/[^\w.\-() ]+/g, '_');
    res.setHeader('Content-Disposition', `inline; filename="${nomSur}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.isBuffer(p.contenu) ? p.contenu : Buffer.from(p.contenu));
  } catch (err) {
    console.error('[INSERTION] Erreur pièce fichier :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/insertion/pieces/:id
// ═══════════════════════════════════════════════════════════════════════════
router.delete('/:id', ADMIN_RH, [
  param('id').isInt().withMessage('Identifiant de pièce invalide'),
], validate, async (req, res) => {
  try {
    const r = await pool.query(
      'DELETE FROM insertion_pieces WHERE id = $1 RETURNING id, employee_id, type, nom_fichier, sha256',
      [parseInt(req.params.id, 10)]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Pièce non trouvée' });
    const p = r.rows[0];
    await journaliser(req, 'INSERTION_PIECE_SUPPRESSION', p.employee_id, {
      piece_id: p.id, type: p.type, nom_fichier: p.nom_fichier, sha256: p.sha256,
    });
    res.json({ ok: true, id: p.id });
  } catch (err) {
    console.error('[INSERTION] Erreur pièce DELETE :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
