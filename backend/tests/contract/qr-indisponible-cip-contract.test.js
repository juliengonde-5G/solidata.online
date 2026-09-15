// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — DÉCLARATION « QR INDISPONIBLE » + PÉRIMÈTRE DE L'ESPACE CIP
// ───────────────────────────────────────────────────────────────────────────
// Deux demandes client du 10/09/2026, verrouillées ici.
//
// 1. LE CHAUFFEUR N'EST PLUS BLOQUÉ, IL EST TRACÉ. Le refus « trop loin du
//    CAV » se posait sur les trois chemins d'identification, y compris celui
//    qu'on emprunte PARCE QU'ON NE PEUT PAS APPROCHER (portail fermé, accès
//    bloqué). Il est levé côté mobile ; côté serveur, ce qui compte est que la
//    déclaration ARRIVE avec sa position, que celle-ci soit conservée telle
//    quelle, et qu'une valeur illisible soit écartée plutôt que rangée « au
//    mieux » — une coordonnée fausse dans un compte rendu vaut moins qu'une
//    absence assumée.
//
// 2. L'ESPACE CIP NE LISTE QUE LES PERSONNES ACCOMPAGNÉES. Il servait tous les
//    salariés actifs — permanents, apprentis, CDD ordinaires compris. La règle
//    de périmètre est celle du module Effectifs ETP, établie contre les états
//    ASP réels : une SEULE implémentation, partagée. Les tests l'exercent des
//    deux côtés pour que la divergence se voie.
//
// Auth réelle (JWT), base mockée : aucun accès disque ni réseau.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockClientQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

const { keepContractForInsertion, relevantDeLaCip } = require('../../src/utils/contrat-insertion');

const tokenFor = (role, id = 1) => jwt.sign(
  { id, username: 'u', role, first_name: 'T', last_name: 'U', mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
  JWT_SECRET, { expiresIn: '1h' }
);
const ADMIN = tokenFor('ADMIN');
const CHAUFFEUR = jwt.sign(
  { id: 9, username: 'driver_7', role: 'COLLABORATEUR', vehicle_id: 7, employee_id: null },
  JWT_SECRET, { expiresIn: '1h' }
);

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Règle de périmètre « contrat d\'insertion » (source unique)', () => {
  const perm = { insertion_status: 'none' };

  it('un permanent en CDI ordinaire est hors périmètre', () => {
    expect(keepContractForInsertion({ contract_type: 'CDI', position_title: 'Cariste' }, perm)).toBe(false);
    expect(relevantDeLaCip(perm, [{ contract_type: 'CDI', position_title: 'Cariste' }])).toBe(false);
  });

  it('un apprenti est hors périmètre, même sur un poste marqué Cddi', () => {
    expect(relevantDeLaCip(perm, [{ contract_type: 'Apprentissage', position_title: 'Agent de tri Cddi' }])).toBe(false);
  });

  it('un CDDI est dans le périmètre', () => {
    expect(relevantDeLaCip(perm, [{ contract_type: 'CDDI', position_title: 'Agent de tri' }])).toBe(true);
  });

  it('un CDI « Inclusion » est dans le périmètre', () => {
    expect(relevantDeLaCip(perm, [{ contract_type: 'CDI', position_title: 'CDI Inclusion' }])).toBe(true);
  });

  it('un CDD au poste ordinaire est hors périmètre', () => {
    expect(relevantDeLaCip(perm, [{ contract_type: 'CDD', position_title: 'Cariste Manutentionnaire' }])).toBe(false);
  });

  it("un parcours CLÔTURÉ garde la personne : le suivi post-sortie est le travail de la CIP", () => {
    // Elle a quitté le décompte ASP (CDI ordinaire) mais pas le dossier CIP :
    // c'est la seule différence entre les deux périmètres, et elle est voulue.
    const ancien = { insertion_status: 'termine' };
    expect(keepContractForInsertion({ contract_type: 'CDI', position_title: 'Cariste' }, ancien)).toBe(false);
    expect(relevantDeLaCip(ancien, [{ contract_type: 'CDI', position_title: 'Cariste' }])).toBe(true);
  });

  it('une personne sans aucun contrat connu ni parcours est hors périmètre', () => {
    expect(relevantDeLaCip(perm, [])).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. GET /api/insertion — la liste se borne aux personnes accompagnées', () => {
  let app;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/insertion', require('../../src/routes/insertion'));
  });

  const SALARIES = [
    { id: 1, first_name: 'A', last_name: 'CDDI', is_active: true, insertion_status: 'en_parcours', cddi_derogation_motif: null, position: 'Agent de tri Cddi', contract_type: 'CDDI' },
    { id: 2, first_name: 'B', last_name: 'PERMANENT', is_active: true, insertion_status: 'none', cddi_derogation_motif: null, position: 'Cariste', contract_type: 'CDI' },
    { id: 3, first_name: 'C', last_name: 'APPRENTI', is_active: true, insertion_status: 'none', cddi_derogation_motif: null, position: 'Apprenti', contract_type: 'Apprentissage' },
    { id: 4, first_name: 'D', last_name: 'SORTI', is_active: true, insertion_status: 'termine', cddi_derogation_motif: null, position: 'Cariste', contract_type: 'CDI' },
  ];
  const CONTRATS = [
    { employee_id: 1, contract_type: 'CDDI', position_title: 'Agent de tri Cddi' },
    { employee_id: 2, contract_type: 'CDI', position_title: 'Cariste' },
    { employee_id: 3, contract_type: 'Apprentissage', position_title: 'Apprenti' },
    { employee_id: 4, contract_type: 'CDI', position_title: 'Cariste' },
  ];

  const brancher = ({ contratsEnErreur = false, colonneAbsente = false } = {}) => {
    mockQuery.mockReset();
    mockQuery.mockImplementation((text) => {
      const s = String(text);
      if (/information_schema\.tables/.test(s)) {
        return Promise.resolve({ rows: [{ table_name: 'employee_contracts' }] });
      }
      if (/FROM employee_contracts/.test(s) && !/FROM employees/.test(s)) {
        if (contratsEnErreur) return Promise.reject(Object.assign(new Error('relation absente'), { code: '42P01' }));
        return Promise.resolve({ rows: CONTRATS });
      }
      if (/FROM employees e/.test(s)) {
        if (colonneAbsente && /e\.cddi_derogation_motif/.test(s)) {
          return Promise.reject(Object.assign(new Error('column does not exist'), { code: '42703' }));
        }
        return Promise.resolve({ rows: SALARIES.map((e) => ({ ...e, nb_contracts: 1, has_pcm: 0, has_diagnostic: 0 })) });
      }
      return Promise.resolve({ rows: [] });
    });
  };

  const noms = (body) => body.map((e) => e.last_name).sort();

  it('écarte les permanents et les apprentis, garde les parcours', async () => {
    brancher();
    const res = await request(app).get('/api/insertion').set('Authorization', `Bearer ${ADMIN}`);
    expect(res.status).toBe(200);
    expect(noms(res.body)).toEqual(['CDDI', 'SORTI']);
  });

  it('expose le statut d\'insertion — l\'écran doit pouvoir dire de qui il parle', async () => {
    brancher();
    const res = await request(app).get('/api/insertion').set('Authorization', `Bearer ${ADMIN}`);
    expect(res.body.every((e) => 'insertion_status' in e)).toBe(true);
  });

  it("contrats illisibles → repli sur la fiche, jamais un espace CIP vide", async () => {
    // Un écran vide se lirait « plus personne en insertion » : la dégradation
    // retombe sur le type porté par la fiche du salarié.
    brancher({ contratsEnErreur: true });
    const res = await request(app).get('/api/insertion').set('Authorization', `Bearer ${ADMIN}`);
    expect(res.status).toBe(200);
    expect(noms(res.body)).toEqual(['CDDI', 'SORTI']);
  });

  it('colonne de dérogation absente (base non migrée) → la liste est servie quand même', async () => {
    brancher({ colonneAbsente: true });
    const res = await request(app).get('/api/insertion').set('Authorization', `Bearer ${ADMIN}`);
    expect(res.status).toBe(200);
    expect(noms(res.body)).toEqual(['CDDI', 'SORTI']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. PUT collect-public — la déclaration « QR indisponible » et sa position', () => {
  let app;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/tours', require('../../src/routes/tours'));
  });

  let updateArgs;
  beforeEach(() => {
    updateArgs = null;
    mockQuery.mockReset();
    mockClientQuery.mockReset();
    mockQuery.mockImplementation((text, params) => {
      const s = String(text);
      // Tournée de bornes, en cours, sur le véhicule du jeton.
      if (/FROM tours/.test(s)) {
        return Promise.resolve({ rows: [{ id: 5, vehicle_id: 7, status: 'in_progress', is_demo: false, collection_type: 'cav' }] });
      }
      if (/tour_association_point/.test(s)) return Promise.resolve({ rows: [], rowCount: 0 });
      if (/UPDATE tour_cav/.test(s)) {
        updateArgs = { text: s, params };
        return Promise.resolve({ rows: [{ id: 1, cav_id: 3, status: 'collected' }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  const envoyer = (corps) => request(app)
    .put('/api/tours/5/cav/3/collect-public')
    .set('Authorization', `Bearer ${CHAUFFEUR}`)
    .send({ status: 'collected', fill_level: 3, fill_percent: 75, ...corps });

  // Indices des paramètres de position dans l'UPDATE (cf. routes/tours/index.js).
  const position = () => {
    const p = updateArgs.params;
    return { lat: p[12], lng: p[13], precision: p[14], at: p[15] };
  };

  it('conserve la position telle qu\'elle a été relevée', async () => {
    const res = await envoyer({
      qr_scanned: false, qr_unavailable: true, qr_unavailable_reason: 'fallback',
      declaration_lat: 49.4231, declaration_lng: 1.0993, declaration_accuracy_m: 14,
      declaration_at: new Date().toISOString(),
    });
    expect(res.status).toBe(200);
    expect(updateArgs).not.toBeNull();
    expect(position().lat).toBe(49.4231);
    expect(position().lng).toBe(1.0993);
    expect(position().precision).toBe(14);
    // Le motif et le drapeau voyagent aussi : sans eux, le compte rendu ne
    // saurait pas distinguer « scanné » de « déclaré ».
    expect(updateArgs.params[2]).toBe(false);       // qr_scanned
    expect(updateArgs.params[3]).toBe(true);        // qr_unavailable
    expect(updateArgs.params[4]).toBe('fallback');  // motif
  });

  it('écarte une paire de coordonnées INCOMPLÈTE — une demi-position n\'est pas une position', async () => {
    await envoyer({ qr_unavailable: true, declaration_lat: 49.4231, declaration_accuracy_m: 14 });
    expect(position().lat).toBeNull();
    expect(position().lng).toBeNull();
    expect(position().precision).toBeNull();
  });

  it('écarte une coordonnée hors bornes plutôt que de la ranger', async () => {
    await envoyer({ qr_unavailable: true, declaration_lat: 999, declaration_lng: 1.0993 });
    expect(position().lat).toBeNull();
    expect(position().lng).toBeNull();
  });

  it('écarte une coordonnée illisible (chaîne vide, « null » textuel du multipart)', async () => {
    await envoyer({ qr_unavailable: true, declaration_lat: 'null', declaration_lng: '' });
    expect(position().lat).toBeNull();
    expect(position().lng).toBeNull();
  });

  it('n\'invente PAS le point (0, 0) à partir de deux champs vides', async () => {
    // `Number('')` vaut 0, et 0 est une latitude valide : sans garde, une
    // déclaration sans position serait rangée au large du golfe de Guinée.
    // Le contrôle de paire ne suffit pas — les deux champs sont « complets ».
    await envoyer({ qr_unavailable: true, declaration_lat: '', declaration_lng: '' });
    expect(position().lat).toBeNull();
    expect(position().lng).toBeNull();
  });

  it('écrit RÉELLEMENT les colonnes de position (et pas seulement les paramètres)', async () => {
    await envoyer({ qr_unavailable: true, declaration_lat: 49.4, declaration_lng: 1.09 });
    expect(updateArgs.text).toMatch(/declaration_lat\s*=/);
    expect(updateArgs.text).toMatch(/declaration_lng\s*=/);
    expect(updateArgs.text).toMatch(/declaration_accuracy_m\s*=/);
    expect(updateArgs.text).toMatch(/declaration_at\s*=/);
  });

  it('une collecte SANS déclaration n\'écrit aucune position', async () => {
    await envoyer({ qr_scanned: true });
    expect(position().lat).toBeNull();
    expect(position().lng).toBeNull();
    expect(position().at).toBeNull();
  });

  it('refuse une heure de déclaration venue du futur (horloge de téléphone)', async () => {
    const futur = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    await envoyer({
      qr_unavailable: true, declaration_lat: 49.4, declaration_lng: 1.09, declaration_at: futur,
    });
    // La position reste, l'heure est écartée : la base retombe sur NOW().
    expect(position().lat).toBe(49.4);
    expect(position().at).toBeNull();
  });
});
