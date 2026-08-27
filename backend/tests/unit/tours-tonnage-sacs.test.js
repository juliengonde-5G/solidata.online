// ═══════════════════════════════════════════════════════════════════════════
// CLÔTURE DE TOURNÉE — le poids pesé suit les SACS, plus la moyenne
// ───────────────────────────────────────────────────────────────────────────
// `ecrireTonnage` écrivait jusqu'ici `total ÷ nombre de points` dans
// `tonnage_history_association`, faute de mieux — et c'est cette table que
// relisent la carte des associations et `predictAssociationFillRate`. Deux sacs
// chez l'une et quarante chez l'autre y laissaient donc la même trace.
//
// Ces tests vérifient ce qui est RÉELLEMENT écrit en base (les paramètres des
// INSERT), pas seulement le calcul : c'est la ligne d'historique qui compte.
// Ils verrouillent aussi la non-régression des tournées de BORNES, qui ne
// déclarent aucun sac et doivent garder leur comportement au kilo près.
// ═══════════════════════════════════════════════════════════════════════════

jest.mock('../../src/config/database', () => ({ query: jest.fn(), connect: jest.fn() }));

const {
  ecrireTonnage, pointsCollectes,
} = require('../../src/routes/tours/completion-effects');

/** Base simulée : journalise les écritures, répond aux lectures de points. */
function fakeDb({ points = [], colonneSacsAbsente = false } = {}) {
  const inserts = [];
  const query = jest.fn(async (text, params) => {
    if (/^\s*INSERT INTO tonnage_history/i.test(text)) {
      inserts.push({ text: text.replace(/\s+/g, ' ').trim(), params });
      return { rows: [], rowCount: 1 };
    }
    if (/FROM tour_association_point/i.test(text)) {
      if (colonneSacsAbsente && /nb_sacs/i.test(text)) {
        const err = new Error('column "nb_sacs" does not exist');
        err.code = '42703';
        throw err;
      }
      // Le repli relit sans la colonne : les points reviennent sans sacs.
      const rows = /nb_sacs/i.test(text)
        ? points
        : points.map(({ point_id }) => ({ point_id }));
      return { rows };
    }
    if (/FROM tour_cav/i.test(text)) return { rows: points.map((p) => ({ cav_id: p.point_id })) };
    return { rows: [] };
  });
  return { query, inserts };
}

const tourneeAsso = (total) => ({ collection_type: 'association', date: '2026-08-27', total_weight_kg: total });
const tourneeBornes = (total) => ({ collection_type: 'pav', date: '2026-08-27', total_weight_kg: total });

/** Les poids réellement écrits, indexés par identifiant de point. */
const poidsEcrits = (db) => Object.fromEntries(
  db.inserts.map(({ text, params }) => (
    /tonnage_history_association/i.test(text)
      ? [params[0], params[2]]     // (association_point_id, date, weight_kg, …)
      : [params[1], params[2]]     // (date, cav_id, weight_kg, …)
  ))
);

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('ecrireTonnage — répartition au prorata des sacs', () => {
  test('le poids écrit suit les sacs, et non le nombre de points', async () => {
    const db = fakeDb();
    const points = [{ point_id: 5, nb_sacs: 2 }, { point_id: 9, nb_sacs: 40 }];
    const lignes = await ecrireTonnage(tourneeAsso(840), 77, points, db);

    expect(lignes).toBe(2);
    expect(poidsEcrits(db)).toEqual({ 5: 40, 9: 800 });
    // Contre-épreuve : l'ancienne règle aurait écrit 420 kg de chaque côté.
    expect(db.inserts.some((i) => i.params.includes(420))).toBe(false);
  });

  test('le total écrit est exactement le total pesé — rien ne se perd en route', async () => {
    const db = fakeDb();
    const points = [{ point_id: 1, nb_sacs: 3 }, { point_id: 2, nb_sacs: 7 }, { point_id: 3, nb_sacs: 11 }];
    await ecrireTonnage(tourneeAsso(1000), 78, points, db);
    const somme = db.inserts.reduce((s, i) => s + i.params[2], 0);
    expect(somme).toBeCloseTo(1000, 9);
  });

  test('un point déclaré à 0 sac reçoit bien une ligne à 0 kg (déclaré vide ≠ oublié)', async () => {
    const db = fakeDb();
    const points = [{ point_id: 1, nb_sacs: 0 }, { point_id: 2, nb_sacs: 10 }];
    await ecrireTonnage(tourneeAsso(500), 79, points, db);
    expect(poidsEcrits(db)).toEqual({ 1: 0, 2: 500 });
  });

  test('le prorata est ANNONCÉ, pas appliqué en douce', async () => {
    const db = fakeDb();
    await ecrireTonnage(tourneeAsso(840), 77, [{ point_id: 5, nb_sacs: 2 }, { point_id: 9, nb_sacs: 40 }], db);
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/prorata des sacs/));
  });
});

describe('ecrireTonnage — replis, tous journalisés', () => {
  test('aucune déclaration : parts égales, exactement comme avant', async () => {
    const db = fakeDb();
    const points = [{ point_id: 1 }, { point_id: 2 }, { point_id: 3 }];
    await ecrireTonnage(tourneeAsso(900), 80, points, db);
    expect(poidsEcrits(db)).toEqual({ 1: 300, 2: 300, 3: 300 });
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/Aucun point ne déclare/));
  });

  test('déclaration incomplète : parts égales — le point sans sacs ne reçoit JAMAIS 0 kg', async () => {
    const db = fakeDb();
    const points = [{ point_id: 1, nb_sacs: 10 }, { point_id: 2, nb_sacs: null }];
    await ecrireTonnage(tourneeAsso(600), 81, points, db);
    expect(poidsEcrits(db)).toEqual({ 1: 300, 2: 300 });
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/sans nombre de sacs/));
  });

  test('tous les points à 0 sac malgré un poids pesé : aucune division par zéro, aucun kilo perdu', async () => {
    const db = fakeDb();
    const points = [{ point_id: 1, nb_sacs: 0 }, { point_id: 2, nb_sacs: 0 }];
    await ecrireTonnage(tourneeAsso(500), 82, points, db);
    const poids = poidsEcrits(db);
    expect(Object.values(poids).every(Number.isFinite)).toBe(true);
    expect(Object.values(poids).reduce((s, v) => s + v, 0)).toBeCloseTo(500, 9);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/Aucun sac déclaré alors que du textile/));
  });

  test('tournée de BORNES : comportement inchangé au kilo près', async () => {
    const db = fakeDb();
    const points = [{ point_id: 11 }, { point_id: 12 }, { point_id: 13 }, { point_id: 14 }];
    await ecrireTonnage(tourneeBornes(1230), 83, points, db);
    expect(db.inserts.every((i) => /INSERT INTO tonnage_history \(/i.test(i.text))).toBe(true);
    expect(Object.values(poidsEcrits(db))).toEqual([307.5, 307.5, 307.5, 307.5]);
  });

  test('aucun point collecté : aucune écriture', async () => {
    const db = fakeDb();
    expect(await ecrireTonnage(tourneeAsso(900), 84, [], db)).toBe(0);
    expect(db.inserts).toHaveLength(0);
  });
});

describe('pointsCollectes — la colonne nb_sacs remonte, et son absence dégrade sans casser', () => {
  test('les sacs accompagnent le point', async () => {
    const db = fakeDb({ points: [{ point_id: 5, nb_sacs: 12 }] });
    const points = await pointsCollectes({ collection_type: 'association' }, 90, db);
    expect(points).toEqual([{ point_id: 5, nb_sacs: 12 }]);
  });

  test('base non migrée (42703) : on relit sans la colonne, la clôture continue', async () => {
    const db = fakeDb({ points: [{ point_id: 5, nb_sacs: 12 }], colonneSacsAbsente: true });
    const points = await pointsCollectes({ collection_type: 'association' }, 91, db);
    expect(points).toEqual([{ point_id: 5 }]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/Colonne nb_sacs absente/));
    // …et la répartition retombe d'elle-même à parts égales.
    const db2 = fakeDb();
    await ecrireTonnage(tourneeAsso(200), 91, points, db2);
    expect(poidsEcrits(db2)).toEqual({ 5: 200 });
  });

  test('toute AUTRE erreur base remonte : elle ne doit pas être maquillée en « pas de sacs »', async () => {
    const db = {
      query: jest.fn(async () => { const e = new Error('connexion perdue'); e.code = '08006'; throw e; }),
    };
    await expect(pointsCollectes({ collection_type: 'association' }, 92, db))
      .rejects.toThrow('connexion perdue');
  });
});
