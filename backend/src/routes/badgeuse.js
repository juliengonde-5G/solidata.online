/**
 * Module 33 « Temps & Présence » (badgeuse) — back-office.
 * Spécification : docs/badgeuse/MODELE_DONNEES.md §3, SPEC_TECHNIQUE §5.3 (BO-01
 * à BO-11), NOTE_RH §5, NOTE_JURIDIQUE §3. API device : routes/badgeuse-device.js.
 *
 * MOTEUR DE CALCUL PUR : services/badgeuse-engine.js — aucune règle de gestion RH
 * n'est écrite ici ni là-bas (ADR-0002) : toutes viennent de `settings`
 * (utils/badgeuse-settings.js), éditables dans l'onglet Paramètres. Tant que la
 * Direction n'a pas arbitré la grille, `badgeuse.regles_validees_le` reste vide
 * et GET /parametres le dit — l'état « non arbitré » est visible, jamais silencieux.
 *
 * HABILITATIONS (BO-11) : lecture ADMIN/RH/MANAGER (MANAGER = encadrant
 * technique ; accès non restreint par équipe, précédent documenté v2.12.0),
 * écriture ADMIN/RH, administration des postes ADMIN. Les corrections sont
 * ouvertes au MANAGER (c'est lui qui régularise, NOTE_RH §5.1) avec deux
 * verrous : jamais ses PROPRES pointages, jamais une période déjà validée RH.
 *
 * JOURNALISATION : toute consultation de données INDIVIDUELLES (filtre
 * employee_id, relevé, feuille individuelle) et tout export sont tracés dans
 * rgpd_audit_log. Les consultations sont journalisées en « best effort » (hors
 * transaction, jamais bloquantes) ; les actes qui FONT FOI (validation RH,
 * rattachement d'orphelin, exports) le sont DANS la transaction.
 *
 * INALTÉRABILITÉ : aucune requête DELETE ni UPDATE sur les champs de capture de
 * badgeuse_pointages n'existe dans ce fichier. La seule mutation autorisée est
 * le rattachement d'un orphelin (employee_id + statut), qui est journalisé.
 * La suppression physique n'appartient qu'à la purge RGPD planifiée (BO-10).
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('../config/database');
const { authenticate, authorize, resolveBaseRole } = require('../middleware/auth');
const { query: q, param, body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');
const { mediaFilter } = require('../utils/upload-filters');
const engine = require('../services/badgeuse-engine');
const media = require('../services/badgeuse-social');
const {
  BADGEUSE_SETTING_DEFAULTS, REGLES_VALIDEES_LE_KEY, REGLES_VALIDEES_PAR_KEY, REGLES_RH_KEYS,
  META_TOKEN_KEY, META_TOKEN_CONFIGURE_LE_KEY, SOCIAL_DERNIER_SYNC_KEY,
  hmacKeySettingKey, readBadgeuseParams, readReglesValidees, writeSetting,
  validateAffichageSettings,
} = require('../utils/badgeuse-settings');
const {
  generateDeviceKey, hashDeviceKey, generateSiteKey, encryptSecret,
  canonicalPointage, genesisHash, chainHash,
  generateAppairageCode, formatAppairageCode, hashAppairageCode,
} = require('../utils/badgeuse-crypto');

router.use(authenticate);
router.use(autoLogActivity('badgeuse'));

const READ = authorize('ADMIN', 'RH', 'MANAGER');
const WRITE = authorize('ADMIN', 'RH');
const CORRECTION = authorize('ADMIN', 'RH', 'MANAGER');
const ADMIN_ONLY = authorize('ADMIN');

// Seuil de silence d'un poste (BO-09) : il n'est plus codé en dur (QA-11), il
// vient de `badgeuse.supervision_silence_minutes` (défaut 15 min). Le MÊME
// seuil sert à l'affichage « en ligne / hors ligne » et à l'alerte du job
// checkBadgeuseDevices : un poste ne peut plus être affiché « en ligne » alors
// que la supervision le considère muet.

const MOTIFS = ['oubli_badge', 'badge_defaillant', 'mission_exterieure', 'rdv_accompagnement', 'formation', 'autre'];

// Types de contenus de veille (BO-08 + écran v2). Les 5 premiers sont des
// contenus SAISIS, les suivants sont des GÉNÉRATEURS dont le contenu est
// construit par le serveur à la lecture de la playlist (routes/badgeuse-device.js).
const CONTENU_TYPES = [
  'message', 'image', 'planning', 'compte_a_rebours', 'meteo',
  'annonces', 'actus', 'tournees', 'social', 'media', 'lien', 'vak_live',
];

// Téléversement d'un média d'affichage (pattern Refashion : diskStorage +
// filtre extension/MIME + plafond). 100 Mo : une vidéo de veille de quelques
// dizaines de secondes tient largement dedans, et le poste doit pouvoir la
// mettre en cache local (plafond `badgeuse.media_cache_max_mo`).
const MEDIA_UPLOAD_MAX_MO = 100;
const uploadMedia = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, media.ensureMediaDir()),
    filename: (req, file, cb) => cb(
      null,
      `media-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname || '').toLowerCase()}`
    ),
  }),
  limits: { fileSize: MEDIA_UPLOAD_MAX_MO * 1024 * 1024 },
  fileFilter: mediaFilter,
});

/**
 * Multer, mais avec une réponse EXPLICITE au lieu d'un 500 opaque : un fichier
 * refusé (type ou taille) est une erreur d'utilisateur, pas une panne — il doit
 * pouvoir lire pourquoi et recommencer.
 */
function uploadMediaSingle(req, res, next) {
  uploadMedia.single('fichier')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `Fichier trop volumineux (maximum ${MEDIA_UPLOAD_MAX_MO} Mo)` });
    }
    return res.status(415).json({ error: err.message || 'Type de fichier non autorisé' });
  });
}

// Marge de CHARGEMENT autour d'une période (revue Codex — correctif C2) : une
// journée de travail peut enjamber la frontière de mois. Ce n'est pas une règle
// de gestion RH (elle ne change aucun calcul, ADR-0002), c'est la fenêtre de
// lecture qui permet à l'appariement de voir la paire entière.
const MARGE_CHARGEMENT_MS = 24 * 3600 * 1000;

// ── Helpers ────────────────────────────────────────────────────────────────

/** « NOM Prénom » (nom de famille en MAJUSCULES — règle 2.20.0). */
function formatNom(lastName, firstName) {
  return [String(lastName || '').toUpperCase(), String(firstName || '').trim()]
    .filter(Boolean).join(' ').trim();
}

/** Bornes UTC d'une période 'YYYY-MM' en jours civils Paris. */
function bornesPeriode(periode) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periode || ''));
  if (!m) return null;
  const annee = +m[1];
  const mois = +m[2];
  const debut = engine.parisWallClockToUTC(annee, mois - 1, 1, 0, 0, 0);
  const finMois = mois === 12
    ? engine.parisWallClockToUTC(annee + 1, 0, 1, 0, 0, 0)
    : engine.parisWallClockToUTC(annee, mois, 1, 0, 0, 0);
  return { debut, fin: finMois };
}

/**
 * Journalisation d'une consultation individuelle (BO-11). BEST EFFORT : une
 * panne de journal ne doit jamais empêcher un salarié ou un RH de lire une
 * donnée — l'échec est logué, la lecture passe.
 */
function logConsultation(req, action, entityType, entityId, details) {
  pool.query(
    'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
    [req.user.id, action, entityType, entityId || 0, JSON.stringify(details || {})]
  ).catch((err) => console.error('[BADGEUSE] Journalisation consultation impossible :', err.message));
}

/** Sérialise une valeur en cellule CSV (séparateur `;`). */
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Lignes → CSV `;` avec BOM UTF-8 (ouverture directe dans Excel FR). */
function toCsv(rows) {
  return `﻿${rows.map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

/**
 * Trio « théorique / pointé / écart » d'une feuille (BO-04). L'écart est
 * TOUJOURS dérivé des deux valeurs RÉELLEMENT exposées : sur une feuille
 * validée ce sont les chiffres figés en base qui font foi, pas le recalcul.
 * Théorique inconnu → écart `null` (jamais 0 : « — » à l'écran).
 */
function trioHeures(feuille, mois) {
  const theoriques = feuille.heures_theoriques == null ? null : Number(feuille.heures_theoriques);
  const pointees = feuille.statut === 'brouillon' || feuille.heures_pointees == null
    ? mois.heures_pointees
    : Number(feuille.heures_pointees);
  return {
    heures_theoriques: theoriques,
    heures_pointees: pointees,
    ecart_heures: theoriques == null || pointees == null ? null : engine.round2(pointees - theoriques),
  };
}

/**
 * Charge les événements effectifs d'un salarié sur une fenêtre, calcule ses
 * journées via le moteur pur et rend le tout. Une seule source de vérité pour
 * /pointages, /feuilles-temps, /anomalies, /releve et les exports.
 */
async function computeEmployeePeriod(employeeId, debut, fin, params, client = null) {
  const runner = client || pool;
  const debutMs = engine.toMs(debut);
  const finMs = engine.toMs(fin);
  // FENÊTRE DE CHARGEMENT ÉLARGIE de 24 h de part et d'autre. Une journée de
  // travail peut enjamber la frontière (nuit du 31/08 23:50 au 01/09 00:10) :
  // sans cette marge, la période de destination ne verrait que la moitié de la
  // paire. 24 h suffisent — la journée est bornée par les règles (au-delà de
  // `journee_max_heures`, défaut 10 h, l'anomalie « journée longue » part). La
  // marge sert au CALCUL ; la période est tranchée plus bas, par JOURNÉE.
  const debutCharge = new Date(debutMs - MARGE_CHARGEMENT_MS);
  const finCharge = new Date(finMs + MARGE_CHARGEMENT_MS);

  // (1) Pointages de la fenêtre élargie par leur horodatage d'ORIGINE, PLUS
  //     ceux qu'une correction DÉPLACE dedans (revue Codex C2). Sans le EXISTS,
  //     un pointage du 31/07 23:50 recalé au 01/08 restait invisible pour août :
  //     la période de destination ne chargeait pas le brut, donc ignorait la
  //     correction et perdait purement et simplement l'heure travaillée. Le
  //     EXISTS couvre AUSSI les déplacements de plus de 24 h (correction d'une
  //     date saisie à côté), que la marge seule ne rattraperait pas.
  const pts = await runner.query(
    `SELECT p.id, p.employee_id, p.horodatage_utc, p.sens, p.source, p.statut
     FROM badgeuse_pointages p
     WHERE p.employee_id = $1
       AND (
         (p.horodatage_utc >= $2 AND p.horodatage_utc < $3)
         OR EXISTS (
           SELECT 1 FROM badgeuse_corrections c
           WHERE c.pointage_id = p.id
             AND c.horodatage_corrige >= $2 AND c.horodatage_corrige < $3
         )
       )
     ORDER BY p.horodatage_utc`,
    [employeeId, debutCharge, finCharge]
  );

  // (2) Corrections de la fenêtre par leur horodatage CORRIGÉ, PLUS toutes
  //     celles qui portent sur un pointage chargé en (1) — y compris quand
  //     elles l'emmènent HORS de la fenêtre. Sans ce second membre, la période
  //     d'origine continuait de compter l'événement brut non corrigé (défaut b).
  //     Les `ajout` (pointage_id NULL) entrent par leur horodatage corrigé.
  const idsCharges = pts.rows.map((p) => Number(p.id)).filter((n) => Number.isFinite(n));
  const corr = await runner.query(
    `SELECT c.id, c.pointage_id, c.type, c.horodatage_corrige, c.sens_corrige, c.motif_code, c.motif_detail, c.auteur_id
     FROM badgeuse_corrections c
     WHERE c.employee_id = $1
       AND (
         (c.horodatage_corrige >= $2 AND c.horodatage_corrige < $3)
         OR c.pointage_id = ANY($4::bigint[])
       )
     ORDER BY c.id`,
    [employeeId, debutCharge, finCharge, idsCharges]
  );

  // (3) Appariement SANS filtre préalable — c'est le point du correctif : une
  //     paire coupée avant l'appariement perd ses minutes des DEUX côtés
  //     (l'entrée reste orpheline dans son mois, la sortie tombe seule dans le
  //     suivant). On calcule les journées sur l'ensemble chargé…
  const events = engine.buildEffectiveEvents(pts.rows, corr.rows);
  //     …puis on tranche la période par JOURNÉE : le moteur rattache une paire
  //     au jour civil de son ENTRÉE, donc une nuit du 31/08 appartient à août
  //     tout entière, sortie comprise. Bornes civiles Paris, fin exclue.
  const jours = engine.filterDaysToPeriod(
    engine.computeDays(events, params),
    engine.parisDateStr(debut), engine.parisDateStr(fin)
  );

  // (4) AFFICHAGE : les lignes de la marge ne doivent pas apparaître dans le
  //     relevé du salarié ni dans /mes-pointages. On y restitue donc la fenêtre
  //     STRICTE, avec la même définition qu'avant le correctif : pointage dont
  //     l'origine est dans la période OU qu'une correction y amène ; correction
  //     dont l'horodatage corrigé y tombe OU qui porte sur un pointage affiché
  //     (la pièce qui explique une heure reste visible — NOTE_RH §5.2).
  const dansPeriode = (v) => {
    const t = engine.toMs(v);
    return t != null && t >= debutMs && t < finMs;
  };
  const amenesDansPeriode = new Set(
    corr.rows.filter((c) => dansPeriode(c.horodatage_corrige))
      .map((c) => Number(c.pointage_id)).filter((n) => Number.isFinite(n))
  );
  const pointages = pts.rows.filter(
    (p) => dansPeriode(p.horodatage_utc) || amenesDansPeriode.has(Number(p.id))
  );
  const idsAffiches = new Set(pointages.map((p) => Number(p.id)));
  const corrections = corr.rows.filter(
    (c) => dansPeriode(c.horodatage_corrige)
      || (c.pointage_id != null && idsAffiches.has(Number(c.pointage_id)))
  );

  // `events` = événements effectifs AYANT SERVI AU CALCUL (marge comprise) ;
  // l'appartenance à la période se lit sur `jours`, jamais sur cette liste.
  return { pointages, corrections, events, jours };
}

/**
 * POPULATION d'une fenêtre : les salariés qui doivent y figurer. Membres réunis
 * par UNION (revue Codex C1) :
 *   1. pointages bruts de la fenêtre ;
 *   2. feuille déjà ouverte — SEULEMENT quand la fenêtre est une période
 *      'YYYY-MM' (`periode` non nul) : ne pas faire disparaître une feuille
 *      existante. Une fenêtre libre (/anomalies) n'a pas de période, donc pas
 *      ce membre ;
 *   3. CORRECTIONS de la fenêtre — un salarié en mission extérieure toute la
 *      période n'a QUE des corrections « ajout » : sans ce membre il
 *      n'apparaissait nulle part, donc ne pouvait être ni validé ni exporté en
 *      paie/IAE. Ses heures existaient en base et ne sortaient jamais.
 * On ne crée toujours pas de feuille vide pour toute la boîte : la population
 * reste bornée à ceux qui ont une trace sur la fenêtre.
 */
async function populationFenetre(debut, fin, periode, client = null) {
  const runner = client || pool;
  const vals = [debut, fin];
  // Membres assemblés à partir de FRAGMENTS FIXES : aucune donnée utilisateur
  // n'entre dans le texte SQL, tout passe par $1..$n.
  const membres = [
    `SELECT employee_id FROM badgeuse_pointages
       WHERE employee_id IS NOT NULL AND horodatage_utc >= $1 AND horodatage_utc < $2`,
  ];
  if (periode) {
    vals.push(periode);
    membres.push(`SELECT employee_id FROM badgeuse_feuilles_temps WHERE periode = $${vals.length}`);
  }
  membres.push(
    `SELECT c.employee_id FROM badgeuse_corrections c
       LEFT JOIN badgeuse_pointages p ON p.id = c.pointage_id
       WHERE (c.horodatage_corrige >= $1 AND c.horodatage_corrige < $2)
          OR (p.horodatage_utc >= $1 AND p.horodatage_utc < $2)`
  );

  return runner.query(
    // Pas de SELECT DISTINCT : le filtre porte sur la clé primaire, chaque
    // salarié ne peut donc sortir qu'une fois. (PostgreSQL refuserait de
    // toute façon « SELECT DISTINCT … ORDER BY UPPER(col) » : les expressions
    // du ORDER BY doivent alors figurer dans la liste de sélection.)
    `SELECT e.id, e.first_name, e.last_name, e.malibou_id, e.team_id
     FROM employees e
     WHERE e.id IN (
       ${membres.join('\n       UNION\n       ')}
     )
     ORDER BY UPPER(e.last_name), UPPER(e.first_name)`,
    vals
  );
}

/** Population d'une période 'YYYY-MM' (les trois membres, feuille comprise). */
async function populationPeriode(periode, bornes, client = null) {
  return populationFenetre(bornes.debut, bornes.fin, periode, client);
}

// ═══════════════════════════════════════════════════════════════════════════
// PARAMÈTRES (§5.4 + marqueur d'arbitrage ADR-0002)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/parametres', READ, async (req, res) => {
  try {
    const [params, regles] = await Promise.all([readBadgeuseParams(), readReglesValidees()]);
    res.json({
      parametres: params,
      defauts: BADGEUSE_SETTING_DEFAULTS,
      regles_validees: regles,
      motifs_correction: MOTIFS,
    });
  } catch (err) {
    console.error('[BADGEUSE] Erreur lecture paramètres :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/parametres', WRITE, async (req, res) => {
  const client = await pool.connect();
  try {
    const entrees = Object.entries(req.body || {})
      // Seules les clés du dictionnaire documenté sont acceptées : pas de clé
      // sauvage, donc pas de règle de gestion « fantôme » hors grille.
      .map(([k, v]) => [k.startsWith('badgeuse.') ? k : `badgeuse.${k}`, v])
      .filter(([k]) => Object.prototype.hasOwnProperty.call(BADGEUSE_SETTING_DEFAULTS, k));

    if (entrees.length === 0) {
      return res.status(400).json({ error: 'Aucun paramètre reconnu à enregistrer' });
    }

    // Garde-fous d'AFFICHAGE (écran v2) : un gabarit sans `{prenom}`, une
    // borne horaire illisible ou un vivier de phrases démesuré casseraient
    // l'écran en silence. Le lot est refusé ENTIER — un paramétrage à moitié
    // écrit serait pire qu'un refus (règles incohérentes entre elles).
    const erreurAffichage = validateAffichageSettings(entrees);
    if (erreurAffichage) return res.status(400).json({ error: erreurAffichage });

    await client.query('BEGIN');
    for (const [key, value] of entrees) {
      await writeSetting(key, value, client);
    }
    // L'enregistrement explicite de la grille VAUT arbitrage (ADR-0002 §3) :
    // le bandeau « règles par défaut » disparaît alors du back-office.
    // MAIS uniquement si le lot touche VRAIMENT une règle de gestion RH : les
    // paramètres d'AFFICHAGE de l'écran v2 (gabarits, phrases, réseaux
    // sociaux) passent par le même endpoint, et modifier un message de
    // bienvenue ne vaut pas arbitrage de la grille par la Direction. Sans
    // cette distinction, le signal « non arbitré » s'éteindrait tout seul.
    const toucheRegleRh = entrees.some(([k]) => REGLES_RH_KEYS.includes(k));
    if (toucheRegleRh) {
      await writeSetting(REGLES_VALIDEES_LE_KEY, new Date().toISOString(), client);
      await writeSetting(REGLES_VALIDEES_PAR_KEY, String(req.user.id), client);
    }
    await client.query('COMMIT');

    const [params, regles] = await Promise.all([readBadgeuseParams(), readReglesValidees()]);
    res.json({ parametres: params, regles_validees: regles, enregistres: entrees.length });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
    console.error('[BADGEUSE] Erreur écriture paramètres :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// BADGES (BO-01)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/badges', READ, [
  q('statut').optional().isString(),
  q('employee_id').optional().isInt(),
], validate, async (req, res) => {
  try {
    const clauses = [];
    const vals = [];
    if (req.query.statut) { vals.push(req.query.statut); clauses.push(`b.statut = $${vals.length}`); }
    if (req.query.employee_id) { vals.push(parseInt(req.query.employee_id, 10)); clauses.push(`b.employee_id = $${vals.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const r = await pool.query(
      `SELECT b.id, b.employee_id, b.uid_hmac, b.statut, b.attribue_le, b.restitue_le,
              b.commentaire, b.created_at, e.first_name, e.last_name, e.malibou_id,
              COALESCE(e.badgeuse_optin_festif, false) AS badgeuse_optin_festif,
              e.badgeuse_optin_festif_le
       FROM badgeuse_badges b
       JOIN employees e ON e.id = b.employee_id
       ${where}
       ORDER BY UPPER(e.last_name), UPPER(e.first_name), b.id DESC`,
      vals
    );
    res.json(r.rows.map((x) => ({
      id: x.id,
      employee_id: x.employee_id,
      nom: formatNom(x.last_name, x.first_name),
      matricule: x.malibou_id || null,
      // uid_hmac est un pseudonyme, jamais l'UID : son affichage tronqué sert
      // au rapprochement visuel à l'appairage, sans jamais permettre un clone.
      uid_hmac: x.uid_hmac,
      statut: x.statut,
      attribue_le: x.attribue_le,
      restitue_le: x.restitue_le,
      commentaire: x.commentaire,
      // Consentement à l'affichage festif (ADR-0004 §4) : la case se gère dans
      // l'onglet Badges, avec sa date de recueil — un consentement sans date
      // ne prouve rien.
      badgeuse_optin_festif: x.badgeuse_optin_festif === true,
      badgeuse_optin_festif_le: x.badgeuse_optin_festif_le || null,
    })));
  } catch (err) {
    console.error('[BADGEUSE] Erreur liste badges :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/badges', WRITE, [
  body('employee_id').isInt().withMessage('employee_id requis'),
  body('uid_hmac').matches(/^[0-9a-fA-F]{64}$/).withMessage('uid_hmac : 64 caractères hexadécimaux attendus (jamais un UID en clair)'),
  body('commentaire').optional({ nullable: true }).isString().isLength({ max: 300 }),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const employeeId = parseInt(req.body.employee_id, 10);
    const uidHmac = String(req.body.uid_hmac).toLowerCase();

    await client.query('BEGIN');

    // Deux unicites distinctes, deux messages distincts — le 409 fourre-tout
    // d'origine laissait la RH deviner lequel des deux etats bloquait.
    // Un badge physique se REATTRIBUE apres un depart : seul un badge encore
    // ACTIF au meme uid_hmac bloque (l'historique, lui, peut porter la meme
    // empreinte sur des periodes differentes).
    const dejaActif = await client.query(
      `SELECT b.id, UPPER(e.last_name) || ' ' || e.first_name AS porteur
       FROM badgeuse_badges b JOIN employees e ON e.id = b.employee_id
       WHERE b.uid_hmac = $1 AND b.statut = 'actif'`, [uidHmac]
    );
    if (dejaActif.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Ce badge est encore actif au nom de ${dejaActif.rows[0].porteur} — le passer « restitué » (ou perdu/volé) avant de le réattribuer`,
      });
    }
    const salarieEquipe = await client.query(
      `SELECT id FROM badgeuse_badges WHERE employee_id = $1 AND statut = 'actif'`, [employeeId]
    );
    if (salarieEquipe.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ce salarié a déjà un badge actif — le restituer avant d’en attribuer un autre' });
    }

    const ins = await client.query(
      `INSERT INTO badgeuse_badges (employee_id, uid_hmac, statut, commentaire, cree_par)
       VALUES ($1, $2, 'actif', $3, $4) RETURNING *`,
      [employeeId, uidHmac, req.body.commentaire || null, req.user.id]
    );
    await client.query(
      `INSERT INTO badgeuse_badge_historique (badge_id, evenement, details, auteur_id)
       VALUES ($1, 'attribution', $2, $3)`,
      [ins.rows[0].id, JSON.stringify({ employee_id: employeeId }), req.user.id]
    );

    // Rattachement des orphelins de CE badge, dans la MEME transaction : la RH
    // qui attribue le badge repond deja a la question « a qui appartiennent ces
    // pointages ? » — la refaire orphelin par orphelin dans une seconde modale
    // etait le trou constate en exploitation (« un orphelin ne s'affecte pas »).
    // Perimetre borne : uniquement les orphelins « badge_inconnu » de cette
    // empreinte POSTERIEURS a la derniere restitution du meme support — les
    // pointages d'un eventuel porteur precedent ne sont JAMAIS reattribues au
    // nouveau. Journalise comme le rattachement manuel.
    const ratt = await client.query(
      `UPDATE badgeuse_pointages
       SET employee_id = $1, statut = 'traite'
       WHERE uid_hmac = $2 AND statut = 'orphelin' AND orphelin_raison = 'badge_inconnu'
         AND horodatage_utc >= COALESCE(
           (SELECT MAX(COALESCE(restitue_le, created_at)) FROM badgeuse_badges
            WHERE uid_hmac = $2 AND id <> $3),
           '-infinity'::timestamptz)
       RETURNING id`,
      [employeeId, uidHmac, ins.rows[0].id]
    );
    if (ratt.rows.length > 0) {
      await client.query(
        'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
        [req.user.id, 'BADGEUSE_ORPHELIN_RATTACHEMENT', 'badgeuse_pointages', ins.rows[0].id,
          JSON.stringify({
            via: 'creation_badge', badge_id: ins.rows[0].id, employee_id: employeeId,
            pointage_ids: ratt.rows.map((r) => Number(r.id)), nb: ratt.rows.length,
          })]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ ...ins.rows[0], orphelins_rattaches: ratt.rows.length });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ce badge est déjà enregistré, ou ce salarié a déjà un badge actif' });
    }
    if (err.code === '23503') {
      return res.status(404).json({ error: 'Salarié introuvable' });
    }
    console.error('[BADGEUSE] Erreur création badge :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});


// PATCH /badges/:id — changement de statut. Perte/vol = INVALIDATION IMMÉDIATE :
// le badge sort du cache servi aux postes à la sync suivante (≤ 5 min) et tout
// passage ultérieur devient un orphelin `badge_inactif`.
router.patch('/badges/:id', WRITE, [
  param('id').isInt(),
  body('statut').isIn(['actif', 'perdu', 'vole', 'restitue', 'desactive']).withMessage('statut invalide'),
  body('commentaire').optional({ nullable: true }).isString().isLength({ max: 300 }),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const statut = req.body.statut;

    await client.query('BEGIN');
    const before = await client.query('SELECT * FROM badgeuse_badges WHERE id = $1 FOR UPDATE', [id]);
    if (before.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Badge introuvable' });
    }

    // TYPAGE EXPLICITE de $2 (::varchar aux DEUX emplacements). Sans lui,
    // PostgreSQL déduit deux types incompatibles pour le MÊME paramètre —
    // `character varying` depuis l'affectation de colonne, `text` depuis la
    // comparaison à un littéral — et refuse la requête entière (SQLSTATE
    // 42P08 « inconsistent types deduced for parameter $2 »). Tout le cycle
    // de vie du badge tombait alors en 500 : un badge perdu restait ACTIF et
    // continuait d'être accepté par le poste. Le défaut était invisible sous
    // base mockée : seul un vrai moteur analyse la requête.
    const upd = await client.query(
      `UPDATE badgeuse_badges
       SET statut = $2::varchar,
           commentaire = COALESCE($3, commentaire),
           restitue_le = CASE WHEN $2::varchar = 'restitue' THEN NOW() ELSE restitue_le END
       WHERE id = $1 RETURNING *`,
      [id, statut, req.body.commentaire || null]
    );

    const evenement = { perdu: 'perte', vole: 'vol', restitue: 'restitution', desactive: 'desactivation', actif: 'reactivation' }[statut];
    await client.query(
      `INSERT INTO badgeuse_badge_historique (badge_id, evenement, details, auteur_id)
       VALUES ($1, $2, $3, $4)`,
      [id, evenement, JSON.stringify({ statut_precedent: before.rows[0].statut, statut, commentaire: req.body.commentaire || null }), req.user.id]
    );
    await client.query('COMMIT');
    res.json(upd.rows[0]);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ce salarié a déjà un badge actif — restituez-le d\'abord' });
    }
    console.error('[BADGEUSE] Erreur mise à jour badge :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

router.get('/badges/:id/historique', READ, [param('id').isInt()], validate, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT h.id, h.evenement, h.details, h.created_at, u.first_name, u.last_name
       FROM badgeuse_badge_historique h
       LEFT JOIN users u ON u.id = h.auteur_id
       WHERE h.badge_id = $1 ORDER BY h.created_at DESC, h.id DESC`,
      [parseInt(req.params.id, 10)]
    );
    res.json(r.rows.map((x) => ({
      id: x.id, evenement: x.evenement, details: x.details, created_at: x.created_at,
      auteur: formatNom(x.last_name, x.first_name) || null,
    })));
  } catch (err) {
    console.error('[BADGEUSE] Erreur historique badge :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// JOURNAL DES POINTAGES (BO-02)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/pointages', READ, [
  q('employee_id').optional().isInt(),
  q('device_id').optional().isInt(),
  q('statut').optional().isIn(['brut', 'traite', 'orphelin']),
  q('du').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
  q('au').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
  q('limit').optional().isInt({ min: 1, max: 500 }),
  q('offset').optional().isInt({ min: 0 }),
], validate, async (req, res) => {
  try {
    const limit = Math.min(500, parseInt(req.query.limit, 10) || 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const clauses = [];
    const vals = [];

    if (req.query.employee_id) { vals.push(parseInt(req.query.employee_id, 10)); clauses.push(`p.employee_id = $${vals.length}`); }
    if (req.query.device_id) { vals.push(parseInt(req.query.device_id, 10)); clauses.push(`p.device_id = $${vals.length}`); }
    if (req.query.statut) { vals.push(req.query.statut); clauses.push(`p.statut = $${vals.length}`); }
    if (req.query.du) { vals.push(engine.parisDateTimeToUTC(req.query.du, '00:00')); clauses.push(`p.horodatage_utc >= $${vals.length}`); }
    if (req.query.au) {
      // Borne haute INCLUSIVE du jour civil Paris : minuit du lendemain.
      const lendemain = engine.parisDateStr(new Date(engine.parisDateTimeToUTC(req.query.au, '12:00').getTime() + 24 * 3600 * 1000));
      vals.push(engine.parisDateTimeToUTC(lendemain, '00:00'));
      clauses.push(`p.horodatage_utc < $${vals.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    vals.push(limit, offset);
    const r = await pool.query(
      `SELECT p.id, p.uuid, p.employee_id, p.device_id, p.horodatage_utc, p.horodatage_local,
              p.sens, p.source, p.statut, p.orphelin_raison, p.sequence_device, p.chaine_valide, p.recu_le,
              e.first_name, e.last_name, e.malibou_id, d.code AS device_code,
              COUNT(*) OVER() AS total
       FROM badgeuse_pointages p
       LEFT JOIN employees e ON e.id = p.employee_id
       LEFT JOIN badgeuse_devices d ON d.id = p.device_id
       ${where}
       ORDER BY p.horodatage_utc DESC, p.id DESC
       LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals
    );

    // Consultation INDIVIDUELLE (filtre sur un salarié) → journalisée (BO-11).
    if (req.query.employee_id) {
      logConsultation(req, 'BADGEUSE_CONSULTATION', 'badgeuse_pointages', parseInt(req.query.employee_id, 10), {
        employee_id: parseInt(req.query.employee_id, 10), du: req.query.du || null, au: req.query.au || null, portee: 'journal_pointages',
      });
    }

    const total = r.rows[0] ? Number(r.rows[0].total) : 0;
    res.json({
      total,
      limit,
      offset,
      pointages: r.rows.map((x) => ({
        id: Number(x.id),
        uuid: x.uuid,
        employee_id: x.employee_id,
        nom: x.employee_id ? formatNom(x.last_name, x.first_name) : null,
        matricule: x.malibou_id || null,
        device_id: x.device_id,
        device_code: x.device_code || null,
        horodatage_utc: x.horodatage_utc,
        horodatage_local: x.horodatage_local,
        sens: x.sens,
        source: x.source,
        statut: x.statut,
        orphelin_raison: x.orphelin_raison,
        sequence_device: x.sequence_device == null ? null : Number(x.sequence_device),
        // Indicateur d'anomalie porté par la ligne (BO-02).
        chaine_valide: x.chaine_valide,
        anomalie: x.statut === 'orphelin' || x.chaine_valide === false,
        recu_le: x.recu_le,
      })),
    });
  } catch (err) {
    console.error('[BADGEUSE] Erreur journal pointages :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ORPHELINS (PST-04 / BO-05)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Liste des pointages EN ATTENTE DE TRAITEMENT (statut `orphelin`).
 *
 * TOUS les orphelins, pas seulement ceux dont le badge est inconnu. Le filtre
 * historique `AND p.employee_id IS NULL` rendait INVISIBLE toute une famille
 * d'orphelins : ceux dont le badge EST reconnu mais dont l'horodatage tombe
 * hors de la plage d'acceptation (`hors_plage` — poste dont l'horloge dérive,
 * plage mal réglée, badgeage nocturne). Ils n'apparaissaient ni ici, ni dans
 * l'écran Anomalies, alors qu'ils sont bel et bien comptés dans les heures :
 * un pointage signalé « à traiter » que personne ne pouvait voir, c'est-à-dire
 * exactement l'échec silencieux que PST-04 interdit.
 *
 * `employee_id`/`nom` sont donc exposés : l'écran distingue « badge non
 * reconnu » (à rattacher) de « salarié connu, horodatage hors plage »
 * (à confirmer). `nom` vaut null quand le badge est inconnu — jamais un
 * libellé inventé.
 */
router.get('/orphelins', READ, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.id, p.uuid, p.uid_hmac, p.horodatage_utc, p.horodatage_local, p.sens,
              p.orphelin_raison, p.recu_le, p.employee_id,
              e.first_name, e.last_name, e.malibou_id, d.code AS device_code
       FROM badgeuse_pointages p
       LEFT JOIN employees e ON e.id = p.employee_id
       LEFT JOIN badgeuse_devices d ON d.id = p.device_id
       WHERE p.statut = 'orphelin'
       ORDER BY p.horodatage_utc DESC LIMIT 500`
    );
    res.json(r.rows.map((x) => ({
      id: Number(x.id),
      uuid: x.uuid,
      uid_hmac: x.uid_hmac,
      horodatage_utc: x.horodatage_utc,
      horodatage_local: x.horodatage_local,
      sens: x.sens,
      orphelin_raison: x.orphelin_raison,
      recu_le: x.recu_le,
      device_code: x.device_code || null,
      employee_id: x.employee_id,
      nom: x.employee_id ? formatNom(x.last_name, x.first_name) : null,
      matricule: x.malibou_id || null,
    })));
  } catch (err) {
    console.error('[BADGEUSE] Erreur liste orphelins :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * Rattachement d'un orphelin à un salarié (BO-05). SEULE mutation autorisée sur
 * un pointage : employee_id + statut. Les champs couverts par la chaîne
 * d'intégrité (uuid, device, séquence, uid_hmac, horodatage, sens, source) ne
 * sont JAMAIS touchés — la preuve de capture reste vérifiable après coup.
 * Le sens `inconnu` est laissé tel quel : c'est à l'encadrant de le trancher par
 * une correction motivée, pas au serveur de le deviner.
 *
 * Le verrou est le STATUT (`orphelin`), pas l'absence de salarié : un orphelin
 * `hors_plage` porte déjà son salarié (le badge était reconnu) et doit lui
 * aussi pouvoir être TRAITÉ — sinon il resterait « à traiter » à vie. Un
 * pointage déjà traité reste refusé (404), le geste n'est donc jamais rejoué.
 */
router.post('/orphelins/:id/rattacher', WRITE, [
  param('id').isInt(),
  body('employee_id').isInt().withMessage('employee_id requis'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const employeeId = parseInt(req.body.employee_id, 10);

    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE badgeuse_pointages
       SET employee_id = $2, statut = 'traite'
       WHERE id = $1 AND statut = 'orphelin'
       RETURNING id, uuid, horodatage_utc, sens, orphelin_raison`,
      [id, employeeId]
    );
    if (upd.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pointage orphelin introuvable ou déjà rattaché' });
    }
    await client.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'BADGEUSE_ORPHELIN_RATTACHEMENT', 'badgeuse_pointages', id,
        JSON.stringify({
          pointage_id: id, employee_id: employeeId,
          horodatage_utc: upd.rows[0].horodatage_utc, raison_initiale: upd.rows[0].orphelin_raison,
          requested_by: req.user.id,
        })]
    );
    await client.query('COMMIT');
    res.json({ ...upd.rows[0], id: Number(upd.rows[0].id), employee_id: employeeId, statut: 'traite' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
    if (err.code === '23503') return res.status(404).json({ error: 'Salarié introuvable' });
    console.error('[BADGEUSE] Erreur rattachement orphelin :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CORRECTIONS (BO-03) — additives, motif fermé, anti-autocorrection
// ═══════════════════════════════════════════════════════════════════════════

router.get('/corrections', READ, [
  q('employee_id').optional().isInt(),
  q('periode').optional().matches(/^\d{4}-\d{2}$/),
], validate, async (req, res) => {
  try {
    const clauses = [];
    const vals = [];
    if (req.query.employee_id) { vals.push(parseInt(req.query.employee_id, 10)); clauses.push(`c.employee_id = $${vals.length}`); }
    if (req.query.periode) {
      const b = bornesPeriode(req.query.periode);
      if (b) {
        vals.push(b.debut); clauses.push(`c.horodatage_corrige >= $${vals.length}`);
        vals.push(b.fin); clauses.push(`c.horodatage_corrige < $${vals.length}`);
      }
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const r = await pool.query(
      `SELECT c.*, e.first_name, e.last_name, u.first_name AS auteur_prenom, u.last_name AS auteur_nom
       FROM badgeuse_corrections c
       JOIN employees e ON e.id = c.employee_id
       LEFT JOIN users u ON u.id = c.auteur_id
       ${where}
       ORDER BY c.created_at DESC, c.id DESC LIMIT 500`,
      vals
    );
    if (req.query.employee_id) {
      logConsultation(req, 'BADGEUSE_CONSULTATION', 'badgeuse_corrections', parseInt(req.query.employee_id, 10), {
        employee_id: parseInt(req.query.employee_id, 10), portee: 'corrections',
      });
    }
    res.json(r.rows.map((x) => ({
      id: x.id,
      pointage_id: x.pointage_id == null ? null : Number(x.pointage_id),
      employee_id: x.employee_id,
      nom: formatNom(x.last_name, x.first_name),
      type: x.type,
      horodatage_corrige: x.horodatage_corrige,
      sens_corrige: x.sens_corrige,
      motif_code: x.motif_code,
      motif_detail: x.motif_detail,
      auteur: formatNom(x.auteur_nom, x.auteur_prenom) || null,
      created_at: x.created_at,
    })));
  } catch (err) {
    console.error('[BADGEUSE] Erreur liste corrections :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/corrections', CORRECTION, [
  body('employee_id').isInt().withMessage('employee_id requis'),
  body('type').isIn(['ajout', 'modification', 'annulation']).withMessage('type invalide'),
  body('motif_code').isIn(MOTIFS).withMessage('motif_code hors liste fermée'),
  body('motif_detail').optional({ nullable: true }).isString().isLength({ max: 200 }),
  body('pointage_id').optional({ nullable: true }).isInt(),
  body('horodatage_corrige').optional({ nullable: true }).isISO8601(),
  body('sens_corrige').optional({ nullable: true }).isIn(['entree', 'sortie']),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const { type, motif_code: motifCode } = req.body;
    const employeeId = parseInt(req.body.employee_id, 10);
    const pointageId = req.body.pointage_id == null ? null : parseInt(req.body.pointage_id, 10);
    // Un horodatage SANS indication de fuseau est une heure MURALE Paris (saisie
    // encadrant), jamais l'heure du serveur — doctrine du dépôt (2.20.0) :
    // stockage UTC, interprétation Europe/Paris.
    let horodatage = null;
    if (req.body.horodatage_corrige) {
      const raw = String(req.body.horodatage_corrige);
      if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
        horodatage = new Date(raw);
      } else {
        const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})/.exec(raw);
        horodatage = m ? engine.parisDateTimeToUTC(m[1], m[2]) : new Date(raw);
      }
      if (!horodatage || Number.isNaN(horodatage.getTime())) {
        return res.status(400).json({ error: 'horodatage_corrige invalide' });
      }
    }

    // Motif « autre » ⇒ précision OBLIGATOIRE ; et réciproquement, un détail sur
    // un motif codé n'a pas lieu d'être (liste fermée, NOTE_JURIDIQUE §3.4 :
    // « champ libre à proscrire »).
    const motifDetail = req.body.motif_detail ? String(req.body.motif_detail).trim() : null;
    if (motifCode === 'autre' && !motifDetail) {
      return res.status(400).json({ error: 'Le motif « autre » exige une précision (motif_detail)' });
    }
    if (motifCode !== 'autre' && motifDetail) {
      return res.status(400).json({ error: 'motif_detail n\'est accepté que pour le motif « autre »' });
    }
    if (type === 'ajout' && (!horodatage || !req.body.sens_corrige)) {
      return res.status(400).json({ error: 'Un ajout exige un horodatage et un sens' });
    }
    if (type === 'modification' && (!pointageId || !horodatage)) {
      return res.status(400).json({ error: 'Une modification exige le pointage d\'origine et un horodatage corrigé' });
    }
    if (type === 'annulation' && !pointageId) {
      return res.status(400).json({ error: 'Une annulation exige le pointage d\'origine' });
    }

    // ── Verrou 1 : aucun encadrant ne corrige ses PROPRES pointages (NOTE_RH §5.2) ──
    const emp = await client.query('SELECT id, user_id FROM employees WHERE id = $1', [employeeId]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Salarié introuvable' });
    if (emp.rows[0].user_id && Number(emp.rows[0].user_id) === Number(req.user.id)) {
      return res.status(403).json({ error: 'Vous ne pouvez pas corriger vos propres pointages — la correction relève d\'un tiers' });
    }

    // ── Verrou 2 : aucune correction sur une période validée RH (NOTE_RH §5.2) ──
    // DOUBLE verrou (revue Codex C2) : une modification qui déplace un pointage
    // d'un mois vers un autre touche DEUX périodes — celle qu'elle vide
    // (origine) et celle qu'elle remplit (destination). Si l'UNE des deux est
    // validée RH, la correction est refusée : sinon on modifierait un mois clos
    // « par l'autre bout », sans que personne ne le voie.
    const origine = pointageId
      ? (await client.query('SELECT horodatage_utc FROM badgeuse_pointages WHERE id = $1', [pointageId])).rows[0]?.horodatage_utc
      : null;
    const dateRef = horodatage || origine;
    if (!dateRef) return res.status(404).json({ error: 'Pointage d\'origine introuvable' });

    // Périodes CONNUES seulement : un pointage d'origine introuvable ne fait pas
    // inventer une période (la clé étrangère tranchera à l'insertion).
    const periodes = [...new Set(
      [horodatage, origine].filter(Boolean).map((d) => engine.parisDateStr(d).slice(0, 7))
    )];
    const feuille = await client.query(
      'SELECT periode, statut FROM badgeuse_feuilles_temps WHERE employee_id = $1 AND periode = ANY($2::varchar[])',
      [employeeId, periodes]
    );
    const bloquante = feuille.rows.find((x) => x.statut === 'validee_rh');
    if (bloquante) {
      const periodeBloquee = bloquante.periode || periodes.join(' / ');
      return res.status(409).json({
        error: `La feuille de temps ${periodeBloquee} est validée par le RH — aucune correction rétroactive (une contestation suit la procédure de réclamation)`,
        periodes_concernees: periodes,
      });
    }

    // ── Délai de signalement (ADR-0002 addendum §4, QA-05) ──
    // `badgeuse.regularisation_delai_jours` (NOTE_RH §5.1 : « signalement sous
    // 5 jours ouvrés ») était déclaré et arbitrable mais n'avait AUCUN effet.
    // Il en produit un désormais — NON BLOQUANT : une régularisation tardive
    // reste enregistrée (aucune heure ne se perd), elle est simplement signalée
    // à celui qui la saisit et tracée dans la réponse.
    const params = await readBadgeuseParams();
    const delaiJours = Math.max(0, Number(params.regularisation_delai_jours) || 0);
    const joursEcoules = engine.joursOuvresEcoules(
      engine.parisDateStr(dateRef), engine.parisDateStr(new Date())
    );
    const horsDelai = delaiJours > 0 && joursEcoules != null && joursEcoules > delaiJours;

    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO badgeuse_corrections
         (pointage_id, employee_id, type, horodatage_corrige, sens_corrige, motif_code, motif_detail, auteur_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [pointageId, employeeId, type, horodatage, req.body.sens_corrige || null, motifCode, motifDetail, req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json({
      ...ins.rows[0],
      pointage_id: ins.rows[0].pointage_id == null ? null : Number(ins.rows[0].pointage_id),
      avertissement: horsDelai ? 'hors_delai_signalement' : null,
      jours_ouvres_ecoules: joursEcoules,
      regularisation_delai_jours: delaiJours,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
    if (err.code === '23503') return res.status(404).json({ error: 'Salarié ou pointage introuvable' });
    console.error('[BADGEUSE] Erreur création correction :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FEUILLES DE TEMPS (BO-04) — circuit encadrant → RH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Heures hebdomadaires CONTRACTUELLES d'un salarié au 1er jour de la période
 * (ADR-0002 addendum §3, QA-03). Source : `employee_contracts` — le contrat
 * dont la période effective couvre le 1er du mois, comme le fait le moteur ETP
 * (routes/effectifs.js) ; REPLI documenté sur la fiche `employees.weekly_hours`
 * quand aucun contrat ne couvre cette date (salarié sans historique importé,
 * ou contrat démarrant en cours de mois).
 *
 * Rend `null` si aucune heure n'est connue : la feuille affichera « — », JAMAIS
 * un théorique inventé (doctrine « jamais de valeur inventée »).
 */
async function heuresHebdoContractuelles(employeeId, periode, client) {
  const runner = client || pool;
  const premierDuMois = `${periode}-01`;
  const c = await runner.query(
    `SELECT ec.weekly_hours
     FROM employee_contracts ec
     WHERE ec.employee_id = $1
       AND ec.weekly_hours IS NOT NULL
       AND ec.start_date IS NOT NULL
       AND ec.start_date <= $2::date
       AND (ec.end_date IS NULL OR ec.end_date >= $2::date)
     ORDER BY ec.start_date DESC
     LIMIT 1`,
    [employeeId, premierDuMois]
  );
  if (c.rows[0] && c.rows[0].weekly_hours != null) {
    return { heures: Number(c.rows[0].weekly_hours), source: 'contrat' };
  }
  const f = await runner.query('SELECT weekly_hours FROM employees WHERE id = $1', [employeeId]);
  if (f.rows[0] && f.rows[0].weekly_hours != null) {
    return { heures: Number(f.rows[0].weekly_hours), source: 'fiche' };
  }
  return { heures: null, source: null };
}

/**
 * Recalcule (et met à jour en brouillon) la feuille d'un salarié pour une
 * période. Une feuille DÉJÀ VALIDÉE n'est jamais réécrite par le recalcul :
 * le chiffre validé fait foi (même doctrine que la validation ASP des effectifs)
 * — y compris son `heures_theoriques`, figé à la validation.
 */
async function upsertFeuille(employeeId, periode, params, client) {
  const bornes = bornesPeriode(periode);
  const { jours } = await computeEmployeePeriod(employeeId, bornes.debut, bornes.fin, params, client);

  // Théorique = heures hebdo contractuelles × jours ouvrés du mois ÷ 5 (BO-04).
  const { heures: hebdo, source: sourceTheorique } = await heuresHebdoContractuelles(employeeId, periode, client);
  const heuresTheoriques = engine.heuresTheoriquesMois(hebdo, periode);

  const mois = engine.computeMonth(jours, params, { periode, heures_theoriques: heuresTheoriques });

  // Ligne COMPLÈTE (et non `id, statut`) : sur une feuille déjà validée, ce
  // sont SES chiffres qui font foi — heures pointées, théoriques, validées et
  // dates de validation. Une projection partielle les rendait `undefined`, si
  // bien que la feuille validée s'affichait sans date de validation et que la
  // validation RH d'une feuille déjà validée par l'encadrant écrivait `NaN`
  // dans `heures_validees`.
  const existante = await client.query(
    'SELECT * FROM badgeuse_feuilles_temps WHERE employee_id = $1 AND periode = $2',
    [employeeId, periode]
  );
  if (existante.rows[0] && existante.rows[0].statut !== 'brouillon') {
    return { feuille: existante.rows[0], mois, recalculee: false, source_theorique: sourceTheorique };
  }

  const r = await client.query(
    `INSERT INTO badgeuse_feuilles_temps (employee_id, periode, heures_theoriques, heures_pointees, detail, statut, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'brouillon', NOW())
     ON CONFLICT (employee_id, periode) DO UPDATE
       SET heures_theoriques = EXCLUDED.heures_theoriques,
           heures_pointees = EXCLUDED.heures_pointees,
           detail = EXCLUDED.detail,
           updated_at = NOW()
     RETURNING *`,
    [employeeId, periode, heuresTheoriques, mois.heures_pointees, JSON.stringify(mois.detail)]
  );
  return { feuille: r.rows[0], mois, recalculee: true, source_theorique: sourceTheorique };
}

/**
 * Matérialise en BROUILLON les feuilles manquantes de la population d'une
 * période (revue Codex C1). Les exports partent des feuilles : sans ce passage,
 * un salarié qui n'a QUE des corrections sur le mois n'existait pour la paie
 * qu'à la condition qu'un humain ait ouvert l'écran mensuel avant — dépendance
 * invisible et silencieuse. L'export le voit désormais par lui-même :
 *   - export paie : il apparaît en `non_validees` (409 tant qu'il n'est pas
 *     validé RH) au lieu de disparaître du fichier ;
 *   - export IAE : sa feuille existe et devient validable.
 * IDEMPOTENT et non destructif : `upsertFeuille` ne réécrit JAMAIS une feuille
 * déjà validée, et seules les feuilles ABSENTES sont calculées ici (aucun
 * recalcul des brouillons existants, l'export ne doit pas être une passe de
 * recalcul générale).
 * @returns {number} nombre de feuilles créées
 */
async function materialiserFeuillesManquantes(periode, client) {
  const bornes = bornesPeriode(periode);
  if (!bornes) return 0;
  const [pop, existantes] = await Promise.all([
    populationPeriode(periode, bornes, client),
    client.query('SELECT employee_id FROM badgeuse_feuilles_temps WHERE periode = $1', [periode]),
  ]);
  const deja = new Set(existantes.rows.map((x) => Number(x.employee_id)));
  const manquants = pop.rows.filter((e) => !deja.has(Number(e.id)));
  if (manquants.length === 0) return 0;

  const params = await readBadgeuseParams();
  for (const e of manquants) {
    await upsertFeuille(e.id, periode, params, client);
  }
  return manquants.length;
}

router.get('/feuilles-temps', READ, [
  q('periode').matches(/^\d{4}-\d{2}$/).withMessage('periode « YYYY-MM » requise'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const periode = req.query.periode;
    const params = await readBadgeuseParams();
    const bornes = bornesPeriode(periode);

    // Population partagée avec les exports (pointages OU feuille OU corrections
    // du mois) : la liste mensuelle et la paie voient exactement les mêmes gens.
    const pop = await populationPeriode(periode, bornes, client);

    const feuilles = [];
    for (const e of pop.rows) {
      const { feuille, mois, source_theorique: sourceTheorique } = await upsertFeuille(e.id, periode, params, client);
      feuilles.push({
        employee_id: e.id,
        nom: formatNom(e.last_name, e.first_name),
        matricule: e.malibou_id || null,
        team_id: e.team_id,
        periode,
        statut: feuille.statut,
        // Théorique / pointé / écart (BO-04). Le théorique n'est pas inventé :
        // il reste null quand aucune heure contractuelle n'est connue.
        ...trioHeures(feuille, mois),
        source_theorique: sourceTheorique,
        heures_validees: feuille.heures_validees == null ? null : Number(feuille.heures_validees),
        jours_travailles: mois.jours_travailles,
        nb_anomalies: mois.nb_anomalies,
        // Indicateur NOTE_RH §9 (QA-05) : null si aucune journée n'est soumise
        // à l'attendu de pointages sur la période.
        taux_pointages_complets_pct: mois.taux_pointages_complets_pct,
        jours_pointage_complet: mois.jours_pointage_complet,
        jours_pointage_attendu: mois.jours_pointage_attendu,
        valide_encadrant_le: feuille.valide_encadrant_le || null,
        valide_rh_le: feuille.valide_rh_le || null,
      });
    }
    res.json({ periode, feuilles });
  } catch (err) {
    console.error('[BADGEUSE] Erreur feuilles de temps :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

router.get('/feuilles-temps/:employeeId', READ, [
  param('employeeId').isInt(),
  q('periode').matches(/^\d{4}-\d{2}$/).withMessage('periode « YYYY-MM » requise'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const employeeId = parseInt(req.params.employeeId, 10);
    const periode = req.query.periode;
    const params = await readBadgeuseParams();
    const { feuille, mois, source_theorique: sourceTheorique } = await upsertFeuille(employeeId, periode, params, client);

    // Consultation INDIVIDUELLE → journalisée (BO-11).
    logConsultation(req, 'BADGEUSE_CONSULTATION', 'badgeuse_feuilles_temps', employeeId, {
      employee_id: employeeId, periode, portee: 'feuille_individuelle',
    });

    res.json({
      employee_id: employeeId,
      periode,
      statut: feuille.statut,
      ...trioHeures(feuille, mois),
      source_theorique: sourceTheorique,
      heures_validees: feuille.heures_validees == null ? null : Number(feuille.heures_validees),
      heures_hms: mois.heures_hms,
      jours_travailles: mois.jours_travailles,
      nb_anomalies: mois.nb_anomalies,
      taux_pointages_complets_pct: mois.taux_pointages_complets_pct,
      jours_pointage_complet: mois.jours_pointage_complet,
      jours_pointage_attendu: mois.jours_pointage_attendu,
      detail: feuille.statut === 'brouillon' ? mois.detail : feuille.detail,
      valide_encadrant_le: feuille.valide_encadrant_le || null,
      valide_rh_le: feuille.valide_rh_le || null,
    });
  } catch (err) {
    console.error('[BADGEUSE] Erreur feuille individuelle :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

/**
 * Validation d'une feuille (BO-04). Deux niveaux :
 *  - `encadrant` (ADMIN/RH/MANAGER) : contrôle de premier niveau ;
 *  - `rh` (ADMIN/RH) : clôture mensuelle — le chiffre validé FAIT FOI et
 *    verrouille la période contre toute correction rétroactive (NOTE_RH §5.2).
 * La validation RH est journalisée DANS la transaction : pas de validation non
 * tracée (même pattern que ETP_ASP_VALIDATION).
 */
router.post('/feuilles-temps/:employeeId/valider', CORRECTION, [
  param('employeeId').isInt(),
  body('periode').matches(/^\d{4}-\d{2}$/).withMessage('periode « YYYY-MM » requise'),
  body('niveau').isIn(['encadrant', 'rh']).withMessage('niveau : encadrant | rh'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const employeeId = parseInt(req.params.employeeId, 10);
    const { periode, niveau } = req.body;

    // La validation RH est réservée à ADMIN/RH (le MANAGER s'arrête à
    // l'encadrant). Résolution custom→base comme `authorize` : un rôle
    // personnalisé dupliqué de RH valide aussi (revue Codex PR#93).
    if (niveau === 'rh' && !['ADMIN', 'RH'].includes(resolveBaseRole(req.user.role))) {
      return res.status(403).json({ error: 'La validation RH est réservée aux profils ADMIN/RH' });
    }

    const params = await readBadgeuseParams();
    await client.query('BEGIN');
    const { feuille, mois } = await upsertFeuille(employeeId, periode, params, client);
    const heures = feuille.statut === 'brouillon' ? mois.heures_pointees : Number(feuille.heures_pointees);

    let upd;
    if (niveau === 'encadrant') {
      upd = await client.query(
        `UPDATE badgeuse_feuilles_temps
         SET statut = 'validee_encadrant', valide_encadrant_par = $3, valide_encadrant_le = NOW(), updated_at = NOW()
         WHERE employee_id = $1 AND periode = $2 AND statut = 'brouillon'
         RETURNING *`,
        [employeeId, periode, req.user.id]
      );
      if (upd.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Feuille absente ou déjà validée' });
      }
    } else {
      upd = await client.query(
        `UPDATE badgeuse_feuilles_temps
         SET statut = 'validee_rh', heures_validees = $4, valide_rh_par = $3, valide_rh_le = NOW(), updated_at = NOW()
         WHERE employee_id = $1 AND periode = $2 AND statut = 'validee_encadrant'
         RETURNING *`,
        [employeeId, periode, req.user.id, heures]
      );
      if (upd.rows.length === 0) {
        await client.query('ROLLBACK');
        // Le circuit encadrant → RH est OBLIGATOIRE (NOTE_RH §5.1, revue
        // Codex PR#93) : le RH ne clôt pas un brouillon jamais revu par
        // l'encadrant, même en passant par l'API directement.
        return res.status(409).json({ error: 'La feuille doit d\'abord être validée par l\'encadrant (ou est déjà validée par le RH)' });
      }
    }

    await client.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'BADGEUSE_FEUILLE_VALIDATION', 'badgeuse_feuilles_temps', upd.rows[0].id,
        JSON.stringify({ employee_id: employeeId, periode, niveau, heures_validees: niveau === 'rh' ? heures : null, requested_by: req.user.id })]
    );
    await client.query('COMMIT');
    res.json(upd.rows[0]);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
    console.error('[BADGEUSE] Erreur validation feuille :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

/** Dévalidation (ADMIN uniquement, journalisée) — rouvre la période. */
router.delete('/feuilles-temps/:employeeId/validation', ADMIN_ONLY, [
  param('employeeId').isInt(),
  q('periode').matches(/^\d{4}-\d{2}$/).withMessage('periode « YYYY-MM » requise'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const employeeId = parseInt(req.params.employeeId, 10);
    const periode = req.query.periode;

    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE badgeuse_feuilles_temps
       SET statut = 'brouillon', heures_validees = NULL,
           valide_encadrant_par = NULL, valide_encadrant_le = NULL,
           valide_rh_par = NULL, valide_rh_le = NULL, updated_at = NOW()
       WHERE employee_id = $1 AND periode = $2 AND statut <> 'brouillon'
       RETURNING id, statut`,
      [employeeId, periode]
    );
    if (upd.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Aucune feuille validée pour cette période' });
    }
    await client.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'BADGEUSE_FEUILLE_DEVALIDATION', 'badgeuse_feuilles_temps', upd.rows[0].id,
        JSON.stringify({ employee_id: employeeId, periode, requested_by: req.user.id })]
    );
    await client.query('COMMIT');
    res.json({ devalidee: true, employee_id: employeeId, periode });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
    console.error('[BADGEUSE] Erreur dévalidation feuille :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ANOMALIES (BO-05)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/anomalies', READ, [
  q('du').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('du « YYYY-MM-DD » requis'),
  q('au').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('au « YYYY-MM-DD » requis'),
], validate, async (req, res) => {
  try {
    const params = await readBadgeuseParams();
    const debut = engine.parisDateTimeToUTC(req.query.du, '00:00');
    const lendemain = engine.parisDateStr(new Date(engine.parisDateTimeToUTC(req.query.au, '12:00').getTime() + 24 * 3600 * 1000));
    const fin = engine.parisDateTimeToUTC(lendemain, '00:00');

    // MÊME population que la liste mensuelle (revue Codex C1), fenêtre libre
    // donc sans le membre « feuille de la période » : les anomalies d'un
    // salarié qui n'a que des corrections (ajout d'entrée sans sortie, par
    // exemple) restaient elles aussi invisibles.
    const emps = await populationFenetre(debut, fin, null);

    const anomalies = [];
    // Indicateur « taux de pointages complets » (NOTE_RH §9, QA-05), agrégé sur
    // la fenêtre : dénominateur = journées SOUMISES à l'attendu de pointages
    // (celles qui dépassent le seuil de pause), jamais toutes les journées.
    let joursSoumis = 0;
    let joursComplets = 0;
    for (const e of emps.rows) {
      const { jours } = await computeEmployeePeriod(e.id, debut, fin, params);
      for (const j of jours) {
        if (!engine.journeeSoumiseAttenduPointages(j, params)) continue;
        joursSoumis += 1;
        if (!engine.pointagesIncomplets(j, params)) joursComplets += 1;
      }
      for (const a of engine.detectAnomalies(jours, params, { employee_id: e.id })) {
        anomalies.push({ ...a, nom: formatNom(e.last_name, e.first_name) });
      }
    }

    // Orphelins de la fenêtre — TOUS, y compris ceux dont le badge est reconnu
    // (raison `hors_plage`). Le filtre `employee_id IS NULL` les effaçait de
    // l'écran d'anomalies alors qu'ils y ont toute leur place : un pointage
    // hors plage est précisément ce que l'encadrant doit arbitrer.
    const orph = await pool.query(
      `SELECT p.id, p.horodatage_utc, p.orphelin_raison, p.employee_id,
              e.first_name, e.last_name
       FROM badgeuse_pointages p
       LEFT JOIN employees e ON e.id = p.employee_id
       WHERE p.statut = 'orphelin'
         AND p.horodatage_utc >= $1 AND p.horodatage_utc < $2
       ORDER BY p.horodatage_utc`,
      [debut, fin]
    );
    // Le nom n'est restitué que pour un orphelin dont le badge EST reconnu
    // (`hors_plage`) — sinon null, jamais un libellé inventé.
    const nomsOrphelins = new Map(orph.rows
      .filter((x) => x.employee_id != null)
      .map((x) => [Number(x.employee_id), formatNom(x.last_name, x.first_name)]));
    for (const a of engine.detectAnomalies([], params, { orphelins: orph.rows })) {
      anomalies.push({ ...a, nom: a.employee_id == null ? null : (nomsOrphelins.get(a.employee_id) || null) });
    }

    res.json({
      du: req.query.du,
      au: req.query.au,
      total: anomalies.length,
      // null (et non 0 %) quand aucune journée n'est concernée sur la fenêtre.
      taux_pointages_complets_pct: joursSoumis === 0
        ? null
        : engine.round2((joursComplets / joursSoumis) * 100),
      jours_pointage_complet: joursComplets,
      jours_pointage_attendu: joursSoumis,
      anomalies: anomalies.sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))),
    });
  } catch (err) {
    console.error('[BADGEUSE] Erreur anomalies :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS (BO-06 paie / BO-07 IAE) — CSV `;` + BOM, journalisés
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Export paie. Ne sort QUE des feuilles `validee_rh` : un chiffre non validé
 * n'a pas à partir en paie. Si des salariés de la période ne sont pas validés,
 * l'export renvoie 409 avec la liste — sauf `force=1`, qui exporte les seules
 * feuilles validées en le disant explicitement dans la réponse.
 */
router.get('/exports/paie', WRITE, [
  q('periode').matches(/^\d{4}-\d{2}$/).withMessage('periode « YYYY-MM » requise'),
  q('heures').optional().isIn(['decimal', 'hms']),
  q('force').optional().isIn(['0', '1']),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const periode = req.query.periode;
    const format = req.query.heures === 'hms' ? 'hms' : 'decimal';
    const force = req.query.force === '1';

    // L'export voit la population du mois par lui-même (C1) : un salarié qui
    // n'a que des corrections obtient sa feuille (brouillon) et apparaît donc
    // en `non_validees` au lieu de sortir silencieusement de la paie.
    const creees = await materialiserFeuillesManquantes(periode, client);

    const r = await client.query(
      `SELECT f.employee_id, f.statut, f.heures_validees, f.heures_pointees, f.detail,
              e.first_name, e.last_name, e.malibou_id
       FROM badgeuse_feuilles_temps f
       JOIN employees e ON e.id = f.employee_id
       WHERE f.periode = $1
       ORDER BY UPPER(e.last_name), UPPER(e.first_name)`,
      [periode]
    );

    const nonValidees = r.rows.filter((x) => x.statut !== 'validee_rh');
    if (nonValidees.length > 0 && !force) {
      return res.status(409).json({
        error: 'Des feuilles de temps ne sont pas validées par le RH — export refusé',
        periode,
        non_validees: nonValidees.map((x) => ({
          employee_id: x.employee_id, nom: formatNom(x.last_name, x.first_name), statut: x.statut,
        })),
        hint: 'Validez ces feuilles, ou relancez avec force=1 pour n\'exporter que les feuilles validées',
      });
    }

    const validees = r.rows.filter((x) => x.statut === 'validee_rh');
    const lignes = [['matricule', 'nom', 'prenom', 'periode', 'jours_travailles', 'heures']];
    for (const x of validees) {
      const jours = Array.isArray(x.detail) ? x.detail : [];
      const heures = Number(x.heures_validees == null ? x.heures_pointees : x.heures_validees) || 0;
      lignes.push([
        x.malibou_id || '',
        String(x.last_name || '').toUpperCase(),
        x.first_name || '',
        periode,
        jours.filter((d) => (Number(d.minutes) || 0) > 0).length,
        format === 'hms' ? engine.minutesToHms(heures * 60) : String(heures).replace('.', ','),
      ]);
    }

    logConsultation(req, 'BADGEUSE_EXPORT_PAIE', 'badgeuse_feuilles_temps', 0, {
      periode, format, lignes: validees.length, non_validees: nonValidees.length,
      feuilles_creees: creees, force, requested_by: req.user.id,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="badgeuse_paie_${periode}.csv"`);
    res.send(toCsv(lignes));
  } catch (err) {
    console.error('[BADGEUSE] Erreur export paie :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

/** Export heures IAE (BO-07) — salariés en parcours, total mensuel validé. */
router.get('/exports/iae', WRITE, [
  q('periode').matches(/^\d{4}-\d{2}$/).withMessage('periode « YYYY-MM » requise'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const periode = req.query.periode;
    // Même population que la liste mensuelle et l'export paie (C1) : la feuille
    // d'un salarié qui n'a que des corrections est créée si elle manque, donc
    // il devient validable — puis exportable ici une fois validé RH.
    await materialiserFeuillesManquantes(periode, client);

    const r = await client.query(
      `SELECT f.employee_id, f.heures_validees, f.statut, e.first_name, e.last_name, e.malibou_id
       FROM badgeuse_feuilles_temps f
       JOIN employees e ON e.id = f.employee_id
       WHERE f.periode = $1 AND f.statut = 'validee_rh' AND e.insertion_status = 'en_parcours'
       ORDER BY UPPER(e.last_name), UPPER(e.first_name)`,
      [periode]
    );

    const lignes = [['matricule', 'nom', 'prenom', 'periode', 'heures_travaillees']];
    for (const x of r.rows) {
      lignes.push([
        x.malibou_id || '',
        String(x.last_name || '').toUpperCase(),
        x.first_name || '',
        periode,
        String(Number(x.heures_validees) || 0).replace('.', ','),
      ]);
    }

    logConsultation(req, 'BADGEUSE_EXPORT_IAE', 'badgeuse_feuilles_temps', 0, {
      periode, lignes: r.rows.length, requested_by: req.user.id,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="badgeuse_iae_${periode}.csv"`);
    res.send(toCsv(lignes));
  } catch (err) {
    console.error('[BADGEUSE] Erreur export IAE :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CONTENUS DE VEILLE (BO-08) — AUCUNE donnée personnelle
// ═══════════════════════════════════════════════════════════════════════════

const contenuValidators = [
  body('type').optional().isIn(CONTENU_TYPES).withMessage('type invalide'),
  body('titre').optional({ nullable: true }).isString().isLength({ max: 200 }),
  body('corps').optional({ nullable: true }).isString().isLength({ max: 2000 })
    .withMessage('Le corps d\'un contenu d\'affichage est limité à 2000 caractères'),
  body('media_url').optional({ nullable: true }).isString().isLength({ max: 300 }),
  body('duree_sec').optional().isInt({ min: 5, max: 60 }).withMessage('duree_sec : 5 à 60 secondes'),
  body('ordre').optional().isInt({ min: 0, max: 9999 }),
  body('visible_du').optional({ nullable: true }).matches(/^\d{4}-\d{2}-\d{2}$/),
  body('visible_au').optional({ nullable: true }).matches(/^\d{4}-\d{2}-\d{2}$/),
  body('site_id').optional({ nullable: true }).isInt(),
  body('actif').optional().isBoolean(),
];

router.get('/contenus', READ, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.*, s.code AS site_code FROM badgeuse_contenus c
       LEFT JOIN badgeuse_sites s ON s.id = c.site_id
       ORDER BY c.ordre, c.id`
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[BADGEUSE] Erreur liste contenus :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/contenus', WRITE, contenuValidators, validate, async (req, res) => {
  try {
    const b = req.body || {};
    const r = await pool.query(
      `INSERT INTO badgeuse_contenus
         (site_id, type, titre, corps, media_url, ordre, duree_sec, visible_du, visible_au, actif, config, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        b.site_id == null ? null : parseInt(b.site_id, 10), b.type || 'message',
        b.titre || null, b.corps || null, b.media_url || null,
        b.ordre == null ? 0 : parseInt(b.ordre, 10),
        b.duree_sec == null ? 10 : parseInt(b.duree_sec, 10),
        b.visible_du || null, b.visible_au || null,
        b.actif === undefined ? true : !!b.actif,
        b.config == null ? null : JSON.stringify(b.config),
        req.user.id,
      ]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[BADGEUSE] Erreur création contenu :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Écran v2 : médias téléversés et liens partagés ─────────────────────────

/**
 * POST /contenus/upload — téléverse une image ou une vidéo et en fait un
 * contenu de playlist de type `media`. Le poste la téléchargera par l'API
 * device et la servira depuis son cache local : la CSP du kiosque reste
 * `'self'` et l'affichage survit à une coupure réseau (AFF-07).
 *
 * Le condensat SHA-256 est calculé EN FLUX (un fichier de 100 Mo n'a pas à
 * passer par la mémoire) : il permet au poste de vérifier son cache sans
 * retélécharger.
 */
router.post('/contenus/upload', WRITE, uploadMediaSingle, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu (champ « fichier » attendu)' });
  const relatif = path.basename(req.file.path);
  try {
    const b = req.body || {};
    const mime = media.mimeForFile(relatif);
    const mediaType = media.mediaTypeForMime(mime);
    if (!mediaType) {
      media.unlinkMedia(relatif);
      return res.status(415).json({ error: 'Type de fichier non diffusable sur l\'écran' });
    }

    // Condensat en flux.
    const sha256 = await new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const flux = fs.createReadStream(req.file.path);
      flux.on('error', reject);
      flux.on('data', (c) => hash.update(c));
      flux.on('end', () => resolve(hash.digest('hex')));
    });

    const r = await pool.query(
      `INSERT INTO badgeuse_contenus
         (site_id, type, titre, ordre, duree_sec, visible_du, visible_au, actif,
          fichier, media_type, media_sha256, cree_par)
       VALUES ($1,'media',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        b.site_id == null || b.site_id === '' ? null : parseInt(b.site_id, 10),
        b.titre || req.file.originalname || 'Média',
        b.ordre == null || b.ordre === '' ? 0 : parseInt(b.ordre, 10),
        b.duree_sec == null || b.duree_sec === '' ? 10 : Math.min(60, Math.max(5, parseInt(b.duree_sec, 10) || 10)),
        b.visible_du || null, b.visible_au || null,
        b.actif === undefined ? true : !(b.actif === 'false' || b.actif === false),
        relatif, mediaType, sha256, req.user.id,
      ]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    // Échec APRÈS l'écriture multer : le fichier orphelin est nettoyé
    // (correctif de la classe signalée par la revue Codex PR#79).
    media.unlinkMedia(relatif);
    console.error('[BADGEUSE] Erreur téléversement média :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * POST /contenus/lien — un utilisateur partage un lien, le SERVEUR télécharge
 * le contenu et le transforme en média local.
 *
 * C'est le point le plus sensible du lot : une URL fournie par un humain
 * déclenche une requête sortante depuis le serveur. Toutes les gardes vivent
 * dans services/badgeuse-social.js (https strict, résolution DNS + refus des
 * plans d'adressage internes, redirections revalidées, type et taille
 * plafonnés, délai borné) — voir l'en-tête de ce fichier pour le risque
 * résiduel documenté (DNS rebinding).
 */
router.post('/contenus/lien', WRITE, [
  body('url').isString().isLength({ min: 8, max: 2000 }).withMessage('url requise'),
  body('titre').optional({ nullable: true }).isString().isLength({ max: 200 }),
  body('duree_sec').optional().isInt({ min: 5, max: 60 }),
  body('ordre').optional().isInt({ min: 0, max: 9999 }),
  body('site_id').optional({ nullable: true }).isInt(),
], validate, async (req, res) => {
  const b = req.body || {};
  let telecharge = null;
  try {
    const params = await readBadgeuseParams();
    const maxBytes = Math.max(1, Number(params.lien_taille_max_mo) || 50) * 1024 * 1024;

    telecharge = await media.downloadMedia(b.url, { maxBytes, prefixe: 'lien' });

    const r = await pool.query(
      `INSERT INTO badgeuse_contenus
         (site_id, type, titre, ordre, duree_sec, visible_du, visible_au, actif,
          fichier, media_type, media_sha256, source_url, cree_par)
       VALUES ($1,'lien',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        b.site_id == null ? null : parseInt(b.site_id, 10),
        b.titre || 'Contenu partagé',
        b.ordre == null ? 0 : parseInt(b.ordre, 10),
        b.duree_sec == null ? 10 : parseInt(b.duree_sec, 10),
        b.visible_du || null, b.visible_au || null,
        b.actif === undefined ? true : !!b.actif,
        telecharge.fichier, telecharge.media_type, telecharge.media_sha256,
        String(b.url).slice(0, 500), req.user.id,
      ]
    );
    res.status(201).json({ ...r.rows[0], octets: telecharge.bytes });
  } catch (err) {
    if (telecharge) media.unlinkMedia(telecharge.fichier); // jamais d'orphelin
    if (err instanceof media.MediaError) {
      // 422 : la demande est bien formée, mais le contenu visé n'est pas
      // diffusable (ou le lien est refusé par les gardes). Message EXPLICITE :
      // l'utilisateur doit comprendre pourquoi, pas deviner.
      return res.status(422).json({ error: err.message, code: err.code });
    }
    console.error('[BADGEUSE] Erreur rapatriement de lien :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/contenus/:id', WRITE, [param('id').isInt(), ...contenuValidators], validate, async (req, res) => {
  try {
    const b = req.body || {};
    const r = await pool.query(
      `UPDATE badgeuse_contenus SET
         site_id = COALESCE($2, site_id), type = COALESCE($3, type),
         titre = COALESCE($4, titre), corps = COALESCE($5, corps),
         media_url = COALESCE($6, media_url), ordre = COALESCE($7, ordre),
         duree_sec = COALESCE($8, duree_sec), visible_du = COALESCE($9, visible_du),
         visible_au = COALESCE($10, visible_au), actif = COALESCE($11, actif),
         config = COALESCE($12::jsonb, config),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        parseInt(req.params.id, 10),
        b.site_id == null ? null : parseInt(b.site_id, 10), b.type || null,
        b.titre === undefined ? null : b.titre, b.corps === undefined ? null : b.corps,
        b.media_url === undefined ? null : b.media_url,
        b.ordre == null ? null : parseInt(b.ordre, 10),
        b.duree_sec == null ? null : parseInt(b.duree_sec, 10),
        b.visible_du || null, b.visible_au || null,
        b.actif === undefined ? null : !!b.actif,
        b.config == null ? null : JSON.stringify(b.config),
      ]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Contenu introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[BADGEUSE] Erreur mise à jour contenu :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/contenus/:id', WRITE, [param('id').isInt()], validate, async (req, res) => {
  try {
    // `fichier` est rendu par le DELETE : supprimer la ligne sans supprimer le
    // binaire laisserait un média orphelin que plus rien ne référence (et que
    // la purge devrait deviner).
    const r = await pool.query(
      'DELETE FROM badgeuse_contenus WHERE id = $1 RETURNING id, fichier',
      [parseInt(req.params.id, 10)]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Contenu introuvable' });
    const fichierSupprime = r.rows[0].fichier ? media.unlinkMedia(r.rows[0].fichier) : false;
    res.json({ deleted: true, id: r.rows[0].id, fichier_supprime: fichierSupprime });
  } catch (err) {
    console.error('[BADGEUSE] Erreur suppression contenu :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// OPT-IN AFFICHAGE FESTIF (ADR-0004 §4) — consentement individuel, tracé
//
// Afficher un anniversaire n'est pas nécessaire au décompte du temps : c'est
// une divulgation supplémentaire, qui exige un CONSENTEMENT LIBRE. Refuser
// n'a aucune conséquence, ce qui rend le consentement valable malgré le lien
// de subordination. Le recueil ET le retrait sont journalisés DANS la
// transaction (même exigence que les actes qui font foi : validation RH,
// rattachement d'orphelin) : sans trace datée, un consentement ne se prouve pas.
// ═══════════════════════════════════════════════════════════════════════════
router.post('/salaries/:employeeId/optin-festif', WRITE, [
  param('employeeId').isInt(),
  body('actif').isBoolean().withMessage('actif (booléen) requis'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const employeeId = parseInt(req.params.employeeId, 10);
    const actif = !!req.body.actif;

    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE employees
       SET badgeuse_optin_festif = $2,
           badgeuse_optin_festif_le = CASE WHEN $2 THEN NOW() ELSE NULL END,
           badgeuse_optin_festif_par = CASE WHEN $2 THEN $3::int ELSE NULL END
       WHERE id = $1
       RETURNING id, badgeuse_optin_festif, badgeuse_optin_festif_le`,
      [employeeId, actif, req.user.id]
    );
    if (upd.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Salarié introuvable' });
    }
    await client.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'BADGEUSE_OPTIN_FESTIF', 'employees', employeeId,
        JSON.stringify({
          employee_id: employeeId,
          consentement: actif ? 'recueilli' : 'retire',
          finalite: 'affichage des anniversaires sur l\'écran du poste de pointage',
          requested_by: req.user.id,
        })]
    );
    await client.query('COMMIT');
    res.json({
      employee_id: employeeId,
      badgeuse_optin_festif: upd.rows[0].badgeuse_optin_festif,
      badgeuse_optin_festif_le: upd.rows[0].badgeuse_optin_festif_le,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
    console.error('[BADGEUSE] Erreur opt-in festif :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// RÉSEAUX SOCIAUX (ADR-0004 §6) — jeton chiffré, jamais relu
// ═══════════════════════════════════════════════════════════════════════════

/**
 * PUT /social/config — jeton Meta et comptes suivis (ADMIN).
 * Le jeton est chiffré AES-256-GCM (pattern SumUp / clés HMAC de site) et
 * n'est JAMAIS renvoyé, même tronqué : seule sa date de configuration l'est.
 */
router.put('/social/config', ADMIN_ONLY, [
  body('meta_token').optional({ nullable: true }).isString().isLength({ max: 500 }),
  body('comptes').optional().isArray({ max: 30 }),
  body('sync_actif').optional().isBoolean(),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const b = req.body || {};
    await client.query('BEGIN');

    if (typeof b.meta_token === 'string' && b.meta_token.trim()) {
      await writeSetting(META_TOKEN_KEY, encryptSecret(b.meta_token.trim()), client);
      await writeSetting(META_TOKEN_CONFIGURE_LE_KEY, new Date().toISOString(), client);
    } else if (b.meta_token === null) {
      // Retrait explicite du jeton (le job redevient un no-op silencieux).
      await writeSetting(META_TOKEN_KEY, null, client);
      await writeSetting(META_TOKEN_CONFIGURE_LE_KEY, null, client);
    }

    if (Array.isArray(b.comptes)) {
      const comptes = b.comptes.slice(0, 30).map((c) => ({
        reseau: c && c.reseau === 'facebook' ? 'facebook' : 'instagram',
        compte: String((c && c.compte) || '').slice(0, 100),
        graph_id: c && c.graph_id ? String(c.graph_id).slice(0, 100) : null,
        actif: !!(c && c.actif),
      })).filter((c) => c.compte);
      await writeSetting('badgeuse.social_comptes', comptes, client);
    }
    if (b.sync_actif !== undefined) {
      await writeSetting('badgeuse.social_sync_actif', !!b.sync_actif, client);
    }
    await client.query('COMMIT');

    await socialStatus(res);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
    console.error('[BADGEUSE] Erreur configuration sociale :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

/** État de la synchronisation sociale — le jeton n'y figure jamais. */
async function socialStatus(res) {
  const params = await readBadgeuseParams();
  const etat = await pool.query(
    'SELECT key, value FROM settings WHERE key IN ($1, $2, $3)',
    [META_TOKEN_KEY, META_TOKEN_CONFIGURE_LE_KEY, SOCIAL_DERNIER_SYNC_KEY]
  );
  const map = new Map(etat.rows.map((x) => [x.key, x.value]));
  let posts = { total: 0, dernier: null };
  try {
    const p = await pool.query(
      'SELECT COUNT(*)::int AS total, MAX(publie_le) AS dernier FROM badgeuse_social_posts'
    );
    posts = { total: p.rows[0].total || 0, dernier: p.rows[0].dernier || null };
  } catch (_) { /* table absente sur une base non migrée */ }

  res.json({
    sync_actif: params.social_sync_actif === true,
    jeton_configure: !!map.get(META_TOKEN_KEY),
    jeton_configure_le: map.get(META_TOKEN_CONFIGURE_LE_KEY) || null,
    dernier_sync: map.get(SOCIAL_DERNIER_SYNC_KEY) || null,
    posts_par_compte: params.social_posts_par_compte,
    comptes: Array.isArray(params.social_comptes) ? params.social_comptes : [],
    posts,
  });
}

router.get('/social/status', READ, async (req, res) => {
  try {
    await socialStatus(res);
  } catch (err) {
    console.error('[BADGEUSE] Erreur état social :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** POST /social/sync — déclenchement à la demande (ADMIN). */
router.post('/social/sync', ADMIN_ONLY, async (req, res) => {
  try {
    const bilan = await media.syncSocialPosts();
    res.json(bilan);
  } catch (err) {
    console.error('[BADGEUSE] Erreur synchronisation sociale :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POSTES (BO-09) + vérification de chaîne (CONTRAT_INTEGRITE §4)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/devices', READ, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT d.id, d.code, d.libelle, d.site_id, d.actif, d.version_logicielle, d.cible,
              d.dernier_heartbeat, d.heartbeat_info, d.cree_le, s.code AS site_code,
              (d.api_key_hash IS NOT NULL) AS appaire
       FROM badgeuse_devices d
       LEFT JOIN badgeuse_sites s ON s.id = d.site_id
       ORDER BY d.code`
    );
    const params = await readBadgeuseParams();
    const silenceMinutes = Math.max(1, Number(params.supervision_silence_minutes) || 15);
    const silenceMs = silenceMinutes * 60 * 1000;
    const now = Date.now();
    // api_key_hash n'est JAMAIS exposé (même son condensat ne sort pas).
    res.json({
      silence_minutes: silenceMinutes,
      devices: r.rows.map((x) => ({
        ...x,
        online: !!x.dernier_heartbeat && (now - new Date(x.dernier_heartbeat).getTime()) < silenceMs,
        // Alerte remontée par le poste dans son heartbeat (QA-02) — remise à
        // plat ici pour que la supervision n'ait pas à fouiller le JSONB.
        alerte: (x.heartbeat_info && x.heartbeat_info.alerte) || null,
      })),
    });
  } catch (err) {
    console.error('[BADGEUSE] Erreur liste postes :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * Appairage d'un poste (ADMIN). La clé device est renvoyée UNE SEULE FOIS —
 * seul son condensat est stocké. Si le site du poste n'a pas encore de clé
 * HMAC, elle est générée ici (chiffrée en base) et renvoyée UNE SEULE FOIS
 * aussi : c'est le seul moment où l'ADMIN peut la copier dans
 * /etc/badgeuse/badgeuse.conf sur le poste (CONTRAT_HMAC §3).
 */
router.post('/devices', ADMIN_ONLY, [
  body('code').isString().isLength({ min: 1, max: 30 }).withMessage('code du poste requis'),
  body('libelle').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('site_id').optional({ nullable: true }).isInt(),
  body('cible').optional({ nullable: true }).isIn(['pi5', 'pi3']),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const code = String(req.body.code).trim();
    const siteId = req.body.site_id == null ? null : parseInt(req.body.site_id, 10);
    const apiKey = generateDeviceKey();

    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO badgeuse_devices (code, libelle, site_id, api_key_hash, cible)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, code, libelle, site_id, actif, cible, cree_le`,
      [code, req.body.libelle || null, siteId, hashDeviceKey(apiKey), req.body.cible || null]
    );

    let hmacKey = null;
    if (siteId != null) {
      const existing = await client.query('SELECT value FROM settings WHERE key = $1', [hmacKeySettingKey(siteId)]);
      if (!existing.rows[0] || !existing.rows[0].value) {
        hmacKey = generateSiteKey();
        await writeSetting(hmacKeySettingKey(siteId), encryptSecret(hmacKey), client);
      }
    }
    await client.query('COMMIT');

    res.status(201).json({
      device: ins.rows[0],
      // Montrées UNE SEULE FOIS — non récupérables ensuite.
      api_key: apiKey,
      hmac_key: hmacKey,
      avertissement: 'Copiez ces clés maintenant : elles ne seront plus jamais affichées.',
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
    if (err.code === '23505') return res.status(409).json({ error: 'Un poste porte déjà ce code' });
    console.error('[BADGEUSE] Erreur création poste :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

router.post('/devices/:id/regenerate-key', ADMIN_ONLY, [param('id').isInt()], validate, async (req, res) => {
  try {
    const apiKey = generateDeviceKey();
    const r = await pool.query(
      'UPDATE badgeuse_devices SET api_key_hash = $2 WHERE id = $1 RETURNING id, code',
      [parseInt(req.params.id, 10), hashDeviceKey(apiKey)]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Poste introuvable' });
    res.json({
      device: r.rows[0],
      api_key: apiKey,
      avertissement: 'L\'ancienne clé est révoquée immédiatement : le poste ne pourra plus déposer tant qu\'il n\'aura pas la nouvelle.',
    });
  } catch (err) {
    console.error('[BADGEUSE] Erreur régénération clé :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * Émission d'un CODE D'APPAIRAGE court (ADR-0005). Remplace la recopie à la
 * main de deux clés de 64 caractères hex sur le clavier d'un Raspberry — la
 * première cause d'échec de mise en service observée.
 *
 * Le code est un SECRET COURT : il n'est stocké que sous forme de condensat
 * SHA-256 (comme la clé device), il expire (`badgeuse.appairage_ttl_minutes`,
 * défaut 15 min) et il est CONSOMMÉ à la première réclamation réussie. Émettre
 * un nouveau code écrase le précédent : un seul code vit à la fois par poste.
 *
 * Le code en clair n'existe que dans cette réponse HTTP. Il n'est écrit NI en
 * base, NI dans les journaux (un test le vérifie sur les sorties console).
 */
router.post('/devices/:id/code-appairage', ADMIN_ONLY, [param('id').isInt()], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const params = await readBadgeuseParams();
    // Borné [1 min, 24 h] : un réglage aberrant en base ne doit ni produire un
    // code déjà expiré, ni un secret quasi permanent (ADR-0005, alternative
    // « code sans expiration » explicitement refusée).
    const ttl = Math.min(1440, Math.max(1, Number(params.appairage_ttl_minutes) || 15));
    const code = generateAppairageCode();

    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE badgeuse_devices
       SET appairage_code_hash = $2, appairage_expire_le = NOW() + make_interval(mins => $3::int)
       WHERE id = $1
       RETURNING id, code, libelle, site_id, cible, appairage_expire_le`,
      [id, hashAppairageCode(code), ttl]
    );
    if (upd.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Poste introuvable' });
    }
    // Journalisation DANS la transaction : l'émission d'un secret de mise en
    // service est un acte d'administration, il fait foi (pattern des actes
    // probants du module — validation RH, exports).
    await client.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'BADGEUSE_CODE_APPAIRAGE', 'badgeuse_devices', id,
        JSON.stringify({
          device_code: upd.rows[0].code,
          ttl_minutes: ttl,
          expire_le: upd.rows[0].appairage_expire_le,
          requested_by: req.user.id,
        })]
    );
    await client.query('COMMIT');

    // Le poste et la fenêtre, JAMAIS le code.
    console.log(`[BADGEUSE] Code d'appairage émis pour le poste ${upd.rows[0].code} (valable ${ttl} min)`);

    res.json({
      device: {
        id: upd.rows[0].id, code: upd.rows[0].code, libelle: upd.rows[0].libelle,
        site_id: upd.rows[0].site_id, cible: upd.rows[0].cible,
      },
      // Affiché UNE SEULE FOIS. Le tiret est une aide à la lecture : le poste
      // accepte le code avec ou sans, en majuscules ou en minuscules.
      code: formatAppairageCode(code),
      expire_le: upd.rows[0].appairage_expire_le,
      ttl_minutes: ttl,
      avertissement: `Ce code est affiché une seule fois. Il est valable ${ttl} minutes et ne sert qu'une fois.`,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
    console.error('[BADGEUSE] Erreur émission code d\'appairage :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

/**
 * Suppression d'un poste (ADMIN). REFUSÉE dès qu'il a enregistré un pointage :
 * un poste qui a compté des heures fait partie de la PISTE D'AUDIT. Sa
 * disparition rendrait des pointages inexplicables (`device_id` passerait à
 * NULL) et casserait la vérification de chaîne d'intégrité, qui s'ancre sur le
 * CODE du poste. La bonne manœuvre est la désactivation (PATCH actif=false) :
 * le poste cesse d'être accepté, ses heures restent lisibles.
 */
router.delete('/devices/:id', ADMIN_ONLY, [param('id').isInt()], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    await client.query('BEGIN');
    const dev = await client.query(
      'SELECT id, code, libelle, site_id FROM badgeuse_devices WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (dev.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Poste introuvable' });
    }
    const cnt = await client.query(
      'SELECT COUNT(*)::int AS n FROM badgeuse_pointages WHERE device_id = $1',
      [id]
    );
    const pointages = cnt.rows[0] ? Number(cnt.rows[0].n) : 0;
    if (pointages > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Ce poste a enregistré ${pointages} pointage(s) : il appartient à la piste d'audit et ne peut pas être supprimé. Désactivez-le plutôt — il cessera d'accepter les dépôts et ses heures resteront consultables.`,
        pointages,
      });
    }
    await client.query('DELETE FROM badgeuse_devices WHERE id = $1', [id]);
    await client.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'BADGEUSE_DEVICE_SUPPRESSION', 'badgeuse_devices', id,
        JSON.stringify({
          device_code: dev.rows[0].code,
          libelle: dev.rows[0].libelle,
          site_id: dev.rows[0].site_id,
          pointages: 0,
          requested_by: req.user.id,
        })]
    );
    await client.query('COMMIT');
    console.log(`[BADGEUSE] Poste ${dev.rows[0].code} supprimé (aucun pointage enregistré)`);
    res.json({ supprime: true, device: dev.rows[0] });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
    console.error('[BADGEUSE] Erreur suppression poste :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

router.patch('/devices/:id', ADMIN_ONLY, [
  param('id').isInt(),
  body('actif').optional().isBoolean(),
  body('libelle').optional({ nullable: true }).isString().isLength({ max: 120 }),
], validate, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE badgeuse_devices
       SET actif = COALESCE($2, actif), libelle = COALESCE($3, libelle)
       WHERE id = $1
       RETURNING id, code, libelle, site_id, actif, version_logicielle, cible, dernier_heartbeat`,
      [
        parseInt(req.params.id, 10),
        req.body.actif === undefined ? null : !!req.body.actif,
        req.body.libelle === undefined ? null : req.body.libelle,
      ]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Poste introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[BADGEUSE] Erreur mise à jour poste :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * Vérification a posteriori de la chaîne d'intégrité (CONTRAT_INTEGRITE §4).
 * Re-parcourt la chaîne STOCKÉE et recalcule chaque maillon : une modification
 * directe en base (UPDATE d'un horodatage) est détectée ici, puisque le hash
 * recalculé sur les colonnes ne correspondra plus au hash enregistré.
 */
router.get('/devices/:id/verify-chain', READ, [
  param('id').isInt(),
  q('du').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
  q('au').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
], validate, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const dev = await pool.query('SELECT id, code FROM badgeuse_devices WHERE id = $1', [id]);
    if (dev.rows.length === 0) return res.status(404).json({ error: 'Poste introuvable' });

    const clauses = ['p.device_id = $1', 'p.sequence_device IS NOT NULL'];
    const vals = [id];
    if (req.query.du) { vals.push(engine.parisDateTimeToUTC(req.query.du, '00:00')); clauses.push(`p.horodatage_utc >= $${vals.length}`); }
    if (req.query.au) {
      const lendemain = engine.parisDateStr(new Date(engine.parisDateTimeToUTC(req.query.au, '12:00').getTime() + 24 * 3600 * 1000));
      vals.push(engine.parisDateTimeToUTC(lendemain, '00:00'));
      clauses.push(`p.horodatage_utc < $${vals.length}`);
    }

    const r = await pool.query(
      `SELECT p.uuid, p.sequence_device, p.uid_hmac, p.horodatage_utc, p.sens, p.source,
              p.hash_precedent, p.hash_courant, p.chaine_valide
       FROM badgeuse_pointages p
       WHERE ${clauses.join(' AND ')}
       ORDER BY p.sequence_device`,
      vals
    );

    const ruptures = [];
    // Sur une fenêtre partielle, le premier maillon n'a pas son prédécesseur
    // dans le jeu : on part de son hash_precedent enregistré (on vérifie alors
    // le contenu, pas l'ancrage à la genèse — c'est dit dans la réponse).
    let attenduPrecedent = r.rows[0]
      ? (Number(r.rows[0].sequence_device) === 1 ? genesisHash(dev.rows[0].code) : r.rows[0].hash_precedent)
      : genesisHash(dev.rows[0].code);

    for (const p of r.rows) {
      // `uid_hmac` NULL en base ⇔ `-` dans la charge canonique : la symétrie
      // avec le poste est portée par canonicalPointage (QA-01).
      let canonical;
      try {
        canonical = canonicalPointage({
          uuid: p.uuid,
          device_code: dev.rows[0].code,
          sequence_device: p.sequence_device,
          uid_hmac: p.uid_hmac,
          horodatage_utc: p.horodatage_utc,
          sens: p.sens,
          source: p.source,
        });
      } catch (e) {
        // Charge canonique impossible à reconstituer (champ vide / séparateur
        // en base) : c'est une RUPTURE, pas un 500 — la vérification continue.
        ruptures.push({
          sequence: Number(p.sequence_device),
          attendu: null,
          trouve: p.hash_courant,
          raison: 'canonique_impossible',
        });
        attenduPrecedent = p.hash_courant;
        continue;
      }
      const recalcule = chainHash(attenduPrecedent, canonical);
      if (recalcule !== String(p.hash_courant || '').toLowerCase()) {
        ruptures.push({
          sequence: Number(p.sequence_device),
          attendu: recalcule,
          trouve: p.hash_courant,
        });
      }
      attenduPrecedent = p.hash_courant;
    }

    res.json({
      ok: ruptures.length === 0,
      device_code: dev.rows[0].code,
      total: r.rows.length,
      ancrage_genese: !!(r.rows[0] && Number(r.rows[0].sequence_device) === 1),
      ruptures,
    });
  } catch (err) {
    console.error('[BADGEUSE] Erreur vérification de chaîne :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ACCÈS DU SALARIÉ À SES PROPRES DONNÉES (art. 15 — droit satisfait par
// construction, NOTE_JURIDIQUE §3.9). Ouvert à TOUT utilisateur authentifié :
// c'est le seul endpoint du module qui ne demande aucun rôle, parce qu'il ne
// donne accès qu'aux données de la personne connectée.
// ═══════════════════════════════════════════════════════════════════════════

router.get('/mes-pointages', [
  q('periode').optional().matches(/^\d{4}-\d{2}$/),
], validate, async (req, res) => {
  try {
    const emp = await pool.query('SELECT id, first_name, last_name FROM employees WHERE user_id = $1', [req.user.id]);
    if (emp.rows.length === 0) {
      return res.status(404).json({ error: 'Aucune fiche salarié n\'est liée à votre compte' });
    }
    const employeeId = emp.rows[0].id;
    const periode = req.query.periode || engine.parisDateStr(new Date()).slice(0, 7);
    const bornes = bornesPeriode(periode);
    const params = await readBadgeuseParams();

    const { pointages, corrections, jours } = await computeEmployeePeriod(employeeId, bornes.debut, bornes.fin, params);
    const mois = engine.computeMonth(jours, params, { periode });
    const feuille = await pool.query(
      'SELECT statut, heures_validees, valide_rh_le FROM badgeuse_feuilles_temps WHERE employee_id = $1 AND periode = $2',
      [employeeId, periode]
    );

    // La transparence est totale dans les deux sens (NOTE_RH §5.2) : le salarié
    // voit ses pointages ET les corrections apportées, avec leur motif.
    res.json({
      employee_id: employeeId,
      periode,
      heures_pointees: mois.heures_pointees,
      heures_hms: mois.heures_hms,
      jours_travailles: mois.jours_travailles,
      jours: mois.detail,
      pointages: pointages.map((p) => ({
        id: Number(p.id), horodatage_utc: p.horodatage_utc, sens: p.sens, source: p.source, statut: p.statut,
      })),
      corrections: corrections.map((c) => ({
        id: c.id, type: c.type, horodatage_corrige: c.horodatage_corrige,
        sens_corrige: c.sens_corrige, motif_code: c.motif_code, motif_detail: c.motif_detail,
      })),
      feuille: feuille.rows[0] || null,
    });
  } catch (err) {
    console.error('[BADGEUSE] Erreur mes-pointages :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * Relevé individuel remis au salarié (sortie, contestation). Journalisé (BO-11).
 */
router.get('/salaries/:employeeId/releve', READ, [
  param('employeeId').isInt(),
  q('periode').matches(/^\d{4}-\d{2}$/).withMessage('periode « YYYY-MM » requise'),
], validate, async (req, res) => {
  try {
    const employeeId = parseInt(req.params.employeeId, 10);
    const periode = req.query.periode;
    const bornes = bornesPeriode(periode);
    const params = await readBadgeuseParams();

    const emp = await pool.query(
      'SELECT id, first_name, last_name, malibou_id FROM employees WHERE id = $1', [employeeId]
    );
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Salarié introuvable' });

    const { pointages, corrections, jours } = await computeEmployeePeriod(employeeId, bornes.debut, bornes.fin, params);
    const mois = engine.computeMonth(jours, params, { periode });
    const feuille = await pool.query(
      'SELECT statut, heures_validees, valide_rh_le FROM badgeuse_feuilles_temps WHERE employee_id = $1 AND periode = $2',
      [employeeId, periode]
    );

    logConsultation(req, 'BADGEUSE_CONSULTATION', 'employees', employeeId, {
      employee_id: employeeId, periode, portee: 'releve_individuel',
    });

    res.json({
      employee_id: employeeId,
      nom: formatNom(emp.rows[0].last_name, emp.rows[0].first_name),
      matricule: emp.rows[0].malibou_id || null,
      periode,
      heures_pointees: mois.heures_pointees,
      heures_hms: mois.heures_hms,
      jours_travailles: mois.jours_travailles,
      jours: mois.detail,
      pointages: pointages.map((p) => ({
        id: Number(p.id), horodatage_utc: p.horodatage_utc, sens: p.sens, source: p.source, statut: p.statut,
      })),
      corrections: corrections.map((c) => ({
        id: c.id, type: c.type, horodatage_corrige: c.horodatage_corrige,
        sens_corrige: c.sens_corrige, motif_code: c.motif_code, motif_detail: c.motif_detail,
      })),
      feuille: feuille.rows[0] || null,
    });
  } catch (err) {
    console.error('[BADGEUSE] Erreur relevé individuel :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SITES (support de l'appairage multi-site)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/sites', READ, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, code, libelle, actif, created_at FROM badgeuse_sites ORDER BY code');
    res.json(r.rows);
  } catch (err) {
    console.error('[BADGEUSE] Erreur liste sites :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
