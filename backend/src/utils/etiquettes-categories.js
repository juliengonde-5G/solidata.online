/**
 * Catégories d'étiquette SANS DÉCLINAISON — règle HISTORIQUE (2.53.0 → 2.56.x).
 *
 * De la 2.53.0 à la 2.56.x, un carton UPCYCLING était imprimé avec la seule
 * catégorie : produit, genre, saison et gamme restaient NULL (« sans objet »),
 * sans rattachement au catalogue.
 *
 * DEPUIS LA 2.57.0 (arbitrage client B du 23/09/2026), l'Upcycling est une
 * combinaison ORDINAIRE du référentiel : gamme UP, catégorie Upcycling, produit
 * « Upcycling », Sans Genre, Sans Saison. Le générateur (routes/etiquettes.js)
 * ne connaît plus de cas particulier : la table `etiquettes_combinaisons` suffit,
 * et un corps sans déclinaisons est refusé en 400 quelle que soit la catégorie.
 *
 * Ce module est CONSERVÉ pour relire les anciens cartons Upcycling à champs
 * NULL, qui restent tels quels en base (on ne réécrit pas l'histoire) : un écran
 * ou un export qui doit expliquer pourquoi ces champs sont vides peut s'appuyer
 * sur `sansDeclinaison`. Il ne pilote plus AUCUNE saisie.
 */

// Valeurs telles qu'elles figurent dans `ref_dimensions` (type categorie_eco_org).
const CATEGORIES_SANS_DECLINAISON = ['Upcycling'];

/** Normalise pour comparer : casse et accents neutralisés, jamais pour afficher. */
function normaliser(valeur) {
  return String(valeur == null ? '' : valeur)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

const INDEX = new Set(CATEGORIES_SANS_DECLINAISON.map(normaliser));

/**
 * Cette catégorie se passe-t-elle de genre / saison / gamme / produit ?
 * @param {string} categorie valeur de `categorie_eco_org`
 * @returns {boolean} false pour une catégorie absente, vide ou inconnue
 */
function sansDeclinaison(categorie) {
  const n = normaliser(categorie);
  return n !== '' && INDEX.has(n);
}

module.exports = { CATEGORIES_SANS_DECLINAISON, sansDeclinaison };
