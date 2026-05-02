/**
 * Tests unitaires InvoiceRepository (V6.3 — pilote pattern Repository).
 * Mock du module pg config/database — aucune connexion réelle.
 */

jest.mock('../../../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const pool = require('../../../src/config/database');
const repo = require('../../../src/repositories/InvoiceRepository');

beforeEach(() => {
  pool.query.mockReset();
});

function makeFakeClient() {
  return { query: jest.fn() };
}

describe('InvoiceRepository.findAll', () => {
  test('sans filtre — query basique + ORDER BY date DESC', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });
    const rows = await repo.findAll();
    expect(rows).toHaveLength(2);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('FROM invoices WHERE 1=1');
    expect(sql).toContain('ORDER BY date DESC');
    expect(params).toEqual([]);
  });

  test('avec status — ajoute AND status = $1', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await repo.findAll({ status: 'paid' });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('AND status = $1');
    expect(params).toEqual(['paid']);
  });

  test('avec date_from + date_to — ajoute 2 filtres', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await repo.findAll({ date_from: '2026-01-01', date_to: '2026-12-31' });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('AND date >= $1');
    expect(sql).toContain('AND date <= $2');
    expect(params).toEqual(['2026-01-01', '2026-12-31']);
  });

  test('utilise le client passé en option si fourni', async () => {
    const client = makeFakeClient();
    client.query.mockResolvedValue({ rows: [{ id: 99 }] });
    await repo.findAll({}, { client });
    expect(client.query).toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('InvoiceRepository.findById', () => {
  test('retourne le row si trouvé', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 7, status: 'draft' }] });
    const inv = await repo.findById(7);
    expect(inv.id).toBe(7);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toBe('SELECT * FROM invoices WHERE id = $1');
    expect(params).toEqual([7]);
  });

  test('retourne null si absent', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    expect(await repo.findById(999)).toBeNull();
  });
});

describe('InvoiceRepository.findByIdWithLines', () => {
  test('renvoie invoice + lines triées', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 5, client_name: 'X' }] })
      .mockResolvedValueOnce({ rows: [{ position: 1 }, { position: 2 }] });
    const result = await repo.findByIdWithLines(5);
    expect(result.id).toBe(5);
    expect(result.client_name).toBe('X');
    expect(result.lines).toHaveLength(2);
  });

  test('renvoie null si invoice absente (et ne fetch pas les lignes)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    expect(await repo.findByIdWithLines(404)).toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe('InvoiceRepository.create', () => {
  test('exige un client en transaction', async () => {
    await expect(repo.create({}, [], {})).rejects.toThrow(/transaction/i);
  });

  test('insère entête + lignes via le client de transaction', async () => {
    const client = makeFakeClient();
    client.query
      .mockResolvedValueOnce({ rows: [{ id: 42, invoice_number: 'FAC-2026-0001' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const inserted = await repo.create(
      {
        invoice_number: 'FAC-2026-0001',
        client_name: 'Client A',
        client_address: 'Adresse',
        client_email: 'a@b.fr',
        date: '2026-05-02',
        due_date: '2026-06-02',
        total_ht: 100,
        total_tva: 20,
        total_ttc: 120,
        notes: null,
        created_by: 1,
      },
      [
        { description: 'Ligne 1', quantity: 1, unit_price: 50, total: 50 },
        { description: 'Ligne 2', quantity: 1, unit_price: 50, total: 50 },
      ],
      { client }
    );

    expect(inserted.id).toBe(42);
    expect(client.query).toHaveBeenCalledTimes(3); // 1 entête + 2 lignes
    const insertHeaderSql = client.query.mock.calls[0][0];
    expect(insertHeaderSql).toContain('INSERT INTO invoices');
    const insertLineSql = client.query.mock.calls[1][0];
    expect(insertLineSql).toContain('INSERT INTO invoice_lines');
    // position auto-incrémentée à partir de 1
    expect(client.query.mock.calls[1][1][1]).toBe(1);
    expect(client.query.mock.calls[2][1][1]).toBe(2);
  });
});

describe('InvoiceRepository.updateStatus', () => {
  test('status=paid ajoute paid_at = NOW()', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 1, status: 'paid' }] });
    await repo.updateStatus(1, 'paid');
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toContain('paid_at = NOW()');
    expect(sql).toContain('updated_at = NOW()');
  });

  test('status=sent ne touche pas paid_at', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 1, status: 'sent' }] });
    await repo.updateStatus(1, 'sent');
    const [sql] = pool.query.mock.calls[0];
    expect(sql).not.toContain('paid_at');
  });

  test('retourne null si facture absente', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    expect(await repo.updateStatus(999, 'sent')).toBeNull();
  });
});
