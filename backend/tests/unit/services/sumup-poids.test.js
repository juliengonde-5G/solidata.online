/**
 * Tests du calcul de POIDS sur les remontées SumUp (Lot 6 — bug client
 * « les poids des ventes au cours de la VAK sont tous à zéro »).
 *
 * Cause racine testée : les produits des transactions API
 * (/v0.1/me/transactions) et des webhooks SumUp n'ont PAS de champ `unit`
 * (name/description + quantity + price seulement). L'ancien code ne détectait
 * le kilo que via `unit` → unité 'pce' par défaut → poids 0 sur TOUT le flux
 * API/webhook (seul le CSV, qui a une colonne « Unité », donnait un poids).
 *
 * Correctif testé : helper partagé isKgItem(description, unite) —
 *   1. unité explicite non vide → 'kg' ssi elle contient « kg » (chemin CSV) ;
 *   2. unité absente → produit au kilo ssi le libellé matche le mapping
 *      textile au kilo (« Vente moins de 5 kg », « Vente plus de 5 kilos »…),
 *      la caisse SumUp saisissant le poids pesé dans `quantity`.
 * L'unité inférée est stockée ('kg') pour que les agrégats SQL
 * (`unite ILIKE '%kg%'` dans routes/vak.js) restent cohérents.
 */

const { isKgItem, mapSumUpTransaction, getSegment } = require('../../../src/services/sumup');

describe('sumup — isKgItem (détection vendu au kilo)', () => {
  test('unité explicite kg → au kilo (chemin CSV, insensible à la casse)', () => {
    expect(isKgItem('Vente moins de 5 kg', 'kg')).toBe(true);
    expect(isKgItem("n'importe quoi", 'KG')).toBe(true);
    expect(isKgItem('', 'kg')).toBe(true);
  });

  test("unité explicite non-kg → l'unité FAIT FOI même sur un libellé textile", () => {
    expect(isKgItem('Vente moins de 5 kg', 'pce')).toBe(false);
    expect(isKgItem('Vente plus de 5 kilos', 'paire')).toBe(false);
  });

  test('unité absente + libellé textile au kilo → au kilo (chemin API/webhook)', () => {
    expect(isKgItem('Vente moins de 5 kg', '')).toBe(true);
    expect(isKgItem('Vente plus de 5 kilos', '')).toBe(true);
    expect(isKgItem('Vente plus de 5 kg', null)).toBe(true);
    expect(isKgItem('VENTE MOINS DE 5 KG', undefined)).toBe(true);
  });

  test('unité absente + chaussures / consommables → à la pièce', () => {
    expect(isKgItem('Chaussures', '')).toBe(false);
    expect(isKgItem('Sacs', '')).toBe(false);
    expect(isKgItem('Sac', null)).toBe(false);
  });

  test('unité absente + libellé inconnu → à la pièce (jamais de poids inventé)', () => {
    expect(isKgItem('Article divers', '')).toBe(false);
    expect(isKgItem('', '')).toBe(false);
    expect(isKgItem(null, null)).toBe(false);
  });
});

describe('sumup — mapSumUpTransaction : poids depuis les remontées API (produits SANS unité)', () => {
  test('vente textile au kilo — produit « Vente moins de 5 kg » quantity 3.2 → poids 3.2 kg', () => {
    // Fixture réaliste : détail /v0.1/me/transactions?id=… — champ `products`,
    // PAS de champ `unit`, prix unitaire dans `price`.
    const detail = {
      id: 'tx-api-1',
      transaction_code: 'TE4X7SAMPL',
      type: 'PAYMENT',
      status: 'SUCCESSFUL',
      amount: 8.0,
      currency: 'EUR',
      timestamp: '2026-07-18T09:12:00.000Z',
      payment_type: 'POS',
      entry_mode: 'CONTACTLESS',
      products: [
        { name: 'Vente moins de 5 kg', price: 2.5, quantity: 3.2, total_price: 8.0, vat_rate: 20 },
      ],
    };
    const m = mapSumUpTransaction(detail, detail);
    expect(m.isRefund).toBe(false);
    expect(m.poidsTicket).toBeCloseTo(3.2, 3);
    expect(m.totalTTC).toBeCloseTo(8.0, 2);
    expect(m.nbArticles).toBe(1);
    expect(m.lignes).toHaveLength(1);
    expect(m.lignes[0].unite).toBe('kg');            // unité inférée STOCKÉE → agrégats SQL cohérents
    expect(m.lignes[0].quantite).toBeCloseTo(3.2, 3);
    expect(m.lignes[0].segment).toBe('textile_vrac');
    expect(m.lignes[0].prix_unitaire_ttc).toBeCloseTo(2.5, 2); // `price` API pris en compte
    expect(m.moyenPaiement).toBe('CB');
  });

  test('remboursement API (type REFUND) sans unité → poids NÉGATIF', () => {
    const detail = {
      id: 'tx-api-2',
      transaction_code: 'RFNDSAMPLE',
      type: 'REFUND',
      status: 'SUCCESSFUL',
      amount: 13.0,
      timestamp: '2026-07-18T14:03:00.000Z',
      payment_type: 'POS',
      products: [
        { name: 'Vente plus de 5 kilos', price: 2.0, quantity: 6.5, total_price: 13.0, vat_rate: 20 },
      ],
    };
    const m = mapSumUpTransaction(detail, detail);
    expect(m.isRefund).toBe(true);
    expect(m.poidsTicket).toBeCloseTo(-6.5, 3);
    expect(m.totalTTC).toBeCloseTo(-13.0, 2);
    expect(m.lignes[0].unite).toBe('kg');
    expect(m.lignes[0].quantite).toBeCloseTo(-6.5, 3);
  });

  test('produit consommable (sacs) sans unité → poids 0, unité pce', () => {
    const detail = {
      id: 'tx-api-3',
      transaction_code: 'SACSAMPLE1',
      type: 'PAYMENT',
      status: 'SUCCESSFUL',
      amount: 2.0,
      payment_type: 'CASH',
      products: [
        { name: 'Sacs', price: 1.0, quantity: 2, total_price: 2.0, vat_rate: 20 },
      ],
    };
    const m = mapSumUpTransaction(detail, detail);
    expect(m.poidsTicket).toBe(0);
    expect(m.lignes[0].unite).toBe('pce');
    expect(m.lignes[0].segment).toBe('consommables');
    expect(m.moyenPaiement).toBe('Espèces');
  });

  test('chaussures sans unité → poids 0 (vendues à la pièce)', () => {
    const detail = {
      id: 'tx-api-4',
      transaction_code: 'CHAUSAMPLE',
      type: 'PAYMENT',
      amount: 6.0,
      payment_type: 'POS',
      products: [{ name: 'Chaussures', price: 3.0, quantity: 2, total_price: 6.0 }],
    };
    const m = mapSumUpTransaction(detail, detail);
    expect(m.poidsTicket).toBe(0);
    expect(m.lignes[0].segment).toBe('chaussures');
  });

  test('ticket mixte textile + sacs → seul le textile pèse', () => {
    const detail = {
      id: 'tx-api-5',
      transaction_code: 'MIXSAMPLE1',
      type: 'PAYMENT',
      amount: 11.25,
      payment_type: 'POS',
      products: [
        { name: 'Vente moins de 5 kg', price: 2.5, quantity: 4.1, total_price: 10.25 },
        { name: 'Sac', price: 1.0, quantity: 1, total_price: 1.0 },
      ],
    };
    const m = mapSumUpTransaction(detail, detail);
    expect(m.poidsTicket).toBeCloseTo(4.1, 3);
    expect(m.nbArticles).toBe(2);
    expect(m.lignes[0].unite).toBe('kg');
    expect(m.lignes[1].unite).toBe('pce');
  });

  test('flux webhook : résumé fin + détail récupéré avec `products` → poids depuis le détail', () => {
    // Le webhook ne porte que l'id ; le détail est récupéré ensuite
    // (fetchTransactionDetail) et passé en 2e argument.
    const summary = { id: 'tx-wh-1' };
    const detail = {
      id: 'tx-wh-1',
      transaction_code: 'WHKSAMPLE1',
      type: 'PAYMENT',
      status: 'SUCCESSFUL',
      amount: 5.0,
      payment_type: 'POS',
      products: [{ name: 'Vente moins de 5 kg', price: 2.5, quantity: 2, total_price: 5.0 }],
    };
    const m = mapSumUpTransaction(summary, detail);
    expect(m.refTx).toBe('WHKSAMPLE1');
    expect(m.poidsTicket).toBeCloseTo(2, 3);
    expect(m.lignes[0].unite).toBe('kg');
  });

  test('unité explicite `unit: "pce"` sur un libellé textile → respectée (poids 0)', () => {
    const detail = {
      id: 'tx-api-6',
      transaction_code: 'UNITSAMPLE',
      type: 'PAYMENT',
      amount: 5.0,
      payment_type: 'POS',
      line_items: [{ name: 'Vente moins de 5 kg', quantity: 2, unit: 'pce', total_price: 5.0 }],
    };
    const m = mapSumUpTransaction(detail, detail);
    expect(m.poidsTicket).toBe(0);
    expect(m.lignes[0].unite).toBe('pce');
  });

  test('ticket sans détail produits → poids 0 (jamais inventé), segment dérivé du libellé', () => {
    const detail = {
      id: 'tx-api-7',
      transaction_code: 'NODETAIL01',
      type: 'PAYMENT',
      amount: 7.5,
      payment_type: 'POS',
      description: 'Vente moins de 5 kg',
    };
    const m = mapSumUpTransaction(detail, detail);
    expect(m.poidsTicket).toBe(0); // quantité inconnue → pas de poids inventé
    expect(m.lignes).toHaveLength(1);
    expect(m.lignes[0].segment).toBe('textile_vrac'); // mais le segment reste honnête
    expect(m.totalTTC).toBeCloseTo(7.5, 2);
  });

  test('régression : line_items AVEC unité kg explicite (fixtures historiques) inchangés', () => {
    const detail = {
      transaction_code: 'LEGACY0001',
      type: 'PAYMENT',
      amount: 15,
      payment_type: 'VISA',
      line_items: [{ name: 'Vente moins de 5 kg', quantity: 3, unit: 'kg', total_price: 15, vat_rate: 20 }],
    };
    const m = mapSumUpTransaction(detail, detail);
    expect(m.poidsTicket).toBeCloseTo(3, 3);
    expect(m.lignes[0].unite).toBe('kg');
  });
});

describe('sumup — cohérence segment/poids', () => {
  test('le mapping segments reste la source du textile au kilo', () => {
    // Garde-fou : si le mapping change, isKgItem suit automatiquement.
    ['vente moins de 5 kg', 'Vente plus de 5 kilos', 'VENTE PLUS DE 5 KG'].forEach((d) => {
      expect(getSegment(d)).toBe('textile_vrac');
      expect(isKgItem(d, '')).toBe(true);
    });
  });
});
