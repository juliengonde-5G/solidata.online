// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — la boutique passe commande, la logistique la reçoit (2.59.0)
// ───────────────────────────────────────────────────────────────────────────
// Verrouillé ici :
//  1. `POST /boutique-commandes` avec `envoyer: true` crée la commande DIRECTEMENT
//     au statut « envoyée » (pas de brouillon oublié), historique complet, dans
//     la même transaction ;
//  2. l'équipe logistique (ADMIN) est prévenue en messagerie, lien vers la fiche
//     de la commande dans le suivi logistique ;
//  3. sans `envoyer`, rien ne part (brouillon, aucune notification) ;
//  4. une messagerie en panne n'empêche JAMAIS la boutique de commander.
// Auth réelle (JWT), base simulée par routage sur le texte SQL.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockPool = jest.fn();
const mockClient = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockPool(...a),
  connect: async () => ({ query: (...a) => mockClient(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));
const mockNotifier = jest.fn();
jest.mock('../../src/services/messagerie', () => ({
  envoyerMessageSystemeRoles: (...a) => mockNotifier(...a),
}));
jest.mock('../../src/services/boutique-catalogue', () => {
  const vrai = jest.requireActual('../../src/services/boutique-catalogue');
  return {
    ...vrai,
    chargerCatalogue: async () => [{
      cle: 'BTQ|Robes|Adulte Femme|Été', gamme: 'BTQ', produit: 'Robes', genre: 'Adulte Femme', saison: 'Été',
      categorie_eco_org: 'Vêtements', poids_moyen_kg: 12.5, stock_cartons: 3, reserve_cartons: 0, disponible_cartons: 3,
    }],
  };
});

const express = require('express');
const request = require('supertest');

const token = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' });

let app;
let historique;
let statuts;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/boutique-commandes', require('../../src/routes/boutique-commandes'));
});

beforeEach(() => {
  historique = [];
  statuts = [];
  mockNotifier.mockReset();
  mockNotifier.mockResolvedValue({ ok: true, envoyes: 1 });
  const repondre = async (sql, params = []) => {
    const t = String(sql);
    if (/MAX\(reference\)/.test(t)) return { rows: [{ last: null }] };
    if (/INSERT INTO boutique_commandes/.test(t)) {
      return { rows: [{ id: 55, reference: 'BTQ-2026-0001', boutique_id: params[1], statut: 'brouillon' }] };
    }
    if (/INSERT INTO boutique_commande_historique/.test(t)) {
      historique.push({ ancien: params[1], nouveau: params[2], commentaire: params[3] });
      return { rows: [] };
    }
    if (/UPDATE boutique_commandes SET statut = 'envoyee'/.test(t)) { statuts.push('envoyee'); return { rows: [] }; }
    if (/FROM boutique_commandes c LEFT JOIN boutiques b/.test(t)) {
      return { rows: [{ reference: 'BTQ-2026-0001', boutique_nom: 'Saint-Sever', date_livraison_souhaitee: null, nb_cartons: 4, nb_lignes: 1 }] };
    }
    return { rows: [], rowCount: 0 };
  };
  mockPool.mockImplementation(repondre);
  mockClient.mockImplementation(repondre);
});

const envoyer = (body) => request(app)
  .post('/api/boutique-commandes')
  .set('Authorization', `Bearer ${token}`)
  .send({
    boutique_id: 3,
    date_commande: '2026-09-25',
    lignes: [{ gamme: 'BTQ', produit: 'Robes', genre: 'Adulte Femme', saison: 'Été', nb_cartons: 4 }],
    ...body,
  });

const attendreNotification = () => new Promise((r) => setTimeout(r, 20));

test('« Envoyer à la logistique » : créée directement au statut envoyée, historique complet', async () => {
  const r = await envoyer({ envoyer: true });
  expect(r.status).toBe(201);
  expect(r.body.statut).toBe('envoyee');
  expect(statuts).toEqual(['envoyee']);
  expect(historique).toEqual([
    expect.objectContaining({ ancien: null, nouveau: 'brouillon' }),
    expect.objectContaining({ ancien: 'brouillon', nouveau: 'envoyee', commentaire: 'Envoyée à la logistique' }),
  ]);
});

test('la logistique est prévenue, avec un lien vers la fiche de la commande', async () => {
  await envoyer({ envoyer: true });
  await attendreNotification();
  expect(mockNotifier).toHaveBeenCalledTimes(1);
  const [roles, { texte, lien, source }] = mockNotifier.mock.calls[0];
  expect(roles).toEqual(['ADMIN']);
  expect(texte).toMatch(/BTQ-2026-0001/);
  expect(texte).toMatch(/4 carton/);
  expect(lien).toBe('/exutoires-commandes?commande=btq-55');
  expect(source).toBe('commande_boutique');
});

test('sans « envoyer », rien ne part : brouillon, aucune notification', async () => {
  const r = await envoyer({});
  expect(r.status).toBe(201);
  expect(r.body.statut).toBe('brouillon');
  expect(statuts).toEqual([]);
  await attendreNotification();
  expect(mockNotifier).not.toHaveBeenCalled();
});

test('une messagerie en panne n\'empêche pas la boutique de commander', async () => {
  mockNotifier.mockRejectedValue(new Error('messagerie indisponible'));
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const r = await envoyer({ envoyer: true });
  await attendreNotification();
  expect(r.status).toBe(201);
  expect(r.body.statut).toBe('envoyee');
  spy.mockRestore();
});

test('une catégorie inconnue est refusée avant toute écriture', async () => {
  const r = await envoyer({ envoyer: true, lignes: [{ gamme: 'BTQ', produit: 'Inventé', genre: 'X', saison: 'Y', nb_cartons: 1 }] });
  expect(r.status).toBe(400);
  expect(r.body.code).toBe('CATEGORIE_INCONNUE');
  expect(historique).toEqual([]);
  await attendreNotification();
  expect(mockNotifier).not.toHaveBeenCalled();
});
