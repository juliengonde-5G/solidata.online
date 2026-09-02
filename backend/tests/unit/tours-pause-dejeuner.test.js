// ═══════════════════════════════════════════════════════════════════════════
// PAUSE DÉJEUNER — elle suit la journée réelle, pas la journée imaginée
//
// Constat client (02/09/2026, tournée #681) : à midi, le camion en était à sa
// 3e borne et la « Pause déjeuner au centre » était affichée en 15e étape,
// derrière neuf bornes encore à faire. Les heures prévues annonçaient 10:16
// pour l'étape suivante.
//
// Deux défauts distincts, tous deux vérifiés ici :
//   1. la position de la pause et les heures prévues étaient calculées UNE
//      SEULE FOIS, au démarrage, et jamais rejouées ;
//   2. l'heure d'horloge du moteur venait de `getHours()`, donc du fuseau du
//      CONTENEUR (UTC) : la pause « de midi » se déclenchait à 14 h heure de
//      Paris en été, 13 h en hiver.
// ═══════════════════════════════════════════════════════════════════════════
jest.mock('../../src/config/database', () => ({ query: jest.fn(), connect: jest.fn() }));

const engine = require('../../src/services/tour-time-engine');
const { positionCiblePause } = require('../../src/routes/tours/arrets');
const { heureMuraleParis } = require('../../src/routes/tours/planned-passage');

// ── 1. L'HEURE D'HORLOGE EST CELLE DE ROUEN, PAS CELLE DU SERVEUR ──────────
describe('heureMuraleParis — l’horloge du moteur est celle de l’équipage', () => {
  it('en ÉTÉ, midi à Rouen se lit 12 h (et non 10 h, l’heure du conteneur)', () => {
    // 2 septembre 2026, 10:00 UTC = 12:00 à Paris (UTC+2).
    expect(heureMuraleParis(new Date('2026-09-02T10:00:00Z'))).toBeCloseTo(12, 5);
  });

  it('en HIVER, le décalage n’est plus le même — et la règle suit', () => {
    // 15 janvier, 11:00 UTC = 12:00 à Paris (UTC+1). Une constante « +2 »
    // codée en dur aurait donné 13 h ici : c'est tout l'intérêt d'Intl.
    expect(heureMuraleParis(new Date('2026-01-15T11:00:00Z'))).toBeCloseTo(12, 5);
  });

  it('rend les minutes, pas seulement l’heure ronde', () => {
    expect(heureMuraleParis(new Date('2026-09-02T07:27:00Z'))).toBeCloseTo(9.45, 5); // 09:27
  });

  it('minuit à Paris vaut 0 et non 24', () => {
    expect(heureMuraleParis(new Date('2026-09-01T22:00:00Z'))).toBe(0);
  });

  it('une entrée illisible retombe sur le défaut du moteur, jamais sur NaN', () => {
    expect(heureMuraleParis(new Date('pas une date'))).toBe(8);
  });
});

// ── 2. LE MOTEUR SAIT REPRENDRE UNE JOURNÉE DÉJÀ COMMENCÉE ────────────────
describe('moteur de temps — reprise en cours de journée', () => {
  const centre = { lat: 49.4231, lng: 1.0993, name: 'Centre' };
  const pts = (n) => Array.from({ length: n }, (_, i) => ({
    id: i + 1, lat: 49.34 + i * 0.004, lng: 1.09 + i * 0.004, serviceMinutes: 10,
  }));
  // Sans `routeLeg`, le moteur ne compte AUCUNE distance : les scénarios
  // deviendraient indiscernables. On lui donne un calcul à vol d'oiseau.
  const routeLeg = async (a, b) => {
    const R = 6371, r = (d) => (d * Math.PI) / 180;
    const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
    const km = 2 * R * Math.asin(Math.sqrt(h)) * 1.3;
    return { km, minutes: (km / 28) * 60 };
  };
  const indexPause = (est) => est.timeline.findIndex((t) => t.type === 'pause_dejeuner');
  const pointsAvantPause = (est) => {
    const i = indexPause(est);
    return i < 0 ? null : est.timeline.slice(0, i).filter((t) => t.type === 'point').length;
  };

  it('sans amorçage, le comportement de planification est INCHANGÉ', async () => {
    const est = await engine.buildTimeline(pts(6), { center: centre, startHour: 8, capacityKg: 3500, routeLeg });
    expect(est.duree_travail_deja_faite_min).toBe(0);
    expect(est.duree_travail_min).toBe(est.duree_travail_restant_min);
  });

  it('quatre heures de travail derrière soi : la pause est due IMMÉDIATEMENT', async () => {
    // Le déclencheur « après N heures de travail » doit voir la journée
    // entière. Sans `priorWorkMinutes`, la simulation repartait de zéro et
    // repoussait la pause de quatre heures de plus.
    const est = await engine.buildTimeline(pts(6), {
      center: centre, startHour: 11, capacityKg: 3500, routeLeg, priorWorkMinutes: 250,
    });
    expect(pointsAvantPause(est)).toBe(0);
  });

  it('une pause DÉJÀ PRISE n’est jamais reprogrammée', async () => {
    const est = await engine.buildTimeline(pts(8), {
      center: centre, startHour: 11.5, capacityKg: 3500, routeLeg, lunchAlreadyTaken: true,
    });
    expect(indexPause(est)).toBe(-1);
    expect(est.pause_dejeuner_incluse).toBe(true);   // elle a eu lieu
  });

  it('la simulation part de la position RÉELLE de l’équipage', async () => {
    const loin = { lat: 49.90, lng: 1.60, name: 'Position actuelle' };
    const [duCentre, deLoin] = await Promise.all([
      engine.buildTimeline(pts(3), { center: centre, startHour: 9, capacityKg: 3500, routeLeg }),
      engine.buildTimeline(pts(3), { center: centre, startHour: 9, capacityKg: 3500, routeLeg, startPosition: loin }),
    ]);
    // Repartir de 60 km plus loin ne peut pas donner la même journée.
    expect(deLoin.distance_km).toBeGreaterThan(duCentre.distance_km);
    expect(deLoin.timeline[0].name).toBe('Position actuelle');
  });

  it('une position de départ incomplète retombe sur le centre, jamais sur un point inventé', async () => {
    const est = await engine.buildTimeline(pts(3), {
      center: centre, startHour: 9, capacityKg: 3500, routeLeg, startPosition: { lat: 49.9, lng: null },
    });
    expect(est.timeline[0].name).toBe('Centre');
  });

  it('le budget de la journée compte le travail déjà fait', async () => {
    const est = await engine.buildTimeline(pts(4), {
      center: centre, startHour: 13, capacityKg: 3500, routeLeg,
      priorWorkMinutes: 300, maxWorkMinutes: 360,
    });
    // 5 h derrière + ce qui reste : la journée déborde, et le moteur le dit.
    expect(est.duree_travail_min).toBeGreaterThan(300);
    expect(est.duree_travail_deja_faite_min).toBe(300);
    expect(est.faisable).toBe(false);
  });
});

// ── 3. LA PLACE DE LA PAUSE DANS LE PROGRAMME ─────────────────────────────
describe('positionCiblePause — la règle de placement', () => {
  // Programme type : 1 départ (fait), 2-3 collectés, 4 vidage (fait),
  // le chauffeur est donc devant la position 5 ; restent 12 bornes en 5..16.
  const front = 5;
  const restants = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

  it('pause due maintenant → elle devient l’étape SUIVANTE', () => {
    expect(positionCiblePause(front, restants, 0)).toBe(5);
  });

  it('pause due après 3 bornes → juste après la 3e', () => {
    expect(positionCiblePause(front, restants, 3)).toBe(8);
  });

  it('pause due après toutes les bornes → en queue', () => {
    expect(positionCiblePause(front, restants, 99)).toBe(17);
  });

  it('elle ne recule JAMAIS derrière le chauffeur', () => {
    // Cas RÉEL : un point est resté « à faire » DERRIÈRE le chauffeur (borne
    // laissée de côté, ordre remanié par une ré-optimisation). La règle de
    // placement le désignerait alors comme repère et poserait la pause en
    // position 4, dans le passé de l'équipage — invisible du mobile, qui
    // affiche toujours la première étape devant lui (défaut corrigé en 2.37.1).
    expect(positionCiblePause(8, [3, 4, 5, 9, 10], 1)).toBe(8);
    expect(positionCiblePause(8, [3, 4, 5, 9, 10], 3)).toBe(8);
    // Dès que le repère repasse devant lui, la règle reprend normalement.
    expect(positionCiblePause(8, [3, 4, 5, 9, 10], 4)).toBe(10);
    // Et « tout de suite » reste « tout de suite », devant lui.
    expect(positionCiblePause(11, [11, 12, 13], 0)).toBe(11);
  });

  it('aucun point restant : elle se pose devant le chauffeur', () => {
    expect(positionCiblePause(7, [], 0)).toBe(7);
    expect(positionCiblePause(7, [], 4)).toBe(7);
  });

  it('une valeur illisible ne fabrique pas une position absurde', () => {
    expect(positionCiblePause(5, restants, NaN)).toBe(5);
    expect(positionCiblePause(5, restants, undefined)).toBe(5);
  });
});
