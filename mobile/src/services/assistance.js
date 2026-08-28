/**
 * Centre d'assistance du chauffeur — règles PURES (aucun accès réseau ni DOM),
 * partagées par le bouton flottant unique et son panneau.
 *
 * POURQUOI CE MODULE (28/08/2026) : l'application chauffeur montrait DEUX
 * bulles rondes en bas d'écran — `MessagesButton` à gauche, `SolidataBot` à
 * droite — avec la MÊME icône de bulle de conversation. Le client l'a lu, à
 * juste titre, comme « le bouton messagerie apparaît deux fois ». Les deux
 * fusionnent désormais en un seul bouton à trois usages : Assistant, Messages,
 * Notifications.
 *
 * Le calcul du badge et la répartition des non-lus vivent ici plutôt que dans
 * le composant : ce sont des règles, pas de l'affichage — et elles se testent
 * sans navigateur (vitest tourne en `environment: 'node'`).
 */

/**
 * Nom de l'événement `window` par lequel DriverMessageBanner publie le nombre
 * de consignes du responsable RESTANT à acquitter.
 *
 * Le bandeau interroge déjà `/api/tours/vehicle/:id/messages-public` toutes
 * les 15 s : lui faire publier son décompte évite au bouton flottant de
 * sonder le MÊME endpoint en parallèle. Une seule source, une seule requête —
 * et le badge affiche exactement ce que le bandeau montre.
 */
export const EVENEMENT_CONSIGNES = 'solidata:consignes-en-attente';

/** Les trois usages réunis sous le bouton unique (ordre d'affichage). */
export const USAGES_ASSISTANCE = Object.freeze(['assistant', 'messages', 'notifications']);

/**
 * Badge du bouton flottant : TOTAL des non-lus du chauffeur.
 *
 * Deux canaux distincts se cumulent : les messages de la messagerie interne
 * (conversations directes + fil « SOLIDATA ») et les consignes du responsable
 * pas encore acquittées. Un seul bouton doit porter un seul chiffre — sans
 * quoi le chauffeur devrait additionner de tête.
 *
 * Toute valeur non exploitable (null, texte, négatif, NaN) compte pour 0 :
 * mieux vaut ne rien annoncer qu'annoncer un nombre faux.
 */
export function sommeNonLus({ messagerie, consignes } = {}) {
  return normaliserCompteur(messagerie) + normaliserCompteur(consignes);
}

function normaliserCompteur(valeur) {
  const n = Number(valeur);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * Texte du badge — jamais plus de deux caractères, pour rester lisible sur une
 * pastille de 22 px en plein soleil. `null` = pas de badge du tout (une
 * pastille « 0 » ferait croire à une information à traiter).
 */
export function libelleBadge(total) {
  const n = normaliserCompteur(total);
  if (n === 0) return null;
  return n > 9 ? '9+' : String(n);
}

/**
 * Répartit les non-lus entre les deux lignes du panneau à partir de la liste
 * des conversations renvoyée par le serveur.
 *
 * Le fil de type `systeme` (« SOLIDATA ») EST l'historique des notifications
 * applicatives (modification de programme, ré-optimisation… — module 34,
 * v2.40.0) : c'est lui que la ligne « Notifications » ouvre. Les autres
 * conversations sont des échanges avec des personnes : ligne « Messages ».
 *
 * `conversations` absent ou illisible (hors couverture) → `disponible: false`
 * et AUCUN compteur : le panneau dit alors qu'il ne sait pas, au lieu
 * d'afficher des zéros qui se liraient « rien à lire ».
 */
export function repartitionNonLus(conversations) {
  if (!Array.isArray(conversations)) {
    return { disponible: false, conversationSystemeId: null, nonLusMessages: 0, nonLusNotifications: 0 };
  }
  let systemeId = null;
  let messages = 0;
  let notifications = 0;
  for (const conv of conversations) {
    if (!conv || typeof conv !== 'object') continue;
    const nonLus = normaliserCompteur(conv.non_lus);
    if (conv.type === 'systeme') {
      // Un chauffeur n'a qu'un fil système ; on garde le premier rencontré.
      if (systemeId === null && conv.id != null) systemeId = conv.id;
      notifications += nonLus;
    } else {
      messages += nonLus;
    }
  }
  return {
    disponible: true,
    conversationSystemeId: systemeId,
    nonLusMessages: messages,
    nonLusNotifications: notifications,
  };
}

/**
 * Le bouton flottant doit-il être visible ?
 *
 * Deux refus, et deux seulement :
 *  - pas de session chauffeur (écrans d'accès, avant l'authentification) ;
 *  - on est DÉJÀ sur l'écran Messages — inutile de flotter au-dessus de sa
 *    propre destination, et sur le fil de conversation la bulle recouvrait
 *    la zone de réponse.
 *
 * Le sondage du badge, lui, continue de tourner : le compteur doit être juste
 * dès le retour sur un autre écran.
 */
export function boutonVisible({ authentifie, chemin } = {}) {
  if (!authentifie) return false;
  const p = typeof chemin === 'string' ? chemin : '';
  return !p.startsWith('/messages');
}

/**
 * Destination de la ligne « Notifications » : le fil « SOLIDATA » quand on
 * connaît son identifiant, sinon la liste des conversations — jamais un
 * identifiant deviné, qui ouvrirait la conversation d'un autre.
 */
export function lienNotifications(conversationSystemeId) {
  return conversationSystemeId != null
    ? `/messages?conversation=${conversationSystemeId}`
    : '/messages';
}
