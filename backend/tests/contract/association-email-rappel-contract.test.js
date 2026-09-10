// ═══════════════════════════════════════════════════════════════════════════
// CONTRAT — E-MAIL DE CONTACT D'UNE ASSOCIATION + RAPPEL EXTRANET REFASHION
// ───────────────────────────────────────────────────────────────────────────
// Deux demandes client du 10/09/2026, servies par les mêmes routes :
//   1. la fiche d'une association porte enfin une ADRESSE E-MAIL (le téléphone
//      sert sur place, l'adresse sert avant : rendez-vous, justificatifs) ;
//   2. toute modification d'une association — comme d'une DPAV — dépose un
//      RAPPEL : Refashion n'expose aucune API, la déclaration reste manuelle,
//      et un point créé ici n'existe pas là-bas tant qu'il n'y est pas saisi.
//
// Ce que ces tests tiennent : une adresse mal formée est REFUSÉE (une adresse
// fausse coûte plus cher qu'une adresse absente — on croit avoir prévenu), un
// PUT partiel n'efface pas un contact qu'il ne mentionne pas, et le rappel part
// sur les trois gestes (création, modification, suppression) en NOMMANT le
// point, sans jamais bloquer l'écriture s'il échoue.
// ═══════════════════════════════════════════════════════════════════════════
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));
const mockEnvoyer = jest.fn().mockResolvedValue({ ok: true, envoyes: 1, echecs: [] });
jest.mock('../../src/services/messagerie', () => ({
  envoyerMessageSystemeRoles: (...a) => mockEnvoyer(...a),
}));

const express = require('express');
const request = require('supertest');

const app = express();
app.use(express.json());
app.use('/api/association-points', require('../../src/routes/association-points'));

const jeton = (role) => jwt.sign(
  { id: 1, username: 'u', role, first_name: 'Julien', last_name: 'Gondé', mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
  JWT_SECRET, { expiresIn: '1h' });
const ADMIN = jeton('ADMIN');

const LIGNE = {
  id: 12, name: 'Les Restos du Cœur', address: '3 rue Verte', code_postal: '76000', ville: 'Rouen',
  latitude: 49.44, longitude: 1.09, contact_phone: '0600000000', contact_email: 'contact@restos.fr',
  contact_info: null, horaires_accessibilite: null, status: 'active',
};

beforeEach(() => {
  mockQuery.mockReset();
  mockEnvoyer.mockClear();
  mockQuery.mockImplementation(async (sql) => {
    const q = String(sql);
    if (/FROM custom_roles/i.test(q)) return { rows: [] };
    if (/SELECT token_version FROM users/i.test(q)) return { rows: [{ token_version: 0 }] };
    if (/INSERT INTO association_points/i.test(q)) return { rows: [{ ...LIGNE }] };
    if (/UPDATE association_points/i.test(q)) return { rows: [{ ...LIGNE }] };
    if (/DELETE FROM association_points/i.test(q)) return { rows: [{ id: 12, name: LIGNE.name }] };
    if (/SELECT value FROM settings/i.test(q)) return { rows: [] };
    return { rows: [] };
  });
});

const post = (body) => request(app).post('/api/association-points').set('Authorization', `Bearer ${ADMIN}`).send(body);
const put = (body) => request(app).put('/api/association-points/12').set('Authorization', `Bearer ${ADMIN}`).send(body);

// Le rappel part APRÈS la réponse (fire-and-forget) : on laisse la boucle
// d'événements se vider avant d'inspecter, plutôt que de rendre l'écriture
// dépendante d'un canal de confort.
const laisserPartirLeRappel = () => new Promise((r) => setImmediate(r));

describe('e-mail de contact — accepté, normalisé, ou refusé', () => {
  it('POST : une adresse valide est enregistrée', async () => {
    const r = await post({ name: 'Les Restos du Cœur', contact_email: '  contact@restos.fr  ' });
    expect(r.status).toBe(201);
    const insert = mockQuery.mock.calls.find(([q]) => /INSERT INTO association_points/i.test(String(q)));
    expect(insert[0]).toMatch(/contact_email/);
    expect(insert[1]).toContain('contact@restos.fr'); // espaces retirés
  });

  it('POST : une adresse VIDE vaut « non renseignée » (null), pas une erreur', async () => {
    const r = await post({ name: 'X', contact_email: '   ' });
    expect(r.status).toBe(201);
    const insert = mockQuery.mock.calls.find(([q]) => /INSERT INTO association_points/i.test(String(q)));
    expect(insert[1][insert[1].length - 1]).toBeNull();
  });

  it.each(['pas-une-adresse', 'a@b', 'a b@c.fr', '@restos.fr', 'contact@restos'])(
    'POST : « %s » est REFUSÉ en 400 — jamais rangé « au mieux »', async (mauvaise) => {
      const r = await post({ name: 'X', contact_email: mauvaise });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('EMAIL_INVALIDE');
      expect(mockQuery.mock.calls.some(([q]) => /INSERT INTO association_points/i.test(String(q)))).toBe(false);
    });

  it('PUT : la clé ABSENTE n’efface pas le contact existant', async () => {
    const r = await put({ status: 'inactive' });
    expect(r.status).toBe(200);
    const update = mockQuery.mock.calls.find(([q]) => /UPDATE association_points/i.test(String(q)));
    expect(String(update[0])).not.toMatch(/contact_email =/);
  });

  it('PUT : la clé présente à null EFFACE — c’est un geste explicite', async () => {
    const r = await put({ contact_email: null });
    expect(r.status).toBe(200);
    const update = mockQuery.mock.calls.find(([q]) => /UPDATE association_points/i.test(String(q)));
    expect(String(update[0])).toMatch(/contact_email = \$\d+/);
    expect(update[1]).toContain(null);
  });

  it('PUT : une adresse invalide est refusée AVANT toute écriture', async () => {
    const r = await put({ contact_email: 'nawak' });
    expect(r.status).toBe(400);
    expect(mockQuery.mock.calls.some(([q]) => /UPDATE association_points/i.test(String(q)))).toBe(false);
  });
});

describe('rappel extranet Refashion — les trois gestes', () => {
  it('création : le rappel NOMME le point et dit qu’il faut le déclarer', async () => {
    await post({ name: 'Les Restos du Cœur' });
    await laisserPartirLeRappel();
    expect(mockEnvoyer).toHaveBeenCalledTimes(1);
    const [roles, args] = mockEnvoyer.mock.calls[0];
    expect(roles).toEqual(['ADMIN']);
    expect(args.texte).toMatch(/Les Restos du Cœur/);
    expect(args.texte).toMatch(/créée/);
    expect(args.texte).toMatch(/EXTRANET REFASHION/i);
    expect(args.source).toBe('rappel_refashion');
    expect(args.lien).toBe('/admin-associations');
  });

  it('modification : le rappel dit le STATUT quand c’est lui qui change', async () => {
    await put({ status: 'inactive' });
    await laisserPartirLeRappel();
    expect(mockEnvoyer.mock.calls[0][1].texte).toMatch(/statut : inactive/);
  });

  it('suppression : le point est nommé — le nom est lu AVANT le DELETE', async () => {
    await request(app).delete('/api/association-points/12').set('Authorization', `Bearer ${ADMIN}`);
    await laisserPartirLeRappel();
    const texte = mockEnvoyer.mock.calls[0][1].texte;
    expect(texte).toMatch(/Les Restos du Cœur/);
    expect(texte).toMatch(/supprimée/);
  });

  it('une messagerie en panne n’empêche PAS d’enregistrer', async () => {
    mockEnvoyer.mockRejectedValueOnce(new Error('messagerie indisponible'));
    const r = await post({ name: 'X' });
    expect(r.status).toBe(201); // l'écriture a bien eu lieu
    await laisserPartirLeRappel();
  });
});
