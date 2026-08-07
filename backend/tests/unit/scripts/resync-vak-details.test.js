/**
 * Tests du script de réparation resync-vak-details.js (bug « poids trop
 * faibles » — les tickets ingérés SANS détail produits SumUp portaient une
 * ligne globale synthétique quantité 1, requalifiée à tort en 'kg' par le
 * backfill v2.20.0 → ~1 kg compté par vente au lieu du poids pesé).
 *
 * On teste les fonctions PURES exportées (aucun réseau ni DB) :
 *  - computeRebuildFromDetail : reconstruction des vraies lignes depuis le
 *    détail SumUp (quantités décimales préservées, remboursements signés) ;
 *  - doitDegraderLigneKgSynthetique : détection de la ligne 'kg' quantité 1
 *    inventée, à requalifier 'pce' quand SumUp confirme l'absence de détail ;
 *  - parseArgs : --dry-run par défaut, --apply, --vak, --limit, --rate.
 */

const {
  computeRebuildFromDetail,
  doitDegraderLigneKgSynthetique,
  parseArgs,
} = require('../../../src/scripts/resync-vak-details');

describe('resync-vak-details — computeRebuildFromDetail', () => {
  const ticket = {
    id: 42,
    vak_id: 3,
    batch_id: null,
    source: 'api_sumup',
    ref_transaction: 'TE4X7SAMPL',
    sumup_transaction_id: 'tx-abc',
    date_ticket: new Date('2026-07-18T09:12:00Z'),
    poids_kg: 1, // poids inventé par le backfill (ligne synthétique 'kg' qté 1)
    total_ttc: 8,
  };

  test('détail avec produit au kilo quantité 3.2 → lignes reconstruites, poids 3.2', () => {
    const detail = {
      id: 'tx-abc', transaction_code: 'TE4X7SAMPL', type: 'PAYMENT', status: 'SUCCESSFUL',
      amount: 8, payment_type: 'POS',
      products: [{ name: 'Vente moins de 5 kg', price: 2.5, quantity: 3.2, total_price: 8, vat_rate: 20 }],
    };
    const r = computeRebuildFromDetail(ticket, detail);
    expect(r.hasRealItems).toBe(true);
    expect(r.poids_kg).toBeCloseTo(3.2, 3);
    expect(r.nb_articles).toBe(1);
    expect(r.total_ttc).toBeCloseTo(8, 2);
    expect(r.moyen_paiement).toBe('CB');
    expect(r.lignes).toHaveLength(1);
    expect(r.lignes[0].unite).toBe('kg');
    expect(r.lignes[0].quantite).toBeCloseTo(3.2, 3);
    expect(r.lignes[0].segment).toBe('textile_vrac');
  });

  test('détail multi-lignes (textile + sac) → seul le textile pèse', () => {
    const detail = {
      id: 'tx-abc', transaction_code: 'TE4X7SAMPL', type: 'PAYMENT', amount: 11.25,
      payment_type: 'POS',
      products: [
        { name: 'Vente plus de 5 kilos', price: 2.0, quantity: 5.1, total_price: 10.2 },
        { name: 'Sac', price: 1.05, quantity: 1, total_price: 1.05 },
      ],
    };
    const r = computeRebuildFromDetail(ticket, detail);
    expect(r.poids_kg).toBeCloseTo(5.1, 3);
    expect(r.nb_articles).toBe(2);
    expect(r.lignes[0].unite).toBe('kg');
    expect(r.lignes[1].unite).toBe('pce');
  });

  test('détail REFUND → lignes et poids NÉGATIFS (nette la vente d\'origine)', () => {
    const detail = {
      id: 'tx-abc', transaction_code: 'TE4X7SAMPL', type: 'REFUND', amount: 13,
      payment_type: 'POS',
      products: [{ name: 'Vente plus de 5 kilos', price: 2.0, quantity: 6.5, total_price: 13 }],
    };
    const r = computeRebuildFromDetail(ticket, detail);
    expect(r.poids_kg).toBeCloseTo(-6.5, 3);
    expect(r.total_ttc).toBeCloseTo(-13, 2);
    expect(r.lignes[0].quantite).toBeCloseTo(-6.5, 3);
  });

  test('détail sans produits → hasRealItems=false (le script ne reconstruit pas)', () => {
    const detail = { id: 'tx-abc', transaction_code: 'TE4X7SAMPL', type: 'PAYMENT', amount: 8 };
    const r = computeRebuildFromDetail(ticket, detail);
    expect(r.hasRealItems).toBe(false);
    expect(r.poids_kg).toBe(0); // jamais de valeur inventée
  });

  test('PROPAGATION extension chaussures : détail chaussures + textile → les deux pèsent (fixture réelle TAAA4NKXTDV)', () => {
    // Le resync passe par mapSumUpTransaction : la règle « segments au poids
    // KG_SEGMENTS = textile_vrac + chaussures » s'applique donc aussi à la
    // reconstruction des tickets synthétiques (poids ticket 12,17 kg, pas 10,575).
    const detail = {
      id: 'tx-abc', transaction_code: 'TAAA4NKXTDV', type: 'PAYMENT', status: 'SUCCESSFUL',
      amount: 64.0, payment_type: 'CASH',
      products: [
        { name: 'Chaussures', price: 3.0, quantity: 1.595, total_price: 4.78, vat_rate: 20 },
        { name: 'Vente Plus de 5 kilos', price: 5.6, quantity: 10.575, total_price: 59.22, vat_rate: 20 },
      ],
    };
    const r = computeRebuildFromDetail(ticket, detail);
    expect(r.hasRealItems).toBe(true);
    expect(r.poids_kg).toBeCloseTo(12.17, 3);
    expect(r.total_ttc).toBeCloseTo(64.0, 2);
    expect(r.lignes[0].unite).toBe('kg');
    expect(r.lignes[0].segment).toBe('chaussures');
    expect(r.lignes[0].quantite).toBeCloseTo(1.595, 3);
    expect(r.lignes[1].unite).toBe('kg');
    expect(r.lignes[1].segment).toBe('textile_vrac');
  });
});

describe('resync-vak-details — doitDegraderLigneKgSynthetique', () => {
  test('ligne unique kg |qté| = 1 (invention du backfill) → à requalifier', () => {
    expect(doitDegraderLigneKgSynthetique([{ unite: 'kg', quantite: 1 }])).toBe(true);
    expect(doitDegraderLigneKgSynthetique([{ unite: 'KG', quantite: -1 }])).toBe(true);
  });

  test('quantité décimale réelle, unité pce ou multi-lignes → NE PAS toucher', () => {
    expect(doitDegraderLigneKgSynthetique([{ unite: 'kg', quantite: 3.2 }])).toBe(false);
    expect(doitDegraderLigneKgSynthetique([{ unite: 'pce', quantite: 1 }])).toBe(false);
    expect(doitDegraderLigneKgSynthetique([{ unite: 'kg', quantite: 1 }, { unite: 'pce', quantite: 1 }])).toBe(false);
    expect(doitDegraderLigneKgSynthetique([])).toBe(false);
  });
});

describe('resync-vak-details — parseArgs', () => {
  test('dry-run par défaut, --apply pour écrire', () => {
    expect(parseArgs([]).apply).toBe(false);
    expect(parseArgs(['--dry-run']).apply).toBe(false);
    expect(parseArgs(['--apply']).apply).toBe(true);
  });

  it('--degrade-ambigus est OPT-IN (revue Codex PR#89 : une ligne kg qté 1 peut être une vraie vente de 1,000 kg)', () => {
    expect(parseArgs([]).degradeAmbigus).toBe(false);
    expect(parseArgs(['--apply']).degradeAmbigus).toBe(false);
    expect(parseArgs(['--apply', '--degrade-ambigus']).degradeAmbigus).toBe(true);
  });

  test('--vak / --limit / --rate', () => {
    const a = parseArgs(['--apply', '--vak=12', '--limit=200', '--rate=3']);
    expect(a.vakId).toBe(12);
    expect(a.limit).toBe(200);
    expect(a.rate).toBe(3);
  });

  test('rate par défaut 5 req/s, borné bas', () => {
    expect(parseArgs([]).rate).toBe(5);
    expect(parseArgs(['--rate=0.1']).rate).toBe(0.5);
  });
});
