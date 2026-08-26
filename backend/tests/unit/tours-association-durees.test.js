// ═══════════════════════════════════════════════════════════════════════════
// TESTS UNITAIRES — CASCADE DES DURÉES D'ARRÊT (RG-C3) ET SUGGESTION D'ORDRE
//                   SOUS RENDEZ-VOUS (RG-B4)
// ───────────────────────────────────────────────────────────────────────────
// Deux règles PURES du lot « tournées associations », testées sans base :
//
//  1. CASCADE : ajustement de la tournée (`duree_prevue_min`) → durée par
//     défaut de la fiche (`duree_collecte_min`) → réglage global `timePerCav`.
//     Chaque niveau ne s'applique QUE si le précédent est vide. Aucune valeur
//     n'est inventée : une saisie aberrante (0, négative, > 8 h, texte) n'est
//     pas « corrigée », elle est ignorée et la cascade descend d'un cran.
//
//  2. SUGGESTION D'ORDRE : les points ancrés d'abord (fenêtre croissante),
//     chaque point libre inséré au moindre détour SOUS test de faisabilité.
//     La distance et la faisabilité sont INJECTÉES → fonction pure.
//
// La base est mockée pour que `smart-tour.js` se charge sans PostgreSQL ;
// aucune des fonctions testées ici ne l'interroge.
// ═══════════════════════════════════════════════════════════════════════════
jest.mock('../../src/config/database', () => ({
  query: jest.fn(async () => ({ rows: [] })),
  connect: jest.fn(async () => ({ query: async () => ({ rows: [] }), release: () => {} })),
}));

const {
  resolveDureeArret, resolveServiceMinutes, dureeArretValide, suggererOrdre,
} = require('../../src/routes/tours/smart-tour');

const GLOBAL = 10; // réglage `timePerCav` par défaut

describe('Cascade des durées d’arrêt (RG-C3)', () => {
  test('l’ajustement de la tournée prime sur tout le reste', () => {
    const r = resolveDureeArret({ duree_prevue_min: 45, duree_collecte_min: 20 }, GLOBAL);
    expect(r).toEqual({ minutes: 45, source: 'tournee' });
  });

  test('sans ajustement, la durée de la FICHE s’applique', () => {
    const r = resolveDureeArret({ duree_prevue_min: null, duree_collecte_min: 20 }, GLOBAL);
    expect(r).toEqual({ minutes: 20, source: 'fiche' });
  });

  test('sans ajustement ni fiche, le réglage GLOBAL s’applique', () => {
    expect(resolveDureeArret({}, GLOBAL)).toEqual({ minutes: 10, source: 'global' });
    expect(resolveDureeArret({ duree_prevue_min: null, duree_collecte_min: null }, GLOBAL))
      .toEqual({ minutes: 10, source: 'global' });
    expect(resolveDureeArret(null, GLOBAL)).toEqual({ minutes: 10, source: 'global' });
  });

  test('les colonnes PostgreSQL rendues en chaîne sont acceptées', () => {
    expect(resolveDureeArret({ duree_collecte_min: '25' }, GLOBAL).minutes).toBe(25);
    expect(resolveDureeArret({ duree_prevue_min: '30.5' }, GLOBAL).minutes).toBe(30.5);
  });

  test('une durée aberrante est IGNORÉE, jamais corrigée : la cascade descend', () => {
    // 0 et négatif : un arrêt de durée nulle n'existe pas.
    expect(resolveDureeArret({ duree_prevue_min: 0, duree_collecte_min: 20 }, GLOBAL))
      .toEqual({ minutes: 20, source: 'fiche' });
    expect(resolveDureeArret({ duree_prevue_min: -5, duree_collecte_min: 20 }, GLOBAL))
      .toEqual({ minutes: 20, source: 'fiche' });
    // Au-delà de 8 h : hors de toute journée de travail.
    expect(resolveDureeArret({ duree_prevue_min: 481, duree_collecte_min: 20 }, GLOBAL))
      .toEqual({ minutes: 20, source: 'fiche' });
    // Texte / NaN.
    expect(resolveDureeArret({ duree_prevue_min: 'quarante', duree_collecte_min: 20 }, GLOBAL))
      .toEqual({ minutes: 20, source: 'fiche' });
    // Fiche aberrante ET ajustement absent → réglage global.
    expect(resolveDureeArret({ duree_collecte_min: 0 }, GLOBAL))
      .toEqual({ minutes: 10, source: 'global' });
  });

  test('480 min (8 h) est la dernière valeur acceptée', () => {
    expect(dureeArretValide(480)).toBe(480);
    expect(dureeArretValide(480.5)).toBeNull();
    expect(dureeArretValide(1)).toBe(1);
  });

  test('resolveServiceMinutes ne renvoie que les minutes', () => {
    expect(resolveServiceMinutes({ duree_collecte_min: 20 }, GLOBAL)).toBe(20);
    expect(resolveServiceMinutes({}, GLOBAL)).toBe(GLOBAL);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Suggestion d’ordre sous rendez-vous (RG-B4)', () => {
  // Points alignés sur un axe : la distance est |x(a) − x(b)|, le centre est
  // en 0. Un ordre croissant est donc l'ordre le plus court.
  const P = (id, x, anchor = null) => ({ id, x, anchor });
  const distance = (a, b) => Math.abs((a ? a.x : 0) - (b ? b.x : 0));
  const toujoursFaisable = async () => true;
  const ids = (ordre) => ordre.map((p) => p.id);

  test('sans aucun point ancré, aucune suggestion (rien à réordonner pour un RDV)', async () => {
    const r = await suggererOrdre([P(1, 1), P(2, 2)], { distance, faisable: toujoursFaisable });
    expect(r).toBeNull();
  });

  test('les points ancrés sont placés par fenêtre croissante', async () => {
    const tardif = P(1, 5, { debutMin: 660, finMin: 690 });   // 11:00
    const matinal = P(2, 1, { debutMin: 540, finMin: 570 });  // 09:00
    const r = await suggererOrdre([tardif, matinal], { distance, faisable: toujoursFaisable });
    expect(ids(r)).toEqual([2, 1]);
  });

  test('un point libre est inséré à la position du moindre détour', async () => {
    const a = P(1, 1, { debutMin: 540, finMin: 570 });
    const b = P(2, 9, { debutMin: 660, finMin: 690 });
    const libre = P(3, 5); // entre les deux : détour nul sur l'axe
    const r = await suggererOrdre([b, libre, a], { distance, faisable: toujoursFaisable });
    expect(ids(r)).toEqual([1, 3, 2]);
  });

  test('une position infaisable est écartée au profit de la suivante', async () => {
    const a = P(1, 1, { debutMin: 540, finMin: 570 });
    const b = P(2, 9, { debutMin: 660, finMin: 690 });
    const libre = P(3, 5);
    // Le placement « au milieu » (le moins coûteux) est déclaré infaisable :
    // la suggestion doit essayer une autre position, pas abandonner.
    const faisable = async (ordre) => !(ordre.length === 3 && ordre[1].id === 3);
    const r = await suggererOrdre([b, libre, a], { distance, faisable });
    expect(r).not.toBeNull();
    expect(ids(r)).not.toEqual([1, 3, 2]);
    expect(ids(r).sort()).toEqual([1, 2, 3]); // aucun point n'est perdu
  });

  test('aucun point n’est jamais abandonné', async () => {
    const points = [P(1, 3, { debutMin: 600, finMin: 630 }), P(2, 1), P(3, 7), P(4, 5)];
    const r = await suggererOrdre(points, { distance, faisable: toujoursFaisable });
    expect(ids(r).slice().sort()).toEqual([1, 2, 3, 4]);
  });

  test('si AUCUN ordre ne tient le rendez-vous, rien n’est proposé (jamais un ordre qui échoue)', async () => {
    const points = [P(1, 3, { debutMin: 600, finMin: 630 }), P(2, 1)];
    const r = await suggererOrdre(points, { distance, faisable: async () => false });
    expect(r).toBeNull();
  });

  test('un ordre identique à celui soumis n’est pas une suggestion', async () => {
    const a = P(1, 1, { debutMin: 540, finMin: 570 });
    const libre = P(2, 5);
    const r = await suggererOrdre([a, libre], { distance, faisable: toujoursFaisable });
    expect(r).toBeNull();
  });

  test('à détour égal, l’ordre soumis départage (le moins de bouleversement possible)', async () => {
    // Géométrie identique dans les deux cas : le point libre (x=3) s'insère
    // entre A (x=2) et B (x=4) ou après B pour EXACTEMENT le même détour (0).
    // Les deux ancrés sont soumis à l'envers de leurs fenêtres, l'ordre est
    // donc bien recomposé ; seule la place que le gestionnaire avait donnée au
    // point libre départage l'égalité.
    const A = () => P(1, 2, { debutMin: 540, finMin: 570 });   // 09:00
    const B = () => P(2, 4, { debutMin: 660, finMin: 690 });   // 11:00
    const libre = () => P(3, 3);

    const soumisAuMilieu = await suggererOrdre([B(), libre(), A()], { distance, faisable: toujoursFaisable });
    expect(ids(soumisAuMilieu)).toEqual([1, 3, 2]);

    // Même géométrie, point libre soumis EN DERNIER : à détour rigoureusement
    // égal, il reste en dernier au lieu d'être déplacé au milieu sans raison.
    const soumisALaFin = await suggererOrdre([B(), A(), libre()], { distance, faisable: toujoursFaisable });
    expect(ids(soumisALaFin)).toEqual([1, 2, 3]);
  });

  test('dépendances manquantes ou liste trop courte → null (jamais d’exception)', async () => {
    await expect(suggererOrdre([], {})).resolves.toBeNull();
    await expect(suggererOrdre([P(1, 1, { debutMin: 1, finMin: 2 })], { distance, faisable: toujoursFaisable }))
      .resolves.toBeNull();
    await expect(suggererOrdre(null, { distance, faisable: toujoursFaisable })).resolves.toBeNull();
  });
});
