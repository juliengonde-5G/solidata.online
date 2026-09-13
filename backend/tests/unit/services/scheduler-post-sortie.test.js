// ═══════════════════════════════════════════════════════════════════════════
// UNITAIRE — Suivi post-sortie à +N mois (PR A, lot 0)
// ───────────────────────────────────────────────────────────────────────────
// Le délai était FIXÉ À 3 MOIS dans le code (`due.setMonth(+3)`, fenêtre
// « 80 jours → 7 mois »), sans réglage. Or l'indicateur de résultat que
// l'autorité et le cofinanceur FSE+ mesurent est la situation de la personne
// à SIX mois de sa sortie : le jalon posé à +3 faisait travailler la CIP sans
// documenter ce qui est demandé, et le relevé à 6 mois n'était réclamé nulle
// part (plan 07 § 3, lot 0.3 ; contrat 10 § 6.3).
//
// Ce que le fichier verrouille :
//   - le délai vient du réglage `insertion.post_sortie_mois` (défaut 6) ;
//   - il est BORNÉ à [1 ; 12] : une valeur aberrante en base ne pose pas un
//     rendez-vous à une date absurde dans le dossier d'un salarié ;
//   - l'échéance = date du bilan de sortie + N mois (jamais « aujourd'hui ») ;
//   - le titre porte le délai retenu (« Suivi post-sortie (+6 mois) ») — un
//     dossier archivé doit dire à quelle échéance le suivi était attendu ;
//   - la fenêtre de création est [N−1 ; N+4] mois après la sortie ;
//   - idempotence : rien n'est créé au second passage, et une violation
//     d'unicité concurrente est absorbée.
//
// Aucune base : `pg` est simulé, les assertions portent sur le SQL émis.
// ═══════════════════════════════════════════════════════════════════════════
const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...args) => mockQuery(...args),
}));

const scheduler = require('../../../src/services/scheduler');
const { INSERTION_SETTING_DEFAULTS } = require('../../../src/utils/insertion-settings');

/** Bilan de sortie réalisé, prêt à recevoir son suivi. */
const SORTIE = {
  id: 42, employee_id: 5, parcours_num: 1,
  completed_date: '2026-03-15', first_name: 'Alice', last_name: 'DUPONT',
};

/**
 * Simule la base : `reglage` = valeur brute lue dans `settings` (undefined =
 * clé absente → défaut), `candidats` = lignes rendues par la requête de
 * sélection, `insert` = comportement de l'INSERT.
 */
function baseAvec({ reglage, candidats = [SORTIE], insert = () => ({ rows: [] }) } = {}) {
  mockQuery.mockImplementation((sql, params) => {
    const s = String(sql);
    if (/FROM settings WHERE key = \$1/.test(s)) {
      return Promise.resolve({ rows: reglage === undefined ? [] : [{ value: reglage }] });
    }
    if (/FROM insertion_milestones im/.test(s)) return Promise.resolve({ rows: candidats });
    if (/INSERT INTO insertion_milestones/.test(s)) return Promise.resolve(insert(params));
    return Promise.resolve({ rows: [] });
  });
}

const selection = () => mockQuery.mock.calls.find((c) => /FROM insertion_milestones im/.test(String(c[0])));
const inserts = () => mockQuery.mock.calls.filter((c) => /INSERT INTO insertion_milestones/.test(String(c[0])));

beforeEach(() => {
  mockQuery.mockReset();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  console.log.mockRestore();
  console.error.mockRestore();
});

describe('createPostSortieFollowups — délai paramétré', () => {
  it('le défaut EN CODE est 6 mois (et non les 3 mois historiques)', () => {
    expect(INSERTION_SETTING_DEFAULTS['insertion.post_sortie_mois']).toBe(6);
  });

  it('sans réglage en base : échéance = sortie + 6 mois, titre « (+6 mois) »', async () => {
    baseAvec({ reglage: undefined });
    const r = await scheduler.createPostSortieFollowups();

    expect(inserts()).toHaveLength(1);
    const params = inserts()[0][1];
    expect(params[0]).toBe(5);                       // employee_id
    expect(params[1]).toBe(1);                       // parcours_num
    expect(params[2]).toBe('Suivi post-sortie (+6 mois)');
    expect(params[3]).toBe('2026-09-15');            // 15/03 + 6 mois
    expect(params[4]).toBe(42);                      // previous_milestone_id
    expect(r).toEqual({ crees: 1, verifies: 1 });
  });

  it('réglage à 9 mois : le délai ET le titre suivent', async () => {
    baseAvec({ reglage: '9' });
    await scheduler.createPostSortieFollowups();
    const params = inserts()[0][1];
    expect(params[2]).toBe('Suivi post-sortie (+9 mois)');
    expect(params[3]).toBe('2026-12-15');
  });

  it('valeur aberrante en base (0, 240, texte) → repli sur 6, jamais une date absurde', async () => {
    for (const valeur of ['0', '240', '-3', 'six']) {
      mockQuery.mockReset();
      baseAvec({ reglage: valeur });
      await scheduler.createPostSortieFollowups();
      expect(inserts()[0][1][3]).toBe('2026-09-15');
      expect(inserts()[0][1][2]).toBe('Suivi post-sortie (+6 mois)');
    }
  });

  it('la fenêtre de création est [N−1 ; N+4] mois, en mois calendaires paramétrés', async () => {
    baseAvec({ reglage: undefined });
    await scheduler.createPostSortieFollowups();
    const [sql, params] = selection();
    // make_interval(months => $n) : pas d'INTERVAL littéral concaténé — le
    // délai est une donnée, jamais du SQL assemblé à la main.
    expect(String(sql)).toContain('make_interval(months => $1)');
    expect(String(sql)).toContain('make_interval(months => $2)');
    expect(params).toEqual([5, 10]);                 // 6−1 et 6+4
  });

  it('la fenêtre suit le réglage (3 mois → [2 ; 7])', async () => {
    baseAvec({ reglage: '3' });
    await scheduler.createPostSortieFollowups();
    expect(selection()[1]).toEqual([2, 7]);
  });
});

describe('createPostSortieFollowups — idempotence', () => {
  it('ne crée rien quand la sélection ne remonte aucun candidat (suivi déjà posé)', async () => {
    baseAvec({ candidats: [] });
    const r = await scheduler.createPostSortieFollowups();
    expect(inserts()).toHaveLength(0);
    expect(r).toEqual({ crees: 0, verifies: 0 });
  });

  it('la requête exclut par NOT EXISTS les parcours qui portent déjà un suivi', async () => {
    baseAvec();
    await scheduler.createPostSortieFollowups();
    const sql = String(selection()[0]);
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain("s.milestone_type = 'suivi_post_sortie'");
  });

  it('absorbe une violation d’unicité concurrente (23505) sans échouer le job', async () => {
    baseAvec({ insert: () => { throw Object.assign(new Error('doublon'), { code: '23505' }); } });
    const r = await scheduler.createPostSortieFollowups();
    expect(r).toEqual({ crees: 0, verifies: 1 });   // vu, non créé : pas de doublon
  });

  it('une vraie erreur SQL est journalisée et ne fait pas tomber la chaîne de jobs', async () => {
    baseAvec({ insert: () => { throw Object.assign(new Error('colonne absente'), { code: '42703' }); } });
    const r = await scheduler.createPostSortieFollowups();
    expect(r).toEqual({ crees: 0, verifies: 1 });
    expect(console.error).toHaveBeenCalled();
  });
});

describe('checkFseSortiesNonRenseignees — enveloppe du job du lot 2', () => {
  it('est exportée par le scheduler (déclenchement manuel + supervision)', () => {
    expect(typeof scheduler.checkFseSortiesNonRenseignees).toBe('function');
  });

  it('se saute en l’ANNONÇANT tant que services/fse-participants.js ne fournit pas la fonction', async () => {
    // Un module manquant ou incomplet ne doit jamais faire tomber la chaîne :
    // le coût reste borné à ce job, et la supervision le verra « jamais
    // exécuté » — ce qui est exactement l'information utile.
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    let dispo = true;
    try { require.resolve('../../../src/services/fse-participants'); }
    catch (_) { dispo = false; }
    if (dispo) {
      const mod = require('../../../src/services/fse-participants');
      dispo = typeof mod.checkFseSortiesNonRenseignees === 'function';
    }
    if (!dispo) {
      const r = await scheduler.checkFseSortiesNonRenseignees();
      expect(r).toEqual({ crees: 0, verifies: 0 });
      expect(console.warn).toHaveBeenCalled();
    }
    console.warn.mockRestore();
  });

  it('est déclaré dans JOB_SCHEDULE (sinon un arrêt du job passerait inaperçu)', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', '..', 'src', 'routes', 'monitoring.js'), 'utf8');
    expect(src).toContain('checkFseSortiesNonRenseignees:');
    expect(src).toContain("Suivis post-sortie (+6 mois)");
  });
});
