// ═══════════════════════════════════════════════════════════════════════════
// UNITAIRE — la règle de calcul du poids d'une tournée (routes/tours/poids.js).
//
// Le poids d'une tournée est la somme de TOUTES ses pesées, intermédiaires
// comprises. Cette règle était recopiée dans chaque écran de pesée, et une des
// copies avait dérivé : elle excluait les intermédiaires, si bien que les kilos
// déposés en cours de journée disparaissaient du total — et avec eux le tonnage
// par borne, l'entrée de stock et l'apprentissage du moteur prédictif.
//
// Ce test verrouille la règle À LA SOURCE, et la garde de non-recopie ci-dessous
// vérifie qu'aucune voie ne la réécrit dans son coin.
// ═══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({ query: (...a) => mockQuery(...a) }));

const { lirePoidsKg, recalculerTotalTournee, POIDS_MAX_KG } = require('../../src/routes/tours/poids');

beforeEach(() => mockQuery.mockReset());

describe('lirePoidsKg', () => {
  it('accepte un nombre et une chaîne, à la virgule comme au point', () => {
    expect(lirePoidsKg(815).valeur).toBe(815);
    expect(lirePoidsKg('815').valeur).toBe(815);
    expect(lirePoidsKg('815,5').valeur).toBe(815.5);
    expect(lirePoidsKg('815.5').valeur).toBe(815.5);
  });

  it('accepte zéro : un camion revenu vide est une information, pas une erreur', () => {
    expect(lirePoidsKg(0)).toEqual({ valeur: 0 });
  });

  it('refuse un poids négatif', () => {
    expect(lirePoidsKg(-1).error).toMatch(/négatif/);
  });

  it('refuse au-delà de la borne haute, sans valeur de remplacement', () => {
    const r = lirePoidsKg(POIDS_MAX_KG + 1);
    expect(r.error).toMatch(String(POIDS_MAX_KG));
    expect(r.valeur).toBeUndefined();
  });

  it('refuse ce qui n’est pas un nombre', () => {
    expect(lirePoidsKg('beaucoup').error).toMatch(/nombre/);
    expect(lirePoidsKg({}).error).toMatch(/nombre/);
  });

  it('exige la valeur quand elle est obligatoire, l’autorise vide sinon', () => {
    expect(lirePoidsKg(undefined).error).toMatch(/obligatoire/);
    expect(lirePoidsKg('', { obligatoire: false })).toEqual({ valeur: null });
    expect(lirePoidsKg(null, { obligatoire: false })).toEqual({ valeur: null });
  });

  it('nomme le champ fautif dans le message', () => {
    expect(lirePoidsKg(-1, { champ: 'La tare' }).error).toMatch(/^La tare/);
  });

  it('arrondit au centième — le gramme n’a pas de sens sur un pont-bascule', () => {
    expect(lirePoidsKg(815.4567).valeur).toBe(815.46);
  });
});

describe('recalculerTotalTournee', () => {
  it('somme TOUTES les pesées, sans filtrer les intermédiaires', async () => {
    mockQuery.mockResolvedValue({ rows: [{ total_weight_kg: 1455 }] });
    const total = await recalculerTotalTournee(null, 7);
    expect(total).toBe(1455);
    const sql = String(mockQuery.mock.calls[0][0]).replace(/\s+/g, ' ');
    expect(sql).toMatch(/SUM\(weight_kg\)/);
    // La faute historique : une clause qui écarterait les vidages en cours de
    // tournée. Elle ne doit jamais réapparaître ici.
    expect(sql).not.toMatch(/is_intermediate/);
    expect(mockQuery.mock.calls[0][1]).toEqual([7]);
  });

  it('renvoie 0 sur une tournée sans aucune pesée, jamais NaN', async () => {
    mockQuery.mockResolvedValue({ rows: [{ total_weight_kg: null }] });
    await expect(recalculerTotalTournee(null, 7)).resolves.toBe(0);
  });

  it('utilise la connexion fournie — donc reste dans la transaction de l’appelant', async () => {
    const client = { query: jest.fn(async () => ({ rows: [{ total_weight_kg: 12 }] })) };
    await recalculerTotalTournee(client, 7);
    expect(client.query).toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('garde anti-recopie de la règle', () => {
  // Le défaut d'origine ne venait pas d'un mauvais SQL : il venait de sa
  // RECOPIE dans plusieurs fichiers, dont une copie avait dérivé. On vérifie
  // donc qu'aucune voie d'écriture de pesée ne réécrit le calcul dans son coin.
  const DOSSIER = path.join(__dirname, '..', '..', 'src', 'routes', 'tours');

  it('seul poids.js écrit « UPDATE tours SET total_weight_kg = (SELECT SUM… ) »', () => {
    const coupables = fs.readdirSync(DOSSIER)
      .filter((f) => f.endsWith('.js') && f !== 'poids.js')
      .filter((f) => {
        const src = fs.readFileSync(path.join(DOSSIER, f), 'utf8').replace(/\s+/g, ' ');
        return /UPDATE tours SET total_weight_kg = \( SELECT COALESCE\(SUM\(weight_kg\)/.test(src);
      });
    expect(coupables).toEqual([]);
  });
});
