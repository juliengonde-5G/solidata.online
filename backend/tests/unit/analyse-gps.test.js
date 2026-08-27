/**
 * Détection des arrêts GPS — moteur PUR, aucune base.
 *
 * Ce que ces tests vérifient réellement : que la détection est DÉTERMINISTE et
 * qu'elle ne fabrique jamais de temps. Les deux propriétés sont ce qui autorise
 * un recalcul idempotent après coup — sans elles, « recalculer les arrêts »
 * changerait les chiffres d'une journée déjà close.
 */

const {
  detecterArrets, classerArret, RAYON_CENTRE_M,
} = require('../../src/routes/tours/analyse-gps');

// Point de départ arbitraire (secteur du centre de tri de Rouen).
const LAT = 49.4231;
const LNG = 1.0993;

/** Décale une latitude de `m` mètres vers le nord (1° ≈ 111 320 m). */
const versNord = (lat, m) => lat + m / 111320;

const t0 = Date.UTC(2026, 7, 26, 8, 0, 0);
/** Position à `minutes` du départ, éventuellement décalée de `m` mètres. */
const pos = (minutes, m = 0) => ({
  latitude: versNord(LAT, m),
  longitude: LNG,
  recorded_at: new Date(t0 + minutes * 60000).toISOString(),
});

describe('detecterArrets — clusters', () => {
  test('un immobile de 8 min au-dessus du seuil de 5 min est retenu', () => {
    const arrets = detecterArrets(
      [pos(0), pos(2), pos(4), pos(6), pos(8)],
      { seuilMin: 5, rayonM: 40 }
    );
    expect(arrets).toHaveLength(1);
    expect(arrets[0].duree_min).toBe(8);
    expect(arrets[0].nb_positions).toBe(5);
    // Les coordonnées sont celles du PREMIER point : l'ancre du cluster.
    expect(arrets[0].latitude).toBeCloseTo(LAT, 6);
  });

  test('un immobile de 3 min sous le seuil n’est PAS retenu', () => {
    const arrets = detecterArrets([pos(0), pos(1), pos(3)], { seuilMin: 5, rayonM: 40 });
    expect(arrets).toEqual([]);
  });

  test('la durée exacte au seuil est retenue (bord inclus)', () => {
    const arrets = detecterArrets([pos(0), pos(5)], { seuilMin: 5, rayonM: 40 });
    expect(arrets).toHaveLength(1);
    expect(arrets[0].duree_min).toBe(5);
  });

  test('un déplacement hors rayon ferme le cluster et en ouvre un autre', () => {
    // 6 min sur place, puis 300 m plus loin, 7 min sur place.
    const arrets = detecterArrets(
      [pos(0), pos(6), pos(10, 300), pos(17, 300)],
      { seuilMin: 5, rayonM: 40 }
    );
    expect(arrets).toHaveLength(2);
    expect(arrets[0].duree_min).toBe(6);
    expect(arrets[1].duree_min).toBe(7);
    expect(arrets[1].latitude).toBeCloseTo(versNord(LAT, 300), 6);
  });

  test('un point DANS le rayon reste dans le cluster (35 m < 40 m)', () => {
    const arrets = detecterArrets(
      [pos(0), pos(3, 35), pos(7, 20)],
      { seuilMin: 5, rayonM: 40 }
    );
    expect(arrets).toHaveLength(1);
    expect(arrets[0].nb_positions).toBe(3);
  });

  test('la distance se mesure au PREMIER point, jamais à un centroïde glissant', () => {
    // Chaque point est à 30 m du précédent (donc DANS le rayon de son voisin)
    // mais s'éloigne sans jamais revenir : c'est un camion qui roule au pas, pas
    // un camion arrêté. Avec un centroïde qui suivrait les points, les douze
    // minutes ne feraient qu'un seul « arrêt » de douze minutes.
    const derive = [0, 1, 2, 3, 4, 5, 6].map((i) => pos(i * 2, i * 30));

    // Au seuil de 4 min : aucun cluster ne tient assez longtemps — le trajet ne
    // produit AUCUN arrêt, ce qui est la bonne réponse.
    expect(detecterArrets(derive, { seuilMin: 4, rayonM: 40 })).toEqual([]);

    // Seuil abaissé pour observer le découpage lui-même : plusieurs clusters
    // courts, et aucun ne couvre la trace entière.
    const fins = detecterArrets(derive, { seuilMin: 1, rayonM: 40 });
    expect(fins.length).toBeGreaterThan(1);
    for (const a of fins) expect(a.duree_min).toBeLessThan(12);
  });

  test('déterministe : deux passages sur les mêmes données donnent le même résultat', () => {
    const trace = [pos(0), pos(4), pos(9), pos(12, 500), pos(20, 500), pos(26, 500)];
    const a = detecterArrets(trace, { seuilMin: 5, rayonM: 40 });
    const b = detecterArrets(trace, { seuilMin: 5, rayonM: 40 });
    expect(a).toEqual(b);
  });
});

describe('detecterArrets — trous d’émission et entrées invalides', () => {
  test('un trou d’émission compte tel quel et est EXPOSÉ, jamais masqué', () => {
    // Relevé à 0, puis plus rien pendant 14 min, puis relevé à 14 et 16.
    const arrets = detecterArrets([pos(0), pos(14), pos(16)], { seuilMin: 5, rayonM: 40 });
    expect(arrets).toHaveLength(1);
    expect(arrets[0].duree_min).toBe(16);
    // Le lecteur doit pouvoir relativiser : le plus grand trou est dit.
    expect(arrets[0].trou_max_min).toBe(14);
  });

  test('l’option trouMaxMin coupe le cluster — désactivée par défaut', () => {
    const trace = [pos(0), pos(3), pos(20), pos(26)];
    const sansCoupe = detecterArrets(trace, { seuilMin: 5, rayonM: 40 });
    expect(sansCoupe).toHaveLength(1);
    expect(sansCoupe[0].duree_min).toBe(26);

    const avecCoupe = detecterArrets(trace, { seuilMin: 5, rayonM: 40, trouMaxMin: 10 });
    expect(avecCoupe).toHaveLength(1); // le premier segment (3 min) tombe sous le seuil
    expect(avecCoupe[0].duree_min).toBe(6);
  });

  test('une position sans coordonnées ou sans horodatage est ignorée, pas comptée en (0,0)', () => {
    const arrets = detecterArrets(
      [
        pos(0),
        { latitude: null, longitude: null, recorded_at: new Date(t0 + 120000).toISOString() },
        { latitude: LAT, longitude: LNG, recorded_at: 'pas-une-date' },
        pos(7),
      ],
      { seuilMin: 5, rayonM: 40 }
    );
    expect(arrets).toHaveLength(1);
    expect(arrets[0].nb_positions).toBe(2);
    expect(arrets[0].duree_min).toBe(7);
  });

  test('une trace vide, nulle ou non tableau ne produit aucun arrêt et ne jette pas', () => {
    expect(detecterArrets([], {})).toEqual([]);
    expect(detecterArrets(null, {})).toEqual([]);
    expect(detecterArrets(undefined, {})).toEqual([]);
    expect(detecterArrets('pas-un-tableau', {})).toEqual([]);
  });

  test('une position unique ne fait pas un arrêt (durée nulle sous le seuil)', () => {
    expect(detecterArrets([pos(0)], { seuilMin: 5, rayonM: 40 })).toEqual([]);
  });
});

describe('classerArret — rattachement', () => {
  const contexte = {
    cavs: [
      { id: 11, name: 'ROUEN - Rue A', latitude: versNord(LAT, 1000), longitude: LNG },
      { id: 12, name: 'ROUEN - Rue B', latitude: versNord(LAT, 1050), longitude: LNG },
    ],
    associations: [
      { id: 21, name: 'Association Untel', latitude: versNord(LAT, 2000), longitude: LNG },
    ],
    centre: { id: 1, nom: 'Centre de tri', latitude: LAT, longitude: LNG },
    rattachementM: 80,
  };

  test('rattaché au CAV du programme quand il est dans le rayon', () => {
    const c = classerArret({ latitude: versNord(LAT, 1020), longitude: LNG }, contexte);
    expect(c.type).toBe('cav');
    expect(c.cav_id).toBe(11);
    expect(c.distance_m).toBeLessThanOrEqual(80);
  });

  test('le CAV le PLUS PROCHE l’emporte entre deux voisins', () => {
    const c = classerArret({ latitude: versNord(LAT, 1045), longitude: LNG }, contexte);
    expect(c.type).toBe('cav');
    expect(c.cav_id).toBe(12);
  });

  test('rattaché à un point association quand aucun CAV n’est proche', () => {
    const c = classerArret({ latitude: versNord(LAT, 2030), longitude: LNG }, contexte);
    expect(c.type).toBe('association');
    expect(c.association_point_id).toBe(21);
    expect(c.cav_id).toBeNull();
  });

  test('rattaché au centre de tri dans son rayon propre (200 m), plus large qu’une borne', () => {
    const c = classerArret({ latitude: versNord(LAT, 150), longitude: LNG }, contexte);
    expect(c.type).toBe('centre');
    expect(RAYON_CENTRE_M).toBe(200);
  });

  test('un arrêt loin de tout reste « inconnu » — et c’est une information', () => {
    const c = classerArret({ latitude: versNord(LAT, 5000), longitude: LNG }, contexte);
    expect(c).toEqual({
      type: 'inconnu', cav_id: null, association_point_id: null,
      distance_m: null, cible_nom: null,
    });
  });

  test('un arrêt sans coordonnées est « inconnu », jamais rattaché au hasard', () => {
    expect(classerArret({ latitude: null, longitude: null }, contexte).type).toBe('inconnu');
    expect(classerArret({}, contexte).type).toBe('inconnu');
  });

  test('un contexte vide ne jette pas et classe « inconnu »', () => {
    expect(classerArret({ latitude: LAT, longitude: LNG }, {}).type).toBe('inconnu');
    expect(classerArret({ latitude: LAT, longitude: LNG }).type).toBe('inconnu');
  });

  test('une cible sans coordonnées est ignorée au lieu de fausser la distance', () => {
    const c = classerArret({ latitude: LAT, longitude: LNG }, {
      cavs: [{ id: 99, name: 'Sans GPS', latitude: null, longitude: null }],
      associations: [], centre: null, rattachementM: 80,
    });
    expect(c.type).toBe('inconnu');
  });

  test('le rayon de rattachement est bien celui du contexte (5 m ne rattache plus rien)', () => {
    const c = classerArret({ latitude: versNord(LAT, 1020), longitude: LNG },
      { ...contexte, rattachementM: 5 });
    expect(c.type).toBe('inconnu');
  });
});

describe('resumeAnomaliesChecklist — ce qui mérite de déranger un gestionnaire', () => {
  // Requis ici : tours/index.js monte un routeur, il n'a pas à être chargé par
  // les tests de détection ci-dessus.
  const { resumeAnomaliesChecklist } = require('../../src/routes/tours');

  test('tout conforme → aucune alerte', () => {
    expect(resumeAnomaliesChecklist({
      reponses: [{ id: 'a', libelle: 'Feux', ok: true }, { id: 'b', libelle: 'Pneus', ok: true }],
      degats: [], notes: null,
    })).toBeNull();
  });

  test('checklist sans détail transmis → aucune alerte (absence ≠ anomalie)', () => {
    expect(resumeAnomaliesChecklist({ reponses: [], degats: [], notes: null })).toBeNull();
    expect(resumeAnomaliesChecklist({})).toBeNull();
  });

  test('un point non validé déclenche l’alerte et nomme le point', () => {
    const a = resumeAnomaliesChecklist({
      reponses: [{ id: 'a', libelle: 'Feux', ok: true }, { id: 'b', libelle: 'Pneus', ok: false }],
      degats: [], notes: '  pneu avant droit lisse  ',
    });
    expect(a.nb_points_non_valides).toBe(1);
    expect(a.nb_degats).toBe(0);
    expect(a.resume).toContain('Pneus');
    expect(a.remarque).toBe('pneu avant droit lisse');
  });

  test('un dégât seul suffit à alerter, même si tous les points sont validés', () => {
    const a = resumeAnomaliesChecklist({
      reponses: [{ id: 'a', libelle: 'Feux', ok: true }],
      degats: [{ vue: 'avant', x: 0.2, y: 0.3, type: 'choc' }],
      notes: null,
    });
    expect(a.nb_degats).toBe(1);
    expect(a.nb_points_non_valides).toBe(0);
    expect(a.remarque).toBeNull();
  });

  test('au-delà de 4 points non validés, la liste est tronquée avec un « … » explicite', () => {
    const reponses = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, libelle: `Point ${id}`, ok: false }));
    const a = resumeAnomaliesChecklist({ reponses, degats: [], notes: null });
    expect(a.nb_points_non_valides).toBe(6);
    expect(a.resume).toContain('…');
  });
});

describe('normaliserNiveauCarburant — ce que la base accepte réellement', () => {
  // Même raison qu'au-dessus : tours/index.js monte un routeur.
  const { normaliserNiveauCarburant } = require('../../src/routes/tours');

  // La colonne `vehicle_checklists.fuel_level` n'accepte QUE ces quatre valeurs
  // (CHECK `vehicle_checklists_fuel_level_check`).
  const ACCEPTES = ['1/4', '1/2', '3/4', 'full'];

  test('« plein » (valeur envoyée par le mobile) devient « full »', () => {
    // Défaut réel : le sélecteur mobile envoie « plein », la base attend
    // « full ». Un chauffeur partant réservoir PLEIN recevait un 500 et sa
    // checklist n'était jamais enregistrée.
    expect(normaliserNiveauCarburant('plein')).toBe('full');
    expect(normaliserNiveauCarburant('Plein')).toBe('full');
    expect(normaliserNiveauCarburant(' PLEIN ')).toBe('full');
  });

  test('les quarts sont conservés tels quels', () => {
    expect(normaliserNiveauCarburant('1/4')).toBe('1/4');
    expect(normaliserNiveauCarburant('1/2')).toBe('1/2');
    expect(normaliserNiveauCarburant('3/4')).toBe('3/4');
    expect(normaliserNiveauCarburant('full')).toBe('full');
  });

  test('valeur absente ou inconnue → repli « 1/2 », jamais un échec du départ', () => {
    expect(normaliserNiveauCarburant(null)).toBe('1/2');
    expect(normaliserNiveauCarburant(undefined)).toBe('1/2');
    expect(normaliserNiveauCarburant('')).toBe('1/2');
    expect(normaliserNiveauCarburant('   ')).toBe('1/2');
    expect(normaliserNiveauCarburant('réservoir à moitié')).toBe('1/2');
  });

  test('AUCUNE entrée ne peut produire une valeur refusée par la base', () => {
    const entrees = ['plein', 'full', '4/4', '1', '1/4', '1/2', '3/4', '', null,
      undefined, 0, 42, 'xyz', '  Plein  ', {}, []];
    for (const e of entrees) {
      expect(ACCEPTES).toContain(normaliserNiveauCarburant(e));
    }
  });
});
