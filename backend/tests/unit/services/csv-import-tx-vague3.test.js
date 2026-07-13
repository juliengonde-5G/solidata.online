/**
 * Vague 3 — item 3.B : imports CSV ATOMIQUES (boutiques + VAK).
 * Vérifie que l'insertion d'un batch passe par une transaction et que le
 * file_hash n'est validé (commité) qu'au succès — un échec ROLLBACK le batch
 * ET son hash, ce qui autorise le rejeu du même fichier.
 */
const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...args) => mockQuery(...args),
  connect: async () => ({ query: (...args) => mockClientQuery(...args), release: mockRelease }),
}));
// Neutralise la météo réseau (best-effort après commit côté VAK)
jest.mock('../../../src/utils/weather', () => ({
  fetchOpenMeteoDaily: jest.fn().mockResolvedValue(null),
}));

const sumup = require('../../../src/services/sumup');
const { importCSVContent: importBoutiqueCSV } = require('../../../src/routes/boutique-ventes');

afterEach(() => { mockQuery.mockReset(); mockClientQuery.mockReset(); mockRelease.mockReset(); });

const clientCalls = () => mockClientQuery.mock.calls.map((c) => String(c[0]));

// ── VAK (sumup.js) ──────────────────────────────────────────────
const VAK_CSV = [
  'Date,Type,Réf. transaction,Moyen de paiement,Quantité,Unité,Description,Catégorie,SKU,Devise,Prix avant réduction,Réduction,Prix (TTC),Prix (HT),TVA,Taux de TVA,Compte',
  '15 mai 2026 10:15,Vente,TX123,Carte,3,kg,Vente moins de 5 kg,,,EUR,,0,15.00,12.50,2.50,20%,Compte',
].join('\n');

describe('sumup.importCSVContent — import VAK atomique', () => {
  function mockVakReads() {
    mockQuery.mockImplementation((sql) => {
      if (/FROM vak_import_batches WHERE file_hash/.test(sql)) return Promise.resolve({ rows: [] });
      if (/date_debut, date_fin FROM vaks WHERE id/.test(sql) && !/latitude/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 1, date_debut: new Date('2026-05-01'), date_fin: new Date('2026-05-31') }] });
      }
      // captureWeatherForVak (post-commit) → aucune VAK → retour anticipé, pas de réseau
      return Promise.resolve({ rows: [] });
    });
  }

  it('COMMIT au succès : batch inséré dans la transaction, hash validé', async () => {
    mockVakReads();
    mockClientQuery.mockImplementation((sql) => {
      if (/INSERT INTO vak_import_batches/.test(sql)) return Promise.resolve({ rows: [{ id: 9 }] });
      if (/INSERT INTO vak_tickets/.test(sql)) return Promise.resolve({ rows: [{ id: 50 }] });
      return Promise.resolve({ rows: [] });
    });

    const r = await sumup.importCSVContent(1, VAK_CSV, 'vak.csv', 7, 'csv_manuel');
    expect(r.duplicate).toBe(false);
    expect(r.batch_id).toBe(9);
    const c = clientCalls();
    expect(c[0]).toMatch(/BEGIN/);
    expect(c.some((s) => /INSERT INTO vak_import_batches/.test(s))).toBe(true);
    expect(c.at(-1)).toMatch(/COMMIT/);
    expect(c.some((s) => /ROLLBACK/.test(s))).toBe(false);
    expect(mockRelease).toHaveBeenCalled();
  });

  it('ROLLBACK si une écriture échoue : le batch (et son hash) sont annulés → rejeu possible', async () => {
    mockVakReads();
    mockClientQuery.mockImplementation((sql) => {
      if (/INSERT INTO vak_import_batches/.test(sql)) return Promise.resolve({ rows: [{ id: 9 }] });
      if (/INSERT INTO vak_tickets/.test(sql)) return Promise.reject(new Error('db down'));
      return Promise.resolve({ rows: [] });
    });

    await expect(sumup.importCSVContent(1, VAK_CSV, 'vak.csv', 7, 'csv_manuel')).rejects.toThrow('db down');
    const c = clientCalls();
    expect(c.some((s) => /ROLLBACK/.test(s))).toBe(true);
    expect(c.some((s) => /COMMIT/.test(s))).toBe(false);
    expect(mockRelease).toHaveBeenCalled();
  });

  it('doublon détecté AVANT toute transaction (hash déjà présent)', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM vak_import_batches WHERE file_hash/.test(sql)) return Promise.resolve({ rows: [{ id: 3 }] });
      return Promise.resolve({ rows: [] });
    });
    const r = await sumup.importCSVContent(1, VAK_CSV, 'vak.csv', 7, 'csv_manuel');
    expect(r.duplicate).toBe(true);
    expect(mockClientQuery).not.toHaveBeenCalled(); // aucune transaction ouverte
  });
});

// ── Boutiques (boutique-ventes.js) ──────────────────────────────
const BTQ_CSV = [
  'Rayon;Date;Num_Ticket;ID Article;Article;Quantite;Prix U. TTC;Total HT;Total TTC;Montant TVA;Taux TVA',
  'FEMME;15/05/2026 10:15:30;T001;42;Pull;1;10,00;8,33;10,00;1,67;20',
].join('\n');

describe('boutique-ventes.importCSVContent — import boutique atomique', () => {
  it('COMMIT au succès (batch dans la transaction)', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM boutique_import_batches\s+WHERE file_hash/.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    mockClientQuery.mockImplementation((sql) => {
      if (/INSERT INTO boutique_import_batches/.test(sql)) return Promise.resolve({ rows: [{ id: 3 }] });
      if (/INSERT INTO boutique_tickets/.test(sql)) return Promise.resolve({ rows: [{ id: 70 }] });
      return Promise.resolve({ rows: [] });
    });

    const r = await importBoutiqueCSV(1, BTQ_CSV, 'logics.csv', 7, 'manuel', { force: true });
    expect(r.duplicate).toBe(false);
    expect(r.batch_id).toBe(3);
    const c = clientCalls();
    expect(c[0]).toMatch(/BEGIN/);
    expect(c.some((s) => /INSERT INTO boutique_import_batches/.test(s))).toBe(true);
    expect(c.at(-1)).toMatch(/COMMIT/);
    expect(c.some((s) => /ROLLBACK/.test(s))).toBe(false);
  });

  it('ROLLBACK si une écriture échoue (batch + hash annulés)', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM boutique_import_batches\s+WHERE file_hash/.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    mockClientQuery.mockImplementation((sql) => {
      if (/INSERT INTO boutique_import_batches/.test(sql)) return Promise.resolve({ rows: [{ id: 3 }] });
      if (/INSERT INTO boutique_tickets/.test(sql)) return Promise.reject(new Error('db down'));
      return Promise.resolve({ rows: [] });
    });

    await expect(importBoutiqueCSV(1, BTQ_CSV, 'logics.csv', 7, 'manuel', { force: true })).rejects.toThrow('db down');
    const c = clientCalls();
    expect(c.some((s) => /ROLLBACK/.test(s))).toBe(true);
    expect(c.some((s) => /COMMIT/.test(s))).toBe(false);
  });
});
