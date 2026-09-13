// ═══════════════════════════════════════════════════════════════════════════
// UNITAIRE — fiche pour le référent et relevé d'assiduité (PR B, lot 3)
// ───────────────────────────────────────────────────────────────────────────
// `pg` est simulé : chaque requête du service reçoit sa réponse, et on inspecte
// CE QUI SORT. C'est le seul angle qui compte ici : ces deux documents quittent
// la structure vers un tiers qui peut décider d'une suspension de droits.
//
// Ce que ces tests tiennent :
//   1. LISTE BLANCHE EXACTE — neuf clés de premier niveau, pas une de plus.
//      Une liste NOIRE laisserait passer le prochain champ ajouté au dossier.
//   2. SANTÉ ET JUDICIAIRE STRUCTURELLEMENT ABSENTS — pas de clé, pas de valeur
//      nulle, pas de mention « rubrique retirée » : signaler l'exclusion
//      désignerait la personne comme ayant quelque chose à cacher.
//   3. ACTIONS SENSIBLES RETIRÉES LIGNE ENTIÈRE — masquer le seul libellé
//      laisserait la date, le partenaire et le résultat, de quoi reconstituer.
//   4. AUCUN LIBELLÉ DE PAIE — seule `type_category` est lue ; `leave_type`
//      peut nommer une pathologie.
//   5. « MOTIF NON RENSEIGNÉ » ET JAMAIS « INJUSTIFIÉE ».
// ═══════════════════════════════════════════════════════════════════════════

const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({ query: (...a) => mockQuery(...a) }));

const {
  composerFicheReferent, composerReleveAssiduite, composerTotauxAssiduite,
  composerFreinsPeriode, FICHE_CLES, FREINS_TRANSMISSIBLES, FREINS_EXCLUS, TYPE_LABELS,
} = require('../../../src/services/fiche-referent');

const EMP = {
  id: 5, first_name: 'Amine', last_name: 'BENALI', malibou_id: 'M-0912', weekly_hours: 26,
  parcours_num: 1,
  pass_iae_number: '2026-03-0441', pass_iae_start: '2026-03-01', pass_iae_end: '2028-02-29',
  pass_iae_statut: 'actif',
  referent_unique_type: 'cms', referent_unique_nom: 'Mme L. (CMS Elbeuf)', referent_unique_contact: '02 35 00 00 00',
  insertion_start_date: '2026-03-01', insertion_end_date: null,
  contract_type: 'CDD', contrat_debut: '2026-03-01', contrat_fin: '2026-09-30', contrat_heures: 26,
  cip_nom: 'Claire MARTIN', cip_email: 'claire.martin@solidarite-textiles.fr',
};

/** Aiguillage du faux `pg`. `over` surcharge une source précise. */
function branche(over = {}) {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (/FROM employees e\s+LEFT JOIN employee_contracts/.test(s)) return Promise.resolve({ rows: over.employees ?? [EMP] });
    // Les trois requêtes sur `insertion_milestones` se distinguent par leur
    // projection, jamais par leur ordre : un aiguillage positionnel casserait
    // au premier remaniement de requête.
    if (/absence_motif/.test(s)) return Promise.resolve({ rows: over.entretiens ?? [] });
    if (/frein_mobilite/.test(s)) return Promise.resolve({ rows: over.freins ?? [] });
    if (/FROM insertion_milestones/.test(s)) return Promise.resolve({ rows: over.prochains ?? [] });
    if (/FROM cip_action_plans/.test(s)) return Promise.resolve({ rows: over.actions ?? [] });
    if (/FROM insertion_objectifs/.test(s)) return Promise.resolve({ rows: over.objectifs ?? [] });
    if (/FROM employee_leaves/.test(s)) return Promise.resolve({ rows: over.conges ?? [] });
    if (/FROM employee_week_hours/.test(s)) return Promise.resolve({ rows: over.weekHours ?? [] });
    if (/FROM insertion_pmsmp/.test(s)) return Promise.resolve({ rows: over.pmsmp ?? [] });
    if (/FROM settings/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM users/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  branche();
});

const PERIODE = { employeeId: 5, du: '2026-03-01', au: '2026-06-30', userId: 7 };

// ───────────────────────────────────────────────────────────────────────────
describe('1. liste blanche exacte', () => {
  test('exactement NEUF clés de premier niveau, dans l’ordre du contrat', () => {
    // Le test porte sur l'ÉGALITÉ de l'ensemble, pas sur une inclusion : une
    // dixième rubrique ajoutée demain fait tomber ce test, ce qui est le but.
    expect(FICHE_CLES).toEqual([
      'identite', 'situation_emploi', 'activite', 'assiduite',
      'freins', 'actions', 'objectifs', 'prochaines_echeances', 'mentions',
    ]);
  });

  test('la fiche produite ne porte QUE ces neuf clés', async () => {
    const f = await composerFicheReferent(PERIODE);
    expect(Object.keys(f).sort()).toEqual([...FICHE_CLES].sort());
  });

  test('salarié introuvable → null (jamais une fiche vide qui partirait quand même)', async () => {
    branche({ employees: [] });
    expect(await composerFicheReferent(PERIODE)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('2. santé et judiciaire — structurellement absents', () => {
  test('les axes transmissibles sont les 7 non sensibles du registre', () => {
    expect(FREINS_TRANSMISSIBLES.map((f) => f.key)).toEqual([
      'mobilite', 'finances', 'famille', 'linguistique', 'administratif', 'numerique', 'logement',
    ]);
    expect(FREINS_EXCLUS.sort()).toEqual(['judiciaire', 'sante']);
  });

  test('AUCUNE clé « sante » ni « judiciaire » dans les freins — pas même à null', async () => {
    branche({
      freins: [{
        completed_date: '2026-04-10',
        frein_mobilite: 4, frein_finances: 3, frein_famille: 2, frein_linguistique: 1,
        frein_administratif: 2, frein_numerique: 3, frein_logement: 5,
        // Ces deux-là sont dans la LIGNE de base mais ne doivent jamais être
        // LUS : ils ne figurent pas dans la projection SQL du service.
        frein_sante: 5, frein_judiciaire: 4,
      }],
    });
    const f = await composerFicheReferent(PERIODE);
    const axes = f.freins.map((x) => x.axe);
    expect(axes).not.toContain('sante');
    expect(axes).not.toContain('judiciaire');
    expect(axes).toHaveLength(7);
    // Et le service ne les demande même pas à la base.
    const sqlFreins = mockQuery.mock.calls.map(([s]) => String(s)).find((s) => /frein_mobilite/.test(s));
    expect(sqlFreins).not.toMatch(/frein_sante/);
    expect(sqlFreins).not.toMatch(/frein_judiciaire/);
  });

  test('ni le mot « judiciaire » ni le niveau de santé n’apparaissent dans la fiche sérialisée', async () => {
    branche({
      freins: [{ completed_date: '2026-04-10', frein_mobilite: 4, frein_sante: 5, frein_judiciaire: 4 }],
    });
    const json = JSON.stringify(await composerFicheReferent(PERIODE));
    expect(json).not.toMatch(/judiciaire/i);
    expect(json).not.toMatch(/frein_sante/);
  });

  test('un axe jamais évalué rend deux null — jamais un niveau 1 (« aucune difficulté »)', async () => {
    const f = await composerFicheReferent(PERIODE);
    for (const axe of f.freins) {
      expect(axe.niveau_debut).toBeNull();
      expect(axe.niveau_fin).toBeNull();
    }
  });

  test('premier et dernier niveau RENSEIGNÉS de la période', () => {
    const r = composerFreinsPeriode([], [
      { frein_mobilite: null, frein_logement: 5 },
      { frein_mobilite: 4, frein_logement: null },
      { frein_mobilite: 2, frein_logement: 3 },
    ]);
    const mob = r.find((x) => x.axe === 'mobilite');
    expect(mob).toMatchObject({ niveau_debut: 4, niveau_fin: 2 });
    const log = r.find((x) => x.axe === 'logement');
    expect(log).toMatchObject({ niveau_debut: 5, niveau_fin: 3 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('3. actions rattachées à un frein sensible — retirées LIGNE ENTIÈRE', () => {
  test('le filtre part en SQL, avec les deux clés sensibles en paramètre', async () => {
    await composerFicheReferent(PERIODE);
    const appel = mockQuery.mock.calls.find(([s]) => /FROM cip_action_plans/.test(String(s)));
    expect(String(appel[0])).toMatch(/frein_type IS NULL OR NOT \(a\.frein_type = ANY/);
    // Les deux clés sensibles partent en PARAMÈTRE (jamais interpolées) et
    // viennent du registre des freins, pas d'une liste recopiée ici.
    expect(appel[1][3]).toEqual(expect.arrayContaining(['sante', 'judiciaire']));
  });

  test('les notes d’une action ne sont jamais lues ni transmises', async () => {
    branche({
      actions: [{
        id: 1, action_label: 'Rendez-vous Mission locale', category: 'insertion',
        frein_type: null, status: 'realise', date_realisation: '2026-04-02',
        resultat: 'Dossier déposé', partenaire_nom: 'Mission locale de Rouen',
      }],
    });
    const f = await composerFicheReferent(PERIODE);
    expect(f.actions).toEqual([{
      date: '2026-04-02', nature: 'insertion', partenaire: 'Mission locale de Rouen',
      orientation_dora: false, resultat: 'Dossier déposé',
    }]);
    expect(Object.keys(f.actions[0])).not.toContain('notes');
    const sqlActions = mockQuery.mock.calls.map(([s]) => String(s)).find((s) => /FROM cip_action_plans/.test(s));
    expect(sqlActions).not.toMatch(/a\.notes/);
  });

  test('orientation DORA reconnue au nom du partenaire — false quand on ne sait pas', async () => {
    branche({
      actions: [
        { id: 1, category: 'insertion', date_realisation: '2026-04-02', partenaire_nom: 'DORA — service de mobilité' },
        { id: 2, category: 'insertion', date_realisation: '2026-04-03', partenaire_nom: 'CCAS' },
        { id: 3, category: 'insertion', date_realisation: '2026-04-04', partenaire_nom: null },
      ],
    });
    const f = await composerFicheReferent(PERIODE);
    expect(f.actions.map((a) => a.orientation_dora)).toEqual([true, false, false]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('4. assiduité — jamais « injustifiée », jamais un libellé de paie', () => {
  const entretiens = [
    { id: 1, milestone_type: 'bilan_intermediaire', status: 'realise', completed_date: '2026-03-10', presence: 'present' },
    { id: 2, milestone_type: 'bilan_intermediaire', status: 'realise', completed_date: '2026-04-10', presence: 'absent', absence_motif: 'transport' },
    { id: 3, milestone_type: 'bilan_intermediaire', status: 'realise', completed_date: '2026-05-10', presence: 'absent', absence_motif: null },
    { id: 4, milestone_type: 'bilan_intermediaire', status: 'realise', completed_date: '2026-06-10', presence: 'excuse', absence_motif: 'sante' },
    { id: 5, milestone_type: 'bilan_intermediaire', status: 'a_planifier', due_date: '2026-06-20' },
  ];

  test('totaux : l’entretien « à planifier » n’est pas un rendez-vous proposé', () => {
    const t = composerTotauxAssiduite(entretiens);
    expect(t.rdv_proposes).toBe(4);
    expect(t.rdv_honores).toBe(1);
    expect(t.absents).toBe(2);
    expect(t.excuses).toBe(1);
  });

  test('une absence sans motif tombe dans « sans_motif » — jamais dans « autre »', () => {
    const t = composerTotauxAssiduite(entretiens);
    expect(t.absences_par_motif).toEqual({
      sante: 1, administratif: 0, garde: 0, transport: 1, autre: 0, sans_motif: 1,
    });
  });

  test('une présence NON RENSEIGNÉE n’est pas comptée comme honorée', () => {
    const t = composerTotauxAssiduite([
      { status: 'realise', presence: null },
      { status: 'realise', presence: 'present' },
    ]);
    expect(t.rdv_proposes).toBe(2);
    expect(t.rdv_honores).toBe(1); // et non 2 : on ne sait pas pour le premier
  });

  test('la rubrique assiduité de la fiche porte exactement trois clés', async () => {
    branche({ entretiens });
    const f = await composerFicheReferent(PERIODE);
    expect(Object.keys(f.assiduite).sort()).toEqual(['absences_par_motif', 'rdv_honores', 'rdv_proposes']);
  });

  test('relevé : les absences de paie ne portent QUE leur catégorie', async () => {
    branche({
      conges: [{ type_category: 'sick', leave_type: 'Arrêt maladie — affection longue durée', start_date: '2026-04-01', end_date: '2026-04-10' }],
    });
    const r = await composerReleveAssiduite({ employeeId: 5, du: '2026-03-01', au: '2026-06-30' });
    expect(r.absences_paie).toEqual([{ du: '2026-04-01', au: '2026-04-10', categorie: 'sick' }]);
    expect(JSON.stringify(r)).not.toMatch(/affection longue durée/);
    // Le libellé n'est même pas demandé à la base.
    const sqlConges = mockQuery.mock.calls.map(([s]) => String(s)).find((s) => /FROM employee_leaves/.test(s));
    expect(sqlConges).not.toMatch(/leave_type/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('5. relevé d’assiduité — variantes tiers et dossier', () => {
  const avecPiece = [{
    id: 2, milestone_type: 'bilan_intermediaire', titre: null, status: 'realise',
    completed_date: '2026-04-10', presence: 'absent', absence_motif: 'sante',
    absence_piece_ref: 'Certificat du Dr Durand — 10/04',
  }];

  test('variante tiers (défaut) : la référence de pièce n’est ni lue ni rendue', async () => {
    branche({ entretiens: avecPiece });
    const r = await composerReleveAssiduite({ employeeId: 5, du: '2026-03-01', au: '2026-06-30' });
    expect(r.variante).toBe('tiers');
    expect(Object.keys(r.entretiens[0])).not.toContain('absence_piece_ref');
    expect(JSON.stringify(r)).not.toMatch(/Dr Durand/);
    const sqlEnt = mockQuery.mock.calls.map(([s]) => String(s)).find((s) => /absence_motif/.test(s));
    expect(sqlEnt).not.toMatch(/absence_piece_ref/);
  });

  test('variante dossier : la référence figure — c’est elle qui prouve la justification', async () => {
    branche({ entretiens: avecPiece });
    const r = await composerReleveAssiduite({ employeeId: 5, du: '2026-03-01', au: '2026-06-30', variante: 'dossier' });
    expect(r.variante).toBe('dossier');
    expect(r.entretiens[0].absence_piece_ref).toBe('Certificat du Dr Durand — 10/04');
  });

  test('les deux nouveaux types d’entretien ont un libellé français', () => {
    expect(TYPE_LABELS.point_etape_referent).toBe('Point avec le référent');
    expect(TYPE_LABELS.conciliation).toBe('Entretien de conciliation (protection des droits)');
    // Les six types historiques restent servis par engine.js.
    expect(TYPE_LABELS.diagnostic_accueil).toBe("Diagnostic d'accueil");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('6. activité transmise — un volume, jamais un jugement', () => {
  test('les semaines transmises ne portent ni « sous_seuil » ni « arret_declare »', async () => {
    branche({
      weekHours: [{ iso_year: 2026, iso_week: 12, hours_worked: 10, hours_contract: 26 }],
    });
    const f = await composerFicheReferent(PERIODE);
    expect(f.activite.semaines.length).toBeGreaterThan(0);
    for (const s of f.activite.semaines) {
      expect(Object.keys(s).sort()).toEqual(['heures_travail', 'iso_week', 'jours_pmsmp', 'minutes_accompagnement']);
    }
    // L'indicateur de volume, lui, est transmis : c'est ce que l'autorité
    // demande (amendement A4).
    expect(f.activite.nb_semaines_sous_seuil).toBe(1);
  });

  test('une période à cheval sur deux années couvre les DEUX (jamais une moitié muette)', async () => {
    await composerFicheReferent({ employeeId: 5, du: '2025-11-01', au: '2026-02-28', userId: 7 });
    const annees = mockQuery.mock.calls
      .filter(([s]) => /FROM employee_week_hours/.test(String(s)))
      .map(([, p]) => p[1]);
    expect(annees).toEqual(expect.arrayContaining([2025, 2026]));
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('7. identité et destinataire', () => {
  test('le destinataire et la conseillère sont repris du dossier', async () => {
    const f = await composerFicheReferent(PERIODE);
    expect(f.identite).toMatchObject({
      nom: 'BENALI', prenom: 'Amine', identifiant_interne: 5, matricule: 'M-0912',
      destinataire: { type: 'cms', nom: 'Mme L. (CMS Elbeuf)', contact: '02 35 00 00 00' },
      periode: { du: '2026-03-01', au: '2026-06-30' },
      conseillere: { nom: 'Claire MARTIN' },
    });
  });

  test('la quotité vient du contrat en cours, à défaut de la fiche', async () => {
    expect((await composerFicheReferent(PERIODE)).situation_emploi.quotite_hebdo).toBe(26);
    branche({ employees: [{ ...EMP, contrat_heures: null, weekly_hours: 30 }] });
    expect((await composerFicheReferent(PERIODE)).situation_emploi.quotite_hebdo).toBe(30);
  });

  test('les mentions de droits nomment le DPO et ne sont jamais vides', async () => {
    const f = await composerFicheReferent(PERIODE);
    expect(f.mentions.droits).toMatch(/droit d'accès/);
    expect(f.mentions.droits).toMatch(/protection des données/);
    expect(f.mentions.genere_le).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('une source en panne dégrade sans faire échouer le document', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM employees e\s+LEFT JOIN employee_contracts/.test(s)) return Promise.resolve({ rows: [EMP] });
      if (/FROM insertion_objectifs/.test(s)) return Promise.reject(Object.assign(new Error('relation absente'), { code: '42P01' }));
      return Promise.resolve({ rows: [] });
    });
    const muet = jest.spyOn(console, 'error').mockImplementation(() => {});
    const f = await composerFicheReferent(PERIODE);
    muet.mockRestore();
    expect(f.objectifs).toEqual([]);
    expect(f.identite.nom).toBe('BENALI');
  });
});
