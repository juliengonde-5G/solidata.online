// Tests du matching facture ↔ commande exutoire (item 34, Vague 1).
// Fiabilité : on ne rapproche/clôture automatiquement une commande QUE si sa
// référence complète (CMD-AAAA-NNNN) apparaît sans ambiguïté sur la facture.

// Le mock renvoie des lignes contrôlées pour les requêtes commandes_exutoires,
// et rien pour le reste (dont l'IIFE de création de tables au chargement).
let commandeMatchRows = [];
const mockQuery = jest.fn((sql) => {
  if (typeof sql === 'string' && /FROM commandes_exutoires/i.test(sql)) {
    return Promise.resolve({ rows: commandeMatchRows });
  }
  return Promise.resolve({ rows: [] });
});
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));

const { extractCommandeReferences, autoMatchCommande } = require('../../../src/routes/pennylane');

describe('extractCommandeReferences (extraction de la référence complète)', () => {
  it('extrait la référence COMPLÈTE CMD-AAAA-NNNN (pas seulement CMD-AAAA)', () => {
    expect(extractCommandeReferences({ external_reference: 'CMD-2026-0042' })).toEqual(['CMD-2026-0042']);
  });

  it('trouve la référence noyée dans un libellé libre', () => {
    expect(extractCommandeReferences({ label: 'Facture CMD-2026-0042 - Solidarité Textiles' }))
      .toEqual(['CMD-2026-0042']);
  });

  it('normalise la casse en majuscules', () => {
    expect(extractCommandeReferences({ invoice_number: 'cmd-2026-0007' })).toEqual(['CMD-2026-0007']);
  });

  it('dédoublonne une même référence répétée sur plusieurs champs', () => {
    const refs = extractCommandeReferences({
      external_reference: 'CMD-2026-0001',
      label: 'Réf CMD-2026-0001',
    });
    expect(refs).toEqual(['CMD-2026-0001']);
  });

  it('remonte plusieurs références distinctes (déclenchera un refus de match auto)', () => {
    const refs = extractCommandeReferences({
      external_reference: 'CMD-2026-0001',
      invoice_lines: [{ label: 'CMD-2026-0002' }, { description: 'CMD-2026-0002' }],
    });
    expect(refs.sort()).toEqual(['CMD-2026-0001', 'CMD-2026-0002']);
  });

  it('ne matche PAS un nombre arbitraire (date, montant, n° de pièce)', () => {
    expect(extractCommandeReferences({ label: 'Facture 20260042 montant 12345 pièce PL-2026' }))
      .toEqual([]);
  });

  it('renvoie [] quand aucun champ ne contient de référence', () => {
    expect(extractCommandeReferences({ label: 'Facture janvier', invoice_number: 'PL-99' })).toEqual([]);
  });

  it('gère une facture sans champ exploitable', () => {
    expect(extractCommandeReferences({})).toEqual([]);
    expect(extractCommandeReferences(null)).toEqual([]);
  });
});

describe('autoMatchCommande (règle « exactement une commande »)', () => {
  afterEach(() => { commandeMatchRows = []; });

  it('rapproche quand UNE seule commande correspond exactement', async () => {
    commandeMatchRows = [{ id: 5, reference: 'CMD-2026-0042', statut: 'expediee' }];
    const r = await autoMatchCommande({ external_reference: 'CMD-2026-0042' });
    expect(r).toEqual({ id: 5, reference: 'CMD-2026-0042', statut: 'expediee' });
  });

  it('ne rapproche PAS quand aucune référence n\'est extraite', async () => {
    commandeMatchRows = [{ id: 99, reference: 'CMD-2026-9999', statut: 'expediee' }];
    const r = await autoMatchCommande({ label: 'Facture sans référence' });
    expect(r).toBeNull();
  });

  it('ne rapproche PAS quand la référence ne correspond à aucune commande', async () => {
    commandeMatchRows = []; // 0 ligne en base
    const r = await autoMatchCommande({ external_reference: 'CMD-2026-0042' });
    expect(r).toBeNull();
  });

  it('ne rapproche PAS en cas d\'ambiguïté (plusieurs commandes candidates)', async () => {
    commandeMatchRows = [
      { id: 1, reference: 'CMD-2026-0001', statut: 'expediee' },
      { id: 2, reference: 'CMD-2026-0002', statut: 'expediee' },
    ];
    const r = await autoMatchCommande({
      external_reference: 'CMD-2026-0001',
      invoice_lines: [{ label: 'CMD-2026-0002' }],
    });
    expect(r).toBeNull();
  });
});
