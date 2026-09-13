// ═══════════════════════════════════════════════════════════════════════════
// UNIT — Service « participants FSE+ » (PR A lot 2)
//   backend/src/services/fse-participants.js
// Ce que ces tests verrouillent :
//   - les 9 pièces du dossier de conformité, DANS L'ORDRE, avec leurs 4 états —
//     et surtout « sans objet » pour un parcours en cours (une pièce de sortie
//     n'est pas en retard pour quelqu'un qui est encore là) ;
//   - une sortie saisie sans bilan puis reprise par la clôture d'un bilan
//     produit UNE SEULE ligne, et son horodatage de saisie NE RECULE PAS
//     (sinon la structure s'accuserait d'un retard qu'elle n'a pas eu) ;
//   - les alertes J+15 / J+25, avec anti-doublon.
// DB simulée : aucune connexion PostgreSQL.
// ═══════════════════════════════════════════════════════════════════════════
const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(),
}));

const svc = require('../../../src/services/fse-participants');

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

// ── Contexte minimal d'un salarié, tel que le renvoie chargerContextes ──
const ctxBase = (over = {}) => ({
  employee: {
    id: 5, first_name: 'Inès', last_name: 'Garcia',
    insertion_status: 'en_parcours', insertion_start_date: '2026-09-08',
    parcours_num: 1, contract_end: '2027-03-07',
    pass_iae_number: null, pass_iae_end: null, pass_iae_statut: 'inconnu',
    referent_unique_type: 'non_determine', referent_unique_nom: null,
    eligibilite_verifiee_le: null, eligibilite_criteres: null,
    ...over.employee,
  },
  criteres: over.criteres || [],
  diagnostic: 'diagnostic' in over ? over.diagnostic : null,
  sortie: 'sortie' in over ? over.sortie : null,
  remises: over.remises || 0,
  derniere_remise: over.derniere_remise || null,
  projets: over.projets || [],
});

const REGLAGES = { today: '2026-09-14', delaiDiagnosticJours: 30, postSortieMois: 6 };

describe('composerPieces — les 9 pièces du dossier de conformité', () => {
  it('rend les 9 pièces DANS L’ORDRE de la maquette', () => {
    const p = svc.composerPieces(ctxBase(), REGLAGES);
    expect(p.map((x) => x.cle)).toEqual([
      'eligibilite', 'pass_iae', 'referent_unique', 'fse_entree', 'diagnostic_socle',
      'fse_sortie', 'sortie_delai', 'six_mois', 'remise_documents',
    ]);
    expect(svc.PIECES_ORDRE).toHaveLength(9);
  });

  it('dossier VIDE : les pièces d’entrée sont « à faire », celles de sortie « sans objet »', () => {
    const p = svc.composerPieces(ctxBase(), REGLAGES);
    const etat = Object.fromEntries(p.map((x) => [x.cle, x.etat]));
    expect(etat.eligibilite).toBe('a_faire');
    expect(etat.pass_iae).toBe('a_faire');
    expect(etat.referent_unique).toBe('a_faire');
    expect(etat.fse_entree).toBe('a_faire');
    expect(etat.diagnostic_socle).toBe('a_faire');
    // Le parcours est en cours : rien à reprocher sur la sortie.
    expect(etat.fse_sortie).toBe('sans_objet');
    expect(etat.sortie_delai).toBe('sans_objet');
    expect(etat.six_mois).toBe('sans_objet');
    expect(p.find((x) => x.cle === 'fse_sortie').detail).toBe('parcours en cours');
  });

  it('dossier COMPLET d’un parcours en cours : aucune pièce à faire', () => {
    const ctx = ctxBase({
      employee: {
        pass_iae_number: '2025-07-0918', pass_iae_end: '2027-03-14', pass_iae_statut: 'actif',
        referent_unique_type: 'cms', referent_unique_nom: 'CMS Grand-Quevilly',
        eligibilite_verifiee_le: '2025-07-10',
      },
      criteres: [{ code: 'brsa', libelle: 'Bénéficiaire du RSA' }, { code: 'qpv', libelle: 'Résident en QPV' }],
      diagnostic: {
        statut_saisie: 'complet', fse_entree_complet: true, fse_entree_saisie_at: '2025-08-05',
        fse_entree: { statut_avant_entree: 'demandeur_emploi', duree_sans_emploi: '12_24m', foyer_monoparental: true, sans_domicile_stable: false, ressources_principales: 'rsa' },
      },
      remises: 6, derniere_remise: '2026-06-12',
    });
    const p = svc.composerPieces(ctx, REGLAGES);
    expect(p.filter((x) => x.etat === 'a_faire')).toEqual([]);
    expect(p.find((x) => x.cle === 'eligibilite').detail).toMatch(/2 critères/);
    expect(p.find((x) => x.cle === 'remise_documents').detail).toMatch(/6 remises/);
  });

  it('des critères SANS date de vérification donnent « partiel », jamais « complet »', () => {
    const p = svc.composerPieces(ctxBase({ criteres: [{ code: 'brsa', libelle: 'BRSA' }] }), REGLAGES);
    const e = p.find((x) => x.cle === 'eligibilite');
    expect(e.etat).toBe('partiel');
    expect(e.detail).toMatch(/date de vérification manquante/);
  });

  it('un Pass IAE EXPIRÉ est « à faire », un Pass sans date de fin est « partiel »', () => {
    const exp = svc.composerPieces(ctxBase({ employee: { pass_iae_number: 'X', pass_iae_end: '2026-01-01', pass_iae_statut: 'expire' } }), REGLAGES);
    expect(exp.find((x) => x.cle === 'pass_iae').etat).toBe('a_faire');
    const part = svc.composerPieces(ctxBase({ employee: { pass_iae_number: 'X', pass_iae_end: null, pass_iae_statut: 'actif' } }), REGLAGES);
    expect(part.find((x) => x.cle === 'pass_iae').etat).toBe('partiel');
  });

  it('contrat terminé SANS sortie : la sortie devient « à faire » et le délai est chiffré', () => {
    const ctx = ctxBase({ employee: { contract_end: '2026-08-21', insertion_status: 'termine' } });
    const p = svc.composerPieces(ctx, REGLAGES);
    expect(p.find((x) => x.cle === 'fse_sortie').etat).toBe('a_faire');
    const d = p.find((x) => x.cle === 'sortie_delai');
    expect(d.etat).toBe('a_faire');
    expect(d.detail).toMatch(/24 jour\(s\)/);
  });

  it('sortie saisie DANS le mois → « complet » ; au-delà → « partiel » (le fait reste, la conformité non)', () => {
    const dansLeMois = ctxBase({
      employee: { contract_end: '2026-08-21', insertion_status: 'termine' },
      sortie: { date_sortie: '2026-08-21', saisie_at: '2026-09-01', source: 'sans_bilan', situation_6mois: null },
    });
    expect(svc.composerPieces(dansLeMois, REGLAGES).find((x) => x.cle === 'sortie_delai').etat).toBe('complet');
    const tardive = ctxBase({
      employee: { contract_end: '2026-06-01', insertion_status: 'termine' },
      sortie: { date_sortie: '2026-06-01', saisie_at: '2026-09-01', source: 'sans_bilan', situation_6mois: null },
    });
    expect(svc.composerPieces(tardive, REGLAGES).find((x) => x.cle === 'sortie_delai').etat).toBe('partiel');
  });

  it('le relevé à +6 mois n’est exigible qu’à son échéance', () => {
    const recent = ctxBase({
      employee: { contract_end: '2026-08-21', insertion_status: 'termine' },
      sortie: { date_sortie: '2026-08-21', saisie_at: '2026-08-22', situation_6mois: null },
    });
    const p1 = svc.composerPieces(recent, REGLAGES).find((x) => x.cle === 'six_mois');
    expect(p1.etat).toBe('sans_objet');
    expect(p1.detail).toMatch(/attendu le/);

    const echu = ctxBase({
      employee: { contract_end: '2026-03-10', insertion_status: 'termine' },
      sortie: { date_sortie: '2026-03-10', saisie_at: '2026-03-12', situation_6mois: null },
    });
    expect(svc.composerPieces(echu, REGLAGES).find((x) => x.cle === 'six_mois').etat).toBe('a_faire');

    const releve = ctxBase({
      employee: { contract_end: '2026-03-10', insertion_status: 'termine' },
      sortie: { date_sortie: '2026-03-10', saisie_at: '2026-03-12', situation_6mois: 'emploi_durable', date_releve_6mois: '2026-09-12' },
    });
    expect(svc.composerPieces(releve, REGLAGES).find((x) => x.cle === 'six_mois').etat).toBe('complet');
  });

  it('un questionnaire d’entrée partiel reste « partiel » et affiche n/5', () => {
    const ctx = ctxBase({ diagnostic: { statut_saisie: 'en_cours', fse_entree: { statut_avant_entree: 'inactif', foyer_monoparental: true }, fse_entree_complet: false } });
    const p = svc.composerPieces(ctx, REGLAGES).find((x) => x.cle === 'fse_entree');
    expect(p.etat).toBe('partiel');
    expect(p.detail).toMatch(/^2\/5 items/);
    expect(p.echeance).toBe('2026-10-08'); // entrée le 08/09 + 30 j
  });
});

describe('situationDepuisClassification — aucune situation inventée', () => {
  it('traduit les correspondances sûres', () => {
    expect(svc.situationDepuisClassification('emploi_durable')).toBe('emploi_durable');
    expect(svc.situationDepuisClassification('emploi_transition')).toBe('emploi_transition');
    expect(svc.situationDepuisClassification('sortie_positive', 'formation')).toBe('formation');
    expect(svc.situationDepuisClassification('sortie_positive', 'autre_IAE')).toBe('autre_sortie_positive');
  });
  it('rend « inconnue » pour la catégorie IAE « autre », qui n’a pas d’équivalent FSE+', () => {
    expect(svc.situationDepuisClassification('autre')).toBe('inconnue');
    expect(svc.situationDepuisClassification(null)).toBe('inconnue');
  });
});

describe('enregistrerSortie — une seule ligne par parcours', () => {
  const capturerUpsert = () => mockQuery.mock.calls.find(([sql]) => /INSERT INTO insertion_fse_sorties/.test(String(sql)));

  it('saisie SANS bilan : source « sans_bilan », upsert sur (employee_id, parcours_num)', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM employees/.test(s)) return Promise.resolve({ rows: [{ pn: 1 }] });
      if (/INSERT INTO insertion_fse_sorties/.test(s)) return Promise.resolve({ rows: [{ id: 1, source: 'sans_bilan' }] });
      return Promise.resolve({ rows: [] });
    });
    const r = await svc.enregistrerSortie({
      employeeId: 5, payload: { date_sortie: '2026-08-21', situation_sortie: 'chomage' }, userId: 7,
    });
    expect(r.source).toBe('sans_bilan');
    const [sql, params] = capturerUpsert();
    expect(String(sql)).toMatch(/ON CONFLICT \(employee_id, parcours_num\) DO UPDATE/);
    expect(params[0]).toBe(5);
    expect(params[6]).toBe('chomage');
  });

  it('le PREMIER horodatage de saisie est conservé (LEAST) — pas de retard rétroactif', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/INSERT INTO insertion_fse_sorties/.test(s)) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [] });
    });
    await svc.enregistrerSortie({
      employeeId: 5,
      milestone: { id: 9, parcours_num: 1, completed_date: '2026-08-25', sortie_classification: 'emploi_durable', fse_sortie: null },
      userId: 7,
    });
    const [sql, params] = capturerUpsert();
    expect(String(sql)).toMatch(/saisie_at = LEAST\(insertion_fse_sorties\.saisie_at, EXCLUDED\.saisie_at\)/);
    expect(params[4]).toBe('bilan');
    expect(params[6]).toBe('emploi_durable'); // déduit de la classification IAE
  });

  it('REFUSE un questionnaire hors schéma sans rien écrire', async () => {
    await expect(svc.enregistrerSortie({
      employeeId: 5, payload: { date_sortie: '2026-08-21', situation_sortie: 'chomage', fse_sortie: { type_contrat: 'apprentissage' } }, userId: 7,
    })).rejects.toMatchObject({ code: 'FSE_SORTIE_INVALIDE' });
    expect(capturerUpsert()).toBeUndefined();
  });

  it('REFUSE une sortie sans date (la colonne est NOT NULL, le message doit l’être aussi)', async () => {
    mockQuery.mockResolvedValue({ rows: [{ pn: 1 }] });
    await expect(svc.enregistrerSortie({
      employeeId: 5, payload: { situation_sortie: 'chomage' }, userId: 7,
    })).rejects.toMatchObject({ code: 'FSE_SORTIE_INVALIDE' });
  });

  it('journalise la saisie sans jamais écrire le commentaire libre', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/INSERT INTO insertion_fse_sorties/.test(s)) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [{ pn: 1 }] });
    });
    await svc.enregistrerSortie({
      employeeId: 5,
      payload: { date_sortie: '2026-08-21', situation_sortie: 'chomage', fse_sortie: { commentaire: 'situation personnelle délicate' } },
      userId: 7,
    });
    const log = mockQuery.mock.calls.find(([sql]) => /INSERT INTO rgpd_audit_log/.test(String(sql)));
    expect(log[1][1]).toBe('INSERTION_FSE_SORTIE_SAISIE');
    expect(log[1][4]).not.toMatch(/délicate/);
  });
});

describe('enregistrerSixMois', () => {
  it('REFUSE un relevé sans sortie enregistrée (pas de ligne de sortie fantôme)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await expect(svc.enregistrerSixMois({ employeeId: 5, situation6mois: 'formation', userId: 7 }))
      .rejects.toMatchObject({ code: 'SORTIE_ABSENTE' });
  });
  it('REFUSE une situation hors liste', async () => {
    await expect(svc.enregistrerSixMois({ employeeId: 5, situation6mois: 'en_vacances', userId: 7 }))
      .rejects.toMatchObject({ code: 'SIX_MOIS_INVALIDE' });
  });
  it('met à jour la ligne et journalise', async () => {
    mockQuery.mockImplementation((sql) => (/UPDATE insertion_fse_sorties/.test(String(sql))
      ? Promise.resolve({ rows: [{ id: 1, parcours_num: 1 }] })
      : Promise.resolve({ rows: [] })));
    await svc.enregistrerSixMois({ employeeId: 5, situation6mois: 'emploi_durable', dateReleve: '2026-09-12', userId: 7 });
    const log = mockQuery.mock.calls.find(([sql]) => /INSERT INTO rgpd_audit_log/.test(String(sql)));
    expect(log[1][1]).toBe('INSERTION_FSE_SIX_MOIS_SAISIE');
  });
});

describe('checkFseSortiesNonRenseignees — alertes J+15 puis J+25', () => {
  const brancher = (participants, alertesExistantes = []) => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM settings/.test(s)) return Promise.resolve({ rows: [] }); // défauts 15 / 25
      if (/FROM employees e/.test(s) && /insertion_projet_participants/.test(s)) return Promise.resolve({ rows: participants });
      if (/SELECT id FROM insertion_interview_alerts/.test(s)) return Promise.resolve({ rows: alertesExistantes });
      if (/INSERT INTO insertion_interview_alerts/.test(s)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
  };

  it('crée « fse_sortie_j15 » entre les deux seuils et « fse_sortie_j25 » au-delà', async () => {
    brancher([
      { id: 1, first_name: 'A', last_name: 'A', contract_end: '2026-08-25', jours: 18 },
      { id: 2, first_name: 'B', last_name: 'B', contract_end: '2026-08-01', jours: 42 },
    ]);
    const r = await svc.checkFseSortiesNonRenseignees();
    expect(r).toEqual({ crees: 2, verifies: 2 });
    const types = mockQuery.mock.calls
      .filter(([sql]) => /INSERT INTO insertion_interview_alerts/.test(String(sql)))
      .map(([, p]) => p[1]);
    expect(types).toEqual(['fse_sortie_j15', 'fse_sortie_j25']);
  });

  it('ANTI-DOUBLON : une alerte déjà posée n’est pas répétée chaque jour', async () => {
    brancher([{ id: 1, first_name: 'A', last_name: 'A', contract_end: '2026-08-25', jours: 18 }], [{ id: 99 }]);
    const r = await svc.checkFseSortiesNonRenseignees();
    expect(r).toEqual({ crees: 0, verifies: 1 });
    expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO insertion_interview_alerts/.test(String(sql)))).toHaveLength(0);
  });

  it('un échec SQL ne casse pas le tour de scheduler et rend des compteurs honnêtes', async () => {
    mockQuery.mockRejectedValue(Object.assign(new Error('relation inconnue'), { code: '42P01' }));
    await expect(svc.checkFseSortiesNonRenseignees()).resolves.toEqual({ crees: 0, verifies: 0 });
  });
});

describe('bornesPeriode', () => {
  it('borne un trimestre, y compris le passage d’année', () => {
    expect(svc.bornesPeriode('2026-T3')).toMatchObject({ debut: '2026-07-01', fin: '2026-10-01' });
    expect(svc.bornesPeriode('2026-T4')).toMatchObject({ debut: '2026-10-01', fin: '2027-01-01' });
  });
  it('rend null sur un libellé illisible (l’appelant retombe sur « tous les participants »)', () => {
    expect(svc.bornesPeriode('2026-T9')).toBeNull();
    expect(svc.bornesPeriode('')).toBeNull();
  });
});
