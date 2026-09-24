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
 *
 * 2.57.0 (Étiquettes v2, 23/09/2026) : les gammes changent de nature. BTQ
 * remplace STANDARD, EXPORT disparaît de la saisie, UP (Upcycling) et CHIF
 * (Chiffons) deviennent des gammes IMPRIMÉES à part entière et non plus des
 * cas particuliers. Les anciennes valeurs (STANDARD, EXPORT, BTQ STAND,
 * BTQ EXTRA, BTQ FMR, Pvak) restent gérées ICI pour l'affichage de l'HISTORIQUE
 * (des cartons imprimés avant la bascule continuent d'exister en stock et
 * doivent rester lisibles) — elles ne sont plus proposées à la saisie
 * (le référentiel backend ne les sert plus dans `/etiquettes/referentiel`).
 * Import important : `import { Map } from 'lucide-react'` a provoqué une page
 * blanche totale en prod (2.56.2, `Map` masque le constructeur du langage) —
 * on n'importe donc ici que des icônes dont le nom ne recouvre AUCUN
 * identifiant global (jamais Map/Set/Promise/Symbol… sans alias).
 */
import {
  ShoppingBag, Shirt, Footprints, SprayCan, BedDouble, WashingMachine,
  ToyBrick, Blinds, Sparkles, Tag,
  Sun, Snowflake, CalendarOff, Leaf, Flower2,
  Gem, Store, PackageSearch, Container,
  User, Users, Baby, UserX,
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
// Cinq gammes ACTIVES à la saisie (arbitrages A1/A2 du 23/09/2026), chacune
// avec sa définition métier — un nom de code (« EXTRA », « VAK »…) ne se
// comprend qu'après des mois d'atelier, la définition se lit tout de suite.
// Les entrées suivantes (standard/export/btq stand/btq extra/btq fmr/pvak)
// sont des valeurs HISTORIQUES : des cartons déjà imprimés les portent encore
// (stock, réimpression, export ancien format) mais aucune n'est plus proposée
// au choix — leur définition le dit explicitement (« ancien »).
const GAMMES = {
  extra: { icon: Gem, color: '#7C3AED', bg: '#EDE9FE', definition: 'Premium' },
  btq: { icon: Store, color: '#16A34A', bg: '#DCFCE7', definition: 'Boutique' },
  vak: { icon: PackageSearch, color: '#B45309', bg: '#FEF3C7', definition: 'Vente au kilo' },
  chif: { icon: SprayCan, color: '#475569', bg: '#E2E8F0', definition: 'Chiffons' },
  up: { icon: Sparkles, color: '#0F766E', bg: '#CCFBF1', definition: 'Upcycling' },

  // Historique — affichage seul, jamais proposé à la saisie.
  standard: { icon: Store, color: '#16A34A', bg: '#DCFCE7', definition: 'Boutique (ancien, désormais BTQ)' },
  export: { icon: Container, color: '#1D4ED8', bg: '#DBEAFE', definition: 'Gros volumes (ancien, retiré)' },
  'btq stand': { icon: Store, color: '#16A34A', bg: '#DCFCE7', definition: 'Boutique (ancien, désormais BTQ)' },
  'btq extra': { icon: Gem, color: '#7C3AED', bg: '#EDE9FE', definition: 'Premium (ancien, désormais EXTRA)' },
  'btq fmr': { icon: Store, color: '#16A34A', bg: '#DCFCE7', definition: 'Boutique (ancien, désormais BTQ)' },
  pvak: { icon: PackageSearch, color: '#B45309', bg: '#FEF3C7', definition: 'Vente au kilo (ancien)' },
};

export function visuelGamme(valeur) {
  const v = GAMMES[normaliser(valeur)];
  // `definition` absente pour une gamme inconnue : l'écran affiche alors le
  // nom seul plutôt qu'une définition approchée.
  return v || VISUEL_NEUTRE;
}

// ── Genres : familles d'âge, une ligne chacune ─────────────────────────────
// Demande client (référentiel 2026) : Adulte / Enfant (sans tranche d'âge) /
// Enfant 0-2 ans / Enfant 3-9 ans / Enfant 10 ans et + / Sans genre — dans cet
// ordre d'AFFICHAGE. Le référentiel porte 14 valeurs (Adulte Homme, Enfant
// Fille 0-2 ans…) que l'écran alignait à plat avant 2.57.0 ; l'opérateur
// balayait dix tuiles pour en trouver une.
//
// Le classement se fait par un TEST spécifique à chaque famille (pas un
// simple préfixe) car « Enfant Fille 0-2 ans » et « Enfant Fille » partagent
// le même préfixe « enfant » — c'est la présence d'une tranche d'âge dans le
// libellé qui les distingue, pas seulement le mot « Enfant ». L'ordre des
// TESTS (dans `FAMILLES_GENRE`) va donc du plus spécifique (tranche d'âge) au
// plus général, pour qu'« Enfant Fille 0-2 ans » ne tombe jamais dans la
// famille générique « Enfant ».
//
// Toute valeur qui ne correspond à aucun test (un ajout futur au référentiel
// qu'on n'a pas encore répertorié ici) tombe dans « Autre », affichée
// seulement si elle contient quelque chose — une ligne vide se lit comme une
// donnée manquante.
export const FAMILLES_GENRE = [
  { id: 'adulte', label: 'Adulte', icon: User, test: (n) => n.startsWith('adulte') },
  { id: 'enfant_0_2', label: 'Enfant 0-2 ans', icon: Baby, test: (n) => n.startsWith('enfant') && n.includes('0-2') },
  { id: 'enfant_3_9', label: 'Enfant 3-9 ans', icon: Baby, test: (n) => n.startsWith('enfant') && n.includes('3-9') },
  { id: 'enfant_10_plus', label: 'Enfant 10 ans et +', icon: Baby, test: (n) => n.startsWith('enfant') && n.includes('10 ans') },
  { id: 'enfant', label: 'Enfant', icon: Users, test: (n) => n.startsWith('enfant') },
  { id: 'sans_genre', label: 'Sans genre', icon: UserX, test: (n) => n === 'sans genre' },
];

/**
 * Range les valeurs de genre par famille, DANS L'ORDRE D'AFFICHAGE ci-dessus
 * (indépendant de l'ordre des tests, qui doit lui rester du plus spécifique
 * au plus général — voir le commentaire de FAMILLES_GENRE). Une valeur qui ne
 * correspond à AUCUNE famille rejoint « Autre » en dernier.
 * @param {string[]} valeurs
 * @returns {{id:string,label:string,icon:Function,valeurs:string[]}[]} familles NON VIDES
 */
export function grouperGenres(valeurs) {
  // Tests dans l'ordre spécifique → général (voir commentaire ci-dessus) ;
  // affichage dans l'ordre de FAMILLES_GENRE (déjà celui voulu par le client).
  const ordreTest = ['enfant_0_2', 'enfant_3_9', 'enfant_10_plus', 'sans_genre', 'adulte', 'enfant'];
  const restants = [...(valeurs || [])];
  const parFamille = new Map(FAMILLES_GENRE.map((f) => [f.id, []]));
  for (const idFamille of ordreTest) {
    const famille = FAMILLES_GENRE.find((f) => f.id === idFamille);
    const pris = restants.filter((v) => famille.test(normaliser(v)));
    for (const v of pris) restants.splice(restants.indexOf(v), 1);
    parFamille.set(idFamille, pris);
  }
  const groupes = FAMILLES_GENRE.map((f) => ({ ...f, valeurs: parFamille.get(f.id) }));
  if (restants.length > 0) {
    groupes.push({ id: 'autre', label: 'Autre', icon: Tag, valeurs: restants });
  }
  return groupes.filter((g) => g.valeurs.length > 0);
}
