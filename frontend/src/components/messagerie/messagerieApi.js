// ══════════════════════════════════════════
// Messagerie — enveloppe des appels REST /api/messages
// (contrat figé : rapports/evolutions-2026-08-26/CONTRATS.md §2.3)
// ══════════════════════════════════════════
import api from '../../services/api';

/** Liste des conversations de l'utilisateur/véhicule courant, triée serveur. */
export function fetchConversations() {
  return api.get('/messages/conversations').then((r) => r.data?.conversations || []);
}

/** Crée ou retrouve (par cle_unique) une conversation directe/bot. */
export function createConversation(destinataire) {
  return api.post('/messages/conversations', { destinataire }).then((r) => r.data?.conversation);
}

/** Page de messages (du plus ancien au plus récent) + indicateur de pagination. */
export function fetchMessages(conversationId, { avantId, limit = 50 } = {}) {
  const params = { limit };
  if (avantId) params.avant_id = avantId;
  return api
    .get(`/messages/conversations/${conversationId}/messages`, { params })
    .then((r) => ({ messages: r.data?.messages || [], aPlus: !!r.data?.a_plus }));
}

/** Envoie un message ; sur une conversation bot, la réponse porte aussi `reponse_bot`. */
export function postMessage(conversationId, texte) {
  return api.post(`/messages/conversations/${conversationId}/messages`, { texte }).then((r) => r.data);
}

/** Accusé de lecture, borné côté serveur au dernier message réel. */
export function markConversationRead(conversationId, dernierLuMessageId) {
  return api
    .post(`/messages/conversations/${conversationId}/lu`, { dernier_lu_message_id: dernierLuMessageId })
    .then((r) => r.data);
}

/** Recherche de contacts (utilisateurs actifs + véhicules) pour @mention / nouvelle conversation. */
export function fetchContacts(q) {
  return api
    .get('/messages/contacts', { params: q ? { q } : {} })
    .then((r) => r.data?.contacts || []);
}

/** Compteur global de non-lus, pour la pastille du dock. */
export function fetchNonLus() {
  return api.get('/messages/non-lus').then((r) => r.data || { total: 0, par_conversation: {} });
}
