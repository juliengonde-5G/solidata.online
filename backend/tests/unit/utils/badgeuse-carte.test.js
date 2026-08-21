/**
 * Module 33 « Temps & Présence » — FOND DE CARTE de l'écran « position des
 * tournées ». Géométrie PURE : aucune base, aucun réseau.
 *
 * CE QUE CE FICHIER VERROUILLE, et qui est la condition de conformité de
 * l'écran (ADR-0004, addendum du 19/08/2026) :
 *   1. la projection a lieu ICI, côté serveur, et elle DÉTRUIT la coordonnée :
 *      un secteur projeté n'a plus ni `lat` ni `lng`. C'est ce qui rend
 *      impossible, en aval, l'envoi d'une position géographique au poste ;
 *   2. une coordonnée aberrante (fiche jamais géocodée, (0,0)) ne doit pas
 *      écraser tout le territoire sur un point — un écran faux est pire qu'un
 *      écran vide ;
 *   3. le contour est l'emprise RÉELLE du réseau de collecte, et il dit
 *      honnêtement qu'il n'y a pas de surface quand il n'y en a pas.
 */
const {
  projeterSecteurs, enveloppeConvexe, coordonneeUtilisable,
  CONTENU_H, MARGE_X, MARGE_HAUT, MARGE_BAS, MIN_L,
} = require('../../../src/utils/badgeuse-carte');

// Quatre communes réelles de l'agglomération, prises aux quatre vents.
const NORD = { code: '76108', nom: 'Le Houlme', lat: 49.5100, lng: 1.0500 };
const SUD = { code: '76681', nom: 'Sotteville', lat: 49.4100, lng: 1.0900 };
const OUEST = { code: '76451', nom: 'Maromme', lat: 49.4700, lng: 1.0200 };
const EST = { code: '76039', nom: 'Bonsecours', lat: 49.4400, lng: 1.1400 };

describe('projection des secteurs — la coordonnée s\'arrête au serveur', () => {
  test('un secteur projeté n\'a PLUS de latitude ni de longitude', () => {
    const { secteurs } = projeterSecteurs([NORD, SUD]);
    for (const s of secteurs) {
      expect(s).not.toHaveProperty('lat');
      expect(s).not.toHaveProperty('lng');
      expect(s.code).toBeDefined();
      expect(Number.isInteger(s.x)).toBe(true);
      expect(Number.isInteger(s.y)).toBe(true);
    }
    // Et la sérialisation complète ne contient aucune trace de coordonnée.
    expect(JSON.stringify(secteurs)).not.toMatch(/lat|lng|latitude|longitude/i);
  });

  test('le nord est en HAUT et l\'est à DROITE (une carte à l\'envers serait pire qu\'aucune carte)', () => {
    const { secteurs } = projeterSecteurs([NORD, SUD, OUEST, EST]);
    const par = Object.fromEntries(secteurs.map((s) => [s.code, s]));
    expect(par[NORD.code].y).toBeLessThan(par[SUD.code].y);
    expect(par[OUEST.code].x).toBeLessThan(par[EST.code].x);
  });

  test('tout tient dans le cadre, y compris la réserve pour les étiquettes', () => {
    // La marge latérale n'est pas décorative : l'étiquette « commune +
    // progression » s'écrit à côté du marqueur et doit rester DANS le canevas.
    const { largeur, hauteur, secteurs } = projeterSecteurs([NORD, SUD, OUEST, EST]);
    for (const s of secteurs) {
      expect(s.x).toBeGreaterThanOrEqual(MARGE_X - 1);
      expect(s.x).toBeLessThanOrEqual(largeur - MARGE_X + 1);
      expect(s.y).toBeGreaterThanOrEqual(MARGE_HAUT - 1);
      expect(s.y).toBeLessThanOrEqual(hauteur - MARGE_BAS + 1);
    }
  });

  test('la HAUTEUR du canevas est CONSTANTE (la police garde sa taille apparente)', () => {
    // Les tailles de police de la carte sont en unités du canevas : une
    // hauteur variable ferait varier la lisibilité d'un territoire à l'autre,
    // et « lisible à 3 m » ne serait plus vérifiable.
    const attendue = MARGE_HAUT + CONTENU_H + MARGE_BAS;
    const portrait = projeterSecteurs([NORD, SUD, OUEST, EST]);
    const etale = projeterSecteurs([
      { code: 'o', lat: 49.45, lng: 0.80 }, { code: 'e', lat: 49.46, lng: 1.40 }]);
    expect(portrait.hauteur).toBe(attendue);
    expect(etale.hauteur).toBe(attendue);
    expect(projeterSecteurs([NORD]).hauteur).toBe(attendue);
    expect(projeterSecteurs([]).hauteur).toBe(attendue);
  });

  test('la LARGEUR épouse la forme du territoire (pas de bande vide imposée)', () => {
    const portrait = projeterSecteurs([NORD, SUD, OUEST, EST]);
    const etale = projeterSecteurs([
      { code: 'o', lat: 49.45, lng: 0.80 }, { code: 'e', lat: 49.46, lng: 1.40 }]);
    expect(etale.largeur).toBeGreaterThan(portrait.largeur);
  });

  test('les proportions du territoire sont respectées (pas d\'étirement)', () => {
    // L'emprise réelle est ~2× plus haute que large en degrés ; corrigée du
    // cosinus de latitude, elle reste plus haute que large à l'écran.
    const { secteurs } = projeterSecteurs([NORD, SUD, OUEST, EST]);
    const xs = secteurs.map((s) => s.x);
    const ys = secteurs.map((s) => s.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(Math.max(...xs) - Math.min(...xs));
  });

  test('UN SEUL secteur : canevas minimal, centré, jamais NaN (division par zéro évitée)', () => {
    const { largeur, secteurs } = projeterSecteurs([NORD]);
    expect(secteurs).toHaveLength(1);
    expect(largeur).toBe(MIN_L);
    expect(secteurs[0].x).toBe(MIN_L / 2);
    expect(Number.isFinite(secteurs[0].y)).toBe(true);
  });

  test('plusieurs secteurs CONFONDUS : centrés, jamais NaN', () => {
    const { secteurs } = projeterSecteurs([NORD, { ...NORD, code: 'bis' }]);
    for (const s of secteurs) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.y)).toBe(true);
    }
  });

  test('aucune donnée exploitable : liste vide, jamais un fond inventé', () => {
    expect(projeterSecteurs([]).secteurs).toEqual([]);
    expect(projeterSecteurs(null).secteurs).toEqual([]);
    expect(projeterSecteurs([{ code: 'x', lat: null, lng: null }]).secteurs).toEqual([]);
  });
});

describe('coordonnées aberrantes — un écran faux est pire qu\'un écran vide', () => {
  test('(0,0), hors bornes et non finies sont refusées', () => {
    expect(coordonneeUtilisable(0, 0)).toBe(false);          // fiche jamais géocodée
    expect(coordonneeUtilisable(49.42, NaN)).toBe(false);
    expect(coordonneeUtilisable(null, 1.09)).toBe(false);
    expect(coordonneeUtilisable(91, 1.09)).toBe(false);
    expect(coordonneeUtilisable(49.42, 181)).toBe(false);
    expect(coordonneeUtilisable(49.42, 1.09)).toBe(true);
  });

  test('UN point à (0,0) n\'écrase pas la Normandie sur un pixel', () => {
    const sain = projeterSecteurs([NORD, SUD, OUEST, EST]);
    const polluee = projeterSecteurs([NORD, SUD, OUEST, EST,
      { code: 'X', nom: 'Jamais géocodée', lat: 0, lng: 0 }]);
    // Le point pollué est écarté, et les quatre autres gardent EXACTEMENT
    // leur place : sans le garde-fou, tout se tasserait en haut à droite.
    expect(polluee.secteurs).toHaveLength(4);
    expect(polluee.secteurs).toEqual(sain.secteurs);
  });
});

describe('contour du territoire', () => {
  test('un point INTÉRIEUR ne fait pas partie du contour', () => {
    const points = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
      { x: 50, y: 50 },
    ];
    const contour = enveloppeConvexe(points);
    expect(contour).toHaveLength(4);
    expect(contour).not.toContainEqual([50, 50]);
  });

  test('moins de 3 points : aucune surface annoncée', () => {
    expect(enveloppeConvexe([{ x: 1, y: 2 }])).toEqual([[1, 2]]);
    expect(enveloppeConvexe([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toEqual([[1, 2], [3, 4]]);
    expect(enveloppeConvexe([])).toEqual([]);
  });

  test('points ALIGNÉS : pas de polygone d\'aire nulle à peindre', () => {
    const contour = enveloppeConvexe([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }]);
    expect(contour.length).toBeLessThan(3);
  });

  test('les doublons de position ne dupliquent pas un sommet', () => {
    const contour = enveloppeConvexe([
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 90 },
    ]);
    expect(contour).toHaveLength(3);
  });

  test('le contour enveloppe bien tous les secteurs projetés', () => {
    const { secteurs } = projeterSecteurs([NORD, SUD, OUEST, EST]);
    const contour = enveloppeConvexe(secteurs);
    expect(contour.length).toBeGreaterThanOrEqual(3);
    for (const [x, y] of contour) {
      expect(secteurs.some((s) => s.x === x && s.y === y)).toBe(true);
    }
  });
});
