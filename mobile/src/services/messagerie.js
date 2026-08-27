/**
 * Messagerie interne — appels REST côté mobile (lot L3, contrat §2.3/§4).
 *
 * Mêmes endpoints et mêmes formes de réponse que le web : `/api/messages/*`,
 * authentifiés par le JWT chauffeur (`mobile_token`). Le serveur borne déjà
 * le périmètre du véhicule (identité = véhicule, jamais le compte générique
 * « chauffeur ») — ce module n'a rien à filtrer côté client.
 *
 * L'ENVOI d'un message (réponse rapide ou texte libre) ne vit PAS ici : il
 * passe par la file offline (services/db.js `addPendingMessage` +
 * services/sync.js `sendMessagerieMessage`/`syncPendingMessages`), pour ne
 * jamais bloquer ni perdre un message hors couverture. Ce module ne couvre
 * que les LECTURES (liste, fil, contacts, non-lus) et l'ouverture de
 * conversation — best-effort, dégradées silencieusement en mode hors ligne
 * par l'appelant (l'écran affiche alors le dernier état chargé).
 */

import { authedFetch } from './authedFetch';

/**
 * Trois réponses rapides FIGÉES (contrat §4 — texte exact, ne pas
 * reformuler) : envoyées par le même POST que la saisie libre.
 */
export const REPONSES_RAPIDES = Object.freeze([
  "J'ai compris",
  "J'arrive",
  'Je suis bloqué, rappelez-moi',
]);

function erreurHttp(status, data) {
  const err = new Error(`HTTP ${status}`);
  err.response = { status, data };
  return err;
}

async function lireJson(res) {
  return res.json().catch(() => ({}));
}

/** Liste des conversations du chauffeur (systeme SOLIDATA + consignes + DMs). */
export async function fetchConversations() {
  const res = await authedFetch('/api/messages/conversations');
  const data = await lireJson(res);
  if (!res.ok) throw erreurHttp(res.status, data);
  return Array.isArray(data.conversations) ? data.conversations : [];
}

/**
 * Fil d'une conversation, du plus ancien au plus récent.
 * @param {number} conversationId
 * @param {object} [opts] - { avantId, limit }
 */
export async function fetchThread(conversationId, { avantId, limit } = {}) {
  const params = new URLSearchParams();
  if (avantId != null) params.set('avant_id', String(avantId));
  if (limit != null) params.set('limit', String(limit));
  const qs = params.toString();
  const res = await authedFetch(`/api/messages/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`);
  const data = await lireJson(res);
  if (!res.ok) throw erreurHttp(res.status, data);
  return {
    messages: Array.isArray(data.messages) ? data.messages : [],
    aPlus: !!data.a_plus,
  };
}

/** Compteur de non-lus (pastille du bouton flottant). */
export async function fetchNonLus() {
  const res = await authedFetch('/api/messages/non-lus');
  const data = await lireJson(res);
  if (!res.ok) throw erreurHttp(res.status, data);
  return {
    total: Number.isInteger(data.total) ? data.total : 0,
    parConversation: data.par_conversation || {},
  };
}

/**
 * Contacts pour démarrer une conversation. Le serveur filtre déjà, pour un
 * chauffeur, aux seuls ADMIN/MANAGER actifs (contrat §2.2) — aucun filtre
 * supplémentaire à faire ici.
 */
export async function fetchContacts(q = '') {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  const res = await authedFetch(`/api/messages/contacts${qs}`);
  const data = await lireJson(res);
  if (!res.ok) throw erreurHttp(res.status, data);
  return Array.isArray(data.contacts) ? data.contacts : [];
}

/**
 * Ouvre (ou retrouve) une conversation directe avec un contact.
 * @param {{type:'utilisateur', user_id:number}} destinataire
 */
export async function openConversation(destinataire) {
  const res = await authedFetch('/api/messages/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ destinataire }),
  });
  const data = await lireJson(res);
  if (!res.ok) throw erreurHttp(res.status, data);
  return data.conversation;
}

/** Accusé de lecture — best effort, jamais bloquant pour l'affichage du fil. */
export async function markRead(conversationId, dernierLuMessageId) {
  const res = await authedFetch(`/api/messages/conversations/${conversationId}/lu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dernier_lu_message_id: dernierLuMessageId }),
  });
  const data = await lireJson(res);
  if (!res.ok) throw erreurHttp(res.status, data);
  return data;
}

/** Un participant véhicule du fil est-il « moi » ? (message émis par ce camion) */
export function estDeMoi(message, vehicleId) {
  if (!message || vehicleId == null) return false;
  return String(message.auteur_vehicle_id) === String(vehicleId);
}

/**
 * La bannière « nouveau message » doit-elle se déclencher pour cet
 * événement Socket.IO `messagerie:nouveau` ? Fonction PURE (aucun accès
 * DOM/réseau) pour rester testable indépendamment du socket.
 *
 * Trois exclusions volontaires :
 *  - écho de mon propre envoi (le serveur notifie aussi l'auteur) ;
 *  - notification SOLIDATA/consigne (`auteur_type: 'systeme'`) — déjà
 *    alertée par DriverMessageBanner (canal `driver_messages` existant,
 *    contrat §12.3) : doubler le toast serait redondant, pas informatif ;
 *  - conversation déjà ouverte à l'écran (le chauffeur la lit déjà).
 *
 * @param {{conversation_id:number, message:object}} data
 * @param {string|number|null} vehicleId
 * @param {number|null} conversationOuverteId
 */
export function doitNotifier(data, vehicleId, conversationOuverteId) {
  if (!data || !data.message) return false;
  const m = data.message;
  if (m.auteur_type === 'systeme') return false;
  if (estDeMoi(m, vehicleId)) return false;
  if (conversationOuverteId != null && String(conversationOuverteId) === String(data.conversation_id)) return false;
  return true;
}

/**
 * Identifiant du dernier message RÉEL d'un fil (pour l'accusé de lecture) —
 * `null` si le fil est vide, jamais 0 (qui bornerait le curseur à l'origine).
 */
export function dernierMessageId(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const last = messages[messages.length - 1];
  return last && last.id != null ? last.id : null;
}
