// ═══════════════════════════════════════════════════════════════════════════
// UNITAIRE — moteur PUR de la feuille de temps (PR B lot 4, contrat 15 § 6.4)
// ───────────────────────────────────────────────────────────────────────────
// Aucune base, aucun mock : tout entre par les arguments. Ce qui est verrouillé
// ici est ce que l'autorité contrôle sur l'export (c) :
//   - une durée absente ne produit AUCUNE ligne (« jamais de valeur inventée ») ;
//   - le rattachement au projet suit la règle ASI-par-participant puis
//     OCS-par-poste, jamais l'inverse ;
//   - une quotité ou un taux forfaitaire inconnus sont ABSENTS, jamais 0 ;
//   - la ligne de cohérence signale les jours d'absence et le dépassement
//     contractuel, et n'empêche JAMAIS rien (elle ne lève aucune exception) ;
//   - aucune ligne ne porte de nom de bénéficiaire.
// ═══════════════════════════════════════════════════════════════════════════
const {
  composerLignes, calculerTotaux, verifierCoherence, projetDeLigne,
  jourISO, joursDuMois, dansPeriode, couvre, HORS_PROJET, HEURES_HEBDO_DEFAUT,
} = require('../../../src/services/temps-engine');

// ── Jeux de données ────────────────────────────────────────────────────────
const PROJETS = new Map([
  [1, { id: 1, code: 'ASI-2026-2027', nom: 'ASI', type: 'asi', taux_forfaitaire_pct: null }],
  [2, { id: 2, code: 'OCS-CIP-2026-2027', nom: 'OCS', type: 'ocs', taux_forfaitaire_pct: 40 }],
]);
const PROJETS_LISTE = [...PROJETS.values()];

const POSTES = [
  { projet_id: 2, projet_code: 'OCS-CIP-2026-2027', projet_type: 'ocs', user_id: 7, quotite_pct: 60, date_debut: '2026-01-01', date_fin: null },
];
const PARTICIPATIONS = [
  { employee_id: 5, projet_id: 1, projet_code: 'ASI-2026-2027', projet_type: 'asi', date_entree: '2026-01-01', date_sortie: null },
];

describe('helpers de date', () => {
  test('jourISO normalise chaîne, Date et timestamp ; illisible → null', () => {
    expect(jourISO('2026-09-04')).toBe('2026-09-04');
    expect(jourISO('2026-09-04T10:00:00.000Z')).toBe('2026-09-04');
    expect(jourISO(new Date(Date.UTC(2026, 8, 4)))).toBe('2026-09-04');
    expect(jourISO(null)).toBeNull();
    expect(jourISO('pas une date')).toBeNull();
  });

  test('joursDuMois gère les années bissextiles', () => {
    expect(joursDuMois(2026, 2)).toBe(28);
    expect(joursDuMois(2024, 2)).toBe(29);
    expect(joursDuMois(2026, 9)).toBe(30);
  });

  test('dansPeriode : mois nul = année entière', () => {
    expect(dansPeriode('2026-03-12', 2026, 9)).toBe(false);
    expect(dansPeriode('2026-03-12', 2026, null)).toBe(true);
    expect(dansPeriode('2025-09-12', 2026, 9)).toBe(false);
  });

  test('couvre : fin nulle = période ouverte', () => {
    expect(couvre('2026-09-04', '2026-01-01', null)).toBe(true);
    expect(couvre('2025-12-31', '2026-01-01', null)).toBe(false);
    expect(couvre('2026-09-04', '2026-01-01', '2026-06-30')).toBe(false);
  });
});

describe('projetDeLigne — ASI par le salarié, OCS par le poste', () => {
  test('salarié participant ASI à cette date → projet ASI', () => {
    const r = projetDeLigne({ employeeId: 5, date: '2026-09-04', participations: PARTICIPATIONS, postes: POSTES });
    expect(r.code).toBe('ASI-2026-2027');
  });

  test('salarié non participant, intervenant affecté OCS → projet OCS', () => {
    const r = projetDeLigne({ employeeId: 99, date: '2026-09-04', participations: PARTICIPATIONS, postes: POSTES });
    expect(r.code).toBe('OCS-CIP-2026-2027');
  });

  test('rattachement ASI CLOS avant la date → on retombe sur l’OCS, pas sur l’ASI', () => {
    const clos = [{ ...PARTICIPATIONS[0], date_sortie: '2026-06-30' }];
    expect(projetDeLigne({ employeeId: 5, date: '2026-09-04', participations: clos, postes: POSTES }).code)
      .toBe('OCS-CIP-2026-2027');
  });

  test('ni participation ni poste → HORS_PROJET (jamais un projet choisi au hasard)', () => {
    expect(projetDeLigne({ employeeId: 5, date: '2026-09-04', participations: [], postes: [] }).code).toBe(HORS_PROJET);
  });
});

describe('composerLignes', () => {
  const base = { annee: 2026, mois: 9, postes: POSTES, participations: PARTICIPATIONS, projets: PROJETS };

  test('un entretien SANS durée ne produit AUCUNE ligne', () => {
    const lignes = composerLignes({
      ...base,
      milestones: [
        { id: 1, employee_id: 5, completed_date: '2026-09-04', duree_minutes: 60, milestone_type: 'bilan_intermediaire' },
        { id: 2, employee_id: 5, completed_date: '2026-09-11', duree_minutes: null, milestone_type: 'bilan_intermediaire' },
      ],
    });
    expect(lignes).toHaveLength(1);
    expect(lignes[0].source_id).toBe(1);
  });

  test('une durée de 0 minute n’est pas davantage un temps d’accompagnement', () => {
    const lignes = composerLignes({
      ...base,
      milestones: [{ id: 3, employee_id: 5, completed_date: '2026-09-04', duree_minutes: 0 }],
    });
    expect(lignes).toHaveLength(0);
  });

  test('les entretiens hors du mois sont écartés', () => {
    const lignes = composerLignes({
      ...base,
      milestones: [
        { id: 1, employee_id: 5, completed_date: '2026-08-31', duree_minutes: 60 },
        { id: 2, employee_id: 5, completed_date: '2026-09-01', duree_minutes: 60 },
        { id: 3, employee_id: 5, completed_date: '2026-10-01', duree_minutes: 60 },
      ],
    });
    expect(lignes.map((l) => l.source_id)).toEqual([2]);
  });

  test('les actions non réalisées sont écartées ; `date_realisation` fait foi', () => {
    const lignes = composerLignes({
      ...base,
      actions: [
        { id: 10, employee_id: 5, date_realisation: '2026-09-08', duree_minutes: 45, status: 'realise', action_label: 'RDV CMS' },
        { id: 11, employee_id: 5, date_realisation: '2026-09-09', duree_minutes: 45, status: 'en_cours' },
      ],
    });
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ activite: 'action', origine: 'composee', duree_minutes: 45, employee_id: 5 });
  });

  test('les saisies portent leur projet EXPLICITE ; projet nul → hors projet', () => {
    const lignes = composerLignes({
      ...base,
      saisies: [
        { id: 20, date: '2026-09-15', projet_id: 2, activite: 'atelier_collectif', duree_minutes: 120, libelle: 'Atelier mobilité' },
        { id: 21, date: '2026-09-16', projet_id: null, activite: 'reunion_projet', duree_minutes: 60 },
      ],
    });
    expect(lignes.map((l) => l.projet_code)).toEqual(['OCS-CIP-2026-2027', HORS_PROJET]);
    expect(lignes.every((l) => l.origine === 'saisie')).toBe(true);
    // Une saisie ne concerne aucun salarié nommé.
    expect(lignes.every((l) => l.employee_id === null)).toBe(true);
  });

  test('une activité de saisie inconnue retombe sur « autre » plutôt que de passer telle quelle', () => {
    const lignes = composerLignes({ ...base, saisies: [{ id: 22, date: '2026-09-15', activite: 'bidon', duree_minutes: 30 }] });
    expect(lignes[0].activite).toBe('autre');
  });

  test('aucune ligne ne porte de nom de bénéficiaire — seulement `employee_id`', () => {
    const lignes = composerLignes({
      ...base,
      milestones: [{ id: 1, employee_id: 5, completed_date: '2026-09-04', duree_minutes: 60, first_name: 'Karim', last_name: 'Benali' }],
    });
    const cles = Object.keys(lignes[0]);
    expect(cles).toContain('employee_id');
    expect(cles).not.toContain('first_name');
    expect(cles).not.toContain('last_name');
    expect(JSON.stringify(lignes)).not.toMatch(/Benali|Karim/);
  });

  test('mois nul = l’année entière (agrégat annuel)', () => {
    const milestones = [
      { id: 1, employee_id: 5, completed_date: '2026-03-04', duree_minutes: 60 },
      { id: 2, employee_id: 5, completed_date: '2026-09-04', duree_minutes: 30 },
      { id: 3, employee_id: 5, completed_date: '2025-09-04', duree_minutes: 30 },
    ];
    expect(composerLignes({ ...base, mois: null, milestones })).toHaveLength(2);
  });

  test('les lignes sortent triées par date', () => {
    const lignes = composerLignes({
      ...base,
      milestones: [{ id: 1, employee_id: 5, completed_date: '2026-09-20', duree_minutes: 60 }],
      saisies: [{ id: 20, date: '2026-09-02', activite: 'autre', duree_minutes: 30 }],
    });
    expect(lignes.map((l) => l.date)).toEqual(['2026-09-02', '2026-09-20']);
  });
});

describe('calculerTotaux', () => {
  const lignes = [
    { date: '2026-09-04', projet_code: 'ASI-2026-2027', duree_minutes: 60 },
    { date: '2026-09-08', projet_code: 'ASI-2026-2027', duree_minutes: 45 },
    { date: '2026-09-15', projet_code: 'OCS-CIP-2026-2027', duree_minutes: 120 },
    { date: '2026-09-16', projet_code: HORS_PROJET, duree_minutes: 30 },
  ];

  test('total et ventilation par projet', () => {
    const t = calculerTotaux(lignes, POSTES, PROJETS_LISTE);
    expect(t.total_minutes).toBe(255);
    expect(t.par_projet).toEqual({
      'ASI-2026-2027': 105, 'OCS-CIP-2026-2027': 120, [HORS_PROJET]: 30,
    });
  });

  test('quotité du poste et taux forfaitaire de l’opération (amendement F2)', () => {
    const t = calculerTotaux(lignes, POSTES, PROJETS_LISTE);
    expect(t.quotites['OCS-CIP-2026-2027']).toBe(60);
    expect(t.taux_forfaitaire['OCS-CIP-2026-2027']).toBe(40);
  });

  test('quotité et taux INCONNUS sont ABSENTS, jamais 0 (« non renseigné » ≠ « non financé »)', () => {
    const t = calculerTotaux(lignes, POSTES, PROJETS_LISTE);
    expect(t.quotites['ASI-2026-2027']).toBeUndefined();
    expect(t.taux_forfaitaire['ASI-2026-2027']).toBeUndefined();
    expect(Object.values(t.quotites)).not.toContain(0);
  });

  test('feuille vide → total 0 et aucune ventilation', () => {
    expect(calculerTotaux([], [], [])).toEqual({ total_minutes: 0, par_projet: {}, quotites: {}, taux_forfaitaire: {} });
  });
});

describe('verifierCoherence', () => {
  const lignes = [
    { date: '2026-09-04', duree_minutes: 60 },
    { date: '2026-09-08', duree_minutes: 45 },
  ];

  test('aucune anomalie → conforme', () => {
    const c = verifierCoherence({ lignes, leaves: [], weeklyHours: 35, annee: 2026, mois: 9 });
    expect(c).toEqual({ conforme: true, anomalies: [] });
  });

  test('une ligne un jour d’absence → anomalie `jour_absence`, jamais une exception', () => {
    const c = verifierCoherence({
      lignes,
      leaves: [{ type_category: 'sick', start_date: '2026-09-07', end_date: '2026-09-09' }],
      weeklyHours: 35, annee: 2026, mois: 9,
    });
    expect(c.conforme).toBe(false);
    expect(c.anomalies).toHaveLength(1);
    expect(c.anomalies[0]).toMatchObject({ date: '2026-09-08', type: 'jour_absence' });
  });

  test('les congés payés comptent aussi (un jour de congé n’est pas travaillé)', () => {
    const c = verifierCoherence({
      lignes, leaves: [{ type_category: 'holiday', start_date: '2026-09-04', end_date: '2026-09-04' }],
      weeklyHours: 35, annee: 2026, mois: 9,
    });
    expect(c.anomalies.map((a) => a.date)).toEqual(['2026-09-04']);
  });

  test('le libellé de paie n’est JAMAIS repris dans l’anomalie (seule la catégorie)', () => {
    const c = verifierCoherence({
      lignes,
      leaves: [{ type_category: 'sick', leave_type: 'Arrêt maladie — affection longue durée', start_date: '2026-09-04', end_date: '2026-09-04' }],
      weeklyHours: 35, annee: 2026, mois: 9,
    });
    expect(c.anomalies[0].detail).not.toMatch(/affection longue durée/i);
    expect(c.anomalies[0].detail).toMatch(/arrêt de travail/);
  });

  test('un même jour n’est signalé qu’une fois même avec plusieurs lignes', () => {
    const c = verifierCoherence({
      lignes: [{ date: '2026-09-04', duree_minutes: 60 }, { date: '2026-09-04', duree_minutes: 30 }],
      leaves: [{ type_category: 'absence', start_date: '2026-09-04', end_date: null }],
      weeklyHours: 35, annee: 2026, mois: 9,
    });
    expect(c.anomalies).toHaveLength(1);
  });

  test('dépassement du temps contractuel — le plafond et sa base sont ÉCRITS', () => {
    // 35 h × 30/7 semaines = 150 h → 10 000 min dépassent largement.
    const c = verifierCoherence({
      lignes: [{ date: '2026-09-04', duree_minutes: 10000 }],
      leaves: [], weeklyHours: 35, annee: 2026, mois: 9,
    });
    const a = c.anomalies.find((x) => x.type === 'depassement_contractuel');
    expect(a).toBeDefined();
    expect(a.detail).toMatch(/35 h par semaine/);
    expect(a.detail).toMatch(/4,29 semaines|4.29 semaines/);
    expect(a.detail).not.toMatch(/retenues par défaut/);
  });

  test('quotité inconnue → repli 35 h, ET le repli est DIT dans l’anomalie', () => {
    const c = verifierCoherence({
      lignes: [{ date: '2026-09-04', duree_minutes: 10000 }],
      leaves: [], weeklyHours: null, annee: 2026, mois: 9,
    });
    const a = c.anomalies.find((x) => x.type === 'depassement_contractuel');
    expect(a.detail).toMatch(/quotité contractuelle inconnue, 35 h retenues par défaut/);
    expect(HEURES_HEBDO_DEFAUT).toBe(35);
  });

  test('une quotité partielle abaisse le plafond (26 h ne se juge pas comme 35 h)', () => {
    // 26 h × 4,286 sem = 111,4 h = 6 686 min → 7 000 min dépassent, 6 000 non.
    const dep = verifierCoherence({ lignes: [{ date: '2026-09-04', duree_minutes: 7000 }], leaves: [], weeklyHours: 26, annee: 2026, mois: 9 });
    const ok = verifierCoherence({ lignes: [{ date: '2026-09-04', duree_minutes: 6000 }], leaves: [], weeklyHours: 26, annee: 2026, mois: 9 });
    expect(dep.anomalies.some((a) => a.type === 'depassement_contractuel')).toBe(true);
    expect(ok.anomalies.some((a) => a.type === 'depassement_contractuel')).toBe(false);
  });

  test('aucune anomalie ne LÈVE quoi que ce soit : la fonction rend toujours un objet', () => {
    expect(() => verifierCoherence({})).not.toThrow();
    expect(verifierCoherence({})).toEqual({ conforme: true, anomalies: [] });
  });
});
