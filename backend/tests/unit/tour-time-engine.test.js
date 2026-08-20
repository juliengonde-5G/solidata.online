// ═══════════════════════════════════════════════════════════════════════════
// TESTS UNITAIRES — Moteur de temps des tournées
// (services/tour-time-engine.js — fonctions PURES, aucun accès DB/réseau :
//  la fonction `routeLeg` est injectée par le test, déterministe.)
//
// Règles verrouillées (exigences client, août 2026) :
//  - journée = 6 h de TRAVAIL max (conduite + collecte + déchargements) ;
//  - pause déjeuner AU CENTRE, HORS temps de travail, due au premier des deux
//    signaux : `lunchAfterMinutes` de travail cumulé OU heure ≥ lunchStartHour ;
//    les TRAJETS pour y aller comptent, la pause elle-même non ;
//  - retour de vidage dès que la charge dépasserait le seuil (min entre le
//    seuil kg legacy et le % de la capacité du véhicule réel) : trajet +
//    déchargement = du travail ;
//  - vidage combiné à la pause quand le véhicule est chargé (UN seul trajet) ;
//  - buildTimeline ne retire jamais de point (liste fixe → dépassement affiché) ;
//  - planWithBudget coupe la sélection au dernier point qui tient, retour final
//    compris.
// ═══════════════════════════════════════════════════════════════════════════
const engine = require('../../src/services/tour-time-engine');

const CENTER = { lat: 49.4231, lng: 1.0993 };

/**
 * routeLeg déterministe : chaque tronçon coûte `minutesPerLeg` minutes et
 * `kmPerLeg` km, quels que soient les points. Compte les appels.
 */
function fixedLeg(minutes = 10, km = 5) {
  const fn = async () => ({ km, minutes });
  return fn;
}

/**
 * routeLeg « par distance de Manhattan sur un axe » : permet de différencier
 * les tronçons (utile pour vérifier que le retour au centre est bien facturé).
 */
function axisLeg(minutesPerUnit = 1, kmPerUnit = 1) {
  return async (a, b) => {
    const d = Math.abs((a.lat || 0) - (b.lat || 0)) * 100;
    return { km: d * kmPerUnit, minutes: d * minutesPerUnit };
  };
}

/** Fabrique N points identiques (service + poids paramétrables). */
function makePoints(n, { serviceMinutes = 10, weightKg = 0, type = 'cav' } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    type,
    name: `CAV ${i + 1}`,
    lat: CENTER.lat + (i + 1) / 100,
    lng: CENTER.lng,
    serviceMinutes,
    weightKg,
  }));
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

// ───────────────────────────────────────────────────────────────────────────
describe('resolveReturnThresholdKg — seuil de vidage vehicle-aware', () => {
  it('prend le MINIMUM entre le seuil kg legacy et le % de la capacité', () => {
    // 90 % de 3500 = 3150 → le seuil legacy 2000 est le plus contraignant
    expect(engine.resolveReturnThresholdKg({
      returnEveryKg: 2000, vehicleFillReturnPct: 90, capacityKg: 3500,
    })).toBe(2000);
    // 90 % de 1000 = 900 → c'est la capacité du véhicule qui contraint
    expect(engine.resolveReturnThresholdKg({
      returnEveryKg: 2000, vehicleFillReturnPct: 90, capacityKg: 1000,
    })).toBe(900);
  });

  it('ignore une valeur absente / nulle et renvoie Infinity si rien n’est exploitable', () => {
    expect(engine.resolveReturnThresholdKg({ vehicleFillReturnPct: 90, capacityKg: 2000 })).toBe(1800);
    expect(engine.resolveReturnThresholdKg({ returnEveryKg: 1500 })).toBe(1500);
    expect(engine.resolveReturnThresholdKg({ returnEveryKg: 0, vehicleFillReturnPct: 0 })).toBe(Infinity);
    expect(engine.resolveReturnThresholdKg()).toBe(Infinity);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('buildTimeline — journée courte, sans pause ni vidage', () => {
  it('cumule trajets + services + retour final, aucune pause avant midi', async () => {
    // 3 points : 4 trajets (centre→p1, p1→p2, p2→p3, p3→centre) × 10 min
    // + 3 services × 10 min = 70 min de travail, aucun poids → pas de vidage.
    const est = await engine.buildTimeline(makePoints(3), baseOpts());
    expect(est.duree_travail_min).toBe(70);
    expect(est.pause_dejeuner_incluse).toBe(false);
    expect(est.pause_dejeuner_min).toBe(0);
    expect(est.duree_totale_min).toBe(70);
    expect(est.nb_retours_vidage).toBe(0);
    expect(est.faisable).toBe(true);
    expect(est.depassement_min).toBe(0);
    expect(est.distance_km).toBe(20);
    expect(est.nb_points).toBe(3);
    expect(est.heure_depart).toBe('08:00');
    expect(est.heure_fin_estimee).toBe('09:10');
    expect(est.timeline.map((t) => t.type)).toEqual([
      'depart', 'point', 'point', 'point', 'retour_final',
    ]);
    expect(est.avertissements).toEqual([]);
  });

  it('expose cav_id sur les points CAV et association_point_id sur les points association', async () => {
    const est = await engine.buildTimeline([
      ...makePoints(1),
      { id: 77, type: 'association', name: 'Asso A', lat: 49.5, lng: 1.1, serviceMinutes: 5, weightKg: 0 },
    ], baseOpts());
    const points = est.timeline.filter((t) => t.type === 'point');
    expect(points[0].cav_id).toBe(1);
    expect(points[0].association_point_id).toBeUndefined();
    expect(points[1].association_point_id).toBe(77);
    expect(points[1].cav_id).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('buildTimeline — pause déjeuner', () => {
  it('pause par CUMUL de travail : départ 8 h → pause dès 4 h de travail (12 h)', async () => {
    // 12 points × (10 min trajet + 10 min service) = 20 min chacun.
    // Après 12 points on est à 240 min → la pause devient due AVANT le 13e.
    const est = await engine.buildTimeline(makePoints(14), baseOpts());
    expect(est.pause_dejeuner_incluse).toBe(true);
    expect(est.pause_dejeuner_min).toBe(30);
    const pause = est.timeline.find((t) => t.type === 'pause_dejeuner');
    // Retour au centre (10 min de travail) puis pause : arrivée à 250 min = 12h10
    expect(pause.arrivee_min).toBe(250);
    expect(pause.depart_min).toBe(280);
    // La pause n'entre PAS dans le temps de travail
    expect(est.duree_totale_min - est.duree_travail_min).toBe(30);
  });

  it('pause par HORLOGE : départ 10 h → pause à 12 h après seulement 2 h de travail', async () => {
    const est = await engine.buildTimeline(makePoints(10), baseOpts({ startHour: 10 }));
    expect(est.pause_dejeuner_incluse).toBe(true);
    const pause = est.timeline.find((t) => t.type === 'pause_dejeuner');
    // 6 points = 120 min de travail → 12h00 pile ; la pause devient due avant le 7e.
    // + 10 min de trajet de retour au centre → arrivée 130 min après 10h = 12h10.
    expect(pause.arrivee_min).toBe(130);
    expect(est.heure_depart).toBe('10:00');
    // Le travail cumulé au moment où la pause est déclenchée est bien < 4 h
    expect(pause.arrivee_min).toBeLessThan(240);
  });

  it('aucune pause pour une tournée courte qui se termine avant midi', async () => {
    const est = await engine.buildTimeline(makePoints(2), baseOpts({ startHour: 8 }));
    expect(est.pause_dejeuner_incluse).toBe(false);
    expect(est.timeline.some((t) => t.type === 'pause_dejeuner')).toBe(false);
    expect(est.heure_fin_estimee).toBe('08:50');
  });

  it('la pause n’est prise qu’UNE fois sur toute la journée', async () => {
    const est = await engine.buildTimeline(makePoints(20), baseOpts());
    expect(est.timeline.filter((t) => t.type === 'pause_dejeuner')).toHaveLength(1);
    expect(est.pause_dejeuner_min).toBe(30);
  });

  it('lunchBreakMinutes = 0 désactive la pause (paramétrage admin)', async () => {
    const est = await engine.buildTimeline(makePoints(14), baseOpts({ lunchBreakMinutes: 0 }));
    expect(est.pause_dejeuner_incluse).toBe(false);
    expect(est.duree_totale_min).toBe(est.duree_travail_min);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('buildTimeline — retours de vidage', () => {
  it('déclenche un retour quand la charge dépasserait le seuil, et remet la charge à 0', async () => {
    // 4 points de 600 kg, seuil 2000 kg → le 4e ferait 2400 kg : vidage avant.
    const est = await engine.buildTimeline(
      makePoints(4, { weightKg: 600, serviceMinutes: 5 }),
      baseOpts({ returnThresholdKg: 2000 })
    );
    expect(est.nb_retours_vidage).toBe(1);
    const types = est.timeline.map((t) => t.type);
    expect(types).toEqual(['depart', 'point', 'point', 'point', 'retour_vidage', 'point', 'retour_final']);
    // Travail = 6 trajets × 10 + 4 services × 5 + 15 (vidage intermédiaire)
    //           + 15 (déchargement du retour final, véhicule chargé) = 110 min
    expect(est.duree_travail_min).toBe(110);
    expect(est.poids_estime_kg).toBe(2400);
    // Pic de charge = 1800 kg (3 points) → 1800/3500
    expect(est.taux_remplissage_vehicule_pct).toBe(Math.round((1800 / 3500) * 100));
  });

  it('petit véhicule : le seuil vehicle-aware (90 % de 1000 kg) impose plusieurs vidages', async () => {
    const seuil = engine.resolveReturnThresholdKg({
      returnEveryKg: 2000, vehicleFillReturnPct: 90, capacityKg: 1000,
    });
    expect(seuil).toBe(900);
    const est = await engine.buildTimeline(
      makePoints(4, { weightKg: 500, serviceMinutes: 5 }),
      baseOpts({ returnThresholdKg: seuil, capacityKg: 1000 })
    );
    // 500 + 500 = 1000 > 900 → vidage avant chaque point pair : 3 vidages
    expect(est.nb_retours_vidage).toBe(3);
    expect(est.poids_estime_kg).toBe(2000);
  });

  it('aucun vidage si le seuil est Infinity (aucun seuil exploitable)', async () => {
    const est = await engine.buildTimeline(
      makePoints(5, { weightKg: 900 }),
      baseOpts({ returnThresholdKg: Infinity })
    );
    expect(est.nb_retours_vidage).toBe(0);
  });

  it('déchargement final compté seulement si le véhicule rentre chargé', async () => {
    const charge = await engine.buildTimeline(makePoints(1, { weightKg: 100, serviceMinutes: 0 }), baseOpts());
    const vide = await engine.buildTimeline(makePoints(1, { weightKg: 0, serviceMinutes: 0 }), baseOpts());
    expect(charge.duree_travail_min - vide.duree_travail_min).toBe(15);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('buildTimeline — vidage combiné à la pause déjeuner', () => {
  it('un seul trajet de retour, déchargement facturé, pause hors travail', async () => {
    // 12 points de 100 kg : la pause est due après le 12e (240 min de travail),
    // le véhicule porte alors 1200 kg → vidage au même passage.
    const est = await engine.buildTimeline(
      makePoints(13, { weightKg: 100, serviceMinutes: 10 }),
      baseOpts()
    );
    const idxVidage = est.timeline.findIndex((t) => t.type === 'retour_vidage');
    const idxPause = est.timeline.findIndex((t) => t.type === 'pause_dejeuner');
    expect(idxVidage).toBeGreaterThan(0);
    expect(idxPause).toBe(idxVidage + 1); // ordre : vidage puis pause, même passage
    const vidage = est.timeline[idxVidage];
    const pause = est.timeline[idxPause];
    // Le vidage dure unloadMinutes et la pause enchaîne immédiatement
    expect(vidage.depart_min - vidage.arrivee_min).toBe(15);
    expect(pause.arrivee_min).toBe(vidage.depart_min);
    expect(pause.depart_min - pause.arrivee_min).toBe(30);
    // Un SEUL trajet vers le centre à ce moment (10 min) : 240 (12 pts) + 10 = 250
    expect(vidage.arrivee_min).toBe(250);
    // La pause reste hors travail
    expect(est.duree_totale_min - est.duree_travail_min).toBe(30);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('buildTimeline — budget de travail (liste FIXE, jamais tronquée)', () => {
  it('liste infaisable → faisable:false + depassement_min exact + avertissement', async () => {
    // 20 points × 20 min + trajet de retour pour la pause (10) + retour final (10)
    // = 420 min de travail pour un budget de 360.
    const est = await engine.buildTimeline(makePoints(20), baseOpts());
    expect(est.nb_points).toBe(20); // aucun point retiré
    expect(est.faisable).toBe(false);
    expect(est.duree_travail_min).toBe(420);
    expect(est.budget_travail_min).toBe(360);
    expect(est.depassement_min).toBe(60);
    expect(est.avertissements[0]).toMatch(/dépassement de 60 min/);
  });

  it('budget 6 h : la limite est bien 360 min de TRAVAIL, pause exclue', async () => {
    const est = await engine.buildTimeline(makePoints(17), baseOpts());
    // 17 points × 20 + retour 10 + retour-pause 10 = 360 min pile
    expect(est.duree_travail_min).toBe(360);
    expect(est.faisable).toBe(true);
    expect(est.duree_totale_min).toBe(390); // 360 de travail + 30 de pause
  });

  it('maxDailyHours 7 h → 6 h : une tournée limite bascule en dépassement', async () => {
    const points = makePoints(19);
    const a7 = await engine.buildTimeline(points, baseOpts({ maxWorkMinutes: 420 }));
    const a6 = await engine.buildTimeline(points, baseOpts({ maxWorkMinutes: 360 }));
    expect(a7.faisable).toBe(true);
    expect(a6.faisable).toBe(false);
    expect(a6.duree_travail_min).toBe(a7.duree_travail_min); // même journée, budget différent
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('buildTimeline — robustesse', () => {
  it('coordonnées manquantes : tronçon neutralisé (0) + avertissement, aucun NaN', async () => {
    const est = await engine.buildTimeline([
      { id: 1, type: 'cav', name: 'Sans GPS', lat: null, lng: null, serviceMinutes: 10, weightKg: 100 },
      ...makePoints(1),
    ], baseOpts({ routeLeg: axisLeg() }));
    expect(Number.isFinite(est.duree_travail_min)).toBe(true);
    expect(Number.isFinite(est.distance_km)).toBe(true);
    expect(est.avertissements.join(' ')).toMatch(/Coordonnées manquantes/);
  });

  it('routeLeg qui échoue : tronçon 0, estimation produite quand même', async () => {
    const est = await engine.buildTimeline(makePoints(2), baseOpts({
      routeLeg: async () => { throw new Error('OSRM KO'); },
    }));
    expect(est.duree_travail_min).toBe(20); // seuls les services subsistent
    expect(est.distance_km).toBe(0);
  });

  it('liste vide : estimation neutre et faisable', async () => {
    const est = await engine.buildTimeline([], baseOpts());
    expect(est.nb_points).toBe(0);
    expect(est.faisable).toBe(true);
    expect(est.timeline.map((t) => t.type)).toEqual(['depart', 'retour_final']);
  });

  it('mémoïse les tronçons identiques (un seul appel routeur par paire)', async () => {
    const spy = jest.fn(async () => ({ km: 5, minutes: 10 }));
    await engine.buildTimeline(makePoints(3), baseOpts({ routeLeg: spy }));
    // centre→p1, p1→p2, p2→p3, p3→centre = 4 paires distinctes
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('minutesToHHMM formate et repasse à 0 au-delà de minuit', () => {
    expect(engine.minutesToHHMM(8 * 60)).toBe('08:00');
    expect(engine.minutesToHHMM(13 * 60 + 5)).toBe('13:05');
    expect(engine.minutesToHHMM(25 * 60)).toBe('01:00');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('planWithBudget — sélection gloutonne sous contrainte', () => {
  it('coupe au dernier point qui tient, retour final compris', async () => {
    // 20 min par point + 10 min de retour final ; budget 360 min.
    // 17 points = 340 + 10 = 350 ✓ ; 18 points = 360 + 10 = 370 ✗
    // (la pause déclenchée après 240 min ajoute 10 min de trajet → recalcul :
    //  le moteur tranche, on vérifie surtout la cohérence du résultat).
    const res = await engine.planWithBudget(makePoints(30), baseOpts());
    expect(res.selected.length + res.rejected.length).toBe(30);
    expect(res.estimation.nb_points).toBe(res.selected.length);
    expect(res.estimation.faisable).toBe(true);
    expect(res.estimation.duree_travail_min).toBeLessThanOrEqual(360);
    // Ajouter un point de plus ferait sauter le budget
    const unDePlus = await engine.buildTimeline(
      makePoints(res.selected.length + 1), baseOpts()
    );
    expect(unDePlus.duree_travail_min).toBeGreaterThan(360);
  });

  it('conserve les objets d’origine dans selected / rejected (ordre préservé)', async () => {
    const points = makePoints(30);
    const res = await engine.planWithBudget(points, baseOpts());
    expect(res.selected[0]).toBe(points[0]);
    expect(res.rejected[res.rejected.length - 1]).toBe(points[29]);
    expect(res.selected.every((p) => points.includes(p))).toBe(true);
  });

  it('tout tient : rien de rejeté, aucun avertissement de coupe', async () => {
    const res = await engine.planWithBudget(makePoints(3), baseOpts());
    expect(res.rejected).toEqual([]);
    expect(res.estimation.avertissements).toEqual([]);
    expect(res.estimation.nb_points).toBe(3);
  });

  it('signale la coupe dans les avertissements quand des points sont écartés', async () => {
    const res = await engine.planWithBudget(makePoints(40), baseOpts());
    expect(res.rejected.length).toBeGreaterThan(0);
    expect(res.estimation.avertissements.join(' ')).toMatch(/écarté/);
  });

  it('la pause et les vidages sont comptés dans la sélection (mêmes règles que buildTimeline)', async () => {
    const res = await engine.planWithBudget(
      makePoints(30, { weightKg: 300, serviceMinutes: 10 }),
      baseOpts()
    );
    expect(res.estimation.pause_dejeuner_incluse).toBe(true);
    expect(res.estimation.nb_retours_vidage).toBeGreaterThan(0);
    // Le budget de TRAVAIL reste respecté malgré vidages + trajet de pause
    expect(res.estimation.duree_travail_min).toBeLessThanOrEqual(360);
    expect(res.estimation.duree_totale_min).toBe(
      res.estimation.duree_travail_min + res.estimation.pause_dejeuner_min
    );
  });

  it('premier point déjà trop coûteux → aucune sélection, estimation vide', async () => {
    const res = await engine.planWithBudget(makePoints(3, { serviceMinutes: 600 }), baseOpts());
    expect(res.selected).toEqual([]);
    expect(res.rejected).toHaveLength(3);
    expect(res.estimation.nb_points).toBe(0);
    expect(res.estimation.faisable).toBe(true); // journée vide = budget respecté
  });

  it('un point trop lourd en temps est écarté mais un point suivant plus court peut tenir', async () => {
    const points = [
      { id: 1, type: 'cav', name: 'Court A', lat: CENTER.lat + 0.01, lng: CENTER.lng, serviceMinutes: 10, weightKg: 0 },
      { id: 2, type: 'cav', name: 'Interminable', lat: CENTER.lat + 0.02, lng: CENTER.lng, serviceMinutes: 500, weightKg: 0 },
      { id: 3, type: 'cav', name: 'Court B', lat: CENTER.lat + 0.03, lng: CENTER.lng, serviceMinutes: 10, weightKg: 0 },
    ];
    const res = await engine.planWithBudget(points, baseOpts());
    expect(res.selected.map((p) => p.id)).toEqual([1, 3]);
    expect(res.rejected.map((p) => p.id)).toEqual([2]);
  });

  it('arrête le balayage après maxConsecutiveRejects refus consécutifs', async () => {
    const points = [
      ...makePoints(1),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: 100 + i, type: 'cav', name: `Long ${i}`,
        lat: CENTER.lat + 0.1 + i / 100, lng: CENTER.lng, serviceMinutes: 500, weightKg: 0,
      })),
      { id: 200, type: 'cav', name: 'Court final', lat: CENTER.lat + 0.5, lng: CENTER.lng, serviceMinutes: 5, weightKg: 0 },
    ];
    const res = await engine.planWithBudget(points, baseOpts({ maxConsecutiveRejects: 3 }));
    // Après 3 refus consécutifs, le reste n'est plus examiné (mais reste « rejeté »)
    expect(res.selected.map((p) => p.id)).toEqual([1]);
    expect(res.rejected).toHaveLength(6);
  });
});
