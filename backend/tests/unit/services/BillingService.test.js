/**
 * Tests du BillingService (V5.4).
 * Couvre : numérotation, calcul totaux HT/TVA/TTC, transitions statut.
 */

const billingService = require('../../../src/services/BillingService');

describe('BillingService — calculateTotals', () => {
  test('retourne 0 pour un tableau vide', () => {
    const r = billingService.calculateTotals([]);
    expect(r.totalHT).toBe(0);
    expect(r.totalTVA).toBe(0);
    expect(r.totalTTC).toBe(0);
    expect(r.lineDetails).toEqual([]);
  });

  test('calcule HT/TVA/TTC avec TVA 20% par défaut', () => {
    const r = billingService.calculateTotals([
      { quantity: 2, unit_price: 100 },
      { quantity: 1, unit_price: 50 },
    ]);
    expect(r.totalHT).toBe(250);
    expect(r.totalTVA).toBe(50);
    expect(r.totalTTC).toBe(300);
  });

  test('arrondit au centime', () => {
    const r = billingService.calculateTotals([
      { quantity: 3, unit_price: 33.333 },
    ]);
    expect(r.totalHT).toBe(100);
    expect(r.totalTVA).toBe(20);
    expect(r.totalTTC).toBe(120);
  });

  test('supporte un taux TVA personnalisé (10%)', () => {
    const r = billingService.calculateTotals(
      [{ quantity: 1, unit_price: 100 }],
      0.10
    );
    expect(r.totalHT).toBe(100);
    expect(r.totalTVA).toBe(10);
    expect(r.totalTTC).toBe(110);
  });

  test('quantité par défaut = 1 si absente', () => {
    const r = billingService.calculateTotals([{ unit_price: 50 }]);
    expect(r.totalHT).toBe(50);
    expect(r.lineDetails[0].quantity).toBe(1);
  });

  test('unit_price absent → 0', () => {
    const r = billingService.calculateTotals([{ quantity: 5 }]);
    expect(r.totalHT).toBe(0);
  });

  test('lineDetails contient le total par ligne', () => {
    const r = billingService.calculateTotals([
      { description: 'A', quantity: 2, unit_price: 10 },
      { description: 'B', quantity: 3, unit_price: 5 },
    ]);
    expect(r.lineDetails[0].total).toBe(20);
    expect(r.lineDetails[1].total).toBe(15);
    expect(r.lineDetails[0].description).toBe('A');
  });
});

describe('BillingService — canTransitionStatus', () => {
  test('refuse un statut invalide', () => {
    const r = billingService.canTransitionStatus('draft', 'wat');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/invalide/i);
  });

  test('autorise draft → sent', () => {
    expect(billingService.canTransitionStatus('draft', 'sent').ok).toBe(true);
  });

  test('autorise sent → paid', () => {
    expect(billingService.canTransitionStatus('sent', 'paid').ok).toBe(true);
  });

  test('refuse paid → draft (terminal)', () => {
    const r = billingService.canTransitionStatus('paid', 'draft');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/non autorisée/);
  });

  test('refuse cancelled → toute autre (terminal)', () => {
    expect(billingService.canTransitionStatus('cancelled', 'sent').ok).toBe(false);
    expect(billingService.canTransitionStatus('cancelled', 'paid').ok).toBe(false);
  });

  test('autorise overdue → paid', () => {
    expect(billingService.canTransitionStatus('overdue', 'paid').ok).toBe(true);
  });

  test('création (fromStatus null) → draft seul autorisé', () => {
    expect(billingService.canTransitionStatus(null, 'draft').ok).toBe(true);
    expect(billingService.canTransitionStatus(null, 'sent').ok).toBe(false);
    expect(billingService.canTransitionStatus(undefined, 'draft').ok).toBe(true);
  });
});

describe('BillingService — generateInvoiceNumber', () => {
  test('refuse identifiants non-sûrs (anti-injection)', async () => {
    const fakePool = { query: jest.fn() };
    await expect(
      billingService.generateInvoiceNumber(fakePool, "FAC'; DROP TABLE", 'invoices', 'invoice_number')
    ).rejects.toThrow(/Identifiants invalides/);
    expect(fakePool.query).not.toHaveBeenCalled();
  });

  test('génère 0001 si table vide', async () => {
    const fakePool = {
      query: jest.fn().mockResolvedValue({ rows: [{ last: null }] }),
    };
    const num = await billingService.generateInvoiceNumber(fakePool, 'FAC', 'invoices', 'invoice_number', 2026);
    expect(num).toBe('FAC-2026-0001');
  });

  test('incrémente le dernier numéro', async () => {
    const fakePool = {
      query: jest.fn().mockResolvedValue({ rows: [{ last: 'FAC-2026-0042' }] }),
    };
    const num = await billingService.generateInvoiceNumber(fakePool, 'FAC', 'invoices', 'invoice_number', 2026);
    expect(num).toBe('FAC-2026-0043');
  });

  test('retourne 0001 si parsing du dernier numéro échoue', async () => {
    const fakePool = {
      query: jest.fn().mockResolvedValue({ rows: [{ last: 'FAC-2026-XXXX' }] }),
    };
    const num = await billingService.generateInvoiceNumber(fakePool, 'FAC', 'invoices', 'invoice_number', 2026);
    expect(num).toBe('FAC-2026-0001');
  });
});
