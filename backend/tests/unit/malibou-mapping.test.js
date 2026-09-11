/**
 * Conversion Malibou → SOLIDATA : ce qui entre dans les dossiers du personnel.
 *
 * Les charges de test reproduisent la spécification OpenAPI v1.11.0 telle
 * qu'elle est — y compris les champs que le convertisseur doit REFUSER de
 * lire. Un test qui ne leur donnerait jamais l'occasion d'entrer ne prouverait
 * rien.
 */
const {
  categorieAbsence, codeAbsenceConnu, jourIso, sexeDepuisTitre,
  mapperCollaborateur, mapperAbsence, indexerMatricules, CATEGORIE_PAR_CODE,
  LIBELLE_PAR_CODE, libelleAbsence,
} = require('../../src/services/malibou-mapping');

/** Un collaborateur tel que l'API le rend, scopes détaillés compris. */
function collaborateurApi(extra = {}) {
  return {
    id: 'clb_9f3',
    status: 'active',
    isProfileComplete: true,
    personnelNumber: '00042',
    title: 'mrs',
    firstName: 'Amina',
    lastName: 'Bensalem',
    email: 'a.bensalem@solidarite-textiles.fr',
    birthName: 'Haddad',
    secondaryEmail: 'amina.perso@example.fr',
    phoneNumber: '+33612345678',
    birthDate: '1988-03-17T00:00:00.000Z',
    birthCity: 'Rouen',
    nationality: 'fr',
    address: { street: '12 rue des Lilas', city: 'Le Houlme', zipCode: '76770', country: 'fr' },
    seniorityDate: '2024-09-02T00:00:00.000Z',
    // ── Les trois champs que le convertisseur ne doit JAMAIS lire ──
    ssn: '2880376540123 45',
    socialSecurityNumber: '2880376540123 45',
    bankAccount: { iban: 'FR7630001007941234567890185', bic: 'BNPAFRPP' },
    manager: { collaboratorId: 'clb_aa1' },
    team: { id: 'tm_3', name: 'Tri' },
    currentContract: { id: 'ct_7', startDate: '2026-01-06T00:00:00.000Z', natureContrat: 'fixed_term', estCadre: false },
    ...extra,
  };
}

describe('minimisation — la liste blanche tient', () => {
  const index = indexerMatricules([{ id: 'clb_aa1', personnelNumber: '00007' }]);
  const sortie = mapperCollaborateur(collaborateurApi(), { matriculeParId: index });
  const serialise = JSON.stringify(sortie);

  it.each([
    ['numéro de sécurité sociale', '2880376540123 45'],
    ['IBAN', 'FR7630001007941234567890185'],
    ['BIC', 'BNPAFRPP'],
  ])('%s : absent de la sortie', (_nom, valeur) => {
    expect(serialise).not.toContain(valeur);
  });

  it('aucune clé de la sortie n\'évoque un identifiant bancaire ou social', () => {
    const cles = Object.keys(sortie).join(' ');
    expect(cles).not.toMatch(/ssn|social|iban|bic|bank/i);
  });

  it('un champ AJOUTÉ demain par Malibou n\'entre pas tout seul', () => {
    // C'est la propriété que seule une liste blanche procure : rien n'a été
    // écrit pour exclure `taxIdentificationNumber`, et il n'entre pas.
    const s = mapperCollaborateur(collaborateurApi({ taxIdentificationNumber: 'FR-TVA-999' }), { matriculeParId: index });
    expect(JSON.stringify(s)).not.toContain('FR-TVA-999');
  });
});

describe('identité et emploi', () => {
  const index = indexerMatricules([
    { id: 'clb_aa1', personnelNumber: '00007' },
    { id: 'clb_9f3', personnelNumber: '00042' },
  ]);

  it('reprend le matricule comme clé de rapprochement', () => {
    expect(mapperCollaborateur(collaborateurApi(), { matriculeParId: index }).malibou_id).toBe('00042');
  });

  it('résout le manager en MATRICULE, pas en identifiant interne', () => {
    const s = mapperCollaborateur(collaborateurApi(), { matriculeParId: index });
    expect(s.manager_malibou_id).toBe('00007');
    expect(s.manager_malibou_id).not.toBe('clb_aa1');
  });

  it('rend null quand le manager est hors de l\'index plutôt qu\'une clé inexploitable', () => {
    const s = mapperCollaborateur(collaborateurApi({ manager: { collaboratorId: 'clb_inconnu' } }), { matriculeParId: index });
    expect(s.manager_malibou_id).toBeNull();
  });

  it.each([
    ['active', true],
    ['past', false],
    // Une embauche signée mais pas commencée n'est pas dans les effectifs :
    // elle ne doit compter ni aux ETP ni au portefeuille de la CIP.
    ['future', false],
  ])('statut « %s » → actif %s', (status, attendu) => {
    expect(mapperCollaborateur(collaborateurApi({ status }), { matriculeParId: index }).is_active).toBe(attendu);
  });

  it.each([
    ['permanent', 'CDI'],
    ['fixed_term', 'CDD'],
    ['work_study', 'apprentissage'],
    ['internship', 'stage'],
    ['freelance', null],
    ['external_staff', null],
  ])('nature « %s » → %s', (nature, attendu) => {
    const s = mapperCollaborateur(
      collaborateurApi({ currentContract: { id: 'x', startDate: '2026-01-06T00:00:00Z', natureContrat: nature } }),
      { matriculeParId: index },
    );
    expect(s.contract_type).toBe(attendu);
  });

  it('ne requalifie JAMAIS un fixed_term en CDDI — l\'API ne peut pas le savoir', () => {
    const s = mapperCollaborateur(collaborateurApi(), { matriculeParId: index });
    expect(s.contract_type).toBe('CDD');
    expect(s.contract_type).not.toBe('CDDI');
  });

  it('laisse heures hebdo et poste ABSENTS plutôt que de les inventer', () => {
    const s = mapperCollaborateur(collaborateurApi(), { matriculeParId: index });
    // Absents de la sortie ⇒ la fusion COALESCE conserve ce que le classeur a posé.
    expect(s.weekly_hours).toBeUndefined();
    expect(s.qualification).toBeUndefined();
  });

  it('ne remonte ni nationalité ni pays : le code ISO écraserait un libellé lisible', () => {
    const s = mapperCollaborateur(collaborateurApi(), { matriculeParId: index });
    expect(s.nationality).toBeUndefined();
    expect(s.country).toBeUndefined();
    expect(s.city).toBe('Le Houlme'); // le reste de l'adresse passe bien
  });

  it('prend la fin de contrat la plus tardive du tableau détaillé', () => {
    const s = mapperCollaborateur(collaborateurApi(), {
      matriculeParId: index,
      contrats: [
        { contractId: 'a', startDate: '2026-01-06T00:00:00Z', endDate: '2026-06-30T00:00:00Z' },
        { contractId: 'b', startDate: '2026-07-01T00:00:00Z', endDate: '2026-12-31T00:00:00Z' },
      ],
    });
    expect(s.contract_end).toBe('2026-12-31');
  });

  it('un CDI sans terme laisse la fin à null, jamais à une date inventée', () => {
    const s = mapperCollaborateur(collaborateurApi(), {
      matriculeParId: index,
      contrats: [{ contractId: 'a', startDate: '2020-01-06T00:00:00Z', endDate: null }],
    });
    expect(s.contract_end).toBeNull();
  });
});

describe('dates — le piège du fuseau', () => {
  /**
   * Le fuseau s'éprouve dans un VRAI processus, pas en réassignant `process.env.TZ`.
   *
   * Jest fige le fuseau à l'initialisation de son environnement : changer la
   * variable en cours de test ne change rien à son objet `Date`. La première
   * version de ce test faisait exactement cela — elle passait aussi bien avec
   * la bonne implémentation qu'avec celle qui construit un `Date`, c'est-à-dire
   * qu'elle ne prouvait rien, sur le seul piège que ce projet s'est déjà pris
   * trois fois (jour civil des tournées 2.24.1, horaires VAK 2.20.0, pause
   * déjeuner 2.47.0). La contre-épreuve par mutation l'a démasquée.
   */
  const { execFileSync } = require('child_process');
  const moduleTeste = require.resolve('../../src/services/malibou-mapping');

  const jourIsoDansFuseau = (tz, iso) => execFileSync(
    process.execPath,
    ['-e', `process.stdout.write(String(require(${JSON.stringify(moduleTeste)}).jourIso(${JSON.stringify(iso)})))`],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8' },
  );

  it.each([
    ['Pacific/Niue'],        // UTC-11 : un minuit UTC y tombe la VEILLE
    ['Pacific/Kiritimati'],  // UTC+14 : l'autre extrême
    ['Europe/Paris'],        // le fuseau réel de la structure
    ['UTC'],                 // celui du conteneur
  ])('rend le jour écrit dans la charge, même en %s', (tz) => {
    expect(jourIsoDansFuseau(tz, '1988-03-17T00:00:00.000Z')).toBe('1988-03-17');
  });

  it('ne construit AUCUN objet Date — la garde couvre les réécritures futures', () => {
    const source = require('fs').readFileSync(moduleTeste, 'utf8');
    const debut = source.indexOf('function jourIso(');
    const corps = source.slice(debut, source.indexOf('\n}', debut));
    expect(corps).not.toMatch(/new Date|Date\.parse|toLocale|getFullYear/);
  });

  it('refuse ce qui n\'est pas une date plutôt que de rendre du n\'importe quoi', () => {
    expect(jourIso('bientôt')).toBeNull();
    expect(jourIso('')).toBeNull();
    expect(jourIso(null)).toBeNull();
  });
});

describe('civilité', () => {
  it.each([['mr', 'M'], ['mrs', 'F'], ['MRS', 'F'], ['dr', null], ['', null], [null, null]])(
    '« %s » → %s', (t, attendu) => expect(sexeDepuisTitre(t)).toBe(attendu),
  );
});

describe('absences — la catégorie a des conséquences chiffrées', () => {
  const { deduitDuRealise } = require('../../src/utils/absences');

  it('les congés payés et les repos compensateurs ne déduisent PAS du réalisé', () => {
    // C'est la seule chose que le moteur ETP regarde : holiday ne déduit pas,
    // sick et absence déduisent. Classer un congé payé en « absence »
    // sous-estimerait nos ETP devant le financeur.
    for (const code of ['conge_paye', 'rtt', 'rcr', 'rco']) {
      expect(categorieAbsence(code)).toBe('holiday');
      expect(deduitDuRealise(categorieAbsence(code))).toBe(false);
    }
  });

  it('la maladie, les accidents et les absences non rémunérées déduisent', () => {
    for (const code of [
      'maladie_non_professionnelle', 'enfant_malade', 'maladie_professionnelle',
      'accident_du_travail', 'maternite', 'paternite',
      'absence_non_remuneree_autorisee', 'absence_non_remuneree_non_autorisee',
      'mise_a_pied_disciplinaire', 'autre',
    ]) {
      expect(deduitDuRealise(categorieAbsence(code))).toBe(true);
    }
  });

  it('« Jour de récupération » et « Jour de repos » déduisent — À ARBITRER', () => {
    // Ce test ne dit pas que c'est JUSTE : il dit que c'est le comportement
    // ACTUEL, et il le fige pour qu'on ne le change pas par inadvertance.
    // Ces deux types rémunèrent des heures DÉJÀ travaillées, comme le repos
    // compensateur qui, lui, ne déduit pas. La règle de l'import du classeur
    // est conservée telle quelle pour ne modifier aucun chiffre déjà déclaré.
    // Voir la note « À ARBITRER » de `utils/absences.js`.
    for (const code of ['recuperation', 'repos']) {
      expect(deduitDuRealise(categorieAbsence(code))).toBe(true);
    }
  });

  it('un code INCONNU déduit — sous-estimer nos ETP coûte moins que les surestimer', () => {
    expect(categorieAbsence('custom_journee_solidarite')).toBe('absence');
    expect(categorieAbsence(undefined)).toBe('absence');
    expect(codeAbsenceConnu('custom_journee_solidarite')).toBe(false);
    expect(codeAbsenceConnu('conge_paye')).toBe(true);
  });

  it('la table ne rend que les trois catégories acceptées par la base', () => {
    const valides = new Set(['holiday', 'sick', 'absence']);
    for (const v of Object.values(CATEGORIE_PAR_CODE)) expect(valides.has(v)).toBe(true);
  });

  it('convertit une absence complète', () => {
    const a = mapperAbsence({
      id: 'abs_1', collaboratorId: 'clb_9f3',
      startDate: '2026-02-10', endDate: '2026-02-14',
      createdAt: '2026-02-01T09:12:00.000Z',
      startHalfDay: true, endHalfDay: false,
      status: 'approved', type: 'conge_paye',
    });
    expect(a).toMatchObject({
      collaborator_id_malibou: 'clb_9f3',
      // Le LIBELLÉ, pas le code : c'est lui qui fait la clé naturelle.
      leave_type: 'Congés Payés',
      code_malibou: 'conge_paye',
      type_category: 'holiday',
      start_date: '2026-02-10',
      end_date: '2026-02-14',
      half_day_start: true,
      half_day_end: false,
      statut: 'approved',
      request_date: '2026-02-01',
      source: 'malibou_api',
    });
  });

  it('un type propre à l\'organisation garde son code faute de mieux', () => {
    // Inventer un libellé français pour un `custom_*` ne ferait que déplacer
    // le problème : il ne correspondrait à rien de ce que l'export écrit.
    const a = mapperAbsence({
      id: 'x', collaboratorId: 'c', startDate: '2026-02-10', type: 'custom_journee_solidarite',
    });
    expect(a.leave_type).toBe('custom_journee_solidarite');
    expect(a.type_connu).toBe(false);
  });

  it('écarte une absence sans date de début plutôt que d\'écrire une ligne muette', () => {
    expect(mapperAbsence({ id: 'x', collaboratorId: 'c', endDate: '2026-02-14' })).toBeNull();
  });

  it('une absence sans type (scope manquant) reste exploitable et dit son ignorance', () => {
    const a = mapperAbsence({ id: 'x', collaboratorId: 'c', startDate: '2026-02-10', status: 'approved' });
    expect(a.leave_type).toBe('inconnu');
    expect(a.type_connu).toBe(false);
    expect(a.type_category).toBe('absence');
  });
});

describe('libellés — la clé naturelle des absences est du TEXTE', () => {
  /**
   * POURQUOI CE BLOC EXISTE. `employee_leaves` a pour clé unique
   * (salarié, leave_type, date de début) — vérifié dans `init-db.js`. L'import
   * du classeur de paie y écrit le libellé français de sa colonne « Type »
   * (« Congés Payés ») ; l'API, elle, ne connaît que des codes
   * (« conge_paye »). Écrire le code créerait donc une SECONDE ligne pour la
   * MÊME absence, et le réalisé du calcul ETP — qui additionne les jours de
   * chaque ligne — compterait l'absence deux fois. Nos ETP paraîtraient plus
   * faibles qu'ils ne sont devant le financeur.
   *
   * On converge donc sur les libellés que Malibou publie lui-même. La fixture
   * est extraite MÉCANIQUEMENT de la spécification, pour que l'ajout d'un type
   * chez Malibou fasse tomber la suite au lieu de passer inaperçu.
   */
  const spec = require('../fixtures/malibou-types-absence.json').types;

  it('connaît exactement les types publiés, ni plus ni moins', () => {
    expect(Object.keys(LIBELLE_PAR_CODE).sort()).toEqual(Object.keys(spec).sort());
    expect(Object.keys(CATEGORIE_PAR_CODE).sort()).toEqual(Object.keys(spec).sort());
  });

  it('rend le libellé EXACT de la spécification pour chaque type', () => {
    for (const [code, { libelle }] of Object.entries(spec)) {
      expect(libelleAbsence(code)).toBe(libelle);
    }
  });

  it('la catégorie de chaque type reste dans l\'énumération de la base', () => {
    const valides = new Set(['holiday', 'sick', 'absence']);
    for (const code of Object.keys(spec)) expect(valides.has(categorieAbsence(code))).toBe(true);
  });

  it('s\'accorde avec la catégorisation de l\'import du classeur', () => {
    // Les deux voies écrivent la MÊME ligne : si elles ne s'accordaient pas
    // sur la catégorie, l'absence changerait de nature selon qui l'a importée
    // en dernier — un congé payé deviendrait une absence qui déduit.
    const { categorizeLeaveType } = require('../../src/services/collaborator-import');
    const desaccords = [];
    for (const [code, { libelle }] of Object.entries(spec)) {
      const parCode = categorieAbsence(code);
      const parLibelle = categorizeLeaveType(libelle);
      if (parCode !== parLibelle) desaccords.push(`${code} : API=${parCode} / classeur=${parLibelle} (« ${libelle} »)`);
    }
    expect(desaccords).toEqual([]);
  });

  it('un code inconnu ne prend pas le libellé d\'un autre', () => {
    expect(libelleAbsence('custom_x')).toBe('custom_x');
    expect(libelleAbsence(null)).toBe('inconnu');
    expect(libelleAbsence('  CONGE_PAYE ')).toBe('Congés Payés'); // casse et espaces tolérés
  });
});

describe('robustesse', () => {
  it('une charge absente ne fait pas tomber le convertisseur', () => {
    expect(mapperCollaborateur(null)).toBeNull();
    expect(mapperCollaborateur('pas un objet')).toBeNull();
    expect(mapperAbsence(null)).toBeNull();
  });

  it('un collaborateur au strict minimum (scope de base) passe', () => {
    const s = mapperCollaborateur({
      id: 'c1', status: 'active', isProfileComplete: false, personnelNumber: '1',
      title: null, firstName: 'Jean', lastName: 'Dupont', email: 'j@x.fr',
    });
    expect(s).toMatchObject({ malibou_id: '1', first_name: 'Jean', last_name: 'Dupont', is_active: true });
    expect(s.address).toBeNull();
    expect(s.gender).toBeNull();
  });

  it('une chaîne vide ne devient jamais une valeur qui écraserait l\'existant', () => {
    const s = mapperCollaborateur({ id: 'c', status: 'past', personnelNumber: '  ', firstName: 'A', lastName: 'B', birthCity: '   ' });
    expect(s.malibou_id).toBeNull();
    expect(s.birth_city).toBeNull();
  });
});
