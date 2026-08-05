/**
 * Tests des helpers VAK/SumUp.
 * Couvre :
 *  - normalizePaymentMethod : POS/ECOM/marques carte → 'CB', numéraire → 'Espèces'
 *    (le paiement carte sur terminal SumUp `payment_type` = 'POS' doit compter en CB).
 *  - parseFRDate (Lot 12 « heure de Paris ») : l'horodatage de l'export CSV
 *    SumUp est une heure MURALE FRANÇAISE (Europe/Paris) → convertie en
 *    instant UTC pour le stockage (offset +2 h été / +1 h hiver), quel que
 *    soit le fuseau du serveur. Le stockage reste en UTC, l'affichage et
 *    l'agrégation se font en Europe/Paris.
 */

const {
  normalizePaymentMethod, parseFRDate, parisWallClockToUTC, parisDateStr,
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

describe('sumup — parseFRDate (heure de Paris → stockage UTC)', () => {
  test('été (UTC+2) : « 15 mai 2026 10:15 » Paris → stocké 08:15 UTC', () => {
    const d = parseFRDate('15 mai 2026 10:15');
    expect(d.toISOString()).toBe('2026-05-15T08:15:00.000Z');
  });

  test('hiver (UTC+1) : une date de janvier 10:15 → stockée 09:15 UTC', () => {
    const d = parseFRDate('15 janvier 2026 10:15');
    expect(d.toISOString()).toBe('2026-01-15T09:15:00.000Z');
  });

  test('gère les secondes et les mois abrégés (hiver UTC+1)', () => {
    expect(parseFRDate('3 déc. 2026 09:05:30').toISOString()).toBe('2026-12-03T08:05:30.000Z');
    // Minuit Paris le 1er janvier = 23:00 UTC la veille (le jour civil Paris
    // est préservé par parisDateStr côté rattachement VAK).
    expect(parseFRDate('1 janv. 2027 00:00').toISOString()).toBe('2026-12-31T23:00:00.000Z');
  });

  test('les champs correspondent à l\'heure murale Paris (pas de dérive de fuseau serveur)', () => {
    const d = parseFRDate('15 juillet 2026 14:30');
    expect(d.getUTCHours()).toBe(12); // 14:30 Paris été = 12:30 UTC
    expect(d.getUTCMinutes()).toBe(30);
    expect(d.getUTCMonth()).toBe(6); // juillet = index 6
    expect(d.getUTCDate()).toBe(15);
    // Reprojeté en Europe/Paris, on retrouve l'heure du CSV
    expect(new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit',
    }).format(d)).toBe('14:30');
  });

  test('bascules d\'heure d\'été 2026 (29 mars / 25 octobre)', () => {
    // Juste après le passage à l'heure d'été (dernier dimanche de mars) : UTC+2
    expect(parseFRDate('29 mars 2026 03:00').toISOString()).toBe('2026-03-29T01:00:00.000Z');
    // Juste après le retour à l'heure d'hiver (dernier dimanche d'octobre) : UTC+1
    expect(parseFRDate('25 oct. 2026 04:00').toISOString()).toBe('2026-10-25T03:00:00.000Z');
  });

  test('chaîne invalide → null', () => {
    expect(parseFRDate('')).toBeNull();
    expect(parseFRDate('pas une date')).toBeNull();
  });
});

describe('sumup — helpers fuseau Europe/Paris', () => {
  test('parisWallClockToUTC : été +2 h, hiver +1 h', () => {
    expect(parisWallClockToUTC(2026, 6, 15, 10, 0, 0).toISOString()).toBe('2026-07-15T08:00:00.000Z');
    expect(parisWallClockToUTC(2026, 0, 15, 10, 0, 0).toISOString()).toBe('2026-01-15T09:00:00.000Z');
  });

  test('parisDateStr : jour civil Paris (et non date UTC)', () => {
    // 23:30 UTC un 14 juillet = 01:30 Paris le 15 juillet
    expect(parisDateStr(new Date('2026-07-14T23:30:00Z'))).toBe('2026-07-15');
    // 23:30 UTC un 14 janvier = 00:30 Paris le 15 janvier
    expect(parisDateStr(new Date('2026-01-14T23:30:00Z'))).toBe('2026-01-15');
    // Milieu de journée : dates identiques
    expect(parisDateStr(new Date('2026-05-15T08:15:00Z'))).toBe('2026-05-15');
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
