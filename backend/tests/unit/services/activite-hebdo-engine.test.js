// ═══════════════════════════════════════════════════════════════════════════
// UNITAIRE — compteur d'activité hebdomadaire (PR B, lot 3)
// ───────────────────────────────────────────────────────────────────────────
// Moteur PUR : aucune base, aucune E/S, tout est injecté.
//
// Ce que ces tests tiennent, et ce sont les trois règles de fond du contrat :
//
//   1. UNE SEMAINE SANS RELEVÉ N'EST PAS UNE SEMAINE À ZÉRO HEURE. C'est le
//      piège `Number(null) === 0`, déjà payé trois fois dans ce dépôt (point de
//      départ dans le golfe de Guinée en 2.42.0, tolérance de rendez-vous à
//      zéro minute en 2.38.0, palier « vide » d'une borne jamais relevée en
//      2.48.0). Ici il transformerait un mois de paie non encore importé en
//      série de « semaines sous le minimum » — un faux constat qui part vers un
//      référent qui peut suspendre des droits.
//
//   2. L'ALERTE NE SONNE JAMAIS PENDANT UN ARRÊT DÉCLARÉ, et jamais sur une
//      série interrompue par une semaine non relevée.
//
//   3. L'INDICATEUR EST UN NOMBRE DE SEMAINES, PAS UNE MOYENNE — et il compte
//      les semaines d'arrêt, contrairement à l'alerte : l'autorité demande un
//      volume d'activité constaté, pas un jugement.
// ═══════════════════════════════════════════════════════════════════════════
const { calculerSemaines, calculerAlerte, joursOuvresCouverts } = require('../../../src/services/activite-hebdo-engine');

/** Relevé de paie d'une semaine (celui qui manque quand le mois n'est pas importé). */
const semaine = (num, heures, contrat = 26) => ({
  iso_year: 2026, iso_week: num, hours_worked: heures, hours_contract: contrat,
});

describe('structure du résultat', () => {
  test('2026 compte 53 semaines ISO (l’année commence un jeudi)', () => {
    const r = calculerSemaines({ annee: 2026 });
    expect(r.semaines).toHaveLength(53);
    expect(r.semaines[0].iso_week).toBe(1);
    expect(r.semaines[52].iso_week).toBe(53);
    // Pivot jeudi : le lundi de S1 2026 est le 29/12/2025.
    expect(r.semaines[0].week_start).toBe('2025-12-29');
  });

  test('les réglages sont repris tels quels, avec leurs défauts', () => {
    expect(calculerSemaines({ annee: 2026 })).toMatchObject({ seuil_min: 15, seuil_max: 20 });
    expect(calculerSemaines({ annee: 2026, seuilMin: 12, seuilMax: 25 }))
      .toMatchObject({ seuil_min: 12, seuil_max: 25 });
  });

  test('une année illisible ne lève pas : résultat vide et explicite', () => {
    const r = calculerSemaines({ annee: 'n’importe quoi' });
    expect(r.annee).toBeNull();
    expect(r.semaines).toEqual([]);
    expect(r.alerte.active).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('1. « sans relevé » n’est JAMAIS « zéro heure »', () => {
  test('une semaine sans ligne de paie rend null partout, pas 0', () => {
    const r = calculerSemaines({ annee: 2026, weekHours: [semaine(10, 26)] });
    const s10 = r.semaines.find((s) => s.iso_week === 10);
    const s11 = r.semaines.find((s) => s.iso_week === 11);

    expect(s10.sans_releve).toBe(false);
    expect(s10.heures_travail).toBe(26);

    expect(s11.sans_releve).toBe(true);
    expect(s11.heures_travail).toBeNull();
    expect(s11.total_heures).toBeNull();
    // `false` serait tout aussi faux que `true` : on ne sait pas.
    expect(s11.sous_seuil).toBeNull();
  });

  test('une semaine non relevée n’entre ni dans le compte sous seuil ni dans les relevées', () => {
    const r = calculerSemaines({ annee: 2026, weekHours: [semaine(10, 26)] });
    expect(r.nb_semaines_relevees).toBe(1);
    expect(r.nb_semaines_sous_seuil).toBe(0);
  });

  test('zéro heure RELEVÉ est bien zéro (la distinction ne va pas dans l’autre sens)', () => {
    // Une semaine à 0 h saisie par la paie est un fait : elle compte.
    const r = calculerSemaines({ annee: 2026, weekHours: [semaine(10, 0)] });
    const s = r.semaines.find((x) => x.iso_week === 10);
    expect(s.sans_releve).toBe(false);
    expect(s.heures_travail).toBe(0);
    expect(s.sous_seuil).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('2. le travail compte, et l’accompagnement s’y ajoute', () => {
  test('total = heures travaillées + minutes d’accompagnement converties', () => {
    const r = calculerSemaines({
      annee: 2026,
      weekHours: [semaine(10, 13)],
      milestones: [{ completed_date: '2026-03-04', duree_minutes: 90 }],
      actions: [{ date_realisation: '2026-03-05', duree_minutes: 30 }],
    });
    const s = r.semaines.find((x) => x.iso_week === 10);
    expect(s.minutes_accompagnement).toBe(120);
    expect(s.total_heures).toBe(15); // 13 h + 2 h
    expect(s.sous_seuil).toBe(false); // 15 n'est pas < 15
  });

  test('un entretien SANS durée ne produit aucune minute (jamais de durée inventée)', () => {
    const r = calculerSemaines({
      annee: 2026,
      weekHours: [semaine(10, 13)],
      milestones: [{ completed_date: '2026-03-04', duree_minutes: null }],
    });
    expect(r.semaines.find((x) => x.iso_week === 10).minutes_accompagnement).toBe(0);
  });

  test('un entretien d’une autre semaine n’est pas compté ici', () => {
    const r = calculerSemaines({
      annee: 2026,
      weekHours: [semaine(10, 13), semaine(11, 13)],
      milestones: [{ completed_date: '2026-03-11', duree_minutes: 120 }],
    });
    expect(r.semaines.find((x) => x.iso_week === 10).minutes_accompagnement).toBe(0);
    expect(r.semaines.find((x) => x.iso_week === 11).minutes_accompagnement).toBe(120);
  });

  test('jours de PMSMP : jours OUVRÉS couverts, plafonnés à 5', () => {
    const r = calculerSemaines({
      annee: 2026,
      weekHours: [semaine(10, 0)],
      pmsmp: [{ date_debut: '2026-03-02', date_fin: '2026-03-08' }], // lundi → dimanche
    });
    expect(r.semaines.find((x) => x.iso_week === 10).jours_pmsmp).toBe(5);
  });

  test('deux conventions qui se recouvrent ne font pas 10 jours', () => {
    const r = calculerSemaines({
      annee: 2026,
      weekHours: [semaine(10, 0)],
      pmsmp: [
        { date_debut: '2026-03-02', date_fin: '2026-03-06' },
        { date_debut: '2026-03-03', date_fin: '2026-03-05' },
      ],
    });
    expect(r.semaines.find((x) => x.iso_week === 10).jours_pmsmp).toBe(5);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('3. l’alerte', () => {
  const sousSeuil = (nums) => nums.map((n) => semaine(n, 10));

  test('une seule semaine sous le minimum ne déclenche rien', () => {
    const r = calculerSemaines({ annee: 2026, weekHours: sousSeuil([10]) });
    expect(r.alerte).toEqual({ active: false, depuis_semaine: null });
  });

  test('deux semaines CONSÉCUTIVES déclenchent, et nomment la première de la série', () => {
    const r = calculerSemaines({ annee: 2026, weekHours: sousSeuil([10, 11]) });
    expect(r.alerte).toEqual({ active: true, depuis_semaine: 10 });
  });

  test('deux semaines NON consécutives ne déclenchent pas', () => {
    const r = calculerSemaines({ annee: 2026, weekHours: [semaine(10, 10), semaine(11, 30), semaine(12, 10)] });
    expect(r.alerte.active).toBe(false);
  });

  test('L’ALERTE NE SONNE PAS PENDANT UN ARRÊT DÉCLARÉ', () => {
    const r = calculerSemaines({
      annee: 2026,
      weekHours: sousSeuil([10, 11]),
      leaves: [{ type_category: 'sick', start_date: '2026-03-02', end_date: '2026-03-13' }],
    });
    expect(r.semaines.find((s) => s.iso_week === 10).arret_declare).toBe(true);
    expect(r.alerte.active).toBe(false);
    // … mais les semaines RESTENT comptées dans l'indicateur de volume, qui est
    // ce que l'autorité demande (amendement A4).
    expect(r.nb_semaines_sous_seuil).toBe(2);
    expect(r.raisons).toEqual([
      { iso_week: 10, categorie: 'arret' },
      { iso_week: 11, categorie: 'arret' },
    ]);
  });

  test('un arrêt au MILIEU d’une série l’interrompt (la série reprend après)', () => {
    const r = calculerSemaines({
      annee: 2026,
      weekHours: sousSeuil([10, 11, 12]),
      leaves: [{ type_category: 'sick', start_date: '2026-03-09', end_date: '2026-03-13' }], // S11
    });
    expect(r.alerte.active).toBe(false); // 10 seule, puis 12 seule
  });

  test('une semaine SANS RELEVÉ interrompt la série (un mois non importé n’alerte pas)', () => {
    // S10 et S12 sous le minimum, S11 jamais relevée : si « sans relevé »
    // prolongeait la série, un simple retard d'import de paie fabriquerait
    // l'alerte.
    const r = calculerSemaines({ annee: 2026, weekHours: [semaine(10, 10), semaine(12, 10)] });
    expect(r.alerte.active).toBe(false);
  });

  test('la série la PLUS RÉCENTE est retenue', () => {
    const r = calculerSemaines({
      annee: 2026,
      weekHours: [semaine(5, 10), semaine(6, 10), semaine(7, 30), semaine(20, 10), semaine(21, 10)],
    });
    expect(r.alerte).toEqual({ active: true, depuis_semaine: 20 });
  });

  test('le nombre de semaines consécutives est paramétrable et borné à 1 minimum', () => {
    const trois = calculerSemaines({ annee: 2026, weekHours: sousSeuil([10, 11]), consecutives: 3 });
    expect(trois.alerte.active).toBe(false);

    // Une valeur ABERRANTE (0, une chaîne, NaN) ne doit pas pouvoir faire
    // sonner l'alerte dès la première semaine — ce serait l'inverse de la
    // prudence voulue. Elle retombe sur le défaut documenté (2), comme partout
    // ailleurs dans le dépôt (« hors bornes ou illisible → le défaut »).
    const zero = calculerSemaines({ annee: 2026, weekHours: sousSeuil([10]), consecutives: 0 });
    expect(zero.alerte.active).toBe(false);
    const nImporteQuoi = calculerSemaines({ annee: 2026, weekHours: sousSeuil([10]), consecutives: 'deux' });
    expect(nImporteQuoi.alerte.active).toBe(false);
    // Une valeur EXPLICITE de 1 reste honorée : certains départements
    // conventionnent un suivi à la semaine.
    const une = calculerSemaines({ annee: 2026, weekHours: sousSeuil([10]), consecutives: 1 });
    expect(une.alerte).toEqual({ active: true, depuis_semaine: 10 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('4. raisons catégorisées — jamais un motif inventé', () => {
  test('temps partiel contractuel : le contrat lui-même est sous le plancher', () => {
    const r = calculerSemaines({ annee: 2026, weekHours: [semaine(10, 10, 12)] });
    expect(r.raisons).toEqual([{ iso_week: 10, categorie: 'temps_partiel' }]);
  });

  test('congés payés : catégorie « absence », jamais « arrêt »', () => {
    const r = calculerSemaines({
      annee: 2026,
      weekHours: [semaine(10, 10)],
      leaves: [{ type_category: 'holiday', start_date: '2026-03-02', end_date: '2026-03-06' }],
    });
    // Un congé payé n'est PAS un arrêt : il n'empêche pas l'alerte de sonner…
    expect(r.semaines.find((s) => s.iso_week === 10).arret_declare).toBe(false);
    // … mais il explique la semaine basse.
    expect(r.raisons).toEqual([{ iso_week: 10, categorie: 'absence' }]);
  });

  test('aucune explication trouvée → « inconnue », dit tel quel', () => {
    const r = calculerSemaines({ annee: 2026, weekHours: [semaine(10, 10, 35)] });
    expect(r.raisons).toEqual([{ iso_week: 10, categorie: 'inconnue' }]);
  });

  test('l’arrêt prime sur toutes les autres explications', () => {
    const r = calculerSemaines({
      annee: 2026,
      weekHours: [semaine(10, 2, 12)], // temps partiel ET…
      leaves: [{ type_category: 'sick', start_date: '2026-03-02', end_date: '2026-03-06' }], // … arrêt
    });
    expect(r.raisons).toEqual([{ iso_week: 10, categorie: 'arret' }]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('5. helpers', () => {
  test('joursOuvresCouverts ignore le week-end', () => {
    expect(joursOuvresCouverts('2026-03-02', '2026-03-07', '2026-03-08')).toBe(0); // samedi-dimanche
    expect(joursOuvresCouverts('2026-03-02', '2026-03-02', '2026-03-03')).toBe(2);
    expect(joursOuvresCouverts('2026-03-02', null, null)).toBe(0);
  });

  test('calculerAlerte sur une liste vide ne lève pas', () => {
    expect(calculerAlerte([], 2)).toEqual({ active: false, depuis_semaine: null });
  });

  test('une date fournie en objet Date est acceptée comme une chaîne', () => {
    const r = calculerSemaines({
      annee: 2026,
      weekHours: [semaine(10, 13)],
      milestones: [{ completed_date: new Date(Date.UTC(2026, 2, 4)), duree_minutes: 120 }],
    });
    expect(r.semaines.find((s) => s.iso_week === 10).total_heures).toBe(15);
  });
});
