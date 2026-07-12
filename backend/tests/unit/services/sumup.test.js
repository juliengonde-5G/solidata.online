/**
 * Tests des helpers VAK/SumUp.
 * Couvre :
 *  - normalizePaymentMethod : POS/ECOM/marques carte → 'CB', numéraire → 'Espèces'
 *    (le paiement carte sur terminal SumUp `payment_type` = 'POS' doit compter en CB).
 *  - parseFRDate : l'horodatage de l'export SumUp est interprété en GMT/UTC,
 *    indépendamment du fuseau du serveur (évite le décalage ±1-2 h).
 */

const {
  normalizePaymentMethod, parseFRDate,
  isRefundTransaction, isSyncEligibleTransaction, mapSumUpTransaction,
} = require('../../../src/services/sumup');

describe('sumup — normalizePaymentMethod', () => {
  test('POS (carte terminal) → CB', () => {
    expect(normalizePaymentMethod('POS')).toBe('CB');
    expect(normalizePaymentMethod('pos')).toBe('CB');
  });

  test('carte en ligne / marques → CB', () => {
    ['ECOM', 'VISA', 'MASTERCARD', 'Carte bancaire', 'Sans contact', 'CONTACTLESS', 'Maestro', 'AMEX'].forEach((v) => {
      expect(normalizePaymentMethod(v)).toBe('CB');
    });
  });

  test('déjà normalisé CB reste CB', () => {
    expect(normalizePaymentMethod('CB')).toBe('CB');
  });

  test('numéraire → Espèces', () => {
    ['Espèces', 'Especes', 'cash', 'Numéraire', 'liquide'].forEach((v) => {
      expect(normalizePaymentMethod(v)).toBe('Espèces');
    });
  });

  test('libellé inconnu conservé tel quel', () => {
    expect(normalizePaymentMethod('Chèque')).toBe('Chèque');
  });

  test('vide / null → Inconnu', () => {
    expect(normalizePaymentMethod('')).toBe('Inconnu');
    expect(normalizePaymentMethod(null)).toBe('Inconnu');
    expect(normalizePaymentMethod(undefined)).toBe('Inconnu');
  });
});

describe('sumup — parseFRDate (GMT/UTC)', () => {
  test('interprète l\'heure de l\'export comme GMT', () => {
    const d = parseFRDate('15 mai 2026 10:15');
    expect(d.toISOString()).toBe('2026-05-15T10:15:00.000Z');
  });

  test('gère les secondes et les mois abrégés', () => {
    expect(parseFRDate('3 déc. 2026 09:05:30').toISOString()).toBe('2026-12-03T09:05:30.000Z');
    expect(parseFRDate('1 janv. 2027 00:00').toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  test('les champs UTC correspondent au texte (pas de dérive de fuseau)', () => {
    const d = parseFRDate('15 juillet 2026 14:30');
    expect(d.getUTCHours()).toBe(14);
    expect(d.getUTCMinutes()).toBe(30);
    expect(d.getUTCMonth()).toBe(6); // juillet = index 6
    expect(d.getUTCDate()).toBe(15);
  });

  test('chaîne invalide → null', () => {
    expect(parseFRDate('')).toBeNull();
    expect(parseFRDate('pas une date')).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════
// Remboursements (item 63a) — sémantique partagée CSV / API / webhook
// ══════════════════════════════════════════════════════════════════
describe('sumup — isRefundTransaction', () => {
  test('type REFUND (API) → remboursement', () => {
    expect(isRefundTransaction({ type: 'REFUND' })).toBe(true);
    expect(isRefundTransaction({ type: 'refund' })).toBe(true);
    expect(isRefundTransaction({ transaction_type: 'CHARGE_BACK' })).toBe(true);
    expect(isRefundTransaction({ type: 'chargeback' })).toBe(true);
  });

  test('colonne CSV « Remboursement » → remboursement (même sémantique)', () => {
    expect(isRefundTransaction({ type: 'Remboursement' })).toBe(true);
    expect(isRefundTransaction({ type: 'REMBOURSEMENT' })).toBe(true);
  });

  test('vente normale → pas un remboursement', () => {
    expect(isRefundTransaction({ type: 'PAYMENT' })).toBe(false);
    expect(isRefundTransaction({ type: 'Paiement' })).toBe(false);
  });

  test('original remboursé (statut REFUNDED, type PAYMENT) N\'EST PAS un événement de remboursement', () => {
    // Il reste le ticket de vente positif, netté par l'événement REFUND distinct.
    expect(isRefundTransaction({ type: 'PAYMENT', status: 'REFUNDED' })).toBe(false);
  });

  test('vide / null → false', () => {
    expect(isRefundTransaction({})).toBe(false);
    expect(isRefundTransaction(null)).toBe(false);
    expect(isRefundTransaction(undefined)).toBe(false);
  });
});

describe('sumup — isSyncEligibleTransaction', () => {
  test('ventes réussies retenues', () => {
    expect(isSyncEligibleTransaction({ type: 'PAYMENT', status: 'SUCCESSFUL' })).toBe(true);
    expect(isSyncEligibleTransaction({ type: 'PAYMENT', status: 'PAID' })).toBe(true);
  });

  test('remboursement retenu (ingéré en négatif)', () => {
    expect(isSyncEligibleTransaction({ type: 'REFUND', status: 'SUCCESSFUL' })).toBe(true);
    expect(isSyncEligibleTransaction({ type: 'REFUND', status: 'REFUNDED' })).toBe(true);
  });

  test('original remboursé (statut REFUNDED) retenu — reste un vrai ticket', () => {
    expect(isSyncEligibleTransaction({ type: 'PAYMENT', status: 'REFUNDED' })).toBe(true);
  });

  test('échec / annulation / en attente écartés', () => {
    expect(isSyncEligibleTransaction({ status: 'FAILED' })).toBe(false);
    expect(isSyncEligibleTransaction({ status: 'CANCELLED' })).toBe(false);
    expect(isSyncEligibleTransaction({ status: 'PENDING' })).toBe(false);
    expect(isSyncEligibleTransaction({ status: 'EXPIRED' })).toBe(false);
  });

  test('sans statut → tenté (comportement historique)', () => {
    expect(isSyncEligibleTransaction({})).toBe(true);
    expect(isSyncEligibleTransaction({ id: 'x' })).toBe(true);
  });
});

describe('sumup — mapSumUpTransaction (remboursements signés)', () => {
  test('cas remboursement API (avec line_items) → montants et poids NÉGATIFS', () => {
    const tx = { id: 'rf-1', type: 'REFUND', amount: 12.5, timestamp: '2026-05-15T10:00:00Z' };
    const detail = {
      transaction_code: 'RFND-1',
      type: 'REFUND',
      amount: 12.5,
      payment_type: 'POS', // carte terminal → CB
      line_items: [
        { name: 'Vente plus de 5 kg', quantity: 5, unit: 'kg', total_price: 12.5, vat_rate: 20 },
      ],
    };
    const m = mapSumUpTransaction(tx, detail);
    expect(m.isRefund).toBe(true);
    expect(m.refTx).toBe('RFND-1');
    expect(m.moyenPaiement).toBe('CB');
    expect(m.totalTTC).toBeCloseTo(-12.5, 2);
    expect(m.totalHT).toBeCloseTo(-12.5 / 1.2, 2);
    expect(m.poidsTicket).toBeCloseTo(-5, 3);
    expect(m.nbArticles).toBe(1);
    expect(m.lignes).toHaveLength(1);
    expect(m.lignes[0].quantite).toBeCloseTo(-5, 3);
    expect(m.lignes[0].total_ttc).toBeCloseTo(-12.5, 2);
    expect(m.lignes[0].segment).toBe('textile_vrac');
  });

  test('cas remboursement WEBHOOK (payload fin puis détail sans line_items) → ligne globale négative', () => {
    // Webhook : la charge initiale ne porte pas le type ; le détail récupéré
    // via /transactions/{id} porte type REFUND et pas de line_items → fallback 1 ligne.
    const tx = { id: 'rf-2' };
    const detail = { transaction_code: 'RFND-2', type: 'REFUND', amount: 8, payment_type: 'CASH' };
    const m = mapSumUpTransaction(tx, detail);
    expect(m.isRefund).toBe(true);
    expect(m.refTx).toBe('RFND-2');
    expect(m.moyenPaiement).toBe('Espèces');
    expect(m.totalTTC).toBeCloseTo(-8, 2);
    expect(m.totalHT).toBeCloseTo(-8 / 1.2, 2);
    expect(m.totalTVA).toBeCloseTo(-(8 - 8 / 1.2), 2);
    expect(m.lignes).toHaveLength(1);
    expect(m.lignes[0].quantite).toBe(-1);
    expect(m.lignes[0].total_ttc).toBeCloseTo(-8, 2);
    expect(m.poidsTicket).toBe(0); // pce, pas de kg
  });

  test('régression : vente normale reste POSITIVE', () => {
    const detail = {
      transaction_code: 'OK-1', type: 'PAYMENT', amount: 20, payment_type: 'POS',
      line_items: [{ name: 'Chaussures', quantity: 2, unit: 'pce', total_price: 20, vat_rate: 20 }],
    };
    const m = mapSumUpTransaction(detail, detail);
    expect(m.isRefund).toBe(false);
    expect(m.totalTTC).toBeCloseTo(20, 2);
    expect(m.lignes[0].quantite).toBe(2);
    expect(m.lignes[0].total_ttc).toBeCloseTo(20, 2);
    expect(m.lignes[0].segment).toBe('chaussures');
    expect(m.moyenPaiement).toBe('CB');
  });

  test('régression : vente au kilo positive → poids positif', () => {
    const detail = {
      transaction_code: 'OK-2', type: 'PAYMENT', amount: 15, payment_type: 'VISA',
      line_items: [{ name: 'Vente moins de 5 kg', quantity: 3, unit: 'kg', total_price: 15, vat_rate: 20 }],
    };
    const m = mapSumUpTransaction(detail, detail);
    expect(m.isRefund).toBe(false);
    expect(m.poidsTicket).toBeCloseTo(3, 3);
    expect(m.lignes[0].segment).toBe('textile_vrac');
  });
});
