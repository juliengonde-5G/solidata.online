/**
 * Règles de gestion des noms (Lot 1) — appliquées partout où des salariés ou
 * des candidats sont affichés ou listés dans l'application :
 *   1. Tri alphabétique par NOM de famille puis PRÉNOM (insensible à la
 *      casse et aux accents — collation 'fr').
 *   2. Le NOM de famille est TOUJOURS affiché en MAJUSCULES (ex. « DUPONT Marie »).
 *
 * À utiliser côté front partout où une liste de personnes est construite ou
 * affichée (dropdowns, tableaux, cartes, fiches). Quand la liste vient déjà
 * triée du backend (ORDER BY last_name, first_name), `compareByName` reste
 * inoffensif à réappliquer (idempotent) et protège contre un backend non
 * trié (cas de certaines routes du module Insertion, hors périmètre de ce lot).
 */

/** Met le nom de famille en MAJUSCULES. Toujours utiliser cette fonction pour
 * afficher un nom de famille, plutôt qu'un `.toUpperCase()` ad hoc. */
export function formatLastName(nom) {
  return String(nom == null ? '' : nom).toUpperCase();
}

/** Formate « NOM Prénom » (nom de famille en majuscules). Les deux
 * arguments manquants sont tolérés (renvoie ce qui est disponible). */
export function formatEmployeeName(last, first) {
  const l = formatLastName(last).trim();
  const f = String(first == null ? '' : first).trim();
  return [l, f].filter(Boolean).join(' ');
}

/** Comparateur pour Array.prototype.sort : trie par nom de famille puis
 * prénom, insensible à la casse/aux accents (locale française). Accepte des
 * objets `{ last_name, first_name }` (convention employees/candidates). */
export function compareByName(a, b) {
  const lastA = String(a?.last_name == null ? '' : a.last_name).trim();
  const lastB = String(b?.last_name == null ? '' : b.last_name).trim();
  const byLast = lastA.localeCompare(lastB, 'fr', { sensitivity: 'base' });
  if (byLast !== 0) return byLast;
  const firstA = String(a?.first_name == null ? '' : a.first_name).trim();
  const firstB = String(b?.first_name == null ? '' : b.first_name).trim();
  return firstA.localeCompare(firstB, 'fr', { sensitivity: 'base' });
}
