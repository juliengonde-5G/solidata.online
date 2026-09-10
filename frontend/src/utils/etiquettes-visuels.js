/**
 * Visuels de l'écran d'étiquetage — icônes, couleurs et définitions.
 *
 * POURQUOI UN FICHIER À PART. L'écran /tri/etiquettes est un écran d'ATELIER :
 * il se lit debout, avec des gants, sur une tablette, par des personnes qui ne
 * relisent pas les libellés une fois le geste appris. Ce qui les guide est
 * l'image, pas le mot — une icône qui ne dit rien de la catégorie (le même
 * pictogramme d'étiquette pour « Jouets », « Rideaux » et « Linge ») force à
 * relire à chaque carton, et fait choisir la mauvaise case quand on va vite.
 * Ces tables décident donc de ce qui est vu ; elles vivent hors du composant
 * pour rester lisibles et modifiables sans toucher au parcours.
 *
 * DOCTRINE : rien n'est deviné. Une valeur du référentiel qui n'a pas d'entrée
 * ici reçoit un visuel NEUTRE explicite (icône d'étiquette, gris) — jamais
 * l'icône d'une voisine « qui ressemble ». Un exploitant qui ajoute une
 * catégorie dans Admin → Catalogue voit donc apparaître une tuile neutre, et
 * sait qu'il reste à lui donner son image, plutôt que de découvrir un carton
 * de couettes sous une paire de chaussures.
 *
 * La correspondance se fait sur la valeur NORMALISÉE (casse et accents
 * neutralisés) : « Été », « ETE » et « été » désignent la même saison, et le
 * référentiel est saisi à la main.
 */
import {
  ShoppingBag, Shirt, Footprints, SprayCan, BedDouble, WashingMachine,
  ToyBrick, Blinds, Sparkles, Tag,
  Sun, Snowflake, CalendarOff, Leaf, Flower2,
  Gem, Store, PackageSearch, Container,
  User, Users, Baby,
} from 'lucide-react';

/** Casse et accents neutralisés pour COMPARER — jamais pour afficher. */
export function normaliser(valeur) {
  return String(valeur == null ? '' : valeur)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/** Visuel neutre : dit « pas encore d'image » au lieu d'en inventer une. */
export const VISUEL_NEUTRE = { icon: Tag, color: '#475569', bg: '#E2E8F0' };

// ── Catégories éco-organisme ───────────────────────────────────────────────
// Une icône par nature de produit. « Chiffons » prend le vaporisateur
// (essuyage industriel, leur débouché réel) et non le logo du recyclage, qui
// vaut pour toute la filière et ne distinguait donc rien.
const CATEGORIES = {
  textiles: { icon: Shirt, color: '#2563EB', bg: '#DBEAFE' },
  chaussures: { icon: Footprints, color: '#92400E', bg: '#FED7AA' },
  maroquinerie: { icon: ShoppingBag, color: '#8B5A2B', bg: '#FEF3C7' },
  chiffons: { icon: SprayCan, color: '#475569', bg: '#E2E8F0' },
  'couettes et coussins': { icon: BedDouble, color: '#7C3AED', bg: '#EDE9FE' },
  linge: { icon: WashingMachine, color: '#0369A1', bg: '#E0F2FE' },
  jouets: { icon: ToyBrick, color: '#DB2777', bg: '#FCE7F3' },
  rideaux: { icon: Blinds, color: '#B45309', bg: '#FEF3C7' },
  upcycling: { icon: Sparkles, color: '#0F766E', bg: '#CCFBF1' },
};

export function visuelCategorie(valeur) {
  return CATEGORIES[normaliser(valeur)] || VISUEL_NEUTRE;
}

// ── Saisons ────────────────────────────────────────────────────────────────
// Reconnaissance par MOT-CLÉ et non par égalité stricte : le référentiel porte
// « Été » et « Hiver » aujourd'hui, mais « Été / Mi-saison » demain — un
// libellé enrichi ne doit pas retomber sur le visuel neutre pour un espace.
const SAISONS = [
  { cle: 'hiver', icon: Snowflake, color: '#0369A1', bg: '#E0F2FE' },
  { cle: 'ete', icon: Sun, color: '#B45309', bg: '#FEF3C7' },
  { cle: 'printemps', icon: Flower2, color: '#15803D', bg: '#DCFCE7' },
  { cle: 'automne', icon: Leaf, color: '#9A3412', bg: '#FFEDD5' },
  // « Sans Saison » = le carton se vend toute l'année. Le calendrier barré le
  // dit ; un pictogramme de saison quelconque laisserait croire à un oubli.
  { cle: 'sans', icon: CalendarOff, color: '#475569', bg: '#E2E8F0' },
];

export function visuelSaison(valeur) {
  const n = normaliser(valeur);
  const trouve = SAISONS.find((s) => n.includes(s.cle));
  return trouve ? { icon: trouve.icon, color: trouve.color, bg: trouve.bg } : VISUEL_NEUTRE;
}

// ── Gammes ─────────────────────────────────────────────────────────────────
// Les quatre gammes portent des noms internes (EXTRA, VAK…) que personne ne
// devine à la première journée. Leur DÉFINITION métier — dictée par le client
// le 10/09/2026 — est affichée sous le nom, et l'icône la reprend : le joyau
// pour le premium, la boutique pour le magasin, la fouille pour la vente au
// kilo, le conteneur pour l'export en gros volumes.
const GAMMES = {
  extra: { icon: Gem, color: '#7C3AED', bg: '#EDE9FE', definition: 'Premium' },
  standard: { icon: Store, color: '#0F766E', bg: '#CCFBF1', definition: 'Magasin' },
  vak: { icon: PackageSearch, color: '#B45309', bg: '#FEF3C7', definition: 'Fouille' },
  export: { icon: Container, color: '#1D4ED8', bg: '#DBEAFE', definition: 'Gros volumes' },
};

export function visuelGamme(valeur) {
  const v = GAMMES[normaliser(valeur)];
  // `definition` absente pour une gamme inconnue : l'écran affiche alors le
  // nom seul plutôt qu'une définition approchée.
  return v || VISUEL_NEUTRE;
}

// ── Genres : trois familles, une ligne chacune ─────────────────────────────
// Demande client : « une ligne Adulte / Enfants / Layettes ». Le référentiel
// porte dix valeurs (Adulte Femme, Enfant Fille, Layette Garçon…) que l'écran
// alignait à plat, sans hiérarchie — l'opérateur balayait dix tuiles pour en
// trouver une. Le regroupement se fait sur le PRÉFIXE normalisé, donc une
// onzième valeur (« Adulte Unisexe ») rejoint sa famille toute seule.
//
// « Sans Genre » et tout libellé hors familles tombent dans une quatrième
// ligne « Autre », affichée seulement si elle contient quelque chose : une
// section vide se lit comme une donnée manquante.
export const FAMILLES_GENRE = [
  { id: 'adulte', label: 'Adulte', icon: User, prefixe: 'adulte' },
  { id: 'enfant', label: 'Enfants', icon: Users, prefixe: 'enfant' },
  { id: 'layette', label: 'Layettes', icon: Baby, prefixe: 'layette' },
];

/**
 * Range les valeurs de genre par famille, dans l'ordre des familles puis dans
 * l'ordre du référentiel (qui porte son propre `ordre`).
 * @param {string[]} valeurs
 * @returns {{id:string,label:string,icon:Function,valeurs:string[]}[]} familles NON VIDES
 */
export function grouperGenres(valeurs) {
  const restants = [...(valeurs || [])];
  const groupes = FAMILLES_GENRE.map((f) => {
    const pris = restants.filter((v) => normaliser(v).startsWith(f.prefixe));
    for (const v of pris) restants.splice(restants.indexOf(v), 1);
    return { ...f, valeurs: pris };
  });
  if (restants.length > 0) {
    groupes.push({ id: 'autre', label: 'Autre', icon: Tag, valeurs: restants });
  }
  return groupes.filter((g) => g.valeurs.length > 0);
}
