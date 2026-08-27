/**
 * Connexion Socket.IO PARTAGÉE pour la messagerie mobile (lot L3, contrat
 * §2.4). Une seule connexion pour tout le module (bouton flottant, bannière
 * « nouveau message », écran /messages) — jamais une par composant : c'est
 * la garde « sans duplication » du contrat L3 (choix retenu : connexion
 * propre à la messagerie plutôt que le socket, local et éphémère, de
 * TourMap — qui ne vit que pendant la carte de tournée et sert un tout
 * autre usage, la position GPS).
 *
 * Aucun `join` explicite côté client : le serveur place déjà la session dans
 * la bonne salle à la connexion (`vehicule:<id>` pour un jeton chauffeur,
 * résolu par `driverVehicleIdFromToken` — contrat §2.4). Ce module se
 * contente d'écouter `messagerie:nouveau` / `messagerie:lu`.
 *
 * Best effort par nature : la messagerie reste utilisable sans le socket
 * (REST est la source de vérité, rejouable hors ligne) — l'absence de
 * connexion dégrade seulement le temps réel, jamais la fonctionnalité.
 */

import io from 'socket.io-client';

let socket = null;
const abonnesNouveau = new Set();
const abonnesLu = new Set();

function nombreAbonnes() {
  return abonnesNouveau.size + abonnesLu.size;
}

function ensureSocket() {
  if (socket) return socket;
  let token = null;
  try { token = localStorage.getItem('mobile_token'); } catch { /* ignore */ }
  if (!token) return null;

  const s = io(window.location.origin, {
    transports: ['websocket', 'polling'],
    auth: { token },
  });
  s.on('messagerie:nouveau', (data) => {
    abonnesNouveau.forEach((fn) => {
      try { fn(data); } catch (err) { console.warn('[MESSAGERIE] écouteur nouveau en échec', err); }
    });
  });
  s.on('messagerie:lu', (data) => {
    abonnesLu.forEach((fn) => {
      try { fn(data); } catch (err) { console.warn('[MESSAGERIE] écouteur lu en échec', err); }
    });
  });
  s.on('connect_error', (err) => {
    console.warn('[MESSAGERIE] Socket.IO connect_error:', err.message);
  });
  socket = s;
  return socket;
}

/**
 * S'abonne aux événements temps réel de la messagerie. Retourne une fonction
 * de désabonnement — à appeler impérativement au démontage du composant.
 * @param {object} args
 * @param {(data:object)=>void} [args.onNouveau] - { conversation_id, message, non_lus_conversation }
 * @param {(data:object)=>void} [args.onLu] - { conversation_id, dernier_lu_message_id }
 * @returns {() => void}
 */
export function subscribeMessagerie({ onNouveau, onLu } = {}) {
  ensureSocket();
  if (onNouveau) abonnesNouveau.add(onNouveau);
  if (onLu) abonnesLu.add(onLu);

  return () => {
    if (onNouveau) abonnesNouveau.delete(onNouveau);
    if (onLu) abonnesLu.delete(onLu);
    // Dernier abonné parti : on referme la connexion — un chauffeur qui a
    // quitté tous les écrans de messagerie n'a plus besoin d'un socket ouvert
    // en arrière-plan pour un usage best-effort.
    if (nombreAbonnes() === 0 && socket) {
      socket.disconnect();
      socket = null;
    }
  };
}

/** Utilitaire de tests/déconnexion explicite (ex. logout). */
export function resetMessagerieSocket() {
  if (socket) socket.disconnect();
  socket = null;
  abonnesNouveau.clear();
  abonnesLu.clear();
}
