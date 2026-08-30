/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MESSAGERIE INTERNE — API REST /api/messages (lot L1, contrat §2.3)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * TOUS les rôles connectés messagent : `router.use(authenticate)` est global,
 * mais il n'y a AUCUN `authorize(...)` par rôle. Ce n'est pas un oubli — c'est
 * le modèle : ici, l'autorisation est le PÉRIMÈTRE DE PARTICIPATION. On ne lit
 * et on n'écrit que dans les conversations dont on est participant (403 sinon),
 * et c'est vérifié à CHAQUE requête, jamais déduit d'un identifiant fourni par
 * le client.
 *
 * Deux identités coexistent (contrat §2.2) :
 *   • utilisateur web   → `users.id` (claim `id` du JWT) ;
 *   • chauffeur mobile  → le VÉHICULE (`driverVehicleIdFromToken`), jamais
 *     `req.user.id` : le compte `chauffeur` est générique et PARTAGÉ entre les
 *     camions. Un équipage ne voit que les conversations où son véhicule est
 *     participant, ses contacts se limitent aux ADMIN/MANAGER actifs, et il n'a
 *     pas accès au bot.
 *
 * L'envoi passe TOUJOURS par REST (source de vérité en base, rejouable hors
 * ligne) ; Socket.IO ne sert qu'à la poussée.
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, resolveBaseRole } = require('../middleware/auth');
const { requireMfa } = require('../middleware/mfa');
const { driverVehicleIdFromToken } = require('./tours/driver-session');
const messagerie = require('../services/messagerie');

const {
  TEXTE_MAX, TITRE_SYSTEME, TITRE_BOT, SQL_PAS_DE_MOI,
  assurerConversation, insererMessage, emettreNouveauMessage, emettreLecture,
  extraireMentions, nomUtilisateur, nomVehicule,
  salleUtilisateur, salleVehicule,
} = messagerie;

const LIMITE_MESSAGES_DEFAUT = 50;
const LIMITE_MESSAGES_MAX = 200;
const CONTACTS_MAX = 20;

// ── Périmètre restreint (correctif du 27/08) ───────────────────────────────
//
// DÉFAUT CORRIGÉ : le filtre par rôle de `GET /contacts` ne visait que les
// équipages. Un compte AUTORITE — créé en vague 2 PRÉCISÉMENT comme un accès
// EXTERNE en lecture seule (auditeur Refashion, Métropole) — obtenait donc
// l'annuaire interne complet des salariés actifs et tout le parc de véhicules
// comme contacts, et pouvait ouvrir une conversation privée avec n'importe
// qui. Le périmètre serveur protégeait les conversations EXISTANTES, pas le
// droit d'en ouvrir une.
//
// Règle retenue : un rôle de périmètre restreint dialogue avec ses
// interlocuteurs d'exploitation (ADMIN/MANAGER) et avec eux seuls — exactement
// la règle déjà écrite pour les équipages. Elle est appliquée à l'annuaire ET
// à l'ouverture de conversation : une garde de menu ne protège rien.
//
// La liste est PARAMÉTRABLE (`messagerie.roles_perimetre_restreint`, JSON) :
// c'est un arbitrage d'organisation, pas une constante technique. FINANCE et
// DPO y figurent par défaut parce que ces deux rôles peuvent être tenus par un
// prestataire extérieur (cabinet comptable, DPO externalisé) ; la Direction
// peut les en retirer sans toucher au code.
const ROLES_RESTREINTS_DEFAUT = ['AUTORITE', 'FINANCE', 'DPO'];
const RESTREINTS_TTL_MS = 60000;
let restreintsCache = { valeur: null, expire: 0 };

/** Rôles de base à périmètre restreint. Lecture mise en cache 60 s. */
async function rolesRestreints() {
  const maintenant = Date.now();
  if (restreintsCache.valeur && restreintsCache.expire > maintenant) return restreintsCache.valeur;
  let valeur = ROLES_RESTREINTS_DEFAUT;
  try {
    const r = await pool.query("SELECT value FROM settings WHERE key = 'messagerie.roles_perimetre_restreint'");
    if (r.rows[0] && r.rows[0].value) {
      const brut = JSON.parse(r.rows[0].value);
      // Un réglage illisible ou vide ne DÉSARME jamais la garde en silence :
      // on ne l'accepte que s'il décrit réellement une liste de rôles.
      if (Array.isArray(brut) && brut.every((x) => typeof x === 'string')) {
        valeur = brut.map((x) => x.trim().toUpperCase()).filter(Boolean);
      }
    }
  } catch (err) {
    console.warn('[MESSAGERIE] Réglage messagerie.roles_perimetre_restreint illisible, repli sur le défaut :', err.message);
  }
  restreintsCache = { valeur, expire: maintenant + RESTREINTS_TTL_MS };
  return valeur;
}

/** Purge du cache — exposée pour les tests (sans elle, un test impose ses rôles aux suivants). */
function resetRolesRestreintsCache() { restreintsCache = { valeur: null, expire: 0 }; }

// ── Plafond d'envoi PAR IDENTITÉ (correctif du 27/08) ──────────────────────
//
// Seul le plafond global d'index.js s'appliquait ici : 1 000 requêtes par
// quart d'heure et PAR IP. Derrière un proxy d'entreprise, l'IP est partagée —
// ce n'est donc pas la bonne unité de compte. Un compte authentifié pouvait
// écrire ~1 000 messages de 4 000 caractères en quinze minutes dans une même
// conversation, chacun déclenchant une émission Socket.IO à tous les
// participants et jusqu'à 10 mentions, soit autant d'insertions et de
// notifications système.
//
// Le compteur porte donc sur l'IDENTITÉ DE MESSAGERIE (utilisateur ou
// véhicule), même unité que le périmètre. Fenêtre glissante en mémoire, comme
// `checkRateLimit` de chat.js — pas de dépendance nouvelle, et un plafond
// par instance suffit largement pour un usage humain (60 messages/minute,
// c'est un message par seconde sans discontinuer).
const ENVOI_FENETRE_MS = 60000;
const ENVOI_MAX_PAR_FENETRE = 60;
const envoisParIdentite = new Map();

/** Vrai si l'envoi est autorisé ; incrémente le compteur au passage. */
function autoriserEnvoi(cle) {
  const maintenant = Date.now();
  const entree = envoisParIdentite.get(cle);
  if (!entree || maintenant - entree.debut > ENVOI_FENETRE_MS) {
    envoisParIdentite.set(cle, { debut: maintenant, nb: 1 });
    return true;
  }
  entree.nb += 1;
  return entree.nb <= ENVOI_MAX_PAR_FENETRE;
}

// Nettoyage périodique — sans lui, la table garde une entrée par identité
// jamais revenue. `unref()` : ce minuteur ne doit pas retenir le processus
// (ni faire traîner une suite de tests).
const nettoyageEnvois = setInterval(() => {
  const maintenant = Date.now();
  for (const [cle, e] of envoisParIdentite) {
    if (maintenant - e.debut > ENVOI_FENETRE_MS * 2) envoisParIdentite.delete(cle);
  }
}, 5 * 60 * 1000);
if (typeof nettoyageEnvois.unref === 'function') nettoyageEnvois.unref();

/** Purge du compteur — exposée pour les tests. */
function resetPlafondEnvoi() { envoisParIdentite.clear(); }

router.use(authenticate);
// DOUBLE AUTHENTIFICATION (2.43.0) — même garde que les routeurs sensibles.
//
// Deux raisons, et la seconde est la principale :
//   1. cette API sert le bot SolidataBot (conversation « bot »), qui partage
//      `traiterMessageBot` avec /api/chat : laisser la messagerie ouverte
//      rouvrirait par la bande le contournement fermé sur /api/chat ;
//   2. le handshake Socket.IO REFUSE DÉJÀ une session soumise et non enrôlée
//      (backend/src/index.js) — le temps réel de la messagerie lui est donc
//      fermé depuis 2.43.0, tandis que sa surface REST restait ouverte. Ce
//      n'est pas une restriction nouvelle, c'est la fin d'une incohérence :
//      la porte poussée et la porte tirée se ferment enfin ensemble.
//
// NO-OP pour les rôles hors périmètre (défaut ADMIN/RH/DPO) : équipages
// (COLLABORATEUR en dur), MANAGER, QHSE, FINANCE, RESP_BTQ, AUTORITE
// messagent exactement comme avant.
router.use(requireMfa);

// ── Identité et périmètre ──────────────────────────────────────────────────

/**
 * Identité de messagerie de la requête. Un jeton chauffeur (claim `vehicle_id`
 * OU `username = driver_<id>` pour les jetons hérités, valides jusqu'à 8 h)
 * s'identifie par son VÉHICULE ; tout autre compte par son `users.id`.
 */
function identite(req) {
  const vehicleId = driverVehicleIdFromToken(req.user);
  if (vehicleId != null) {
    return { type: 'vehicule', user_id: null, vehicle_id: vehicleId, chauffeur: true };
  }
  const uid = req.user && req.user.id != null ? req.user.id : (req.user ? req.user.userId : null);
  return {
    type: 'utilisateur',
    user_id: uid != null ? parseInt(uid, 10) : null,
    vehicle_id: null,
    chauffeur: false,
    base_role: resolveBaseRole(req.user ? req.user.role : null),
  };
}

/**
 * Cette identité est-elle bornée aux responsables d'exploitation ?
 * Vrai pour un équipage (règle d'origine) ET pour les rôles de périmètre
 * restreint (correctif du 27/08).
 */
async function perimetreRestreint(moi) {
  if (moi.chauffeur) return true;
  if (!moi.base_role) return false;
  return (await rolesRestreints()).includes(moi.base_role);
}

/** Salle Socket.IO de l'identité courante. */
function salleDe(moi) {
  return moi.chauffeur ? salleVehicule(moi.vehicle_id) : salleUtilisateur(moi.user_id);
}

/**
 * Ligne `messagerie_participants` de l'identité courante pour cette
 * conversation, ou `null`. C'est LA garde de périmètre : aucune lecture ni
 * écriture ne se fait sans elle.
 */
async function participation(conversationId, moi) {
  if (!Number.isInteger(conversationId)) return null;
  const colonne = moi.chauffeur ? 'vehicle_id' : 'user_id';
  const valeur = moi.chauffeur ? moi.vehicle_id : moi.user_id;
  if (valeur == null) return null;
  const r = await pool.query(
    `SELECT p.id, p.conversation_id, p.user_id, p.vehicle_id, p.dernier_lu_message_id,
            c.type, c.titre
       FROM messagerie_participants p
       JOIN messagerie_conversations c ON c.id = p.conversation_id
      WHERE p.conversation_id = $1 AND p.${colonne} = $2`,
    [conversationId, valeur]
  );
  return r.rows[0] || null;
}

/** Refus de périmètre — même réponse qu'une conversation inexistante : on ne
 *  révèle pas l'existence d'une conversation à qui n'en fait pas partie. */
function refusPerimetre(res) {
  return res.status(403).json({
    error: "Cette conversation ne vous est pas accessible",
    code: 'CONVERSATION_INTERDITE',
  });
}

// ── Libellés ───────────────────────────────────────────────────────────────

/** Repli d'accents pour une recherche insensible casse/accents (miroir du SQL). */
function replierAccents(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Expression SQL miroir : `translate()` fait le même repli côté base, ce qui
// permet d'appliquer le LIMIT au bon endroit (filtrer en JS après un LIMIT
// tronquerait la liste avant la recherche).
const SQL_REPLI = (expr) => `translate(lower(${expr}), `
  + `'àáâãäçèéêëìíîïñòóôõöùúûüýÿ', 'aaaaaceeeeiiiinooooouuuuyy')`;

/**
 * Titre présenté à l'écran. Une conversation directe n'a pas de titre stocké :
 * c'est le nom de l'AUTRE (ou des autres) — le titre dépend donc de qui regarde.
 */
function titreAffiche(conv, participants, moi) {
  if (conv.type === 'systeme') return TITRE_SYSTEME;
  if (conv.type === 'bot') return TITRE_BOT;
  if (conv.titre) return conv.titre;
  const autres = participants.filter((p) => !(
    (moi.chauffeur && p.vehicle_id === moi.vehicle_id)
    || (!moi.chauffeur && p.user_id === moi.user_id)
  ));
  const noms = autres.map((p) => p.nom).filter(Boolean);
  if (noms.length > 0) return noms.join(', ');
  // Seul participant restant (l'autre compte a été supprimé) : on le dit.
  return 'Conversation sans autre participant';
}

/** Participants d'un lot de conversations, avec leur nom d'affichage. */
async function participantsDe(conversationIds) {
  if (conversationIds.length === 0) return new Map();
  const r = await pool.query(
    `SELECT p.conversation_id, p.user_id, p.vehicle_id,
            u.username, u.first_name, u.last_name,
            v.registration, v.name AS vehicule_nom
       FROM messagerie_participants p
       LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN vehicles v ON v.id = p.vehicle_id
      WHERE p.conversation_id = ANY($1::int[])
      ORDER BY p.id`,
    [conversationIds]
  );
  const parConv = new Map();
  for (const row of r.rows) {
    const entree = row.user_id != null
      ? { type: 'utilisateur', user_id: row.user_id, nom: nomUtilisateur(row) }
      : { type: 'vehicule', vehicle_id: row.vehicle_id, nom: nomVehicule({ registration: row.registration, name: row.vehicule_nom }) };
    if (!parConv.has(row.conversation_id)) parConv.set(row.conversation_id, []);
    parConv.get(row.conversation_id).push(entree);
  }
  return parConv;
}

/** Nom d'affichage de l'auteur d'un message déjà chargé (jointures faites). */
function nomAuteurLigne(row) {
  if (row.auteur_type === 'systeme') return TITRE_SYSTEME;
  if (row.auteur_type === 'bot') return TITRE_BOT;
  if (row.auteur_user_id != null) {
    return nomUtilisateur({
      username: row.auteur_username, first_name: row.auteur_first_name, last_name: row.auteur_last_name,
    });
  }
  if (row.auteur_vehicle_id != null) {
    return nomVehicule({ registration: row.auteur_registration, name: row.auteur_vehicule_nom });
  }
  return null;
}

/** Projection d'un message vers le client (aucune donnée d'identité en trop). */
function projeterMessage(row) {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    auteur_type: row.auteur_type,
    auteur_user_id: row.auteur_user_id,
    auteur_vehicle_id: row.auteur_vehicle_id,
    auteur_nom: nomAuteurLigne(row),
    texte: row.texte,
    type: row.type,
    source: row.source,
    lien: row.lien,
    created_at: row.created_at,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/messages/conversations
// ═══════════════════════════════════════════════════════════════════════════
router.get('/conversations', async (req, res) => {
  try {
    const moi = identite(req);
    if (moi.user_id == null && moi.vehicle_id == null) {
      return res.status(401).json({ error: 'Session sans identité de messagerie', code: 'IDENTITE_INCONNUE' });
    }
    const colonne = moi.chauffeur ? 'vehicle_id' : 'user_id';
    const valeur = moi.chauffeur ? moi.vehicle_id : moi.user_id;

    const r = await pool.query(
      `SELECT c.id, c.type, c.titre, c.dernier_message_at,
              COALESCE(nl.n, 0) AS non_lus,
              dm.id AS dm_id, dm.texte AS dm_texte, dm.auteur_type AS dm_auteur_type,
              dm.created_at AS dm_created_at
         FROM messagerie_participants p
         JOIN messagerie_conversations c ON c.id = p.conversation_id
         LEFT JOIN LATERAL (
           SELECT m.id, m.texte, m.auteur_type, m.created_at
             FROM messagerie_messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.id DESC LIMIT 1
         ) dm ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS n FROM messagerie_messages m
            WHERE m.conversation_id = c.id
              AND m.id > COALESCE(p.dernier_lu_message_id, 0)
              AND ${SQL_PAS_DE_MOI}
         ) nl ON true
        WHERE p.${colonne} = $1
        ORDER BY c.dernier_message_at DESC NULLS LAST, c.id DESC`,
      [valeur]
    );

    const ids = r.rows.map((row) => row.id);
    const parConv = await participantsDe(ids);

    const conversations = r.rows.map((row) => {
      const participants = parConv.get(row.id) || [];
      return {
        id: row.id,
        type: row.type,
        titre_affiche: titreAffiche(row, participants, moi),
        participants,
        dernier_message: row.dm_id
          ? {
            id: row.dm_id, texte: row.dm_texte,
            auteur_type: row.dm_auteur_type, created_at: row.dm_created_at,
          }
          : null,
        non_lus: parseInt(row.non_lus, 10) || 0,
      };
    });

    res.json({ conversations });
  } catch (err) {
    console.error('[MESSAGERIE] Liste des conversations :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: 'ERREUR_SERVEUR' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/messages/conversations — ouvre ou retrouve une conversation
// ═══════════════════════════════════════════════════════════════════════════
router.post('/conversations', async (req, res) => {
  let client;
  try {
    const moi = identite(req);
    if (moi.user_id == null && moi.vehicle_id == null) {
      return res.status(401).json({ error: 'Session sans identité de messagerie', code: 'IDENTITE_INCONNUE' });
    }
    const dest = req.body ? req.body.destinataire : null;
    if (!dest || typeof dest !== 'object' || !dest.type) {
      return res.status(400).json({ error: 'Destinataire requis', code: 'DESTINATAIRE_REQUIS' });
    }
    // Même règle qu'à l'annuaire, appliquée à l'OUVERTURE : filtrer la liste
    // des contacts sans garder l'ouverture laisserait passer un identifiant
    // saisi à la main.
    const restreint = await perimetreRestreint(moi);

    let type;
    let participants;
    let titre = null;

    if (dest.type === 'bot') {
      // Un équipage n'a pas le bot : son mobile est un outil de conduite, pas
      // un assistant conversationnel (contrat §2.2).
      if (moi.chauffeur) {
        return res.status(403).json({
          error: "L'assistant n'est pas disponible depuis l'application véhicule",
          code: 'BOT_INDISPONIBLE_CHAUFFEUR',
        });
      }
      type = 'bot';
      titre = TITRE_BOT;
      participants = [{ user_id: moi.user_id }];
    } else if (dest.type === 'utilisateur') {
      const cible = parseInt(dest.user_id, 10);
      if (!Number.isInteger(cible)) {
        return res.status(400).json({ error: 'Identifiant utilisateur invalide', code: 'DESTINATAIRE_INVALIDE' });
      }
      if (!moi.chauffeur && cible === moi.user_id) {
        return res.status(400).json({ error: 'Impossible de démarrer une conversation avec soi-même', code: 'DESTINATAIRE_SOI_MEME' });
      }
      const u = await pool.query(
        `SELECT u.id, u.username, u.is_active, COALESCE(cr.base_role, u.role) AS base_role
           FROM users u LEFT JOIN custom_roles cr ON cr.role_key = u.role
          WHERE u.id = $1`, [cible]);
      if (u.rows.length === 0 || u.rows[0].is_active === false) {
        return res.status(404).json({ error: 'Destinataire inconnu ou inactif', code: 'DESTINATAIRE_INCONNU' });
      }
      // Le compte de service « chauffeur » est PARTAGÉ entre tous les camions :
      // lui écrire n'atteindrait personne en particulier. On passe par le véhicule.
      if (u.rows[0].username === 'chauffeur') {
        return res.status(400).json({
          error: 'Pour joindre un équipage, écrivez au véhicule et non au compte partagé « chauffeur »',
          code: 'DESTINATAIRE_COMPTE_PARTAGE',
        });
      }
      if (restreint && !['ADMIN', 'MANAGER'].includes(u.rows[0].base_role)) {
        // ANTI-ÉNUMÉRATION (correctif 27/08) — depuis un jeton VÉHICULE, ce
        // refus était distinct du 404 « identifiant inconnu » : un porteur du
        // lien chauffeur (la crédential la plus exposée du parc — raccourci
        // permanent sur un téléphone d'équipage) pouvait balayer les
        // identifiants et cartographier les comptes existants, leur activité
        // et leur niveau de responsabilité. On lui rend désormais la MÊME
        // réponse que pour un identifiant inexistant : on ne révèle pas
        // l'existence d'une ressource à qui n'y a pas droit (règle déjà
        // appliquée par `refusPerimetre`).
        //
        // Depuis un compte web (rôle externe), le 403 explicite est conservé :
        // l'utilisateur est identifié et doit comprendre POURQUOI c'est refusé,
        // sans quoi il croira à un défaut de l'application.
        if (moi.chauffeur) {
          return res.status(404).json({ error: 'Destinataire inconnu ou inactif', code: 'DESTINATAIRE_INCONNU' });
        }
        return res.status(403).json({
          error: "Votre profil vous permet d'écrire aux responsables d'exploitation (administrateurs et managers)",
          code: 'DESTINATAIRE_NON_AUTORISE',
        });
      }
      type = 'directe';
      participants = moi.chauffeur
        ? [{ vehicle_id: moi.vehicle_id }, { user_id: cible }]
        : [{ user_id: moi.user_id }, { user_id: cible }];
    } else if (dest.type === 'vehicule') {
      if (moi.chauffeur) {
        return res.status(403).json({
          error: "Depuis le véhicule, vous ne pouvez pas écrire à un autre véhicule",
          code: 'DESTINATAIRE_NON_AUTORISE',
        });
      }
      // Un rôle externe (auditeur, consultation financière) n'a pas à donner de
      // consigne à un équipage en tournée : les véhicules ne figurent déjà plus
      // dans son annuaire, l'ouverture est refusée de même.
      if (restreint) {
        return res.status(403).json({
          error: "Votre profil ne permet pas d'écrire à un véhicule en tournée",
          code: 'DESTINATAIRE_NON_AUTORISE',
        });
      }
      const cible = parseInt(dest.vehicle_id, 10);
      if (!Number.isInteger(cible)) {
        return res.status(400).json({ error: 'Identifiant véhicule invalide', code: 'DESTINATAIRE_INVALIDE' });
      }
      const v = await pool.query(
        `SELECT id, registration, name FROM vehicles
          WHERE id = $1 AND COALESCE(is_demo, false) = false AND status <> 'out_of_service'`,
        [cible]);
      if (v.rows.length === 0) {
        return res.status(404).json({ error: 'Véhicule inconnu ou hors service', code: 'DESTINATAIRE_INCONNU' });
      }
      type = 'directe';
      participants = [{ user_id: moi.user_id }, { vehicle_id: cible }];
    } else {
      return res.status(400).json({ error: 'Type de destinataire inconnu', code: 'DESTINATAIRE_INVALIDE' });
    }

    client = await pool.connect();
    await client.query('BEGIN');
    const conv = await assurerConversation(client, {
      type, titre, participants, createdBy: moi.chauffeur ? null : moi.user_id,
    });
    await client.query('COMMIT');

    const parConv = await participantsDe([conv.id]);
    const liste = parConv.get(conv.id) || [];
    res.json({
      conversation: {
        id: conv.id,
        type,
        titre_affiche: titreAffiche({ type, titre }, liste, moi),
        participants: liste,
        dernier_message: null,
        non_lus: 0,
        creee: conv.creee,
      },
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[MESSAGERIE] Ouverture de conversation :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: 'ERREUR_SERVEUR' });
  } finally {
    if (client) client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/messages/conversations/:id/messages — fil paginé
// ═══════════════════════════════════════════════════════════════════════════
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const moi = identite(req);
    const conversationId = parseInt(req.params.id, 10);
    if (!Number.isInteger(conversationId)) {
      return res.status(400).json({ error: 'Conversation invalide', code: 'CONVERSATION_INVALIDE' });
    }
    const p = await participation(conversationId, moi);
    if (!p) return refusPerimetre(res);

    let limit = parseInt(req.query.limit, 10);
    if (!Number.isInteger(limit) || limit <= 0) limit = LIMITE_MESSAGES_DEFAUT;
    limit = Math.min(limit, LIMITE_MESSAGES_MAX);

    const avantId = req.query.avant_id != null && req.query.avant_id !== ''
      ? parseInt(req.query.avant_id, 10) : null;
    if (req.query.avant_id != null && req.query.avant_id !== '' && !Number.isInteger(avantId)) {
      return res.status(400).json({ error: 'Paramètre avant_id invalide', code: 'PAGINATION_INVALIDE' });
    }

    // limit + 1 : la ligne excédentaire dit s'il reste des messages plus anciens
    // (`a_plus`) sans compter la totalité du fil à chaque page.
    const r = await pool.query(
      `SELECT m.id, m.conversation_id, m.auteur_type, m.auteur_user_id, m.auteur_vehicle_id,
              m.texte, m.type, m.source, m.lien, m.created_at,
              u.username AS auteur_username, u.first_name AS auteur_first_name,
              u.last_name AS auteur_last_name,
              v.registration AS auteur_registration, v.name AS auteur_vehicule_nom
         FROM messagerie_messages m
         LEFT JOIN users u ON u.id = m.auteur_user_id
         LEFT JOIN vehicles v ON v.id = m.auteur_vehicle_id
        WHERE m.conversation_id = $1
          AND ($2::int IS NULL OR m.id < $2)
        ORDER BY m.id DESC
        LIMIT $3`,
      [conversationId, avantId, limit + 1]
    );

    const aPlus = r.rows.length > limit;
    const page = (aPlus ? r.rows.slice(0, limit) : r.rows).reverse();
    res.json({ messages: page.map(projeterMessage), a_plus: aPlus });
  } catch (err) {
    console.error('[MESSAGERIE] Lecture du fil :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: 'ERREUR_SERVEUR' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/messages/conversations/:id/messages — envoi
// ═══════════════════════════════════════════════════════════════════════════
router.post('/conversations/:id/messages', async (req, res) => {
  let client;
  try {
    const moi = identite(req);
    const conversationId = parseInt(req.params.id, 10);
    if (!Number.isInteger(conversationId)) {
      return res.status(400).json({ error: 'Conversation invalide', code: 'CONVERSATION_INVALIDE' });
    }
    const p = await participation(conversationId, moi);
    if (!p) return refusPerimetre(res);

    // Plafond d'envoi PAR IDENTITÉ. Placé APRÈS la garde de périmètre : un
    // non-participant ne doit pas pouvoir consommer le quota de quelqu'un
    // d'autre, ni apprendre quoi que ce soit d'un 429 plutôt que d'un 403.
    if (!autoriserEnvoi(salleDe(moi))) {
      return res.status(429).json({
        error: `Trop de messages envoyés (${ENVOI_MAX_PAR_FENETRE} par minute au maximum) — patientez un instant`,
        code: 'TROP_DE_MESSAGES',
      });
    }

    const brut = req.body ? req.body.texte : null;
    const texte = typeof brut === 'string' ? brut.trim() : '';
    if (!texte) {
      return res.status(400).json({ error: 'Le message est vide', code: 'TEXTE_REQUIS' });
    }
    if (texte.length > TEXTE_MAX) {
      return res.status(400).json({
        error: `Le message dépasse ${TEXTE_MAX} caractères`, code: 'TEXTE_TROP_LONG',
      });
    }

    // La conversation SOLIDATA est un canal d'ALERTE, à sens unique : personne
    // ne lit ce qu'on y répond. Le refuser explicitement vaut mieux que
    // d'accepter un message qui n'atteindrait jamais un humain.
    if (p.type === 'systeme') {
      return res.status(409).json({
        error: 'Les notifications SOLIDATA ne reçoivent pas de réponse — écrivez à un responsable',
        code: 'CONVERSATION_SYSTEME_LECTURE_SEULE',
      });
    }

    const auteurType = moi.chauffeur ? 'chauffeur' : 'utilisateur';
    const auteurNom = moi.chauffeur
      ? await nomVehiculeParId(moi.vehicle_id)
      : nomUtilisateur(req.user) || (req.user ? req.user.username : null);

    client = await pool.connect();
    await client.query('BEGIN');
    const message = await insererMessage(client, {
      conversationId,
      auteurType,
      auteurUserId: moi.chauffeur ? null : moi.user_id,
      auteurVehicleId: moi.chauffeur ? moi.vehicle_id : null,
      texte,
      type: 'texte',
    });
    // Son propre message est lu par construction : sans ce recalage, l'auteur
    // verrait sa propre pastille de non-lus s'incrémenter.
    await client.query(
      `UPDATE messagerie_participants
          SET dernier_lu_message_id = GREATEST(COALESCE(dernier_lu_message_id, 0), $2)
        WHERE id = $1`,
      [p.id, message.id]
    );
    await client.query('COMMIT');
    // Connexion rendue au pool DÈS le commit : la suite (mentions, et surtout
    // l'appel à l'assistant, qui peut durer des dizaines de secondes) n'a plus
    // besoin de cette transaction. La garder immobiliserait une connexion sur
    // vingt pendant toute la réponse du modèle.
    client.release();
    client = null;

    await emettreNouveauMessage(conversationId, message, auteurNom);

    // Mentions : traitées APRÈS le commit — une notification qui échoue ne doit
    // jamais faire perdre le message qui la portait.
    const mentions = await traiterMentions({
      conversationId, message, texte, auteurNom, moi,
    });

    const reponse = { message: { ...projeterMessageDirect(message, auteurNom) }, mentions };

    if (p.type === 'bot') {
      const bot = await repondreBot({ conversationId, texte, req });
      reponse.reponse_bot = bot.reponse_bot;
      if (bot.bot_erreur) reponse.bot_erreur = bot.bot_erreur;
    }

    res.status(201).json(reponse);
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[MESSAGERIE] Envoi de message :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: 'ERREUR_SERVEUR' });
  } finally {
    if (client) client.release();
  }
});

/** Projection d'un message qu'on vient d'insérer (auteur déjà connu). */
function projeterMessageDirect(message, auteurNom) {
  return {
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
}

async function nomVehiculeParId(vehicleId) {
  try {
    const r = await pool.query('SELECT registration, name FROM vehicles WHERE id = $1', [vehicleId]);
    return r.rows[0] ? nomVehicule(r.rows[0]) : null;
  } catch (err) {
    console.error('[MESSAGERIE] Nom du véhicule illisible :', err.message);
    return null;
  }
}

/**
 * Mentions `@identifiant` : enregistrement + notification des mentionnés qui ne
 * participent PAS à la conversation (les participants voient déjà le message).
 * Best effort : le message est déjà commité, une mention en échec ne l'annule pas.
 */
async function traiterMentions({ conversationId, message, texte, auteurNom, moi }) {
  const resultat = { enregistrees: 0, notifiees: 0 };
  try {
    const identifiants = extraireMentions(texte);
    if (identifiants.length === 0) return resultat;

    const r = await pool.query(
      `SELECT id, username FROM users
        WHERE LOWER(username) = ANY($1::text[]) AND is_active = true`,
      [identifiants]
    );
    if (r.rows.length === 0) return resultat;

    for (const u of r.rows) {
      // Ne pas se mentionner soi-même (ni le compte partagé : voir POST /conversations).
      if (!moi.chauffeur && u.id === moi.user_id) continue;
      if (u.username === 'chauffeur') continue;
      await pool.query(
        'INSERT INTO messagerie_mentions (message_id, user_id) VALUES ($1, $2)',
        [message.id, u.id]
      );
      resultat.enregistrees += 1;

      const dejaParticipant = await pool.query(
        'SELECT 1 FROM messagerie_participants WHERE conversation_id = $1 AND user_id = $2',
        [conversationId, u.id]
      );
      if (dejaParticipant.rows.length > 0) continue;

      const envoi = await messagerie.envoyerMessageSysteme({
        destinataire_user_id: u.id,
        texte: `${auteurNom || 'Un collègue'} vous a mentionné`,
        source: 'mention',
        lien: `/messagerie?conversation=${conversationId}`,
      });
      if (envoi.ok) resultat.notifiees += 1;
    }
    return resultat;
  } catch (err) {
    console.error('[MESSAGERIE] Traitement des mentions ignoré :', err.message);
    return resultat;
  }
}

/**
 * Réponse du bot sur une conversation `bot`.
 *
 * La logique conversationnelle N'EST PAS DUPLIQUÉE : elle vit dans
 * `routes/chat.js` (`traiterMessageBot`), le même code que le widget
 * SolidataBot. Require paresseux pour ne charger le SDK que si le bot sert.
 *
 * Deux échecs distincts, dits distinctement :
 *   • IA non configurée → un message de bot HONNÊTE est déposé dans le fil
 *     (l'utilisateur voit pourquoi il n'a pas de réponse, au lieu d'un silence) ;
 *   • échec d'appel → `reponse_bot: null` + `bot_erreur`. Dans les deux cas le
 *     message de l'utilisateur reste en base : il n'est JAMAIS perdu.
 */
async function repondreBot({ conversationId, texte, req }) {
  const uid = req.user.id != null ? req.user.id : req.user.userId;
  let reply = null;
  let botErreur = null;

  try {
    const { traiterMessageBot } = require('./chat');
    const sortie = await traiterMessageBot({
      userId: uid, role: req.user.role, username: req.user.username,
      message: texte, sessionId: `msg-${conversationId}`,
      // `journaliser: false` (correctif du 27/08) — l'échange est déjà écrit
      // dans `messagerie_messages`, qui a une rétention réelle et purgée. Le
      // doubler dans `chatbot_history`, table sans aucune purge, l'aurait fait
      // survivre à la durée annoncée au registre RGPD pour la messagerie.
      // Ici le FIL fait foi ; le widget SolidataBot, lui, continue de
      // journaliser puisque c'est sa seule trace.
      journaliser: false,
    });
    reply = sortie.reply;
  } catch (err) {
    if (err && err.code === 'IA_NON_CONFIGUREE') {
      botErreur = 'IA_NON_CONFIGUREE';
      reply = "L'assistant n'est pas disponible : la clé du service d'intelligence "
        + "artificielle n'est pas configurée sur ce serveur. Votre message est enregistré.";
    } else if (err && err.code === 'RATE_LIMIT') {
      botErreur = 'RATE_LIMIT';
      reply = 'Trop de questions d\'affilée — patientez une minute avant de réessayer.';
    } else {
      console.error('[MESSAGERIE] Réponse du bot indisponible :', err.message);
      return { reponse_bot: null, bot_erreur: err.message || 'échec de l\'assistant' };
    }
  }

  // Dépôt de la réponse (ou du message d'indisponibilité) dans le fil.
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const message = await insererMessage(client, {
      conversationId,
      auteurType: 'bot',
      texte: String(reply).slice(0, TEXTE_MAX),
      type: 'texte',
      source: botErreur ? 'bot_indisponible' : 'bot',
    });
    await client.query('COMMIT');
    await emettreNouveauMessage(conversationId, message, TITRE_BOT);
    return { reponse_bot: projeterMessageDirect(message, TITRE_BOT), bot_erreur: botErreur };
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[MESSAGERIE] Enregistrement de la réponse bot :', err.message);
    return { reponse_bot: null, bot_erreur: botErreur || err.message };
  } finally {
    if (client) client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/messages/conversations/:id/lu — accusé de lecture
// ═══════════════════════════════════════════════════════════════════════════
router.post('/conversations/:id/lu', async (req, res) => {
  try {
    const moi = identite(req);
    const conversationId = parseInt(req.params.id, 10);
    if (!Number.isInteger(conversationId)) {
      return res.status(400).json({ error: 'Conversation invalide', code: 'CONVERSATION_INVALIDE' });
    }
    const p = await participation(conversationId, moi);
    if (!p) return refusPerimetre(res);

    const demande = parseInt(req.body ? req.body.dernier_lu_message_id : null, 10);
    if (!Number.isInteger(demande)) {
      return res.status(400).json({ error: 'Identifiant de message invalide', code: 'MESSAGE_INVALIDE' });
    }

    // Deux bornes : jamais au-delà du dernier message RÉEL de la conversation
    // (un client ne fixe pas le curseur où il veut), jamais en arrière
    // (GREATEST) — sinon un onglet resté ouvert ferait « re-sonner » des
    // messages déjà lus ailleurs.
    const r = await pool.query(
      `UPDATE messagerie_participants p
          SET dernier_lu_message_id = GREATEST(
                COALESCE(p.dernier_lu_message_id, 0),
                LEAST($2, COALESCE((SELECT MAX(m.id) FROM messagerie_messages m
                                     WHERE m.conversation_id = p.conversation_id), 0)))
        WHERE p.id = $1
        RETURNING p.dernier_lu_message_id`,
      [p.id, demande]
    );
    const pointeur = r.rows[0] ? r.rows[0].dernier_lu_message_id : null;

    emettreLecture(salleDe(moi), conversationId, pointeur);
    res.json({ ok: true, dernier_lu_message_id: pointeur });
  } catch (err) {
    console.error('[MESSAGERIE] Accusé de lecture :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: 'ERREUR_SERVEUR' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/messages/contacts?q= — autocomplete des mentions et destinataires
// ═══════════════════════════════════════════════════════════════════════════
//
// Champs MINIMAUX : identifiant, nom d'affichage, rôle. Jamais d'adresse
// électronique, de téléphone ni d'aucune donnée de fiche salarié — cette route
// est ouverte à TOUS les rôles connectés, y compris aux équipages.
//
// Le filtre de périmètre restreint (équipages ET rôles externes, cf. en-tête)
// s'applique ICI : l'annuaire interne complet n'est pas un dû du seul fait
// d'être connecté.
router.get('/contacts', async (req, res) => {
  try {
    const moi = identite(req);
    const restreint = await perimetreRestreint(moi);
    const q = replierAccents(req.query.q || '');

    const utilisateurs = await pool.query(
      `SELECT u.id, u.username, u.first_name, u.last_name,
              COALESCE(cr.base_role, u.role) AS base_role
         FROM users u
         LEFT JOIN custom_roles cr ON cr.role_key = u.role
        WHERE u.is_active = true
          AND u.username <> 'chauffeur'
          AND ($1::int IS NULL OR u.id <> $1)
          AND ($3::boolean = false OR COALESCE(cr.base_role, u.role) IN ('ADMIN', 'MANAGER'))
          AND ($2::text = '' OR ${SQL_REPLI("COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '') || ' ' || u.username")} LIKE '%' || $2::text || '%')
        ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST, u.username
        LIMIT $4`,
      [moi.chauffeur ? null : moi.user_id, q, restreint, CONTACTS_MAX]
    );

    // Ni un équipage ni un rôle externe ne dialogue avec les camions : leurs
    // interlocuteurs sont les responsables d'exploitation (contrat §2.2, étendu
    // aux rôles de périmètre restreint le 27/08).
    let vehicules = { rows: [] };
    if (!restreint) {
      vehicules = await pool.query(
        `SELECT id, registration, name
           FROM vehicles
          WHERE COALESCE(is_demo, false) = false
            AND status <> 'out_of_service'
            AND ($1::text = '' OR ${SQL_REPLI("COALESCE(registration, '') || ' ' || COALESCE(name, '')")} LIKE '%' || $1::text || '%')
          ORDER BY registration
          LIMIT $2`,
        [q, CONTACTS_MAX]
      );
    }

    const listeUsers = utilisateurs.rows.map((u) => ({
      type: 'utilisateur', user_id: u.id, nom: nomUtilisateur(u), role: u.base_role,
    }));
    const listeVehicules = vehicules.rows.map((v) => ({
      type: 'vehicule', vehicle_id: v.id, nom: nomVehicule(v),
    }));

    res.json({ contacts: fusionnerContacts(listeUsers, listeVehicules, CONTACTS_MAX) });
  } catch (err) {
    console.error('[MESSAGERIE] Recherche de contacts :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: 'ERREUR_SERVEUR' });
  }
});

/**
 * Fusionne les deux familles en respectant le plafond SANS jamais faire
 * disparaître l'une d'elles : une simple concaténation tronquée à 20 masquerait
 * tous les véhicules dès que la structure compte 20 utilisateurs actifs.
 */
function fusionnerContacts(users, vehicules, plafond) {
  if (users.length + vehicules.length <= plafond) return [...users, ...vehicules];
  const partVehicules = Math.min(vehicules.length, Math.floor(plafond / 2));
  const partUsers = Math.min(users.length, plafond - partVehicules);
  return [...users.slice(0, partUsers), ...vehicules.slice(0, partVehicules)];
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/messages/non-lus — pastille du dock (web) et du mobile
// ═══════════════════════════════════════════════════════════════════════════
router.get('/non-lus', async (req, res) => {
  try {
    const moi = identite(req);
    if (moi.user_id == null && moi.vehicle_id == null) {
      return res.json({ total: 0, par_conversation: {} });
    }
    const colonne = moi.chauffeur ? 'vehicle_id' : 'user_id';
    const valeur = moi.chauffeur ? moi.vehicle_id : moi.user_id;

    const r = await pool.query(
      `SELECT p.conversation_id, COUNT(m.id)::int AS n
         FROM messagerie_participants p
         JOIN messagerie_messages m
           ON m.conversation_id = p.conversation_id
          AND m.id > COALESCE(p.dernier_lu_message_id, 0)
          AND ${SQL_PAS_DE_MOI}
        WHERE p.${colonne} = $1
        GROUP BY p.conversation_id`,
      [valeur]
    );

    const parConversation = {};
    let total = 0;
    for (const row of r.rows) {
      parConversation[String(row.conversation_id)] = row.n;
      total += row.n;
    }
    res.json({ total, par_conversation: parConversation });
  } catch (err) {
    console.error('[MESSAGERIE] Compteur de non-lus :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: 'ERREUR_SERVEUR' });
  }
});

module.exports = router;
// Exposés pour les tests (fonctions pures de présentation et de périmètre).
module.exports.identite = identite;
module.exports.titreAffiche = titreAffiche;
module.exports.fusionnerContacts = fusionnerContacts;
// Périmètre restreint (correctif 27/08) : le cache de 60 s doit être purgeable
// entre deux tests, sans quoi le premier imposerait sa liste de rôles aux suivants.
module.exports.resetRolesRestreintsCache = resetRolesRestreintsCache;
module.exports.ROLES_RESTREINTS_DEFAUT = ROLES_RESTREINTS_DEFAUT;
// Plafond d'envoi par identité (correctif 27/08) : purgeable entre deux tests.
module.exports.resetPlafondEnvoi = resetPlafondEnvoi;
module.exports.ENVOI_MAX_PAR_FENETRE = ENVOI_MAX_PAR_FENETRE;
