/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MESSAGERIE INTERNE — service partagé (lot L1, contrat §2.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ce module est LE PONT DES NOTIFICATIONS : tout ce qui alerte aujourd'hui par
 * courriel (Brevo), par push VAPID ou par la table `driver_messages` peut, en
 * plus, déposer un message dans la conversation « SOLIDATA » de la personne
 * concernée. Il S'AJOUTE aux canaux existants, il n'en remplace aucun
 * (arbitrage §12.3 du contrat) : une consigne au chauffeur continue d'écrire
 * dans `driver_messages`, un rappel RH continue de partir par Brevo.
 *
 * DEUX RÈGLES QUI GOUVERNENT TOUT LE FICHIER
 *
 * 1. AUCUNE fonction publique ne lève d'exception. Une notification qui échoue
 *    ne doit JAMAIS faire tomber l'action métier qui l'a déclenchée (clôturer
 *    une tournée, valider une checklist, réordonner un programme). Toute erreur
 *    résout donc en `{ ok: false, motif }` — un motif lisible, jamais un
 *    silence, jamais un `true` de complaisance.
 *
 * 2. L'IDENTITÉ D'UN CHAUFFEUR EST SON VÉHICULE, jamais son compte. Le compte
 *    `chauffeur` est générique et PARTAGÉ entre tous les camions (« 1 URL =
 *    1 véhicule ») : router par `users.id` enverrait les consignes de tous les
 *    camions à tous les téléphones. D'où la double clé `user_id`/`vehicle_id`
 *    sur les participants, et les salles Socket.IO distinctes
 *    `user:<id>` / `vehicule:<id>`.
 *
 * Émission temps réel via `global.__io` (exposé par index.js). Absent (tests,
 * scripts CLI, worker sans serveur HTTP) → on dégrade sans erreur : le message
 * est en base, il sera lu au prochain chargement. Le socket ne sert QU'À la
 * poussée ; la source de vérité est PostgreSQL.
 */

const pool = require('../config/database');
const { resolveBaseRole } = require('../middleware/auth');

// ── Constantes partagées avec routes/messages.js ────────────────────────────

/** Longueur maximale d'un message (au-delà : 400 côté REST). */
const TEXTE_MAX = 4000;
/** Rétention par défaut si le réglage `messagerie.retention_jours` est absent. */
const RETENTION_DEFAUT_JOURS = 365;
/** Titre de la conversation de notifications applicatives. */
const TITRE_SYSTEME = 'SOLIDATA';
/** Titre de la conversation du bot conversationnel. */
const TITRE_BOT = 'SolidataBot';
/** Nombre maximal de mentions traitées dans un même message (anti-abus). */
const MENTIONS_MAX = 10;

const salleUtilisateur = (id) => `user:${id}`;
const salleVehicule = (id) => `vehicule:${id}`;

// ── Clé de déduplication d'une conversation ────────────────────────────────
//
// Calculée SERVEUR, jamais saisie. Segments `u<user_id>` / `v<vehicle_id>` des
// participants, dédoublonnés, triés, préfixés du type :
//   `directe:u3:u7` · `directe:u3:v1` · `bot:u3` · `systeme:v1`
// C'est elle (index UNIQUE) qui garantit qu'un double clic sur « écrire à
// Untel » ouvre la conversation existante au lieu d'en créer une seconde.

function segmentParticipant(p) {
  if (!p) return null;
  if (p.user_id != null) return `u${p.user_id}`;
  if (p.vehicle_id != null) return `v${p.vehicle_id}`;
  return null;
}

function calculerCleUnique(type, participants) {
  const segments = (participants || []).map(segmentParticipant).filter(Boolean);
  const uniques = Array.from(new Set(segments)).sort();
  return `${type}:${uniques.join(':')}`;
}

// ── Mentions @ ─────────────────────────────────────────────────────────────
//
// Le `@` doit être en début de texte ou précédé d'un caractère qui n'appartient
// pas à un identifiant : sans cette garde, « julien.gonde@gmail.com » serait lu
// comme une mention de l'utilisateur « gmail.com ». La ponctuation finale est
// retirée pour que « préviens @admin. » mentionne bien `admin`.

const RE_MENTION = /(^|[^A-Za-z0-9À-ÖØ-öø-ÿ@._-])@([A-Za-z0-9À-ÖØ-öø-ÿ][A-Za-z0-9À-ÖØ-öø-ÿ._-]{0,99})/g;

/**
 * Extrait les identifiants mentionnés d'un texte libre.
 * @param {string} texte
 * @returns {string[]} identifiants en minuscules, dédoublonnés, plafonnés
 */
function extraireMentions(texte) {
  if (typeof texte !== 'string' || texte.length === 0) return [];
  const trouves = [];
  RE_MENTION.lastIndex = 0;
  let m;
  while ((m = RE_MENTION.exec(texte)) !== null) {
    const brut = String(m[2]).replace(/[._-]+$/, '');
    if (!brut) continue;
    const cle = brut.toLowerCase();
    if (!trouves.includes(cle)) trouves.push(cle);
    if (trouves.length >= MENTIONS_MAX) break;
  }
  return trouves;
}

// ── Libellés d'identité ────────────────────────────────────────────────────

/**
 * « Prénom NOM » (contrat §2.3), repli sur l'identifiant de connexion quand
 * l'état civil n'est pas renseigné — jamais une chaîne vide, jamais « undefined ».
 */
function nomUtilisateur(u) {
  if (!u) return null;
  const prenom = (u.first_name || '').trim();
  const nom = (u.last_name || '').trim().toUpperCase();
  const complet = `${prenom} ${nom}`.trim();
  return complet || (u.username || null);
}

/** « AB-123-CD — Camion 2 » : l'immatriculation d'abord, c'est elle qui identifie. */
function nomVehicule(v) {
  if (!v) return null;
  const immat = (v.registration || '').trim();
  const nom = (v.name || '').trim();
  if (immat && nom) return `${immat} — ${nom}`;
  return immat || nom || null;
}

// ── Accès base : conversation, message, non-lus ────────────────────────────

/**
 * Crée ou retrouve une conversation par sa clé unique, et garantit la présence
 * de ses participants. Idempotent : deux appels concurrents ne créent qu'une
 * conversation (ON CONFLICT sur `cle_unique`).
 *
 * @param {object} client client PostgreSQL (transaction en cours)
 * @param {object} args { type, titre, participants: [{user_id?, vehicle_id?}], createdBy }
 * @returns {Promise<{id:number, cle_unique:string, creee:boolean}>}
 */
async function assurerConversation(client, { type, titre = null, participants = [], createdBy = null }) {
  const cle = calculerCleUnique(type, participants);
  const insere = await client.query(
    `INSERT INTO messagerie_conversations (type, titre, cle_unique, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (cle_unique) DO NOTHING
     RETURNING id`,
    [type, titre, cle, createdBy]
  );

  let id;
  let creee = false;
  if (insere.rows.length > 0) {
    id = insere.rows[0].id;
    creee = true;
  } else {
    const relu = await client.query(
      'SELECT id FROM messagerie_conversations WHERE cle_unique = $1', [cle]);
    if (relu.rows.length === 0) {
      throw new Error(`Conversation introuvable après conflit sur la clé ${cle}`);
    }
    id = relu.rows[0].id;
  }

  for (const p of participants) {
    if (!segmentParticipant(p)) continue;
    // ON CONFLICT sans cible : couvre les DEUX index partiels (user / véhicule).
    await client.query(
      `INSERT INTO messagerie_participants (conversation_id, user_id, vehicle_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [id, p.user_id != null ? p.user_id : null, p.vehicle_id != null ? p.vehicle_id : null]
    );
  }

  return { id, cle_unique: cle, creee };
}

/**
 * Insère un message et avance `dernier_message_at` de la conversation.
 * @returns {Promise<object>} la ligne insérée
 */
async function insererMessage(client, {
  conversationId, auteurType, auteurUserId = null, auteurVehicleId = null,
  texte, type = 'texte', source = null, lien = null,
}) {
  const r = await client.query(
    `INSERT INTO messagerie_messages
       (conversation_id, auteur_type, auteur_user_id, auteur_vehicle_id, texte, type, source, lien)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, conversation_id, auteur_type, auteur_user_id, auteur_vehicle_id,
               texte, type, source, lien, created_at`,
    [conversationId, auteurType, auteurUserId, auteurVehicleId, texte, type, source, lien]
  );
  const message = r.rows[0];
  await client.query(
    'UPDATE messagerie_conversations SET dernier_message_at = $2 WHERE id = $1',
    [conversationId, message.created_at]
  );
  return message;
}

/**
 * Prédicat « ce message n'est pas de moi », donc susceptible d'être non lu.
 *
 * Un message est « à moi » si je l'ai écrit : `auteur_user_id` = mon compte, ou
 * `auteur_vehicle_id` = mon véhicule. Tout le reste compte — un message SYSTÈME
 * n'a NI l'un NI l'autre et doit compter pour tout le monde : c'est précisément
 * le but d'une alerte.
 *
 * PIÈGE DES TROIS VALEURS, débusqué sur base réelle : écrit `m.auteur_user_id =
 * p.user_id`, la comparaison vaut NULL — et non `false` — dès que la colonne
 * d'auteur est NULL. `NOT NULL` valant NULL, la ligne est écartée : TOUTES les
 * notifications système et TOUS les messages d'un véhicule vers un utilisateur
 * (et réciproquement) devenaient invisibles du compteur. Les pastilles seraient
 * restées à zéro pendant qu'une consigne attendait sur un téléphone.
 * `IS NOT DISTINCT FROM` ne renvoie jamais NULL : le prédicat redevient binaire.
 *
 * Expression partagée par les TROIS lectures de non-lus (service + les deux
 * endpoints) — une seule définition, sinon elles divergeraient au premier
 * correctif.
 */
const SQL_PAS_DE_MOI = `NOT (
          (p.user_id IS NOT NULL AND m.auteur_user_id IS NOT DISTINCT FROM p.user_id)
       OR (p.vehicle_id IS NOT NULL AND m.auteur_vehicle_id IS NOT DISTINCT FROM p.vehicle_id))`;

/** Compteur de non-lus, par participant d'une conversation. */
async function nonLusParParticipant(executor, conversationId) {
  const r = await executor.query(
    `SELECT p.user_id, p.vehicle_id,
            (SELECT COUNT(*)::int FROM messagerie_messages m
              WHERE m.conversation_id = p.conversation_id
                AND m.id > COALESCE(p.dernier_lu_message_id, 0)
                AND ${SQL_PAS_DE_MOI}
            ) AS non_lus
       FROM messagerie_participants p
      WHERE p.conversation_id = $1`,
    [conversationId]
  );
  return r.rows;
}

/**
 * Pousse un message vers les salles Socket.IO des participants, chacun avec SON
 * compteur de non-lus. Best effort absolu : ni `global.__io` absent, ni une
 * requête en échec ne doivent remonter à l'appelant (le message est déjà en
 * base — la poussée n'est qu'un confort).
 */
async function emettreNouveauMessage(conversationId, message, auteurNom, executor = pool) {
  try {
    const io = global.__io;
    if (!io) return { ok: false, motif: 'temps réel indisponible' };
    const participants = await nonLusParParticipant(executor, conversationId);
    const charge = {
      id: message.id,
      conversation_id: message.conversation_id,
      auteur_type: message.auteur_type,
      auteur_user_id: message.auteur_user_id,
      auteur_vehicle_id: message.auteur_vehicle_id,
      auteur_nom: auteurNom || null,
      texte: message.texte,
      type: message.type,
      source: message.source,
      lien: message.lien,
      created_at: message.created_at,
    };
    for (const p of participants) {
      const salle = p.user_id != null ? salleUtilisateur(p.user_id)
        : (p.vehicle_id != null ? salleVehicule(p.vehicle_id) : null);
      if (!salle) continue;
      io.to(salle).emit('messagerie:nouveau', {
        conversation_id: conversationId,
        message: charge,
        non_lus_conversation: p.non_lus,
      });
    }
    return { ok: true, destinataires: participants.length };
  } catch (err) {
    // Jamais de log du CONTENU d'un message (vie privée) : identifiants seuls.
    console.error('[MESSAGERIE] Poussée temps réel ignorée :', err.message);
    return { ok: false, motif: err.message };
  }
}

/** Émet le déplacement du pointeur de lecture (synchronisation multi-appareil). */
function emettreLecture(salle, conversationId, dernierLuMessageId) {
  try {
    const io = global.__io;
    if (!io || !salle) return false;
    io.to(salle).emit('messagerie:lu', {
      conversation_id: conversationId,
      dernier_lu_message_id: dernierLuMessageId,
    });
    return true;
  } catch (err) {
    console.error('[MESSAGERIE] Émission « lu » ignorée :', err.message);
    return false;
  }
}

// ── §2.1 — envoyerMessageSysteme ───────────────────────────────────────────

/**
 * Dépose une notification applicative dans la conversation « SOLIDATA » d'UN
 * destinataire (utilisateur, salarié via son compte, ou véhicule).
 *
 * @param {object} args
 * @param {number|null} args.destinataire_user_id     compte utilisateur
 * @param {number|null} args.destinataire_employee_id fiche salarié (résolue via employees.user_id)
 * @param {number|null} args.destinataire_vehicle_id  véhicule (équipage en tournée)
 * @param {string} args.texte
 * @param {string} [args.source='systeme'] origine fonctionnelle ('programme', 'checklist'…)
 * @param {string|null} [args.lien] chemin applicatif cliquable ('/vehicles', '/messagerie?conversation=12')
 * @returns {Promise<{ok:true, conversation_id:number, message_id:number}|{ok:false, motif:string}>}
 */
async function envoyerMessageSysteme({
  destinataire_user_id = null, destinataire_employee_id = null,
  destinataire_vehicle_id = null, texte, source = 'systeme', lien = null,
} = {}) {
  const contenu = typeof texte === 'string' ? texte.trim() : '';
  if (!contenu) return { ok: false, motif: 'texte vide' };

  const fournis = [destinataire_user_id, destinataire_employee_id, destinataire_vehicle_id]
    .filter((v) => v != null && v !== '');
  if (fournis.length === 0) return { ok: false, motif: 'aucun destinataire' };
  if (fournis.length > 1) return { ok: false, motif: 'plusieurs destinataires fournis' };

  let client;
  try {
    let userId = destinataire_user_id != null ? parseInt(destinataire_user_id, 10) : null;
    let vehicleId = destinataire_vehicle_id != null ? parseInt(destinataire_vehicle_id, 10) : null;

    // Salarié → compte utilisateur. Une fiche de paie SANS compte ERP est le cas
    // NORMAL (les fiches viennent de Malibou) : on le dit, on n'invente pas un
    // destinataire de repli qui ferait croire la notification délivrée.
    if (destinataire_employee_id != null) {
      const empId = parseInt(destinataire_employee_id, 10);
      if (!Number.isInteger(empId)) return { ok: false, motif: 'identifiant salarié illisible' };
      const r = await pool.query('SELECT user_id FROM employees WHERE id = $1', [empId]);
      if (r.rows.length === 0) return { ok: false, motif: 'salarié inconnu' };
      if (r.rows[0].user_id == null) return { ok: false, motif: 'employé sans compte utilisateur' };
      userId = r.rows[0].user_id;
    }

    if (userId != null && !Number.isInteger(userId)) return { ok: false, motif: 'identifiant utilisateur illisible' };
    if (vehicleId != null && !Number.isInteger(vehicleId)) return { ok: false, motif: 'identifiant véhicule illisible' };

    const participant = userId != null ? { user_id: userId } : { vehicle_id: vehicleId };

    client = await pool.connect();
    await client.query('BEGIN');
    const conv = await assurerConversation(client, {
      type: 'systeme',
      titre: TITRE_SYSTEME,
      participants: [participant],
      createdBy: null,
    });
    const message = await insererMessage(client, {
      conversationId: conv.id,
      auteurType: 'systeme',
      texte: contenu.slice(0, TEXTE_MAX),
      type: 'notification',
      source: source || 'systeme',
      lien: lien || null,
    });
    await client.query('COMMIT');

    await emettreNouveauMessage(conv.id, message, TITRE_SYSTEME);
    return { ok: true, conversation_id: conv.id, message_id: message.id };
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[MESSAGERIE] envoyerMessageSysteme :', err.message);
    return { ok: false, motif: err.message };
  } finally {
    if (client) client.release();
  }
}

// ── §2.1 — envoyerMessageSystemeRoles ──────────────────────────────────────

/**
 * Même dépôt, à tous les utilisateurs ACTIFS d'un ou plusieurs rôles.
 *
 * Le filtrage passe par `resolveBaseRole` (middleware/auth) : un rôle
 * personnalisé (ex. « REF_RSE », dupliqué de MANAGER) reçoit ce que reçoit son
 * rôle de base. C'est un écart ASSUMÉ avec `sendPushToRoles`, qui compare le
 * rôle BRUT (`u.role = ANY($1)`) et rate donc les rôles personnalisés : écart
 * documenté au contrat §2.1, non corrigé ici (hors périmètre du lot).
 *
 * @param {string[]} roles rôles de base visés ('ADMIN', 'MANAGER'…)
 * @param {object} args { texte, source, lien }
 * @returns {Promise<{ok:true, envoyes:number, echecs:Array}|{ok:false, motif:string}>}
 */
async function envoyerMessageSystemeRoles(roles, { texte, source = 'systeme', lien = null } = {}) {
  if (!Array.isArray(roles) || roles.length === 0) return { ok: false, motif: 'aucun rôle visé' };
  const contenu = typeof texte === 'string' ? texte.trim() : '';
  if (!contenu) return { ok: false, motif: 'texte vide' };

  try {
    const r = await pool.query('SELECT id, role FROM users WHERE is_active = true');
    const cibles = r.rows.filter((u) => roles.includes(resolveBaseRole(u.role)));

    let envoyes = 0;
    const echecs = [];
    for (const u of cibles) {
      const res = await envoyerMessageSysteme({
        destinataire_user_id: u.id, texte: contenu, source, lien,
      });
      if (res.ok) envoyes += 1;
      else echecs.push({ user_id: u.id, motif: res.motif });
    }
    return { ok: true, envoyes, echecs };
  } catch (err) {
    console.error('[MESSAGERIE] envoyerMessageSystemeRoles :', err.message);
    return { ok: false, motif: err.message };
  }
}

// ── §2.1 — purgeMessagerieRetention (RGPD) ─────────────────────────────────

/** Lit `messagerie.retention_jours` ; jamais de durée en dur dans le code. */
async function lireRetentionJours() {
  try {
    const r = await pool.query("SELECT value FROM settings WHERE key = 'messagerie.retention_jours'");
    const brut = r.rows[0] ? parseInt(r.rows[0].value, 10) : NaN;
    if (Number.isInteger(brut) && brut > 0) return brut;
  } catch (err) {
    console.error('[MESSAGERIE] Réglage de rétention illisible :', err.message);
  }
  return RETENTION_DEFAUT_JOURS;
}

/**
 * Purge de rétention RGPD (job planifié).
 *
 * Trois gestes, dans cet ordre :
 *   1. suppression des messages plus vieux que la rétention ;
 *   2. RECALAGE des accusés de lecture devenus orphelins — le pointeur désigne
 *      un message purgé : on le ramène au dernier message ENCORE PRÉSENT qui le
 *      précède, sinon à NULL. Jamais de marquage « lu » d'un message que
 *      personne n'a ouvert ;
 *   3. suppression des conversations vides et sans activité depuis la rétention
 *      (une conversation vide mais récente est conservée : elle vient d'être
 *      ouverte, son fil est simplement encore blanc).
 *
 * Journalisée dans `rgpd_audit_log` UNIQUEMENT si elle a supprimé quelque chose
 * (pattern `badgeusePurgeRetention`) : un journal qui se remplit de « 0 » chaque
 * jour noie les vraies purges.
 */
async function purgeMessagerieRetention() {
  const retentionJours = await lireRetentionJours();
  let messagesSupprimes = 0;
  let conversationsSupprimees = 0;
  let pointeursRecales = 0;

  try {
    const sup = await pool.query(
      "DELETE FROM messagerie_messages WHERE created_at < NOW() - ($1 || ' days')::interval",
      [String(retentionJours)]
    );
    messagesSupprimes = sup.rowCount || 0;

    const recal = await pool.query(
      `UPDATE messagerie_participants p
          SET dernier_lu_message_id = (
                SELECT MAX(m.id) FROM messagerie_messages m
                 WHERE m.conversation_id = p.conversation_id
                   AND m.id <= p.dernier_lu_message_id)
        WHERE p.dernier_lu_message_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM messagerie_messages m2 WHERE m2.id = p.dernier_lu_message_id)`
    );
    pointeursRecales = recal.rowCount || 0;

    const conv = await pool.query(
      `DELETE FROM messagerie_conversations c
        WHERE NOT EXISTS (SELECT 1 FROM messagerie_messages m WHERE m.conversation_id = c.id)
          AND COALESCE(c.dernier_message_at, c.created_at) < NOW() - ($1 || ' days')::interval`,
      [String(retentionJours)]
    );
    conversationsSupprimees = conv.rowCount || 0;

    const total = messagesSupprimes + conversationsSupprimees;
    if (total > 0) {
      await pool.query(
        `INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details)
         VALUES (NULL, 'AUTO_PURGE_MESSAGERIE', 'messagerie_messages', 0, $1)`,
        [JSON.stringify({
          messages_supprimes: messagesSupprimes,
          conversations_supprimees: conversationsSupprimees,
          pointeurs_recales: pointeursRecales,
          retention_jours: retentionJours,
        })]
      ).catch((err) => console.error('[MESSAGERIE] Journalisation de la purge impossible :', err.message));
      console.log(`[MESSAGERIE] Purge RGPD : ${messagesSupprimes} message(s), `
        + `${conversationsSupprimees} conversation(s), rétention ${retentionJours} j`);
    }

    return {
      ok: true,
      messages_supprimes: messagesSupprimes,
      conversations_supprimees: conversationsSupprimees,
      pointeurs_recales: pointeursRecales,
      retention_jours: retentionJours,
    };
  } catch (err) {
    console.error('[MESSAGERIE] purgeMessagerieRetention :', err.message);
    return {
      ok: false,
      motif: err.message,
      messages_supprimes: messagesSupprimes,
      conversations_supprimees: conversationsSupprimees,
      pointeurs_recales: pointeursRecales,
      retention_jours: retentionJours,
    };
  }
}

module.exports = {
  // Contrat §2.1 — signatures figées, consommées par les autres lots.
  envoyerMessageSysteme,
  envoyerMessageSystemeRoles,
  purgeMessagerieRetention,
  // Helpers partagés avec routes/messages.js (et couverts par les tests).
  assurerConversation,
  insererMessage,
  nonLusParParticipant,
  emettreNouveauMessage,
  emettreLecture,
  calculerCleUnique,
  segmentParticipant,
  SQL_PAS_DE_MOI,
  extraireMentions,
  nomUtilisateur,
  nomVehicule,
  lireRetentionJours,
  salleUtilisateur,
  salleVehicule,
  TEXTE_MAX,
  TITRE_SYSTEME,
  TITRE_BOT,
  RETENTION_DEFAUT_JOURS,
  MENTIONS_MAX,
};
