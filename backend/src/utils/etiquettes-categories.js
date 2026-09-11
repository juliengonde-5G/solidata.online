/**
 * Catégories d'étiquette SANS DÉCLINAISON — source unique.
 *
 * La très grande majorité des cartons se décrit par cinq choix successifs :
 * catégorie, genre, saison, gamme, produit. L'UPCYCLING, lui, n'en a aucun —
 * c'est une pièce retransformée : il n'y a ni genre, ni saison, ni gamme, ni
 * type de produit à déclarer. L'opérateur choisit la catégorie et pèse.
 * (Demande client du 10/09/2026.)
 *
 * CE QUI EST ÉCRIT EN BASE, ET POURQUOI. Les quatre déclinaisons restent
 * **NULL** — on n'invente pas une gamme « UPCYCLING » qui ne figure dans aucun
 * référentiel, ni un « Sans Genre » que personne n'a choisi : NULL dit
 * « sans objet », une valeur de remplissage dirait « voici la valeur », et
 * c'est faux. Corollaire assumé : ces cartons forment un groupe à part dans les
 * agrégats par gamme — c'est la réalité, ils n'en ont pas.
 *
 * Le rattachement au CATALOGUE produit est également ignoré pour ces
 * catégories : `produits_catalogue` est construit pour des déclinaisons
 * (nom, genre, saison, gamme, tous requis par sa clé d'unicité), il ne peut pas
 * représenter l'absence de produit. `produits_finis.catalogue_id` est nullable,
 * on s'en sert.
 *
 * POURQUOI UNE CONSTANTE ET PAS UNE COLONNE. La liste est servie au front par
 * `GET /etiquettes/dimensions` : l'écran ne la recopie donc jamais, il la
 * reçoit. Le jour où l'exploitant doit pouvoir en marquer d'autres lui-même,
 * cette constante devient le défaut d'une colonne de `ref_dimensions` sans que
 * ni l'API ni l'écran ne bougent.
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
