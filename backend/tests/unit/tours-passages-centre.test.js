// ═══════════════════════════════════════════════════════════════════════════
// PASSAGES AU CENTRE DE TRI — rattrapage des tournées déjà planifiées
// ───────────────────────────────────────────────────────────────────────────
// Une tournée planifiée avant la mise en place des passages automatiques n'en
// porte aucun. On les pose au démarrage — mais JAMAIS sur une tournée déjà
// entamée : la pause y tomberait derrière le chauffeur, donc invisible. Ces
// tests verrouillent cette frontière, et l'ordre « poser puis acquitter » sans
// lequel on demanderait au chauffeur de déclarer son arrivée à son propre point
// de départ.
// ═══════════════════════════════════════════════════════════════════════════

jest.mock('../../src/config/database', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../../src/routes/tours/impact', () => ({ estimerProgramme: jest.fn() }));

const { estimerProgramme } = require('../../src/routes/tours/impact');
const {
  assurerPassagesCentre, preparerProgrammeAuDemarrage,
} = require('../../src/routes/tours/arrets');
const { parseArgs, buildQuery } = require('../../src/scripts/backfill-passages-centre');

/** Base simulée : chaque requête est routée par sa forme SQL. */
function fakeDb({ arretExistant = false, pointTraite = false, casse = null } = {}) {
  let prochainId = 100;
  const journal = [];
  const query = jest.fn(async (text, params) => {
    journal.push({ text: text.replace(/\s+/g, ' ').trim(), params });
    if (casse && casse.test(text)) throw new Error('base indisponible');
    if (/^\s*UPDATE/i.test(text)) return { rowCount: 0, rows: [] };
    if (/^\s*INSERT INTO tour_arret_technique/i.test(text)) {
      prochainId += 1;
      return { rows: [{ id: prochainId, position: params[3] ?? 1 }] };
    }
    if (/FROM lieux_techniques/i.test(text)) {
      return { rows: [{ id: 7, nom: 'Centre de tri', latitude: 49.42, longitude: 1.09, duree_min: 20 }] };
    }
    if (/motif = ANY/i.test(text)) return { rows: arretExistant ? [{ '?column?': 1 }] : [] };
    // Testé AVANT les deux suivants : la requête de position cite les deux tables.
    if (/COALESCE\(MAX\(p\)/i.test(text)) return { rows: [{ suivante: 18 }] };
    if (/derniere/i.test(text)) return { rows: [{ derniere: 4 }] };
    if (/FROM tour_cav\s+WHERE tour_id = \$1 AND status IN/i.test(text)) {
      return { rows: pointTraite ? [{ '?column?': 1 }] : [] };
    }
    if (/FROM tour_arret_technique/i.test(text)) return { rows: [] };   // arretEnAttente
    return { rows: [] };
  });
  return { query, journal };
}

const timelineAvecPause = {
  timeline: [
    { type: 'point' }, { type: 'point' }, { type: 'point' },
    { type: 'pause_dejeuner' },
    { type: 'point' }, { type: 'point' },
  ],
};

/** Motif de chaque arrêt inséré : porté soit par un paramètre, soit en dur. */
const motifsInseres = (journal) => journal
  .filter((q) => /^INSERT INTO tour_arret_technique/i.test(q.text))
  .map((q) => (typeof q.params[4] === 'string'
    ? q.params[4]
    : (q.text.match(/'(depart_centre|pause_dejeuner|vidage|fin_tournee)'/) || [])[1]));

beforeEach(() => jest.clearAllMocks());

describe('assurerPassagesCentre', () => {
  test('une tournée qui porte déjà un passage n\'est pas retouchée', async () => {
    const db = fakeDb({ arretExistant: true });
    const r = await assurerPassagesCentre(db, 363);
    expect(r).toEqual({ pose: false, motif: 'deja_equipee' });
    expect(motifsInseres(db.journal)).toEqual([]);
  });

  test('une tournée DÉJÀ ENTAMÉE est laissée telle quelle', async () => {
    const db = fakeDb({ pointTraite: true });
    const r = await assurerPassagesCentre(db, 363);
    // La pause serait placée derrière le chauffeur : mieux vaut rien que faux.
    expect(r).toEqual({ pose: false, motif: 'tournee_entamee' });
    expect(motifsInseres(db.journal)).toEqual([]);
    expect(estimerProgramme).not.toHaveBeenCalled();
  });

  test('tournée intacte : les trois passages sont posés', async () => {
    estimerProgramme.mockResolvedValue(timelineAvecPause);
    const db = fakeDb();
    const r = await assurerPassagesCentre(db, 363);
    expect(r).toMatchObject({ pose: true, pause: true, estimation_disponible: true });
    // Fin d'abord (en queue), puis pause, puis départ : chaque insertion décale
    // les positions suivantes, l'ordre inverse les rendrait toutes fausses.
    expect(motifsInseres(db.journal)).toEqual(['fin_tournee', 'pause_dejeuner', 'depart_centre']);
  });

  test('le moteur ne prévoit pas de pause : aucune n\'est inventée', async () => {
    estimerProgramme.mockResolvedValue({ timeline: [{ type: 'point' }, { type: 'point' }] });
    const db = fakeDb();
    const r = await assurerPassagesCentre(db, 363);
    expect(r).toMatchObject({ pose: true, pause: false, estimation_disponible: true });
    expect(motifsInseres(db.journal)).toEqual(['fin_tournee', 'depart_centre']);
  });

  test('estimation indisponible : départ et fin quand même, et le manque est DIT', async () => {
    estimerProgramme.mockResolvedValue(null);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const db = fakeDb();
    const r = await assurerPassagesCentre(db, 363);
    expect(r).toMatchObject({ pose: true, pause: false, estimation_disponible: false });
    expect(motifsInseres(db.journal)).toEqual(['fin_tournee', 'depart_centre']);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/pause déjeuner/i);
    warn.mockRestore();
  });

  test('un échec de base ne remonte jamais : une tournée doit pouvoir démarrer', async () => {
    estimerProgramme.mockResolvedValue(timelineAvecPause);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const db = fakeDb({ casse: /INSERT INTO tour_arret_technique/i });
    await expect(assurerPassagesCentre(db, 363)).resolves.toEqual({ pose: false, motif: 'erreur' });
    console.warn.mockRestore();
  });
});

describe('preparerProgrammeAuDemarrage', () => {
  test('pose les passages PUIS acquitte le départ', async () => {
    estimerProgramme.mockResolvedValue(timelineAvecPause);
    const db = fakeDb();
    await preparerProgrammeAuDemarrage(db, 363);

    const iDepart = db.journal.findIndex((q) => /^INSERT INTO tour_arret_technique/i.test(q.text)
      && /'depart_centre'/.test(q.text));
    const iAcquit = db.journal.findIndex((q) => /SET status = 'done'/.test(q.text));
    expect(iDepart).toBeGreaterThan(-1);
    expect(iAcquit).toBeGreaterThan(iDepart); // acquitter d'abord ne trouverait rien
  });

  test('sur une tournée entamée, le départ éventuel est quand même acquitté', async () => {
    const db = fakeDb({ pointTraite: true });
    await preparerProgrammeAuDemarrage(db, 363);
    expect(db.journal.some((q) => /SET status = 'done'/.test(q.text))).toBe(true);
  });
});

describe('backfill-passages-centre — arguments', () => {
  test('simulation par défaut : --apply est explicite', () => {
    expect(parseArgs(['n', 's']).apply).toBe(false);
    expect(parseArgs(['n', 's', '--apply']).apply).toBe(true);
  });

  test('une date mal formée est refusée plutôt qu\'interprétée', () => {
    expect(() => parseArgs(['n', 's', '--depuis=hier'])).toThrow(/AAAA-MM-JJ/);
    expect(parseArgs(['n', 's', '--depuis=2026-08-20']).depuis).toBe('2026-08-20');
  });

  test('un identifiant de tournée illisible est refusé', () => {
    expect(() => parseArgs(['n', 's', '--tour=abc'])).toThrow(/identifiant/);
    expect(parseArgs(['n', 's', '--tour=363']).tour).toBe(363);
  });

  test('périmètre par défaut : les tournées à rouler, jamais celles déjà closes', () => {
    const q = buildQuery({});
    expect(q.text).toMatch(/status IN \('planned', 'in_progress'\)/);
    expect(q.text).toMatch(/date >= \$1/);
    expect(q.text).toMatch(/is_demo, false\) = false/);   // le camion école reste hors périmètre
  });

  test('--tour vise une tournée précise, quel que soit son statut', () => {
    const q = buildQuery({ tour: 363 });
    expect(q.values).toEqual([363]);
    expect(q.text).not.toMatch(/status IN/);
  });
});
