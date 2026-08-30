// ═══════════════════════════════════════════════════════════════════════════
// TESTS UNITAIRES — services/rgpd-purges.js (purges de rétention RGPD)
// ───────────────────────────────────────────────────────────────────────────
// Ce que ces tests verrouillent :
//   1. la PURGE PCM 90 J (2.44.0) : le bon critère de personne (« non recruté »
//      = status <> 'hired', et JAMAIS une liste de statuts figée qui se
//      périmerait), la bonne date de référence (la PASSATION du test :
//      COALESCE(completed_at, created_at), pas la dernière activité du dossier),
//      et un seuil réellement paramétrable avec repli 90 j EN CODE ;
//   2. le RÉSUMÉ commun renvoyé par toutes les purges (l'écran et job_runs le
//      lisent tel quel) ;
//   3. la JOURNALISATION CONDITIONNELLE : en automatique, on n'écrit que si
//      quelque chose a été supprimé (un journal qui se remplit de « 0 » noie
//      les vraies purges) ; en manuel, on écrit TOUJOURS — c'est la trace qui
//      prouve qu'un humain a vérifié — avec son user_id ;
//   4. le REGISTRE PURGES_RGPD, source unique du scheduler, de la route de
//      déclenchement manuel et de l'écran.
//
// Base mockée par routage SQL (aucune connexion réelle). La preuve sur
// PostgreSQL 16 réel est rapportée à part.
// ═══════════════════════════════════════════════════════════════════════════

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockClientQuery(...a), release: mockRelease }),
}));

const mockAnonymizeCandidate = jest.fn().mockResolvedValue(undefined);
const mockAnonymizeEmployee = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../src/services/anonymization', () => ({
  anonymizeCandidate: (...a) => mockAnonymizeCandidate(...a),
  anonymizeEmployee: (...a) => mockAnonymizeEmployee(...a),
}));

const mockPurgeMessagerie = jest.fn();
jest.mock('../../../src/services/messagerie', () => ({
  purgeMessagerieRetention: (...a) => mockPurgeMessagerie(...a),
}));

const mockReadInsertionSetting = jest.fn().mockResolvedValue(24);
jest.mock('../../../src/utils/insertion-settings', () => ({
  readInsertionSetting: (...a) => mockReadInsertionSetting(...a),
}));

const purges = require('../../../src/services/rgpd-purges');

// ── Harnais de routage SQL ────────────────────────────────────────────────
/** @type {{settings: Record<string,string>, deleted: Record<string,number>, rows: Record<string,any[]>}} */
let db;
const journal = () => mockQuery.mock.calls.filter((c) => /INSERT INTO rgpd_audit_log/.test(c[0]));
const journalClient = () => mockClientQuery.mock.calls.filter((c) => /INSERT INTO rgpd_audit_log/.test(c[0]));
const sqlDe = (motif) => (mockQuery.mock.calls.find((c) => motif.test(c[0])) || [null, null]);

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  mockRelease.mockReset();
  mockAnonymizeCandidate.mockClear();
  mockAnonymizeEmployee.mockClear();
  mockPurgeMessagerie.mockReset();
  mockReadInsertionSetting.mockReset().mockResolvedValue(24);
  db = { settings: {}, deleted: {}, rows: {} };

  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockQuery.mockImplementation(async (sql, params) => {
    if (/FROM settings WHERE key = \$1/.test(sql)) {
      const v = db.settings[params[0]];
      return { rows: v === undefined ? [] : [{ value: v }] };
    }
    if (/FROM settings WHERE key = 'collecte.arrets_retention_jours'/.test(sql)) {
      const v = db.settings['collecte.arrets_retention_jours'];
      return { rows: v === undefined ? [] : [{ value: v }] };
    }
    if (/INSERT INTO rgpd_audit_log/.test(sql)) return { rows: [], rowCount: 1 };
    if (/DELETE FROM pcm_sessions/.test(sql)) return { rows: [], rowCount: db.deleted.pcm ?? 0 };
    if (/DELETE FROM gps_positions/.test(sql)) return { rows: [], rowCount: db.deleted.gps ?? 0 };
    if (/DELETE FROM tour_gps_stops/.test(sql)) {
      if (db.deleted.arretsErreur) throw db.deleted.arretsErreur;
      return { rows: [], rowCount: db.deleted.arrets ?? 0 };
    }
    if (/DELETE FROM refresh_tokens/.test(sql)) return { rows: [], rowCount: db.deleted.tokens ?? 0 };
    if (/FROM candidates/.test(sql)) return { rows: db.rows.candidates || [] };
    if (/FROM employees/.test(sql)) return { rows: db.rows.employees || [] };
    return { rows: [], rowCount: 0 };
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('purgePcmNonRecrute — critère de personne et date de référence', () => {
  it("ne vise QUE les personnes non recrutées, par « status <> 'hired' » et jamais une liste figée", async () => {
    await purges.purgePcmNonRecrute();
    const [sql] = sqlDe(/DELETE FROM pcm_sessions/);
    expect(sql).toBeTruthy();
    expect(sql).toMatch(/status\s*<>\s*'hired'/);
    // Une liste de statuts en dur se périmerait à la première migration du
    // référentiel (le CHECK de candidates.status a déjà changé deux fois).
    expect(sql).not.toMatch(/'received'|'interview'|'rejected'|'preselected'|'test'/);
  });

  it('compte le délai depuis la PASSATION du test, avec repli sur la création de la session', async () => {
    await purges.purgePcmNonRecrute();
    const [sql] = sqlDe(/DELETE FROM pcm_sessions/);
    expect(sql).toMatch(/COALESCE\(completed_at,\s*created_at\)/);
    // Surtout PAS la dernière activité du dossier candidat : une relance ou une
    // note repousserait indéfiniment l'échéance du test.
    expect(sql).not.toMatch(/updated_at/);
  });

  it('supprime la session seule — la fiche candidat suit sa propre échéance', async () => {
    await purges.purgePcmNonRecrute();
    expect(mockQuery.mock.calls.some((c) => /DELETE FROM candidates/.test(c[0]))).toBe(false);
    // pcm_answers / pcm_reports partent en CASCADE FK : aucun DELETE explicite.
    expect(mockQuery.mock.calls.some((c) => /DELETE FROM pcm_(answers|reports)/.test(c[0]))).toBe(false);
  });
});

describe('purgePcmNonRecrute — seuil de rétention', () => {
  it('retombe sur 90 jours (défaut EN CODE) quand aucun réglage n’est en base', async () => {
    const r = await purges.purgePcmNonRecrute();
    expect(r.retention_jours).toBe(90);
    const [, params] = sqlDe(/DELETE FROM pcm_sessions/);
    expect(params).toEqual(['90']);
  });

  it('lit le réglage rgpd.pcm_non_recrute_retention_jours quand il existe', async () => {
    db.settings['rgpd.pcm_non_recrute_retention_jours'] = '30';
    const r = await purges.purgePcmNonRecrute();
    expect(r.retention_jours).toBe(30);
    expect(sqlDe(/DELETE FROM pcm_sessions/)[1]).toEqual(['30']);
  });

  it('ignore un réglage aberrant (0, négatif, non numérique) et garde le défaut', async () => {
    for (const valeur of ['0', '-10', 'quatre-vingt-dix', '']) {
      mockQuery.mockClear();
      db.settings['rgpd.pcm_non_recrute_retention_jours'] = valeur;
      const r = await purges.purgePcmNonRecrute();
      expect(r.retention_jours).toBe(90);
    }
  });
});

describe('purgePcmNonRecrute — résumé renvoyé', () => {
  it('renvoie clé, détail par table, total, seuil et drapeau de journalisation', async () => {
    db.deleted.pcm = 4;
    const r = await purges.purgePcmNonRecrute();
    expect(r).toMatchObject({
      cle: 'pcm_non_recrute',
      supprimes: { pcm_sessions: 4 },
      total: 4,
      retention_jours: 90,
      journalise: true,
      items: 4, // alimente job_runs.items_processed
      ok: true,
    });
  });

  it('une erreur SQL ne lève pas : elle est dite dans le résumé (ok:false + motif)', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/DELETE FROM pcm_sessions/.test(sql)) throw new Error('relation « pcm_sessions » inexistante');
      if (/INSERT INTO rgpd_audit_log/.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const r = await purges.purgePcmNonRecrute();
    expect(r.ok).toBe(false);
    expect(r.motif).toMatch(/pcm_sessions/);
    expect(r.total).toBe(0);
  });
});

describe('journalisation — conditionnelle en automatique, systématique en manuel', () => {
  it('AUTO + 0 ligne supprimée → AUCUNE entrée au journal', async () => {
    db.deleted.pcm = 0;
    const r = await purges.purgePcmNonRecrute();
    expect(journal()).toHaveLength(0);
    expect(r.journalise).toBe(false);
  });

  it('AUTO + lignes supprimées → une entrée AUTO_PURGE_PCM_90J, user_id NULL, entity_id 0', async () => {
    db.deleted.pcm = 3;
    await purges.purgePcmNonRecrute();
    const [, params] = journal()[0];
    expect(params[0]).toBeNull();               // user_id : personne n'a cliqué
    expect(params[1]).toBe('AUTO_PURGE_PCM_90J');
    expect(params[2]).toBe('pcm_sessions');
    const details = JSON.parse(params[3]);
    expect(details.trigger).toBe('auto');
    expect(details.retention_jours).toBe(90);
    expect(details.supprimes).toEqual({ pcm_sessions: 3 });
    // entity_id est figé à 0 dans le SQL (convention des purges de masse).
    expect(journal()[0][0]).toMatch(/VALUES \(\$1, \$2, \$3, 0, \$4\)/);
  });

  it('MANUEL + 0 ligne supprimée → l’entrée est écrite QUAND MÊME (elle prouve la vérification)', async () => {
    db.deleted.pcm = 0;
    const r = await purges.purgePcmNonRecrute({ trigger: 'manual', userId: 42 });
    expect(journal()).toHaveLength(1);
    expect(r.journalise).toBe(true);
    const [, params] = journal()[0];
    expect(params[1]).toBe('PURGE_PCM_NON_RECRUTE');
    expect(params[0]).toBe(42);                 // qui a cliqué
    expect(JSON.parse(params[3]).trigger).toBe('manual');
  });

  it('le code manuel n’a jamais le préfixe AUTO_ (convention maison)', async () => {
    for (const p of purges.PURGES_RGPD) {
      expect(p.actionManuelle.startsWith('AUTO_')).toBe(false);
      if (p.actionAuto) expect(p.actionAuto.startsWith('AUTO_')).toBe(true);
    }
  });

  it('une journalisation impossible ne fait pas échouer une purge déjà appliquée', async () => {
    db.deleted.pcm = 2;
    mockQuery.mockImplementation(async (sql) => {
      if (/INSERT INTO rgpd_audit_log/.test(sql)) throw new Error('journal indisponible');
      if (/DELETE FROM pcm_sessions/.test(sql)) return { rows: [], rowCount: 2 };
      return { rows: [], rowCount: 0 };
    });
    const r = await purges.purgePcmNonRecrute();
    expect(r.total).toBe(2);
    expect(r.journalise).toBe(false); // dit, jamais masqué
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('purges déplacées — comportement automatique inchangé', () => {
  it('candidats : critère created_at (celui du job), garde ANONYME, log AUTO_PURGE_24M par personne', async () => {
    db.rows.candidates = [{ id: 7, first_name: 'Jean', last_name: 'Dupont' }];
    const r = await purges.purgeExpiredCandidates();
    const [sql] = sqlDe(/FROM candidates/);
    expect(sql).toMatch(/status != 'hired'/);
    expect(sql).toMatch(/created_at < \$1/);
    expect(sql).toMatch(/first_name != 'ANONYME'/);
    expect(mockAnonymizeCandidate).toHaveBeenCalledWith(expect.anything(), 7);
    const [, params] = journalClient()[0];
    expect(params[1]).toBe('AUTO_PURGE_24M');
    expect(params[0]).toBeNull();
    expect(r).toMatchObject({ cle: 'candidats_expires', total: 1, retention_mois: 24 });
    // Le seuil s'exprime en MOIS civils : pas de conversion en jours inventée.
    expect(r.retention_jours).toBeNull();
  });

  it('candidats en manuel : le code de journal devient PURGE_EXPIRED et porte le user_id', async () => {
    db.rows.candidates = [{ id: 7, first_name: 'Jean', last_name: 'Dupont' }];
    await purges.purgeExpiredCandidates({ trigger: 'manual', userId: 9 });
    const [, params] = journalClient()[0];
    expect(params[1]).toBe('PURGE_EXPIRED');
    expect(params[0]).toBe(9);
    // + une ligne de synthèse (entity_id 0) qui dit que l'action a eu lieu.
    expect(journal().some((c) => c[1][1] === 'PURGE_EXPIRED')).toBe(true);
  });

  it("insertion : parcours clos + fiche inactive + rétention lue dans insertion.retention_months", async () => {
    mockReadInsertionSetting.mockResolvedValue(36);
    db.rows.employees = [{ id: 3, insertion_status: 'termine', insertion_end_date: '2020-01-01' }];
    const r = await purges.purgeInsertionDossiers();
    const [sql, params] = sqlDe(/FROM employees/);
    expect(sql).toMatch(/insertion_status IN \('termine', 'abandon'\)/);
    expect(sql).toMatch(/is_active = false/);
    expect(sql).toMatch(/make_interval\(months => \$1\)/);
    expect(params).toEqual([36]);
    expect(r.retention_mois).toBe(36);
    expect(journalClient()[0][1][1]).toBe('AUTO_PURGE_INSERTION');
  });

  it('GPS : 90 jours, journal seulement si des lignes ont disparu', async () => {
    db.deleted.gps = 0;
    expect((await purges.purgeOldGpsPositions()).journalise).toBe(false);
    expect(journal()).toHaveLength(0);

    mockQuery.mockClear();
    db.deleted.gps = 12;
    const r = await purges.purgeOldGpsPositions();
    expect(r).toMatchObject({ cle: 'gps_positions', total: 12, retention_jours: 90 });
    expect(journal()[0][1][1]).toBe('AUTO_PURGE_GPS_90D');
  });

  it('arrêts GPS : rétention réglable mais PLAFONNÉE à celle de la source (90 j)', async () => {
    db.settings['collecte.arrets_retention_jours'] = '365';
    db.deleted.arrets = 5;
    const r = await purges.purgeArretsGps();
    expect(r.retention_jours).toBe(90);
    expect(sqlDe(/DELETE FROM tour_gps_stops/)[1]).toEqual(['90']);

    mockQuery.mockClear();
    db.settings['collecte.arrets_retention_jours'] = '30';
    expect((await purges.purgeArretsGps()).retention_jours).toBe(30);
  });

  it('arrêts GPS : table absente (base non migrée) → motif explicite, jamais une exception', async () => {
    const err = new Error('relation "tour_gps_stops" does not exist');
    err.code = '42P01';
    db.deleted.arretsErreur = err;
    const r = await purges.purgeArretsGps();
    expect(r.ok).toBe(false);
    expect(r.motif).toMatch(/tour_gps_stops/);
    expect(r.total).toBe(0);
  });

  it('messagerie : délègue au module propriétaire, n’en réécrit pas le SQL', async () => {
    mockPurgeMessagerie.mockResolvedValue({
      ok: true, messages_supprimes: 8, conversations_supprimees: 2,
      pointeurs_recales: 1, retention_jours: 365,
    });
    const r = await purges.purgeMessagerie();
    expect(mockPurgeMessagerie).toHaveBeenCalled();
    expect(mockQuery.mock.calls.some((c) => /DELETE FROM messagerie_messages/.test(c[0]))).toBe(false);
    expect(r).toMatchObject({ cle: 'messagerie', total: 10, retention_jours: 365 });
  });

  it('refresh tokens : aucun journal en automatique (jetons techniquement morts), un journal en manuel', async () => {
    db.deleted.tokens = 3;
    expect((await purges.purgeExpiredRefreshTokens()).journalise).toBe(false);
    expect(journal()).toHaveLength(0);

    mockQuery.mockClear();
    await purges.purgeExpiredRefreshTokens({ trigger: 'manual', userId: 5 });
    expect(journal()[0][1][1]).toBe('PURGE_REFRESH_TOKENS');
    expect(journal()[0][1][0]).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('registre PURGES_RGPD — source unique', () => {
  it('couvre les 8 purges de rétention, avec des clés uniques', () => {
    const cles = purges.PURGES_RGPD.map((p) => p.cle);
    // 2.45.0 : `pcm_reponses` s'intercale juste après `pcm_non_recrute` — les
    // deux règles PCM se lisent d'affilée à l'écran comme au journal des jobs.
    expect(cles).toEqual([
      'pcm_non_recrute', 'pcm_reponses', 'candidats_expires', 'insertion_dossiers',
      'gps_positions', 'arrets_gps', 'messagerie', 'refresh_tokens',
    ]);
    expect(new Set(cles).size).toBe(cles.length);
  });

  it('chaque entrée est exécutable et décrite en français', () => {
    for (const p of purges.PURGES_RGPD) {
      expect(typeof p.fn).toBe('function');
      expect(typeof p.libelle).toBe('string');
      expect(p.libelle.length).toBeGreaterThan(3);
      expect(typeof p.description).toBe('string');
      expect(p.description.length).toBeGreaterThan(40);
      expect(typeof p.jobName).toBe('string');
      expect(typeof p.entiteAudit).toBe('string');
      expect(typeof p.actionManuelle).toBe('string');
    }
  });

  it('les noms de job correspondent à ceux réellement instrumentés par le scheduler', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, '../../../src/services/scheduler.js'), 'utf8');
    for (const p of purges.PURGES_RGPD) {
      expect(source).toContain(`runInstrumented('${p.jobName}'`);
    }
  });

  it('chaque job de purge est déclaré dans le registre de supervision JOB_SCHEDULE', () => {
    // Sans cadence déclarée, un job qui cesse de tourner ne se signale nulle
    // part — une purge en panne est un manquement de conformité silencieux.
    const { JOB_SCHEDULE } = require('../../../src/routes/monitoring');
    for (const p of purges.PURGES_RGPD) {
      expect(JOB_SCHEDULE[p.jobName]).toBeDefined();
      expect(JOB_SCHEDULE[p.jobName].maxAgeHours).toBeGreaterThan(0);
      expect(typeof JOB_SCHEDULE[p.jobName].label).toBe('string');
    }
  });

  it('chaque code d’action du registre reste un LITTÉRAL visible dans le source', () => {
    // Les codes arrivent en paramètre `$2` de l'INSERT : ils ne sont lisibles
    // nulle part dans le SQL. La garde anti-dérive des libellés lit le code
    // source — si un refactor les fait disparaître (concaténation, table
    // externe…), elle cesse de protéger sans rien dire, et un code brut finit
    // à l'écran. Ce test verrouille leur présence.
    const source = require('fs').readFileSync(require('path').join(__dirname, '../../../src/services/rgpd-purges.js'), 'utf8');
    for (const p of purges.PURGES_RGPD) {
      expect(source).toContain(`'${p.actionManuelle}'`);
      if (p.actionAuto) expect(source).toContain(`'${p.actionAuto}'`);
    }
  });

  it('trouverPurge est une liste blanche : une clé inconnue ne renvoie rien', () => {
    expect(purges.trouverPurge('pcm_non_recrute')).toBeTruthy();
    for (const inconnue of ['inconnue', 'constructor', '__proto__', 'toString', '']) {
      expect(purges.trouverPurge(inconnue)).toBeNull();
    }
  });
});

describe('retentionEffective — jamais une durée que le code n’applique pas', () => {
  it('renvoie le défaut du code quand aucun réglage n’est posé', async () => {
    const r = await purges.retentionEffective(purges.trouverPurge('pcm_non_recrute'));
    expect(r).toMatchObject({ valeur: 90, unite: 'jours', source: 'code', parametrable: 'rgpd.pcm_non_recrute_retention_jours' });
  });

  it('renvoie la valeur réglée et nomme sa source', async () => {
    db.settings['rgpd.pcm_non_recrute_retention_jours'] = '45';
    const r = await purges.retentionEffective(purges.trouverPurge('pcm_non_recrute'));
    expect(r.valeur).toBe(45);
    expect(r.source).toBe('rgpd.pcm_non_recrute_retention_jours');
  });

  it('applique le plafond de la source aux arrêts GPS', async () => {
    db.settings['collecte.arrets_retention_jours'] = '400';
    expect((await purges.retentionEffective(purges.trouverPurge('arrets_gps'))).valeur).toBe(90);
  });

  it('une purge sans seuil temporel renvoie null, jamais 0', async () => {
    const r = await purges.retentionEffective(purges.trouverPurge('refresh_tokens'));
    expect(r.valeur).toBeNull();
    expect(r.source).toBeNull();
  });
});
