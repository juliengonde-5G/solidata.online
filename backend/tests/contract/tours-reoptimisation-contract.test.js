// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — Ré-optimisation d'une tournée en cours (CO2 & efficacité)
// ───────────────────────────────────────────────────────────────────────────
// Exigences client (août 2026) vérifiées ici :
//   • le recalcul s'applique à TOUS les modes — moteur IA, modèle de tournée,
//     saisie manuelle — sans distinction ;
//   • les points AJOUTÉS en cours de route entrent dans le calcul ;
//   • les chiffres publiés viennent d'une MESURE (trafic compris) et la
//     réponse dit d'où ils viennent ;
//   • le CO2 vaut null — jamais 0 — quand la consommation n'est pas saisie ;
//   • une tournée de formation ne produit rien.
// ═══════════════════════════════════════════════════════════════════════════
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(),
}));
// OSRM est simulé au même titre que TomTom. Sans cela, `cachedRouteSegment`
// sortait RÉELLEMENT sur le réseau : ce fichier passait sur un poste privé
// d'accès à un serveur OSRM (repli haversine → source « estimation ») et
// échouait en intégration continue, où l'appel aboutit et renvoie
// « osrm_facteur_jour ». Un test dont le verdict dépend de la joignabilité d'un
// serveur public n'est pas un test : c'est un tirage au sort.
const mockSegment = jest.fn();
jest.mock('../../src/services/route-cache', () => ({
  cachedRouteSegment: (...a) => mockSegment(...a),
  // Renvoie une Map VIDE (« rien en cache »), pas `undefined` : l'appelant en
  // fait une matrice de tronçons et l'aurait déréférencée.
  prefetchLegs: async () => new Map(),
  legKey: (a, b, c, d) => [a, b, c, d].join(','),
}));

const mockTomtom = jest.fn();
jest.mock('../../src/services/routing-tomtom', () => ({
  tomtomRouteSequence: (...a) => mockTomtom(...a),
  tomtomDisponible: async () => true,
}));
jest.mock('../../src/services/push-notifications', () => ({
  sendPushToRoles: jest.fn().mockResolvedValue({ skipped: true }),
  sendPushToUser: jest.fn().mockResolvedValue({ skipped: true }),
  isConfigured: () => false,
  getPublicKey: () => null,
}));
jest.mock('../../src/routes/tours/planned-passage', () => ({
  computeAndStorePlannedPassages: jest.fn().mockResolvedValue({}),
}));

const { proposeReoptimization } = require('../../src/routes/tours/reoptimize-service');
const { haversineDistance, ROAD_FACTOR, resolveAvgSpeedKmh } = require('../../src/routes/tours/geo');

const CENTRE = { lat: 49.4231, lng: 1.0993 };

// Quatre bornes en boucle autour du centre. Une boucle (et non un alignement)
// est indispensable : sur des points alignés, faire l'aller-retour dans un
// sens ou dans l'autre coûte exactement pareil, et le test ne prouverait rien.
const POINTS = [
  { id: 401, cav_id: 41, cav_name: 'Borne A (est)',        latitude: '49.4231', longitude: '1.1300' },
  { id: 402, cav_id: 42, cav_name: 'Borne B (nord-est)',   latitude: '49.4500', longitude: '1.1300' },
  { id: 403, cav_id: 43, cav_name: 'Borne C (nord)',       latitude: '49.4500', longitude: '1.0993' },
  { id: 404, cav_id: 44, cav_name: 'Borne D (nord-ouest)', latitude: '49.4400', longitude: '1.0700' },
];
/** Ordre en place : volontairement croisé. */
const ORDRE_INITIAL = [401, 403, 402, 404];

/** Longueur d'un parcours centre → points → centre (même métrique que le code). */
function longueur(ordre, extra = []) {
  const tous = [...POINTS, ...extra];
  const pts = [CENTRE, ...ordre.map((id) => {
    const p = tous.find((x) => x.id === id);
    return { lat: parseFloat(p.latitude), lng: parseFloat(p.longitude) };
  }), CENTRE];
  let km = 0;
  for (let i = 1; i < pts.length; i++) {
    km += haversineDistance(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng) * 1.3;
  }
  return km;
}

/** Meilleur parcours possible, par force brute (référence du test). */
function optimumParForceBrute(ids, extra = []) {
  const permutations = (arr) => (arr.length <= 1 ? [arr]
    : arr.flatMap((v, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [v, ...p])));
  return Math.min(...permutations(ids).map((o) => longueur(o, extra)));
}

const PLEINS = [
  { litres: 85, km_compteur: 10000, type_carburant: 'gazole' },
  { litres: 90, km_compteur: 10300, type_carburant: 'gazole' },
];

function pointsDansOrdre(ordre) {
  return ordre.map((id, i) => ({ ...POINTS.find((p) => p.id === id), position: i + 1 }));
}

/**
 * Aiguillage SQL. `etat` permet de faire varier un cas sans réécrire le reste.
 */
function installMocks(etat = {}) {
  const {
    tour = { id: 42, collection_type: 'cav', status: 'in_progress', date: '2026-08-24',
      vehicle_id: 7, is_demo: false, tare_weight_kg: 3500, max_capacity_kg: 2000 },
    ordre = ORDRE_INITIAL,
    pleins = PLEINS,
    facteurs = [{ facteur_kgco2e: '2.51000' }],
    pendingReopt = [],
  } = etat;

  mockQuery.mockImplementation((sql) => {
    if (/FROM tours t/.test(sql) && /LEFT JOIN vehicles/.test(sql)) return Promise.resolve({ rows: tour ? [tour] : [] });
    if (/FROM tour_cav tc JOIN cav c/.test(sql)) return Promise.resolve({ rows: pointsDansOrdre(ordre) });
    if (/FROM tour_association_point/.test(sql)) return Promise.resolve({ rows: [] });
    if (/FROM tour_reoptimizations WHERE tour_id/.test(sql)) return Promise.resolve({ rows: pendingReopt });
    if (/FROM gps_positions/.test(sql)) return Promise.resolve({ rows: [] });
    if (/FROM collection_context/.test(sql)) {
      return Promise.resolve({ rows: [{ weather_factor: 1, traffic_factor: 1.2, duration_factor: 1 }] });
    }
    if (/FROM route_legs_cache/.test(sql)) return Promise.resolve({ rows: [] });
    if (/FROM carburant_pleins/.test(sql)) return Promise.resolve({ rows: pleins });
    if (/FROM ges_facteurs/.test(sql)) return Promise.resolve({ rows: facteurs });
    if (/INSERT INTO tour_reoptimizations/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 900, triggered_at: '2026-08-24T10:00:00Z' }] });
    }
    return Promise.resolve({ rows: [] });
  });

  // TomTom factice : mesure cohérente avec l'ordre réellement demandé (somme
  // des tronçons), sinon le test ne prouverait pas que le nouvel ordre est
  // meilleur — il ne ferait que refléter des valeurs codées en dur.
  mockTomtom.mockImplementation(async (waypoints) => {
    let km = 0;
    for (let i = 1; i < waypoints.length; i++) {
      km += haversineDistance(waypoints[i - 1].lat, waypoints[i - 1].lng, waypoints[i].lat, waypoints[i].lng) * 1.3;
    }
    return {
      distance_km: km,
      duration_min: (km / 28) * 60 * 1.2,
      duration_sans_trafic_min: (km / 28) * 60,
      retard_trafic_min: (km / 28) * 60 * 0.2,
      legs: [],
      source: 'tomtom',
    };
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockTomtom.mockReset();
  // Le défaut est posé ICI et non dans installMocks : le service lance un
  // préchauffage de tronçons « fire-and-forget » qui peut s'exécuter APRÈS la
  // fin du test, quand le mock vient d'être réinitialisé — un mock nu renvoie
  // `undefined`, et le `.catch()` de l'appelant explose.
  //
  // Par défaut : AUCUN routeur joignable — le repli exact de geo.js
  // (haversine × ROAD_FACTOR). C'est `source: 'haversine'` qui fait dire à
  // `mesurerSequence` qu'il n'a pas mesuré ; un test qui veut la voie mesurée
  // le déclare explicitement (voir « routeur disponible »).
  mockSegment.mockReset();
  mockSegment.mockImplementation(async (lat1, lng1, lat2, lng2) => {
    const km = haversineDistance(lat1, lng1, lat2, lng2) * ROAD_FACTOR;
    return { distance_km: km, duration_min: (km / resolveAvgSpeedKmh()) * 60, source: 'haversine' };
  });
});

describe('proposeReoptimization — décision', () => {
  test('un ordre manifestement mauvais produit une proposition chiffrée', async () => {
    installMocks();
    const r = await proposeReoptimization({ tourId: 42, triggerReason: 'arret' });
    expect(r.created).toBe(true);
    // On ne fige pas UN ordre : plusieurs peuvent être optimaux (une boucle se
    // parcourt dans les deux sens). On vérifie que l'ordre retenu atteint bien
    // le minimum absolu, calculé ici par force brute.
    expect([...r.proposal.new_sequence].sort()).toEqual([401, 402, 403, 404]);
    expect(longueur(r.proposal.new_sequence)).toBeCloseTo(optimumParForceBrute([401, 402, 403, 404]), 6);
    expect(longueur(r.proposal.new_sequence)).toBeLessThan(longueur(ORDRE_INITIAL));
    expect(r.proposal.new_distance_km).toBeLessThan(r.proposal.old_distance_km);
    expect(r.proposal.gain_distance_km).toBeGreaterThan(0);
    expect(r.proposal.gain_duree_min).toBeGreaterThan(0);
  });

  test('les chiffres publiés viennent d’une MESURE, et la réponse le dit', async () => {
    installMocks();
    const r = await proposeReoptimization({ tourId: 42, triggerReason: 'recurrent' });
    expect(r.proposal.source_calcul).toBe('tomtom_trafic');
    expect(r.proposal.retard_trafic_min).toBeGreaterThan(0);
    // Les deux séquences sont mesurées dans les MÊMES conditions : sinon le
    // gain annoncé ne serait qu'un artefact de circulation.
    expect(mockTomtom).toHaveBeenCalledTimes(2);
  });

  test('le camion est déclaré poids lourd au routeur', async () => {
    installMocks();
    await proposeReoptimization({ tourId: 42 });
    const opts = mockTomtom.mock.calls[0][1];
    expect(opts.vehicule).toMatchObject({ tare_weight_kg: 3500, max_capacity_kg: 2000 });
  });

  test('un ordre déjà optimal ne dérange personne', async () => {
    installMocks({ ordre: [401, 402, 403, 404] });
    const r = await proposeReoptimization({ tourId: 42 });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('ordre_deja_optimal');
    expect(mockTomtom).not.toHaveBeenCalled(); // aucun appel payant gaspillé
  });

  test('une proposition déjà en attente n’est pas doublée', async () => {
    installMocks({ pendingReopt: [{ id: 888 }] });
    const r = await proposeReoptimization({ tourId: 42 });
    expect(r.skipped).toBe(true);
    expect(r.existing_id).toBe(888);
  });

  test('tournée de formation : aucune proposition, aucune notification', async () => {
    installMocks({ tour: { id: 42, collection_type: 'cav', status: 'in_progress',
      date: '2026-08-24', vehicle_id: 7, is_demo: true } });
    const r = await proposeReoptimization({ tourId: 42 });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('tournee_demo');
  });

  test('tournée pas encore démarrée : refus explicite', async () => {
    installMocks({ tour: { id: 42, collection_type: 'cav', status: 'planned',
      date: '2026-08-24', vehicle_id: 7, is_demo: false } });
    const r = await proposeReoptimization({ tourId: 42 });
    expect(r.error).toMatch(/non en cours/);
  });
});

describe('proposeReoptimization — tous les modes, tous les points', () => {
  test('aucun filtre sur le mode de création : IA, modèle et manuel passent pareil', async () => {
    // Le mode n'est même pas lu : la requête de chargement ne le sélectionne
    // pas. Ce test verrouille cette absence de filtre.
    installMocks();
    await proposeReoptimization({ tourId: 42 });
    const chargement = mockQuery.mock.calls.find((c) => /FROM tours t/.test(c[0]) && /LEFT JOIN vehicles/.test(c[0]));
    expect(chargement[0]).not.toMatch(/\bmode\b/);
  });

  test('un point AJOUTÉ en cours de tournée entre dans le calcul', async () => {
    // Ajouté par le gestionnaire en dernière position : le recalcul doit
    // pouvoir le remonter dans l'ordre s'il est sur le chemin.
    const ajoute = { id: 405, cav_id: 45, cav_name: 'Ajout en direct',
      latitude: '49.4360', longitude: '1.1300' }; // sur le segment A → B
    mockQuery.mockImplementation((sql) => {
      if (/FROM tours t/.test(sql) && /LEFT JOIN vehicles/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 42, collection_type: 'cav', status: 'in_progress',
          date: '2026-08-24', vehicle_id: 7, is_demo: false, tare_weight_kg: 3500, max_capacity_kg: 2000 }] });
      }
      if (/FROM tour_cav tc JOIN cav c/.test(sql)) {
        return Promise.resolve({ rows: [
          ...pointsDansOrdre(ORDRE_INITIAL),
          { ...ajoute, position: 5 },
        ] });
      }
      if (/INSERT INTO tour_reoptimizations/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 901, triggered_at: '2026-08-24T10:00:00Z' }] });
      }
      if (/FROM carburant_pleins/.test(sql)) return Promise.resolve({ rows: PLEINS });
      if (/FROM ges_facteurs/.test(sql)) return Promise.resolve({ rows: [{ facteur_kgco2e: '2.51' }] });
      return Promise.resolve({ rows: [] });
    });
    mockTomtom.mockImplementation(async (waypoints) => {
      let km = 0;
      for (let i = 1; i < waypoints.length; i++) {
        km += haversineDistance(waypoints[i - 1].lat, waypoints[i - 1].lng, waypoints[i].lat, waypoints[i].lng) * 1.3;
      }
      return { distance_km: km, duration_min: (km / 28) * 60, retard_trafic_min: 0, legs: [], source: 'tomtom' };
    });

    const r = await proposeReoptimization({ tourId: 42 });
    expect(r.created).toBe(true);
    expect(r.proposal.new_sequence).toContain(405);
    // La borne ajoutée est intercalée à sa vraie place géographique (sur le
    // segment A → B), et non laissée en fin de parcours.
    const rang = r.proposal.new_sequence.indexOf(405);
    const voisins = [r.proposal.new_sequence[rang - 1], r.proposal.new_sequence[rang + 1]];
    expect(voisins).toContain(401);
    expect(voisins).toContain(402);
    expect(longueur(r.proposal.new_sequence, [ajoute]))
      .toBeCloseTo(optimumParForceBrute([401, 402, 403, 404, 405], [ajoute]), 6);
  });
});

describe('proposeReoptimization — CO2', () => {
  test('consommation saisie : le CO2 évité est chiffré', async () => {
    installMocks();
    const r = await proposeReoptimization({ tourId: 42 });
    expect(r.proposal.co2_evite_kg).toBeGreaterThan(0);
    expect(r.proposal.co2_motif).toBeNull();
  });

  test('aucun plein saisi : CO2 null AVEC son motif, gains km/min conservés', async () => {
    installMocks({ pleins: [] });
    const r = await proposeReoptimization({ tourId: 42 });
    expect(r.proposal.co2_evite_kg).toBeNull();
    expect(r.proposal.co2_motif).toBe('moins_de_deux_pleins_saisis');
    expect(r.proposal.gain_distance_km).toBeGreaterThan(0);
  });

  test('facteur d’émission absent : CO2 null, jamais 0', async () => {
    installMocks({ facteurs: [] });
    const r = await proposeReoptimization({ tourId: 42 });
    expect(r.proposal.co2_evite_kg).toBeNull();
    expect(r.proposal.co2_motif).toBe('facteur_emission_absent');
  });
});

describe('proposeReoptimization — repli honnête', () => {
  test('routeur disponible : la proposition annonce une mesure, pas une estimation', async () => {
    installMocks();
    mockTomtom.mockResolvedValue(null);              // TomTom indisponible…
    mockSegment.mockImplementation(async (a, b, c, d) => {   // …mais OSRM répond
      const km = haversineDistance(a, b, c, d) * ROAD_FACTOR;
      return { distance_km: km, duration_min: (km / resolveAvgSpeedKmh()) * 60, source: 'osrm' };
    });
    const r = await proposeReoptimization({ tourId: 42 });
    if (r.created) expect(r.proposal.source_calcul).toBe('osrm_facteur_jour');
    else expect(['gain_marginal', 'ordre_deja_optimal']).toContain(r.reason);
  });

  test('routeur muet : la proposition porte « estimation », pas une fausse mesure', async () => {
    installMocks();
    mockTomtom.mockResolvedValue(null); // TomTom indisponible
    const r = await proposeReoptimization({ tourId: 42 });
    // Sans TomTom ni cache, mesurerSequence retombe sur le repli Haversine et
    // le signale : la proposition existe mais annonce son incertitude.
    if (r.created) {
      expect(r.proposal.source_calcul).toBe('estimation');
    } else {
      expect(['gain_marginal', 'ordre_deja_optimal']).toContain(r.reason);
    }
  });
});
