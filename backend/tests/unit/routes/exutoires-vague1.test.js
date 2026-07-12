// Vague 1 — Lot « Tarifs exutoires alignés + raccourci de statut sécurisé » (item 38).
// 38a : nomenclature des types produit tarifables (front/back/CHECK alignés).
// 38b : garde stock pure sur le passage d'une commande à « expediee ».
const mockQuery = jest.fn(async () => ({ rows: [] }));
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));

const tarifs = require('../../../src/routes/tarifs-exutoires');
const commandes = require('../../../src/routes/commandes-exutoires');

describe('Item 38a — nomenclature tarifs_exutoires alignée', () => {
  const { TYPES_PRODUIT_VALIDES } = tarifs;

  it('accepte les gammes actives essuyage / tricot / merinos', () => {
    for (const t of ['essuyage', 'tricot', 'merinos']) {
      expect(TYPES_PRODUIT_VALIDES).toContain(t);
    }
  });

  it('conserve les types historiques effilo_* pour la lecture/édition (pas de suppression)', () => {
    expect(TYPES_PRODUIT_VALIDES).toContain('effilo_blanc');
    expect(TYPES_PRODUIT_VALIDES).toContain('effilo_couleur');
  });

  it('couvre exactement la nomenclature du CHECK SQL de tarifs_exutoires (init-db.js)', () => {
    // Doit rester identique au CHECK et aux options du formulaire ExutoiresTarifs.jsx.
    expect([...TYPES_PRODUIT_VALIDES].sort()).toEqual([
      'coton_blanc', 'coton_couleur', 'csr', 'effilo_blanc', 'effilo_couleur',
      'essuyage', 'jean', 'merinos', 'original', 'tricot',
    ]);
  });
});

describe('Item 38b — garde stock sur le passage à « expediee »', () => {
  const { stockProofRequired, hasStockProof } = commandes;

  it('exige une preuve de décrément uniquement pour la cible « expediee »', () => {
    expect(stockProofRequired('expediee')).toBe(true);
    for (const s of ['confirmee', 'en_preparation', 'chargee', 'pesee_recue', 'facturee', 'cloturee', 'annulee']) {
      expect(stockProofRequired(s)).toBe(false);
    }
  });

  it('valide la preuve si une préparation est « expediee » OU si un mouvement de sortie existe', () => {
    expect(hasStockProof({ prepExpediee: true, stockSortie: false })).toBe(true);
    expect(hasStockProof({ prepExpediee: false, stockSortie: true })).toBe(true);
    expect(hasStockProof({ prepExpediee: true, stockSortie: true })).toBe(true);
  });

  it('refuse le raccourci chargee→expediee sans preuve de décrément', () => {
    expect(hasStockProof({ prepExpediee: false, stockSortie: false })).toBe(false);
  });

  it('tolère les valeurs falsy/absentes renvoyées par EXISTS()', () => {
    expect(hasStockProof({})).toBe(false);
    expect(hasStockProof({ prepExpediee: null, stockSortie: undefined })).toBe(false);
  });
});
