/**
 * État minimal, hors React, de la conversation actuellement affichée à
 * l'écran. Sert UNIQUEMENT à ce que NouveauMessageBanner ne propose pas
 * d'« ouvrir le fil » d'une conversation déjà ouverte sous les yeux du
 * chauffeur (pas de toast pour un message qu'il est déjà en train de lire).
 *
 * Volontairement un simple module-scope (pas de Context React) : même
 * pattern léger que services/driverAuth.js (verrou de ré-auth) ou
 * services/demoMode.js (drapeau) — la messagerie n'a besoin de partager
 * qu'un seul entier entre deux composants montés à la racine.
 */

let conversationOuverte = null;

export function setConversationOuverte(id) {
  conversationOuverte = id != null ? id : null;
}

export function getConversationOuverte() {
  return conversationOuverte;
}
