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
 *   2. unité absente → produit au kilo ssi le libellé tombe dans un segment
 *      au poids (KG_SEGMENTS = textile_vrac + chaussures : « Vente moins de
 *      5 kg », « Vente plus de 5 kilos », « Chaussures »…), la caisse SumUp
 *      saisissant le poids pesé (décimal) dans `quantity` et le €/kg en prix.
 * L'unité inférée est stockée ('kg') pour que les agrégats SQL
 * (`unite ILIKE '%kg%'` dans routes/vak.js) restent cohérents.
 *
 * Extension chaussures (données réelles marchand FRIP & CO, 07/08/2026) :
 * la liste des ventes SumUp affiche « 1.595 x Chaussures » = 1,595 kg pesé
 * × 3,00 €/kg — les chaussures sont vendues AU POIDS, comme le textile en
 * vrac ; seuls les consommables (sacs) restent à la pièce.
 */

const {
  isKgItem, mapSumUpTransaction, getSegment, KG_SEGMENTS,
  toNumber, isProbablySyntheticLines, fetchTransactionDetailStrict,
  hasProductItems, unwrapTransactionResponse,
} = require('../../../src/services/sumup');

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

  test('unité absente + chaussures → AU KILO (quantité SumUp = poids pesé, prix = €/kg)', () => {
    expect(isKgItem('Chaussures', '')).toBe(true);
    expect(isKgItem('chaussures', null)).toBe(true);
    expect(isKgItem('CHAUSSURES', undefined)).toBe(true);
  });

  test('unité absente + consommables (sacs) → à la pièce', () => {
    expect(isKgItem('Sacs', '')).toBe(false);
    expect(isKgItem('Sac', null)).toBe(false);
  });

  test('KG_SEGMENTS = source unique de la règle « au poids » (textile_vrac + chaussures)', () => {
    expect(KG_SEGMENTS).toEqual(['textile_vrac', 'chaussures']);
    expect(KG_SEGMENTS).not.toContain('consommables');
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

  test('chaussures sans unité → AU KILO (quantité décimale = poids pesé)', () => {
    const detail = {
      id: 'tx-api-4',
      transaction_code: 'CHAUSAMPLE',
      type: 'PAYMENT',
      amount: 6.0,
      payment_type: 'POS',
      products: [{ name: 'Chaussures', price: 3.0, quantity: 2, total_price: 6.0 }],
    };
    const m = mapSumUpTransaction(detail, detail);
    expect(m.poidsTicket).toBeCloseTo(2, 3); // 2,000 kg de chaussures à 3 €/kg
    expect(m.lignes[0].unite).toBe('kg');
    expect(m.lignes[0].segment).toBe('chaussures');
  });

  test('FIXTURE RÉELLE TAAA4NKXTDV (FRIP & CO, 07/08/2026 12:10) — chaussures + textile au poids → 12,17 kg', () => {
    // Captures SumUp de production : ticket 64,00 € en espèces, 2 articles.
    // La liste des ventes affiche « 1.595 x Chaussures, 10.575 x Vente Plus de
    // 5 kilos » : la quantité EST le poids en kg, le prix unitaire un €/kg.
    //  - Chaussures            : 1,595 kg × 3,00 €/kg = 4,78 € (HT 3,98, TVA 20 % 0,80)
    //  - Vente Plus de 5 kilos : 10,575 kg × 5,60 €/kg = 59,22 € (HT 49,35, TVA 9,87)
    // AVANT l'extension chaussures, le ticket comptait 10,575 kg (le poids des
    // chaussures était PERDU) au lieu des 12,17 kg lus dans SumUp.
    const detail = {
      id: 'tx-frip-1',
      transaction_code: 'TAAA4NKXTDV',
      type: 'PAYMENT',
      status: 'SUCCESSFUL',
      amount: 64.0,
      currency: 'EUR',
      timestamp: '2026-08-07T10:10:00.000Z', // 12:10 heure de Paris (été, UTC+2)
      payment_type: 'CASH',
      products: [
        { name: 'Chaussures', price: 3.0, quantity: 1.595, total_price: 4.78, vat_amount: 0.80, vat_rate: 20 },
        { name: 'Vente Plus de 5 kilos', price: 5.6, quantity: 10.575, total_price: 59.22, vat_amount: 9.87, vat_rate: 20 },
      ],
    };
    const m = mapSumUpTransaction(detail, detail);
    expect(m.refTx).toBe('TAAA4NKXTDV');
    expect(m.isRefund).toBe(false);
    expect(m.moyenPaiement).toBe('Espèces');
    expect(m.totalTTC).toBeCloseTo(64.0, 2);           // CA du ticket
    expect(m.poidsTicket).toBeCloseTo(12.17, 3);       // 1,595 + 10,575 kg — lecture équivalente à SumUp
    expect(m.nbArticles).toBe(2);
    // Ligne chaussures : au kilo, quantité décimale préservée.
    expect(m.lignes[0].description).toBe('Chaussures');
    expect(m.lignes[0].segment).toBe('chaussures');
    expect(m.lignes[0].unite).toBe('kg');
    expect(m.lignes[0].quantite).toBeCloseTo(1.595, 3);
    expect(m.lignes[0].prix_unitaire_ttc).toBeCloseTo(3.0, 2);   // €/kg
    expect(m.lignes[0].total_ttc).toBeCloseTo(4.78, 2);
    // Ligne textile vrac.
    expect(m.lignes[1].segment).toBe('textile_vrac');
    expect(m.lignes[1].unite).toBe('kg');
    expect(m.lignes[1].quantite).toBeCloseTo(10.575, 3);
    expect(m.lignes[1].prix_unitaire_ttc).toBeCloseTo(5.6, 2);   // €/kg
    expect(m.lignes[1].total_ttc).toBeCloseTo(59.22, 2);
  });

  test('« 2 x Sacs » (quantité entière, à la pièce) → poids 0, unité pce (données réelles)', () => {
    // Ligne réelle observée : « 2 x Sacs, 2.755 x Vente Moins de 5 Kg » —
    // les sacs sont bien à la pièce, seul le textile pèse.
    const detail = {
      id: 'tx-frip-2',
      transaction_code: 'SACSFRIP01',
      type: 'PAYMENT',
      amount: 15.98,
      payment_type: 'POS',
      products: [
        { name: 'Sacs', price: 0.5, quantity: 2, total_price: 1.0 },
        { name: 'Vente Moins de 5 Kg', price: 5.44, quantity: 2.755, total_price: 14.98 },
      ],
    };
    const m = mapSumUpTransaction(detail, detail);
    expect(m.lignes[0].unite).toBe('pce');
    expect(m.lignes[0].segment).toBe('consommables');
    expect(m.poidsTicket).toBeCloseTo(2.755, 3); // les 2 sacs ne pèsent pas
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

  test('ticket sans détail → indicateur « sans détail » : hasRealItems=false, ligne synthétique JAMAIS en kg', () => {
    // Bug « poids trop faibles » : la ligne globale synthétique quantité 1 ne
    // doit JAMAIS être marquée 'kg' (elle compterait ~1 kg par vente au lieu
    // du poids pesé). Le ticket doit être signalé sans détail à l'appelant.
    const detail = {
      id: 'tx-api-8', transaction_code: 'NODETAIL02', type: 'PAYMENT',
      amount: 12.8, payment_type: 'POS', description: 'Vente plus de 5 kilos',
    };
    const m = mapSumUpTransaction(detail, detail);
    expect(m.hasRealItems).toBe(false);          // → compté « ticket sans détail »
    expect(m.lignes[0].synthetic).toBe(true);    // ligne globale marquée
    expect(m.lignes[0].unite).toBe('pce');       // jamais 'kg' par défaut
    expect(m.lignes[0].quantite).toBe(1);        // artefact (1 ticket), pas un poids
    expect(m.poidsTicket).toBe(0);               // poids inconnu → 0, jamais 1 kg
  });

  test('ticket AVEC produits → hasRealItems=true, aucune ligne synthetic', () => {
    const detail = {
      id: 'tx-api-9', transaction_code: 'REALDETAIL', type: 'PAYMENT', amount: 8,
      payment_type: 'POS',
      products: [{ name: 'Vente moins de 5 kg', price: 2.5, quantity: 3.2, total_price: 8 }],
    };
    const m = mapSumUpTransaction(detail, detail);
    expect(m.hasRealItems).toBe(true);
    expect(m.lignes[0].synthetic).toBeUndefined();
  });

  test('quantité décimale reçue en CHAÎNE ("3.2" et "3,2" FR) → préservée, jamais tronquée', () => {
    // SumUp renvoie normalement des nombres, mais une quantité en chaîne à
    // virgule décimale donnait NaN (Number("3,2")) → poids perdu/corrompu.
    for (const q of [3.2, '3.2', '3,2']) {
      const detail = {
        id: 'tx-str', transaction_code: 'STRQTY0001', type: 'PAYMENT', amount: 8,
        payment_type: 'POS',
        products: [{ name: 'Vente moins de 5 kg', price: 2.5, quantity: q, total_price: 8 }],
      };
      const m = mapSumUpTransaction(detail, detail);
      expect(m.poidsTicket).toBeCloseTo(3.2, 3);
      expect(m.lignes[0].quantite).toBeCloseTo(3.2, 3);
    }
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

  test('les chaussures passent par getSegment (pas de liste de libellés dupliquée)', () => {
    ['Chaussures', 'chaussure', 'CHAUSSURES ENFANT'].forEach((d) => {
      expect(getSegment(d)).toBe('chaussures');
      expect(isKgItem(d, '')).toBe(true);
    });
  });

  test('tout segment de KG_SEGMENTS est au kilo via isKgItem, les autres non', () => {
    // isKgItem doit refléter exactement KG_SEGMENTS via getSegment.
    expect(isKgItem('Chaussures', '')).toBe(KG_SEGMENTS.includes('chaussures'));
    expect(isKgItem('Vente moins de 5 kg', '')).toBe(KG_SEGMENTS.includes('textile_vrac'));
    expect(isKgItem('Sacs', '')).toBe(KG_SEGMENTS.includes('consommables'));
  });
});

describe('sumup — toNumber (parsing robuste des quantités/prix)', () => {
  test('nombres et chaînes point/virgule décimale', () => {
    expect(toNumber(3.2)).toBe(3.2);
    expect(toNumber('3.2')).toBe(3.2);
    expect(toNumber('3,2')).toBe(3.2);
    expect(toNumber('1 234,5')).toBe(1234.5);
    expect(toNumber(0)).toBe(0); // 0 n'est pas « absent »
  });

  test('valeurs invalides → null (jamais NaN)', () => {
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber('')).toBeNull();
    expect(toNumber('abc')).toBeNull();
    expect(toNumber(NaN)).toBeNull();
  });
});

describe('sumup — isProbablySyntheticLines (forme de la ligne globale stockée)', () => {
  test('1 ligne |quantité| = 1 → synthétique probable (vente OU remboursement)', () => {
    expect(isProbablySyntheticLines([{ quantite: 1 }])).toBe(true);
    expect(isProbablySyntheticLines([{ quantite: -1 }])).toBe(true);
    expect(isProbablySyntheticLines([{ quantite: '1' }])).toBe(true);
  });

  test('quantité décimale réelle ou plusieurs lignes → PAS synthétique', () => {
    expect(isProbablySyntheticLines([{ quantite: 3.2 }])).toBe(false);
    expect(isProbablySyntheticLines([{ quantite: 1 }, { quantite: 1 }])).toBe(false);
    expect(isProbablySyntheticLines([])).toBe(false);
    expect(isProbablySyntheticLines(null)).toBe(false);
  });
});

describe('sumup — fetchTransactionDetailStrict (cascade des formes du « retrieve »)', () => {
  const detailAvecProduits = {
    id: 'tx-1', transaction_code: 'CODE1', amount: 8,
    products: [{ name: 'Vente moins de 5 kg', quantity: 3.2, price: 2.5 }],
  };
  const resumeSansProduits = { id: 'tx-1', transaction_code: 'CODE1', amount: 8 };

  test('1re forme (?id=) échoue → 2e forme (?transaction_code=) avec produits retenue', async () => {
    const apiGet = jest.fn()
      .mockRejectedValueOnce(new Error('SumUp 404 /v0.1/me/transactions'))
      .mockResolvedValueOnce(detailAvecProduits);
    const r = await fetchTransactionDetailStrict({ id: 'tx-1', transactionCode: 'CODE1' }, { apiGet });
    expect(r.ok).toBe(true);
    expect(r.has_products).toBe(true);
    expect(r.via).toBe('query_transaction_code');
    expect(r.detail.products[0].quantity).toBe(3.2);
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts[0].ok).toBe(false);
  });

  test('préfère une forme AVEC produits à une forme valide sans produits', async () => {
    // ?id= répond un RÉSUMÉ valide sans produits ; ?transaction_code= répond
    // le détail complet → c'est lui qui doit être retenu (le résumé ferait
    // retomber le poids à 0).
    const apiGet = jest.fn()
      .mockResolvedValueOnce(resumeSansProduits)
      .mockResolvedValueOnce(detailAvecProduits);
    const r = await fetchTransactionDetailStrict({ id: 'tx-1', transactionCode: 'CODE1' }, { apiGet });
    expect(r.ok).toBe(true);
    expect(r.has_products).toBe(true);
    expect(r.via).toBe('query_transaction_code');
  });

  test('toutes les formes valides mais SANS produits → ok, has_products=false (ticket « sans détail »)', async () => {
    const apiGet = jest.fn().mockResolvedValue(resumeSansProduits);
    const r = await fetchTransactionDetailStrict({ id: 'tx-1', transactionCode: 'CODE1' }, { apiGet });
    expect(r.ok).toBe(true);
    expect(r.has_products).toBe(false);
    expect(r.detail).toEqual(resumeSansProduits);
  });

  test('réponse LISTE ({ items: [...] } ou tableau) déballée', async () => {
    const apiGet = jest.fn().mockResolvedValueOnce({ items: [detailAvecProduits] });
    const r = await fetchTransactionDetailStrict({ id: 'tx-1' }, { apiGet });
    expect(r.ok).toBe(true);
    expect(r.has_products).toBe(true);
    expect(r.detail.id).toBe('tx-1');
    expect(unwrapTransactionResponse([detailAvecProduits]).id).toBe('tx-1');
    expect(unwrapTransactionResponse({ items: [] })).toBeNull();
  });

  test('tout échoue → ok=false avec le journal des tentatives (diagnostic prod)', async () => {
    const apiGet = jest.fn().mockRejectedValue(new Error('SumUp 401 — token révoqué'));
    const r = await fetchTransactionDetailStrict({ id: 'tx-1', transactionCode: 'CODE1' }, { apiGet });
    expect(r.ok).toBe(false);
    expect(r.detail).toBeNull();
    expect(r.attempts).toHaveLength(3); // ?id=, ?transaction_code=, chemin /<id>
    expect(r.attempts.every((a) => /401/.test(a.error))).toBe(true);
  });

  test('hasProductItems : line_items OU products non vides', () => {
    expect(hasProductItems({ products: [{}] })).toBe(true);
    expect(hasProductItems({ line_items: [{}] })).toBe(true);
    expect(hasProductItems({ products: [] })).toBe(false);
    expect(hasProductItems({})).toBe(false);
    expect(hasProductItems(null)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2.21.3 — Poids encodé dans le NOM du produit (forme RÉELLE de l'API en prod)
// Diagnostic production, transaction TAAA4NPRDAC (marchand FRIP & CO) : pour
// un article pesé, le produit s'appelle « 3,88 kg Vente Moins de 5 Kg » avec
// quantity = 1 — le poids est dans le TEXTE, pas dans la quantité. Les prix
// portent le HT dans price/total_price et le TTC dans *_with_vat ; vat_rate
// est FRACTIONNAIRE (0.2).
// ══════════════════════════════════════════════════════════════════════════
const { parseKgPrefix, extractCompteCaisse, compteDansPerimetre, sqlPerimetreCaisse } = require('../../../src/services/sumup');

describe('sumup — parseKgPrefix (poids dans le nom du produit)', () => {
  test('« 3,88 kg Vente Moins de 5 Kg » → 3,88 kg + libellé nettoyé', () => {
    expect(parseKgPrefix('3,88 kg Vente Moins de 5 Kg'))
      .toEqual({ poids: 3.88, libelle: 'Vente Moins de 5 Kg' });
    expect(parseKgPrefix('10.575 kg Vente Plus de 5 kilos'))
      .toEqual({ poids: 10.575, libelle: 'Vente Plus de 5 kilos' });
    expect(parseKgPrefix('1,595 kg Chaussures'))
      .toEqual({ poids: 1.595, libelle: 'Chaussures' });
  });

  test('forme product_summary « 1 x 3,88 kg Vente… » → même extraction', () => {
    expect(parseKgPrefix('1 x 3,88 kg Vente Moins de 5 Kg'))
      .toEqual({ poids: 3.88, libelle: 'Vente Moins de 5 Kg' });
  });

  test('résumé MULTI-articles → null (poids par article inconnu, jamais parsé)', () => {
    expect(parseKgPrefix('1 x 3,88 kg Vente Moins de 5 Kg, 2 x Sacs')).toBeNull();
  });

  test('libellés sans préfixe poids → null (Sacs, Vintiz, libellés legacy)', () => {
    expect(parseKgPrefix('Sacs')).toBeNull();
    expect(parseKgPrefix('Vente Vintiz #12')).toBeNull();
    expect(parseKgPrefix('Vente moins de 5 kg')).toBeNull(); // pas de nombre en tête
    expect(parseKgPrefix('')).toBeNull();
    expect(parseKgPrefix(null)).toBeNull();
    expect(parseKgPrefix('0 kg Vente')).toBeNull(); // poids nul → pas un poids
  });
});

describe('sumup — mapSumUpTransaction (fixture réelle TAAA4NPRDAC : poids au nom, HT/TTC, vat_rate 0.2)', () => {
  const detail = {
    id: 'tx-prd-1', transaction_code: 'TAAA4NPRDAC', type: 'PAYMENT', status: 'SUCCESSFUL',
    amount: 27.16, payment_type: 'POS', username: 'caisse@fripandco.fr',
    products: [{
      name: '3,88 kg Vente Moins de 5 Kg', quantity: 1,
      price: 22.63, total_price: 22.63,
      price_with_vat: 27.16, total_with_vat: 27.16,
      vat_rate: 0.2, vat_amount: 4.53,
    }],
  };

  test('poids = 3,88 kg lu dans le NOM (quantity 1 ignorée), unité kg stockée', () => {
    const m = mapSumUpTransaction(detail, detail);
    expect(m.poidsTicket).toBeCloseTo(3.88, 3);
    expect(m.lignes).toHaveLength(1);
    expect(m.lignes[0].unite).toBe('kg');
    expect(m.lignes[0].quantite).toBeCloseTo(3.88, 3);
    expect(m.lignes[0].description).toBe('Vente Moins de 5 Kg');
    expect(m.lignes[0].segment).toBe('textile_vrac');
  });

  test('TTC = total_with_vat (27,16 — pas le HT 22,63), HT/TVA réels, taux 0.2 → 20', () => {
    const m = mapSumUpTransaction(detail, detail);
    expect(m.totalTTC).toBeCloseTo(27.16, 2);
    expect(m.totalHT).toBeCloseTo(22.63, 2);
    expect(m.totalTVA).toBeCloseTo(4.53, 2);
    expect(m.lignes[0].total_ttc).toBeCloseTo(27.16, 2);
    expect(m.lignes[0].taux_tva).toBeCloseTo(20, 2);
  });

  test('prix unitaire = €/kg réel (27,16 ÷ 3,88 = 7,00)', () => {
    const m = mapSumUpTransaction(detail, detail);
    expect(m.lignes[0].prix_unitaire_ttc).toBeCloseTo(7.0, 2);
  });

  test('compte = username top-level (identifiant de caisse pour le filtre de périmètre)', () => {
    const m = mapSumUpTransaction(detail, detail);
    expect(m.compte).toBe('caisse@fripandco.fr');
  });

  test('fallback SANS produits : product_summary mono-article « 1 x 3,88 kg… » → vraie ligne kg', () => {
    const resume = {
      transaction_code: 'TAAA4NPRDAC', type: 'PAYMENT', amount: 27.16,
      payment_type: 'POS', product_summary: '1 x 3,88 kg Vente Moins de 5 Kg',
    };
    const m = mapSumUpTransaction(resume, resume);
    expect(m.hasRealItems).toBe(false); // reste « sans détail » (garde anti-dégradation)
    expect(m.poidsTicket).toBeCloseTo(3.88, 3);
    expect(m.lignes[0].unite).toBe('kg');
    expect(m.lignes[0].quantite).toBeCloseTo(3.88, 3);
    expect(m.lignes[0].synthetic).toBeUndefined(); // poids réel lu, pas un artefact
  });

  test('fallback SANS produits : résumé multi-articles → ligne synthétique pce (jamais de poids inventé)', () => {
    const resume = {
      transaction_code: 'TX-MULTI', type: 'PAYMENT', amount: 30,
      product_summary: '1 x 3,88 kg Vente Moins de 5 Kg, 2 x Sacs',
    };
    const m = mapSumUpTransaction(resume, resume);
    expect(m.poidsTicket).toBe(0);
    expect(m.lignes[0].unite).toBe('pce');
    expect(m.lignes[0].synthetic).toBe(true);
  });

  test('remboursement au nom préfixé → poids et montants négatifs', () => {
    const refund = { ...detail, id: 'tx-prd-2', transaction_code: 'RF-PRD', type: 'REFUND' };
    const m = mapSumUpTransaction(refund, refund);
    expect(m.poidsTicket).toBeCloseTo(-3.88, 3);
    expect(m.totalTTC).toBeCloseTo(-27.16, 2);
    expect(m.lignes[0].quantite).toBeCloseTo(-3.88, 3);
  });

  test('régression : forme legacy (poids dans quantity, total_price = TTC) inchangée', () => {
    const legacy = {
      transaction_code: 'OK-LEG', type: 'PAYMENT', amount: 8, payment_type: 'POS',
      products: [{ name: 'Vente moins de 5 kg', price: 2.5, quantity: 3.2, total_price: 8, vat_rate: 20 }],
    };
    const m = mapSumUpTransaction(legacy, legacy);
    expect(m.poidsTicket).toBeCloseTo(3.2, 3);
    expect(m.lignes[0].total_ttc).toBeCloseTo(8, 2);
    expect(m.lignes[0].taux_tva).toBe(20);
  });
});

describe('sumup — extractCompteCaisse (ce que l\'API expose comme identifiant de caisse)', () => {
  test('username top-level (forme constatée en prod) prioritaire', () => {
    expect(extractCompteCaisse({ username: 'caisse@fripandco.fr' })).toBe('caisse@fripandco.fr');
  });

  test('replis défensifs : user chaîne ou objet { email }', () => {
    expect(extractCompteCaisse({ user: 'operateur@x.fr' })).toBe('operateur@x.fr');
    expect(extractCompteCaisse({ user: { email: 'e@x.fr', name: 'E' } })).toBe('e@x.fr');
    expect(extractCompteCaisse({}, { username: 'second@x.fr' })).toBe('second@x.fr');
  });

  test('charge webhook minimale sans identifiant → null (compte inconnu, ticket compté)', () => {
    expect(extractCompteCaisse({ id: 'tx', amount: 5 })).toBeNull();
    expect(extractCompteCaisse(null, undefined)).toBeNull();
    expect(extractCompteCaisse({ username: '   ' })).toBeNull();
  });
});

describe('sumup — compteDansPerimetre (sémantique du filtre par caisse)', () => {
  test('pas de filtre configuré → tout compté', () => {
    expect(compteDansPerimetre(null, 'Caisse Vintiz')).toBe(true);
    expect(compteDansPerimetre('', 'Caisse Vintiz')).toBe(true);
  });

  test('compte inconnu (NULL/vide) → JAMAIS exclu (sinon le live API disparaîtrait)', () => {
    expect(compteDansPerimetre('Caissier Frip & Co', null)).toBe(true);
    expect(compteDansPerimetre('Caissier Frip & Co', '')).toBe(true);
    expect(compteDansPerimetre('Caissier Frip & Co', '  ')).toBe(true);
  });

  test('compte CONNU ET DIFFÉRENT → exclu (Vintiz hors KPI VAK)', () => {
    expect(compteDansPerimetre('Caissier Frip & Co', 'Caisse Vintiz')).toBe(false);
    expect(compteDansPerimetre('Caissier Frip & Co', 'Delestre Antoine')).toBe(false);
  });

  test('compte égal (insensible casse/espaces) → compté', () => {
    expect(compteDansPerimetre('Caissier Frip & Co', 'caissier frip & co')).toBe(true);
    expect(compteDansPerimetre(' Caissier Frip & Co ', 'Caissier Frip & Co')).toBe(true);
  });

  test('liste d\'ALIAS (nom du rapport CSV + username API, séparés par des virgules)', () => {
    const aliases = 'Caissier Frip & Co, caisse@fripandco.fr';
    expect(compteDansPerimetre(aliases, 'Caissier Frip & Co')).toBe(true);
    expect(compteDansPerimetre(aliases, 'caisse@fripandco.fr')).toBe(true);
    expect(compteDansPerimetre(aliases, 'Caisse Vintiz')).toBe(false);
    expect(compteDansPerimetre(aliases, null)).toBe(true);
  });

  test('sqlPerimetreCaisse : prédicat SQL miroir (NULL passe, connu-différent exclu)', () => {
    const sql = sqlPerimetreCaisse('vk', 't');
    expect(sql).toContain('vk.compte_caisse');
    expect(sql).toContain('t.compte');
    expect(sql).toContain('IS NULL OR'); // pas de filtre / compte inconnu → compté
    expect(sql).toContain('= ANY');      // liste d'alias
  });
});
