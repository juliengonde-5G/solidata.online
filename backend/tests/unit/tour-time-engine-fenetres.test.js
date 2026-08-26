// ═══════════════════════════════════════════════════════════════════════════
// TESTS UNITAIRES — Moteur de temps : FENÊTRES D'ACCESSIBILITÉ ET RENDEZ-VOUS
// (services/tour-time-engine.js — extension « tournées associations », août 2026.
//  Fonctions PURES : la fonction `routeLeg` est injectée par le test, aucune
//  base, aucune horloge réelle.)
//
// Règles verrouillées (CDC RG-A / RG-B, contrat technique §3) :
//  - `windows` = plages d'accessibilité du jour, en minutes d'HORLOGE ;
//    `null` = horaires inconnus (aucun contrôle), `[]` = fermé toute la journée ;
//  - le service ENTIER doit tenir dans une plage, sinon violation
//    `hors_horaires` — mais un horaire d'ouverture ne fait JAMAIS attendre ;
//  - `anchor` = fenêtre effective d'un rendez-vous : une arrivée en avance crée
//    une entrée `attente` explicite, une arrivée trop tardive une violation
//    `rdv_manque` ;
//  - l'attente est imputée au travail ou hors travail selon
//    `attenteCompteTravail` (défaut true) mais compte TOUJOURS dans l'élapsé ;
//  - ORDRE IMPOSÉ à l'arrivée : ancrage (qui avance l'horloge), puis
//    accessibilité, puis service ;
//  - le moteur SIGNALE (`violations` toujours un tableau), il n'élimine jamais
//    un point : `planWithBudget` reste piloté par le seul budget ;
//  - DEUX RÉFÉRENTIELS : `arrivee_min` / `fin_service_min` sont en minutes
//    ÉCOULÉES depuis le départ, `plages` / `fenetre` / `prochain_creneau_min`
//    en minutes d'HORLOGE depuis minuit.
// ═══════════════════════════════════════════════════════════════════════════
const engine = require('../../src/services/tour-time-engine');

const CENTER = { lat: 49.4231, lng: 1.0993 };

/** routeLeg déterministe : chaque tronçon coûte le même temps, quels que soient les points. */
function fixedLeg(minutes = 10, km = 5) {
  return async () => ({ km, minutes });
}

const baseOpts = (over = {}) => ({
  routeLeg: fixedLeg(10, 5),
  center: CENTER,
  maxWorkMinutes: 360,
  lunchBreakMinutes: 30,
  lunchAfterMinutes: 240,
  lunchStartHour: 12,
  startHour: 8,
  unloadMinutes: 15,
  returnThresholdKg: 2000,
  capacityKg: 3500,
  ...over,
});

/** Un point association ordinaire (10 min de collecte, aucun poids estimé). */
function asso(over = {}) {
  return {
    id: 1,
    type: 'association',
    name: 'Asso Centre',
    lat: CENTER.lat + 0.01,
    lng: CENTER.lng,
    serviceMinutes: 10,
    weightKg: 0,
    ...over,
  };
}

const types = (est) => est.timeline.map((t) => t.type);

// ───────────────────────────────────────────────────────────────────────────
describe('rétro-compatibilité — un point sans contrainte se comporte comme avant', () => {
  it('aucun champ nouveau : violations vide, attente nulle, chronologie inchangée', async () => {
    const est = await engine.buildTimeline([asso(), asso({ id: 2, name: 'Asso Nord' })], baseOpts());
    expect(est.violations).toEqual([]);
    expect(est.duree_attente_min).toBe(0);
    expect(types(est)).toEqual(['depart', 'point', 'point', 'retour_final']);
    // 3 trajets × 10 + 2 services × 10 = 50 min, exactement comme avant l'extension
    expect(est.duree_travail_min).toBe(50);
    expect(est.duree_totale_min).toBe(50);
  });

  it('`violations` est TOUJOURS un tableau, même pour une tournée vide', async () => {
    const est = await engine.buildTimeline([], baseOpts());
    expect(Array.isArray(est.violations)).toBe(true);
    expect(est.violations).toHaveLength(0);
    expect(est.duree_attente_min).toBe(0);
  });

  it('windows explicitement null = horaires inconnus : aucun contrôle', async () => {
    // Arrivée à 08:10, très en dehors de toute plage plausible : rien ne doit
    // être signalé tant que l'information n'existe pas (RG-A2).
    const est = await engine.buildTimeline([asso({ windows: null })], baseOpts());
    expect(est.violations).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('ancrage — attente explicite devant un rendez-vous', () => {
  it('arrivée en avance : attente générée, rendez-vous tenu, aucune violation', async () => {
    // Départ 08:00, trajet 10 min → arrivée 08:10 (clock 490) ; rendez-vous
    // 09:00-09:30 → 50 min d'attente, puis service.
    const est = await engine.buildTimeline(
      [asso({ anchor: { debutMin: 540, finMin: 570 } })],
      baseOpts()
    );
    expect(est.violations).toEqual([]);
    expect(est.duree_attente_min).toBe(50);
    expect(types(est)).toEqual(['depart', 'attente', 'point', 'retour_final']);

    const attente = est.timeline.find((t) => t.type === 'attente');
    expect(attente).toEqual({
      type: 'attente', name: 'Asso Centre', arrivee_min: 10, depart_min: 60,
    });
    // Le service démarre à la FIN de l'attente : le point ne prétend pas être
    // arrivé à 09:00 alors que le camion attend depuis 08:10.
    const point = est.timeline.find((t) => t.type === 'point');
    expect(point.arrivee_min).toBe(60);
    expect(point.depart_min).toBe(70);
    // 10 (trajet) + 50 (attente, comptée en travail) + 10 (service) + 10 (retour)
    expect(est.duree_travail_min).toBe(80);
    expect(est.heure_fin_estimee).toBe('09:20');
  });

  it('cumule l’attente de plusieurs rendez-vous', async () => {
    const est = await engine.buildTimeline([
      asso({ id: 1, name: 'Asso A', anchor: { debutMin: 540, finMin: 600 } }),
      asso({ id: 2, name: 'Asso B', anchor: { debutMin: 600, finMin: 700 } }),
    ], baseOpts());
    // 50 min devant A (08:10 → 09:00) puis 40 min devant B (09:20 → 10:00)
    expect(est.duree_attente_min).toBe(90);
    expect(est.timeline.filter((t) => t.type === 'attente')).toHaveLength(2);
    expect(types(est)).toEqual(['depart', 'attente', 'point', 'attente', 'point', 'retour_final']);
    expect(est.violations).toEqual([]);
  });

  it('arrivée trop tardive : rdv_manque, et AUCUNE attente fabriquée', async () => {
    const est = await engine.buildTimeline(
      [asso({ anchor: { debutMin: 480, finMin: 485 } })],   // 08:00-08:05, on arrive 08:10
      baseOpts()
    );
    expect(est.duree_attente_min).toBe(0);
    expect(types(est)).toEqual(['depart', 'point', 'retour_final']);
    expect(est.violations).toEqual([{
      type: 'rdv_manque',
      point_id: 1,
      point_type: 'association',
      name: 'Asso Centre',
      arrivee_min: 10,                                // ÉLAPSÉ depuis le départ
      fenetre: { debutMin: 480, finMin: 485 },        // HORLOGE depuis minuit
    }]);
  });

  it('rendez-vous manqué MALGRÉ l’attente (fenêtre impossible) : l’ordre attente → contrôle tient', async () => {
    // Fenêtre à l'envers (10:00 → 09:00) : on attend jusqu'à l'ouverture
    // annoncée, puis on constate honnêtement que la fenêtre est déjà close.
    // Aucune borne n'est « réparée » en douce.
    const est = await engine.buildTimeline(
      [asso({ anchor: { debutMin: 600, finMin: 540 } })],
      baseOpts()
    );
    expect(est.duree_attente_min).toBe(110);          // 08:10 → 10:00
    expect(types(est)).toEqual(['depart', 'attente', 'point', 'retour_final']);
    expect(est.violations).toHaveLength(1);
    expect(est.violations[0].type).toBe('rdv_manque');
    // Le constat est fait APRÈS l'attente : 10 + 110 = 120 min écoulées
    expect(est.violations[0].arrivee_min).toBe(120);
  });

  it('point CAV ancré : point_type reporte le type réel du point', async () => {
    const est = await engine.buildTimeline([
      { id: 42, type: 'cav', name: 'CAV Mairie', lat: CENTER.lat + 0.01, lng: CENTER.lng,
        serviceMinutes: 10, weightKg: 0, anchor: { debutMin: 480, finMin: 481 } },
    ], baseOpts());
    expect(est.violations[0].point_type).toBe('cav');
    expect(est.violations[0].point_id).toBe(42);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('imputation de l’attente (arbitrage 3a, réglage attenteCompteTravail)', () => {
  const pointAncre = () => [asso({ anchor: { debutMin: 540, finMin: 570 } })];

  it('par défaut l’attente compte dans le TRAVAIL (l’équipage est en service)', async () => {
    const est = await engine.buildTimeline(pointAncre(), baseOpts());
    expect(est.duree_travail_min).toBe(80);           // attente incluse
    expect(est.duree_totale_min).toBe(80);
    expect(est.duree_attente_min).toBe(50);
  });

  it('attenteCompteTravail:false → sortie du budget, mais l’heure de fin ne bouge PAS', async () => {
    const est = await engine.buildTimeline(pointAncre(), baseOpts({ attenteCompteTravail: false }));
    expect(est.duree_travail_min).toBe(30);           // 10 trajet + 10 service + 10 retour
    expect(est.duree_totale_min).toBe(80);            // le temps réel, lui, s'écoule
    expect(est.duree_attente_min).toBe(50);
    expect(est.heure_fin_estimee).toBe('09:20');
  });

  it('l’attente ne pollue JAMAIS pause_dejeuner_min (une attente n’est pas un déjeuner)', async () => {
    const est = await engine.buildTimeline(pointAncre(), baseOpts({ attenteCompteTravail: false }));
    expect(est.pause_dejeuner_min).toBe(0);
    expect(est.pause_dejeuner_incluse).toBe(false);
  });

  it('accepte la chaîne "false" (réglage admin sérialisé), ignore une valeur inconnue', async () => {
    const chaine = await engine.buildTimeline(pointAncre(), baseOpts({ attenteCompteTravail: 'false' }));
    expect(chaine.duree_travail_min).toBe(30);
    const inconnu = await engine.buildTimeline(pointAncre(), baseOpts({ attenteCompteTravail: 'peut-être' }));
    expect(inconnu.duree_travail_min).toBe(80);       // retombe sur le défaut (true)
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('interaction attente / pause déjeuner', () => {
  it('l’attente pousse l’horloge : la pause devient due même sans travail cumulé', async () => {
    // Attente hors travail de 08:10 à 11:50 : seules 20 min de TRAVAIL ont été
    // faites, mais il est midi → la pause se déclenche par l'horloge.
    const est = await engine.buildTimeline([
      asso({ id: 1, name: 'Asso RDV', anchor: { debutMin: 710, finMin: 780 } }),
      asso({ id: 2, name: 'Asso Suivante' }),
    ], baseOpts({ attenteCompteTravail: false }));

    expect(types(est)).toEqual([
      'depart', 'attente', 'point', 'pause_dejeuner', 'point', 'retour_final',
    ]);
    expect(est.pause_dejeuner_incluse).toBe(true);
    expect(est.duree_attente_min).toBe(220);          // 08:10 → 11:50
    expect(est.pause_dejeuner_min).toBe(30);          // la pause reste la pause
    expect(est.duree_travail_min).toBe(60);           // 4 trajets + 2 services
    expect(est.duree_totale_min).toBe(310);
    // Les trois compteurs partitionnent EXACTEMENT la journée
    expect(est.duree_travail_min + est.pause_dejeuner_min + est.duree_attente_min)
      .toBe(est.duree_totale_min);
  });

  it('même journée, attente comptée en travail : le budget change, pas l’heure de fin', async () => {
    const points = [
      asso({ id: 1, name: 'Asso RDV', anchor: { debutMin: 710, finMin: 780 } }),
      asso({ id: 2, name: 'Asso Suivante' }),
    ];
    const travail = await engine.buildTimeline(points, baseOpts());
    const horsTravail = await engine.buildTimeline(points, baseOpts({ attenteCompteTravail: false }));
    expect(travail.duree_travail_min).toBe(280);      // 60 + 220 d'attente
    expect(horsTravail.duree_travail_min).toBe(60);
    expect(travail.duree_totale_min).toBe(horsTravail.duree_totale_min);
    expect(travail.heure_fin_estimee).toBe(horsTravail.heure_fin_estimee);
    expect(types(travail)).toEqual(types(horsTravail));
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('accessibilité — horaires d’ouverture (windows)', () => {
  it('arrivée avant l’ouverture : hors_horaires + premier créneau compatible', async () => {
    const est = await engine.buildTimeline(
      [asso({ windows: [[540, 720]] })],              // ouvert 09:00-12:00, on arrive 08:10
      baseOpts()
    );
    expect(est.violations).toEqual([{
      type: 'hors_horaires',
      point_id: 1,
      point_type: 'association',
      name: 'Asso Centre',
      arrivee_min: 10,                                // ÉLAPSÉ
      fin_service_min: 20,                            // ÉLAPSÉ
      plages: [[540, 720]],                           // HORLOGE
      prochain_creneau_min: 540,                      // HORLOGE (09:00)
    }]);
  });

  it('un horaire d’ouverture ne fabrique JAMAIS d’attente', async () => {
    const points = [asso({ windows: [[840, 1020]] })];   // n'ouvre qu'à 14:00
    const avec = await engine.buildTimeline(points, baseOpts());
    const sans = await engine.buildTimeline([asso()], baseOpts());
    expect(avec.duree_attente_min).toBe(0);
    expect(avec.timeline.some((t) => t.type === 'attente')).toBe(false);
    // La journée est rigoureusement identique : seule la violation s'ajoute.
    expect(avec.duree_travail_min).toBe(sans.duree_travail_min);
    expect(avec.duree_totale_min).toBe(sans.duree_totale_min);
    expect(avec.heure_fin_estimee).toBe(sans.heure_fin_estimee);
    expect(avec.violations).toHaveLength(1);
    expect(sans.violations).toHaveLength(0);
  });

  it('service qui DÉBORDE de la plage : arrivée dans les horaires, fin après la fermeture', async () => {
    // Arrivée 11:55 devant un local ouvert 09:00-12:00 et 14:00-17:00 :
    // 10 min de collecte finiraient à 12:05 → le passage ne tient pas.
    const est = await engine.buildTimeline(
      [asso({ windows: [[540, 720], [840, 1020]] })],
      baseOpts({ startHour: 11, routeLeg: fixedLeg(55, 20) })
    );
    expect(est.violations).toHaveLength(1);
    expect(est.violations[0]).toMatchObject({
      type: 'hors_horaires',
      arrivee_min: 55,
      fin_service_min: 65,
      prochain_creneau_min: 840,                      // rouvre à 14:00
    });
    // Et surtout : aucune attente de deux heures inventée en silence
    expect(est.duree_attente_min).toBe(0);
    expect(types(est)).toEqual(['depart', 'point', 'retour_final']);
  });

  it('service qui tient exactement dans la plage : aucune violation (bornes incluses)', async () => {
    // Arrivée 09:50, service 10 min → 09:50-10:00 dans une plage 08:00-10:00.
    const est = await engine.buildTimeline(
      [asso({ windows: [[480, 600]] })],
      baseOpts({ startHour: 9, routeLeg: fixedLeg(50, 20) })
    );
    expect(est.violations).toEqual([]);
  });

  it('jour FERMÉ (plages vides) : violation et aucun créneau proposé', async () => {
    const est = await engine.buildTimeline([asso({ windows: [] })], baseOpts());
    expect(est.violations).toHaveLength(1);
    expect(est.violations[0]).toMatchObject({
      type: 'hors_horaires',
      plages: [],
      prochain_creneau_min: null,                     // jamais de créneau inventé
    });
  });

  it('prochain_creneau_min null quand aucune plage ne peut accueillir le service', async () => {
    // Plage de 60 min (09:00-10:00), collecte de 120 min : ça ne rentre nulle part.
    const est = await engine.buildTimeline(
      [asso({ serviceMinutes: 120, windows: [[540, 600]] })],
      baseOpts()
    );
    expect(est.violations[0].prochain_creneau_min).toBeNull();
  });

  it('prochain_creneau_min null quand la journée d’ouverture est déjà passée', async () => {
    // Départ 15:00 (pause désactivée pour isoler la règle testée), local ouvert
    // le matin seulement : arrivée à 15:10, il n'y a plus rien après.
    const est = await engine.buildTimeline(
      [asso({ windows: [[540, 720]] })],
      baseOpts({ startHour: 15, lunchBreakMinutes: 0 })
    );
    expect(est.violations[0]).toMatchObject({
      arrivee_min: 10,                                // ÉLAPSÉ : 10 min de trajet
      plages: [[540, 720]],                           // HORLOGE : 09:00-12:00
      prochain_creneau_min: null,
    });
  });

  it('plusieurs plages : le créneau retenu est le PREMIER compatible, pas le premier listé', async () => {
    // Plages fournies dans le désordre : 14:00-17:00 puis 09:00-12:00.
    const est = await engine.buildTimeline(
      [asso({ windows: [[840, 1020], [540, 720]] })],
      baseOpts()
    );
    expect(est.violations[0].prochain_creneau_min).toBe(540);
    expect(est.violations[0].plages).toEqual([[840, 1020], [540, 720]]);  // recopiées telles quelles
  });

  it('un seul point en faute parmi plusieurs : les autres ne sont pas signalés', async () => {
    const est = await engine.buildTimeline([
      asso({ id: 1, name: 'Ouverte', windows: [[480, 1020]] }),
      asso({ id: 2, name: 'Fermée', windows: [[840, 1020]] }),
      asso({ id: 3, name: 'Inconnue' }),
    ], baseOpts());
    expect(est.violations).toHaveLength(1);
    expect(est.violations[0].point_id).toBe(2);
    expect(est.violations[0].name).toBe('Fermée');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('ordre imposé — ancrage AVANT accessibilité', () => {
  it('l’attente du rendez-vous est prise en compte par le contrôle d’horaires', async () => {
    // Arrivée 08:10 hors plage, mais le rendez-vous de 09:00 fait attendre :
    // le contrôle porte sur 09:00-09:10, qui est dans la plage → conforme.
    const est = await engine.buildTimeline(
      [asso({ anchor: { debutMin: 540, finMin: 570 }, windows: [[540, 720]] })],
      baseOpts()
    );
    expect(est.duree_attente_min).toBe(50);
    expect(est.violations).toEqual([]);
  });

  it('les deux violations peuvent coexister, dans l’ordre rdv_manque puis hors_horaires', async () => {
    const est = await engine.buildTimeline(
      [asso({ anchor: { debutMin: 480, finMin: 485 }, windows: [[840, 1020]] })],
      baseOpts()
    );
    expect(est.violations.map((v) => v.type)).toEqual(['rdv_manque', 'hors_horaires']);
    expect(est.violations[1].prochain_creneau_min).toBe(840);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('coercition défensive des champs nouveaux', () => {
  const casSansControle = [
    ['une chaîne', 'lundi 9h-12h'],
    ['un objet', { lundi: [] }],
    ['une plage incomplète', [[540]]],
    ['une borne non numérique', [[540, 'midi']]],
    ['une plage à l’envers', [[720, 540]]],
  ];
  it.each(casSansControle)('windows = %s → horaires inconnus, aucun contrôle', async (_libelle, windows) => {
    const est = await engine.buildTimeline([asso({ windows })], baseOpts());
    expect(est.violations).toEqual([]);
  });

  it('windows en chaînes (colonnes SQL) : plages exploitées et renvoyées en nombres', async () => {
    const est = await engine.buildTimeline([asso({ windows: [['540', '720']] })], baseOpts());
    expect(est.violations[0].plages).toEqual([[540, 720]]);
    expect(est.violations[0].prochain_creneau_min).toBe(540);
  });

  const ancragesIgnores = [
    ['une chaîne', '09:00-09:30'],
    ['une borne manquante', { debutMin: 540 }],
    ['une borne non numérique', { debutMin: 540, finMin: 'midi' }],
  ];
  it.each(ancragesIgnores)('anchor = %s → ancrage ignoré (ni attente ni violation)', async (_libelle, anchor) => {
    const est = await engine.buildTimeline([asso({ anchor })], baseOpts());
    expect(est.duree_attente_min).toBe(0);
    expect(est.violations).toEqual([]);
    expect(types(est)).toEqual(['depart', 'point', 'retour_final']);
  });

  it('anchor en chaînes (colonnes SQL TIME converties) : ancrage honoré', async () => {
    const est = await engine.buildTimeline(
      [asso({ anchor: { debutMin: '540', finMin: '570' } })],
      baseOpts()
    );
    expect(est.duree_attente_min).toBe(50);
    expect(est.violations).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('planWithBudget — la violation signale, le budget seul décide', () => {
  it('un point en violation d’horaires est RETENU, sa violation remonte', async () => {
    const points = [
      asso({ id: 1, name: 'A' }),
      asso({ id: 2, name: 'B', windows: [[540, 720]] }),   // arrivée 08:30, ouvre 09:00
      asso({ id: 3, name: 'C' }),
    ];
    const res = await engine.planWithBudget(points, baseOpts());
    expect(res.selected.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(res.rejected).toEqual([]);
    expect(res.estimation.violations).toHaveLength(1);
    expect(res.estimation.violations[0]).toMatchObject({ point_id: 2, type: 'hors_horaires' });
  });

  it('la violation d’un point REJETÉ ne fuit pas dans l’estimation finale', async () => {
    // Le point 2 est écarté pour cause de budget : signaler ses horaires
    // reviendrait à alerter sur un point qui n'est pas dans la tournée.
    const points = [
      asso({ id: 1, name: 'Court A' }),
      asso({ id: 2, name: 'Interminable', serviceMinutes: 500, windows: [[540, 720]] }),
      asso({ id: 3, name: 'Court B' }),
    ];
    const res = await engine.planWithBudget(points, baseOpts());
    expect(res.selected.map((p) => p.id)).toEqual([1, 3]);
    expect(res.rejected.map((p) => p.id)).toEqual([2]);
    expect(res.estimation.violations).toEqual([]);
  });

  it('une attente comptée en travail pèse sur le budget (et peut faire écarter le point)', async () => {
    // Rendez-vous à 14:40 : 6 h 30 d'attente. Comptée en travail, la journée
    // n'y suffit pas ; hors travail, le point tient.
    const points = [asso({ anchor: { debutMin: 880, finMin: 1000 } })];
    const enTravail = await engine.planWithBudget(points, baseOpts());
    expect(enTravail.selected).toEqual([]);
    expect(enTravail.rejected).toHaveLength(1);

    const horsTravail = await engine.planWithBudget(points, baseOpts({ attenteCompteTravail: false }));
    expect(horsTravail.selected).toHaveLength(1);
    expect(horsTravail.estimation.duree_attente_min).toBe(390);
    expect(horsTravail.estimation.duree_travail_min).toBe(30);   // 2 trajets + le service
  });

  it('l’attente d’un candidat rejeté n’est pas comptée non plus', async () => {
    const points = [
      asso({ id: 1, name: 'Court' }),
      asso({ id: 2, name: 'RDV impossible', serviceMinutes: 500, anchor: { debutMin: 600, finMin: 700 } }),
      asso({ id: 3, name: 'Court B' }),
    ];
    const res = await engine.planWithBudget(points, baseOpts());
    expect(res.selected.map((p) => p.id)).toEqual([1, 3]);
    expect(res.estimation.duree_attente_min).toBe(0);
    expect(res.estimation.timeline.some((t) => t.type === 'attente')).toBe(false);
  });

  it('sans contrainte horaire, la sélection est rigoureusement celle d’avant l’extension', async () => {
    const points = Array.from({ length: 30 }, (_, i) => asso({
      id: i + 1, name: `Asso ${i + 1}`, lat: CENTER.lat + (i + 1) / 100,
    }));
    const res = await engine.planWithBudget(points, baseOpts());
    expect(res.estimation.violations).toEqual([]);
    expect(res.estimation.duree_attente_min).toBe(0);
    expect(res.estimation.duree_travail_min).toBeLessThanOrEqual(360);
    expect(res.selected.length + res.rejected.length).toBe(30);
  });
});
