// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — ISOLEMENT DE LA FICHE COLLABORATEUR (chantier 2.43.0, §4)
// ───────────────────────────────────────────────────────────────────────────
// L'écart corrigé : `GET /api/employees` et `GET /api/employees/:id` faisaient
// un `SELECT e.*`, donc renvoyaient à un MANAGER le statut de travailleur
// handicapé (donnée de SANTÉ, art. 9 RGPD), le salaire brut, le titre de séjour,
// l'adresse du domicile et le lieu de naissance. routes/teams.js avait déjà
// corrigé exactement ce risque sur `GET /teams/:id` — mais jamais ici, sur la
// route la plus consultée, qui est pourtant la SOURCE de ces données.
//
// Ce que ces tests verrouillent :
//   1. MANAGER ne voit plus les colonnes sensibles (liste, fiche, contrats) ;
//   2. ADMIN et RH continuent de tout voir — le correctif ne doit RIEN retirer
//      à ceux dont c'est le métier ;
//   3. ce dont l'encadrement a besoin pour planifier reste visible (identité,
//      poste, équipe, contrat, permis/CACES, quotité, ville) ;
//   4. l'absence de la clé (delete) et non un null : le front distingue
//      « non habilité » de « non renseigné ».
// ═══════════════════════════════════════════════════════════════════════════
const JWT_SECRET = 'secret-de-test-employees';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use('/api/employees', require('../../src/routes/employees'));

// `mfa: true` : le périmètre de ce test est l'isolement par RÔLE, pas la double
// authentification (couverte par auth-mfa-contract.test.js). Sans ce claim,
// ADMIN et RH seraient arrêtés en amont par requireMfa.
const jeton = (role) => jwt.sign(
  { id: 1, username: 'u', role, first_name: 'T', last_name: 'U', mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
  JWT_SECRET, { expiresIn: '1h' });

// Une fiche complète, telle que la renvoie `SELECT e.*` après un import Malibou.
const FICHE = {
  id: 42, first_name: 'Camille', last_name: 'DURAND', email: 'c.durand@solidarite-textiles.fr',
  phone: '0600000000', team_id: 3, team_name: 'Collecte', position: 'Agent de collecte Cddi',
  contract_type: 'CDDI', contract_start: '2026-01-05', contract_end: '2026-07-04',
  has_permis_b: true, has_caces: false, weekly_hours: 26, is_active: true,
  insertion_status: 'en_parcours', insertion_start_date: '2026-01-05',
  pass_iae_number: 'PASS-123', city: 'Rouen',
  // ── Colonnes sensibles ──
  gross_salary: '1 802,00 €', disability_status: 'RQTH', medical_visit_frequency: '24 mois',
  visite_medicale_resultat: 'restrictions', visite_medicale_notes: 'Port de charges limité',
  residence_permit_type: 'Titre de séjour salarié', residence_permit_number: 'FR9988776',
  residence_permit_renewal: '2027-03-01',
  address: '12 rue des Lilas', postal_code: '76000', personal_email: 'camille.perso@example.fr',
  birth_date: '1988-04-12', birth_name: 'MARTIN', birth_city: 'Alger', birth_country: 'Algérie',
  birth_department: '99', nationality: 'Française', civility: 'Mme',
  emergency_contact_name: 'Paul DURAND', emergency_contact_phone: '0611111111',
  emergency_contact_email: 'paul@example.fr',
  emergency_contact2_name: null, emergency_contact2_phone: null, emergency_contact2_email: null,
  eligibilite_criteres: 'BRSA, RQTH', eligibilite_justificatifs_ref: 'CAF-2025-11',
  cddi_derogation_motif: 'rqth', siret: '12345678900011', france_travail_id: 'FT-77',
};

const CONTRAT = {
  id: 7, employee_id: 42, contract_type: 'CDD', start_date: '2026-01-05', end_date: '2026-07-04',
  weekly_hours: 26, position_title: 'Agent de collecte Cddi', team_name: 'Collecte',
  origin: 'embauche', is_current: true,
  gross_salary: '1 802,00 €', siret: '12345678900011',
};

// Les colonnes qu'un MANAGER ne doit plus jamais recevoir.
const SENSIBLES = [
  'gross_salary', 'disability_status', 'medical_visit_frequency',
  'visite_medicale_resultat', 'visite_medicale_notes',
  'residence_permit_type', 'residence_permit_number', 'residence_permit_renewal',
  'address', 'postal_code', 'personal_email',
  'birth_date', 'birth_name', 'birth_city', 'birth_country', 'birth_department',
  'nationality', 'civility',
  'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_email',
  'emergency_contact2_name', 'emergency_contact2_phone', 'emergency_contact2_email',
  'eligibilite_criteres', 'eligibilite_justificatifs_ref', 'cddi_derogation_motif',
  'siret', 'france_travail_id',
];

// Ce dont l'encadrement a réellement besoin : ne doit PAS disparaître.
const OPERATIONNELLES = [
  'id', 'first_name', 'last_name', 'email', 'phone', 'team_id', 'team_name', 'position',
  'contract_type', 'contract_start', 'contract_end', 'has_permis_b', 'has_caces',
  'weekly_hours', 'is_active', 'insertion_status', 'city',
];

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockImplementation(async (sql) => {
    const q = String(sql).replace(/\s+/g, ' ');
    if (/FROM custom_roles/i.test(q)) return { rows: [] };
    if (/SELECT value FROM settings/i.test(q)) return { rows: [] };
    if (/SELECT token_version FROM users/i.test(q)) return { rows: [{ token_version: 0 }] };
    if (/FROM employee_contracts/i.test(q)) return { rows: [{ ...CONTRAT }] };
    if (/FROM employees e/i.test(q)) return { rows: [{ ...FICHE }] };
    return { rows: [] };
  });
});

const get = (url, role) => request(app).get(url).set('Authorization', `Bearer ${jeton(role)}`);

describe('MANAGER — les données sensibles ne sortent plus', () => {
  test('GET /employees (liste) : aucune colonne sensible', async () => {
    const r = await get('/api/employees', 'MANAGER');
    expect(r.status).toBe(200);
    for (const col of SENSIBLES) expect(r.body[0]).not.toHaveProperty(col);
  });

  test('GET /employees/:id (fiche) : aucune colonne sensible', async () => {
    const r = await get('/api/employees/42', 'MANAGER');
    expect(r.status).toBe(200);
    for (const col of SENSIBLES) expect(r.body).not.toHaveProperty(col);
  });

  test('le RQTH et le salaire, nommément — les deux plus graves', async () => {
    // disability_status est une donnée de SANTÉ, de la même famille que les
    // freins santé que le module insertion masque déjà pour MANAGER.
    const r = await get('/api/employees/42', 'MANAGER');
    expect(r.body.disability_status).toBeUndefined();
    expect(r.body.gross_salary).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain('RQTH');
    expect(JSON.stringify(r.body)).not.toContain('1 802,00');
  });

  test('la clé est ABSENTE (jamais un null) — « non habilité » ≠ « non renseigné »', async () => {
    const r = await get('/api/employees/42', 'MANAGER');
    expect('disability_status' in r.body).toBe(false);
    expect(Object.keys(r.body)).not.toContain('gross_salary');
  });

  test('GET /employees/:id/contracts : le salaire de l’avenant est masqué aussi', async () => {
    // Masquer le salaire sur la fiche sans le masquer sur l'historique des
    // avenants n'aurait rien protégé : c'est la même donnée, une porte plus loin.
    const r = await get('/api/employees/42/contracts', 'MANAGER');
    expect(r.status).toBe(200);
    expect(r.body[0]).not.toHaveProperty('gross_salary');
    expect(r.body[0]).not.toHaveProperty('siret');
    // Le contenu opérationnel de l'avenant reste, lui, intégralement visible.
    for (const col of ['contract_type', 'start_date', 'end_date', 'weekly_hours', 'position_title']) {
      expect(r.body[0]).toHaveProperty(col);
    }
  });

  test('un rôle PERSONNALISÉ dérivé de MANAGER est masqué comme lui', async () => {
    mockQuery.mockImplementation(async (sql) => {
      const q = String(sql).replace(/\s+/g, ' ');
      if (/FROM custom_roles/i.test(q)) return { rows: [{ role_key: 'CR_CHEF', base_role: 'MANAGER' }] };
      if (/SELECT value FROM settings/i.test(q)) return { rows: [] };
      if (/SELECT token_version FROM users/i.test(q)) return { rows: [{ token_version: 0 }] };
      if (/FROM employees e/i.test(q)) return { rows: [{ ...FICHE }] };
      return { rows: [] };
    });
    await require('../../src/middleware/auth').refreshCustomRoles();
    const r = await get('/api/employees/42', 'CR_CHEF');
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty('gross_salary');
    expect(r.body).not.toHaveProperty('disability_status');
  });
});

describe('MANAGER — ce dont l’encadrement a besoin reste visible', () => {
  test('identité, poste, équipe, contrat, permis, quotité, ville', async () => {
    const r = await get('/api/employees/42', 'MANAGER');
    for (const col of OPERATIONNELLES) expect(r.body).toHaveProperty(col);
    expect(r.body.last_name).toBe('DURAND');
    expect(r.body.has_permis_b).toBe(true);
    // `city` est délibérément CONSERVÉE (utile aux tournées et covoiturages,
    // sensibilité faible) là où `address` et `postal_code` sont retirées.
    expect(r.body.city).toBe('Rouen');
    expect(r.body).not.toHaveProperty('address');
  });
});

describe('ADMIN et RH — aucune régression, la fiche reste complète', () => {
  test.each(['ADMIN', 'RH'])('%s voit TOUTES les colonnes, sensibles comprises', async (role) => {
    const r = await get('/api/employees/42', role);
    expect(r.status).toBe(200);
    for (const col of [...SENSIBLES, ...OPERATIONNELLES]) expect(r.body).toHaveProperty(col);
    expect(r.body.disability_status).toBe('RQTH');
    expect(r.body.gross_salary).toBe('1 802,00 €');
  });

  test.each(['ADMIN', 'RH'])('%s : la liste reste complète elle aussi', async (role) => {
    const r = await get('/api/employees', role);
    expect(r.status).toBe(200);
    for (const col of SENSIBLES) expect(r.body[0]).toHaveProperty(col);
  });

  test.each(['ADMIN', 'RH'])('%s : l’historique des contrats garde le salaire', async (role) => {
    const r = await get('/api/employees/42/contracts', role);
    expect(r.body[0].gross_salary).toBe('1 802,00 €');
  });
});

describe('non-régression des habilitations', () => {
  test('un rôle sans habilitation reste dehors (403), il n’est pas seulement masqué', async () => {
    for (const role of ['COLLABORATEUR', 'RESP_BTQ', 'FINANCE']) {
      expect((await get('/api/employees', role)).status).toBe(403);
    }
  });
});
