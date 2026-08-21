/**
 * Module 33 « Temps & Présence » — FOND DE CARTE de l'écran « Position des
 * tournées ». Géométrie PURE : aucune base, aucun réseau, aucune horloge.
 *
 * POURQUOI CE FICHIER EXISTE, ET POURQUOI IL EST PUR
 * --------------------------------------------------
 * L'ADR-0004 (addendum du 19/08/2026) autorise une carte sur le kiosque à deux
 * conditions dont découle tout ce qui suit :
 *
 *  1. AUCUNE TUILE EXTERNE. La CSP du poste est `'self'` : il ne joint jamais
 *     un domaine tiers, pas même pour une image de fond. Le fond est donc
 *     DESSINÉ, à partir des seules coordonnées déjà présentes en base (les
 *     points de collecte). C'est aussi ce qui rend l'écran valable hors ligne,
 *     et ce qui évite de faire dépendre un atelier d'un fournisseur
 *     cartographique.
 *
 *  2. AUCUNE COORDONNÉE NE DESCEND VERS LE POSTE. La projection est faite
 *     ICI, côté serveur : le poste reçoit des points déjà exprimés dans un
 *     repère abstrait (0..largeur, 0..hauteur) qu'aucune opération ne
 *     ramène à une latitude. Le véhicule, lui, ne référence qu'un SECTEUR —
 *     il n'a jamais de position propre dans la charge utile. Un poste
 *     compromis ne peut donc pas restituer le trajet de quelqu'un.
 *
 * Le corollaire pratique est que le Raspberry Pi 3 n'a aucun calcul à faire :
 * il trace un polygone et des cercles aux coordonnées reçues. Pas de
 * trigonométrie, pas de projection, pas de bibliothèque cartographique.
 */

/**
 * Boîte du contenu géographique et marges du fond, en unités du repère.
 *
 * DEUX CONTRAINTES, qui expliquent la forme retenue :
 *
 *  1. La HAUTEUR du canevas est CONSTANTE (470 + 50 + 80 = 600). Les tailles
 *     de police de la carte sont exprimées dans ces mêmes unités : un canevas
 *     de hauteur variable ferait varier la taille APPARENTE du texte d'un
 *     territoire à l'autre, et l'exigence « lisible à 3 m » ne serait plus
 *     tenable. À hauteur fixe, l'écran affiche le canevas à une échelle
 *     connue, et 50 unités valent ~50 px sur un téléviseur 1080p — au-delà du
 *     plancher de 48 px du CDC pour l'information principale.
 *
 *  2. La LARGEUR, elle, épouse le territoire. Imposer un cadre 16:9 à une
 *     agglomération plus haute que large afficherait la carte minuscule au
 *     milieu de deux bandes vides.
 *
 * Les marges latérales restent modestes : les étiquettes de véhicule
 * (immatriculation, commune, progression) débordent volontairement du
 * canevas pour occuper la place libre à côté de la carte — c'est le poste qui
 * les laisse dépasser (`overflow: visible`), et cette place existe puisque le
 * territoire est portrait sur un écran paysage.
 */
const CONTENU_L = 900;
const CONTENU_H = 470;
const MARGE_X = 70;
const MARGE_HAUT = 50;
const MARGE_BAS = 80;

/** Largeur minimale : un territoire très étroit ne doit pas être un trait. */
const MIN_L = 520;

/**
 * Une coordonnée exploitable pour dessiner le territoire.
 *
 * Le couple (0, 0) est REFUSÉ volontairement : c'est la valeur qu'on trouve
 * dans une fiche jamais géocodée, et elle tombe dans le golfe de Guinée. Un
 * seul point de ce genre suffirait à étirer la boîte englobante sur deux
 * continents et à écraser toute la Normandie sur un pixel — l'écran serait
 * faux sans être vide, ce qui est le pire des deux.
 */
function coordonneeUtilisable(lat, lng) {
  // `Number(null)` vaut 0, et `Number('')` aussi : sans ce refus explicite,
  // une coordonnée ABSENTE deviendrait silencieusement l'équateur — le cas
  // exact que le garde-fou (0,0) ci-dessous est censé attraper, contourné par
  // une valeur nulle qui n'est pas littéralement zéro.
  if (lat === null || lat === undefined || lat === '' ||
      lng === null || lng === undefined || lng === '') return false;
  const y = Number(lat);
  const x = Number(lng);
  if (!Number.isFinite(y) || !Number.isFinite(x)) return false;
  if (y < -90 || y > 90 || x < -180 || x > 180) return false;
  if (y === 0 && x === 0) return false;
  return true;
}

/**
 * Projette des secteurs géolocalisés dans le repère du fond de carte.
 *
 * Projection équirectangulaire à parallèle de référence : sur l'emprise d'une
 * métropole, elle est indiscernable d'une projection conforme, et elle tient
 * en deux lignes sans dépendance. La correction en cos(latitude) évite le
 * territoire visuellement étiré en largeur qu'on obtiendrait sans elle.
 *
 * @param {Array<{code:string,nom:string,lat:number,lng:number}>} entrees
 * @returns {{largeur:number,hauteur:number,secteurs:Array}} secteurs = entrées
 *   conservées, enrichies de `x`/`y` entiers ; `lat`/`lng` sont RETIRÉS —
 *   c'est ici que la coordonnée géographique cesse d'exister dans le flux.
 */
function projeterSecteurs(entrees) {
  const valides = (Array.isArray(entrees) ? entrees : []).filter(
    (s) => s && coordonneeUtilisable(s.lat, s.lng)
  );
  if (valides.length === 0) {
    return { largeur: MIN_L, hauteur: MARGE_HAUT + CONTENU_H + MARGE_BAS, secteurs: [] };
  }

  const latMoyenne = valides.reduce((somme, s) => somme + Number(s.lat), 0) / valides.length;
  const facteurLongitude = Math.cos((latMoyenne * Math.PI) / 180);

  // Repère intermédiaire : x vers l'est, y vers le BAS (l'écran compte ses
  // ordonnées à l'envers du globe — le nord doit finir en haut).
  const bruts = valides.map((s) => ({
    source: s,
    bx: Number(s.lng) * facteurLongitude,
    by: -Number(s.lat),
  }));

  const xs = bruts.map((p) => p.bx);
  const ys = bruts.map((p) => p.by);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const etendueX = maxX - minX;
  const etendueY = maxY - minY;

  // Un seul secteur, ou plusieurs confondus : aucune échelle n'a de sens, on
  // centre. Ne pas traiter ce cas donnerait une division par zéro le jour où
  // le territoire se réduit à une commune.
  const echelle = (etendueX <= 0 && etendueY <= 0)
    ? 0
    : Math.min(etendueX > 0 ? CONTENU_L / etendueX : Infinity,
               etendueY > 0 ? CONTENU_H / etendueY : Infinity);

  const largeurRendue = etendueX * echelle;
  const hauteurRendue = etendueY * echelle;

  // Le canevas ÉPOUSE le territoire : c'est lui qui donne au poste le rapport
  // d'affichage à respecter, si bien que la carte occupe toute la place
  // disponible quelle que soit la forme de l'agglomération.
  const largeur = Math.round(Math.max(largeurRendue + 2 * MARGE_X, MIN_L));
  const hauteur = MARGE_HAUT + CONTENU_H + MARGE_BAS;   // constante, cf. ci-dessus
  const decalageX = (largeur - largeurRendue) / 2;
  const decalageY = MARGE_HAUT + (CONTENU_H - hauteurRendue) / 2;

  const secteurs = bruts.map((p) => {
    const { lat, lng, ...reste } = p.source;
    return {
      ...reste,
      x: Math.round(decalageX + (p.bx - minX) * echelle),
      y: Math.round(decalageY + (p.by - minY) * echelle),
    };
  });

  return { largeur, hauteur, secteurs };
}

/**
 * Enveloppe convexe (parcours monotone d'Andrew) des points projetés : c'est
 * le « contour du territoire » que l'ADR demande d'afficher.
 *
 * On dessine l'emprise RÉELLE de notre réseau de collecte, pas une frontière
 * administrative — que nous n'avons pas en base, et qu'il faudrait aller
 * chercher chez un tiers. Le contour dit donc exactement ce qu'il sait : où
 * nous collectons. Sous 3 points, il n'y a pas de surface : la liste des
 * points est renvoyée telle quelle et le poste ne remplit rien.
 */
function enveloppeConvexe(points) {
  const uniques = [];
  const vus = new Set();
  for (const p of (Array.isArray(points) ? points : [])) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const cle = `${p.x}|${p.y}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    uniques.push([p.x, p.y]);
  }
  if (uniques.length < 3) return uniques;

  uniques.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const produitVectoriel = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const bas = [];
  for (const p of uniques) {
    while (bas.length >= 2 && produitVectoriel(bas[bas.length - 2], bas[bas.length - 1], p) <= 0) bas.pop();
    bas.push(p);
  }
  const haut = [];
  for (let i = uniques.length - 1; i >= 0; i -= 1) {
    const p = uniques[i];
    while (haut.length >= 2 && produitVectoriel(haut[haut.length - 2], haut[haut.length - 1], p) <= 0) haut.pop();
    haut.push(p);
  }
  bas.pop();
  haut.pop();
  const contour = bas.concat(haut);

  // Points alignés : l'enveloppe dégénère en segment, et le parcours d'Andrew
  // l'a réduit à ses deux extrémités. On renvoie CE segment, pas la liste
  // complète des points : moins de 3 sommets est la façon de dire au poste
  // qu'il n'y a aucune surface à peindre.
  return contour.length >= 2 ? contour : uniques;
}

module.exports = {
  projeterSecteurs, enveloppeConvexe, coordonneeUtilisable,
  CONTENU_L, CONTENU_H, MARGE_X, MARGE_HAUT, MARGE_BAS, MIN_L,
};
