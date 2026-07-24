// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — MODULE ÉNERGIE & GES (RSEI-11)
// ───────────────────────────────────────────────────────────────────────────
// Verrouille la forme de réponse et la matrice d'habilitations du 29e module
// (routes/energie.js) : lecture ADMIN/MANAGER/RH/QHSE, écriture ADMIN/RH/MANAGER
// (saisie terrain), facteurs d'émission éditables ADMIN/RH seulement.
//   - CRUD /energie/{sites,compteurs,releves,pleins}
//   - GET/PUT /energie/facteurs        (édition ADMIN/RH)
//   - GET /energie/dashboard           (émissions par poste, tCO2e, intensité, L/100km)
//   - GET /energie/vsme-b3b6           (données B3 énergie/GES + B6 eau)
//   - oracles computeConsommation100km / pickFacteur
//
// Auth réelle (JWT sans `tv`), DB mockée, activity-logger mocké. Même harnais que
// rse-contract.test.js.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
const mockConnect = jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} }));
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: (...a) => mockConnect(...a),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

let app;
const energie = require('../../src/routes/energie');
const tokenFor = (role) => jwt.sign({ id: 1, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER'),
  QHSE: tokenFor('QHSE'), COLLABORATEUR: tokenFor('COLLABORATEUR'),
};
const YEAR = 2027;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/energie', energie);
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

const get = (path, role = 'ADMIN') => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (path, role, body = {}) => request(app).post(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const put = (path, role, body = {}) => request(app).put(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const del = (path, role) => request(app).delete(path).set('Authorization', `Bearer ${TOKENS[role]}`);

// ───────────────────────────────────────────────────────────────────────────
// ORACLES DE CALCUL
// ───────────────────────────────────────────────────────────────────────────
describe('ORACLE computeConsommation100km', () => {
  it('méthode plein-à-plein : (litres hors 1er plein) / km × 100', () => {
    const r = energie.computeConsommation100km([
      { km_compteur: 100000, litres: 50 },
      { km_compteur: 100500, litres: 40 },
      { km_compteur: 101000, litres: 45 },
    ]);
    // (40 + 45) L / (101000 - 100000) km × 100 = 8.5 L/100km
    expect(r.conso_l_100km).toBe(8.5);
    expect(r.km_parcourus).toBe(1000);
    expect(r.derniere_conso).toBe(9); // segment 2 : 45L/500km×100
    expect(r.moyenne_hors_derniere).toBe(8); // segment 1 : 40L/500km×100
  });

  it('< 2 pleins exploitables (km) → null', () => {
    expect(energie.computeConsommation100km([{ km_compteur: 100000, litres: 50 }])).toBeNull();
    expect(energie.computeConsommation100km([{ km_compteur: null, litres: 50 }, { km_compteur: null, litres: 40 }])).toBeNull();
  });

  it('kilométrage non croissant → null (pas de distance exploitable)', () => {
    expect(energie.computeConsommation100km([{ km_compteur: 100000, litres: 50 }, { km_compteur: 100000, litres: 40 }])).toBeNull();
  });
});

describe('ORACLE pickFacteur', () => {
  const F = [
    { poste: 'electricite', unite: 'kWh', facteur_kgco2e: 0.052, annee: 2024, actif: true },
    { poste: 'electricite', unite: 'kWh', facteur_kgco2e: 0.06, annee: 2026, actif: true },
    { poste: 'gazole', unite: 'L', facteur_kgco2e: 2.51, annee: 2024, actif: false },
  ];
  it('privilégie le millésime exact', () => {
    expect(pickVal(F, 'electricite', 2024)).toBe(0.052);
  });
  it('sinon la ligne active antérieure la plus récente', () => {
    expect(pickVal(F, 'electricite', 2025)).toBe(0.052); // 2024 ≤ 2025, pas 2026
    expect(pickVal(F, 'electricite', 2027)).toBe(0.06);  // 2026 la plus récente ≤ 2027
  });
  it('ignore les facteurs inactifs → null', () => {
    expect(energie.pickFacteur(F, 'gazole', 2024)).toBeNull();
    expect(energie.pickFacteur(F, 'inconnu', 2024)).toBeNull();
  });
  function pickVal(list, poste, annee) { const f = energie.pickFacteur(list, poste, annee); return f ? f.facteur_kgco2e : null; }
});

// ───────────────────────────────────────────────────────────────────────────
// SITES / COMPTEURS — habilitations
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /energie/sites + /compteurs (habilitations)', () => {
  it('GET /sites : lecture ADMIN/MANAGER/RH/QHSE, refusée COLLABORATEUR (403)', async () => {
    for (const role of ['ADMIN', 'MANAGER', 'RH', 'QHSE']) {
      expect((await get('/api/energie/sites', role)).status).toBe(200);
    }
    expect((await get('/api/energie/sites', 'COLLABORATEUR')).status).toBe(403);
  });

  it('POST /sites : MANAGER (écriture terrain) → 201 ; COLLABORATEUR → 403', async () => {
    expect((await post('/api/energie/sites', 'COLLABORATEUR', { nom: 'X' })).status).toBe(403);
    mockQuery.mockImplementation((sql, params) => {
      if (/INSERT INTO energie_sites/.test(String(sql))) return Promise.resolve({ rows: [{ id: 2, nom: params[0] }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/energie/sites', 'MANAGER', { nom: 'Boutique St-Sever' });
    expect(res.status).toBe(201);
    expect(res.body.nom).toBe('Boutique St-Sever');
  });

  it('POST /compteurs : type hors enum → 400 ; RH valide → 201', async () => {
    expect((await post('/api/energie/compteurs', 'RH', { site_id: 1, type: 'nucleaire' })).status).toBe(400);
    mockQuery.mockImplementation((sql, params) => {
      if (/INSERT INTO energie_compteurs/.test(String(sql))) return Promise.resolve({ rows: [{ id: 5, type: params[1], unite: params[3] }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/energie/compteurs', 'RH', { site_id: 1, type: 'electricite' });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('electricite');
    expect(res.body.unite).toBe('kWh'); // défaut
  });
});

// ───────────────────────────────────────────────────────────────────────────
// RELEVÉS — saisie mensuelle
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /energie/releves', () => {
  it('POST : mois hors 1-12 → 400 ; COLLABORATEUR → 403 ; MANAGER valide → 201', async () => {
    expect((await post('/api/energie/releves', 'MANAGER', { compteur_id: 1, periode_annee: 2027, periode_mois: 13, valeur: 100 })).status).toBe(400);
    expect((await post('/api/energie/releves', 'COLLABORATEUR', { compteur_id: 1, periode_annee: 2027, periode_mois: 1, valeur: 100 })).status).toBe(403);
    mockQuery.mockImplementation((sql, params) => {
      if (/INSERT INTO energie_releves/.test(String(sql))) return Promise.resolve({ rows: [{ id: 9, compteur_id: params[0], valeur: params[3] }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/energie/releves', 'MANAGER', { compteur_id: 1, periode_annee: 2027, periode_mois: 3, valeur: 1234.5 });
    expect(res.status).toBe(201);
    expect(res.body.compteur_id).toBe(1);
  });

  it('POST : doublon période (23505) → 409', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/INSERT INTO energie_releves/.test(String(sql))) { const e = new Error('dup'); e.code = '23505'; return Promise.reject(e); }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/energie/releves', 'RH', { compteur_id: 1, periode_annee: 2027, periode_mois: 3, valeur: 100 });
    expect(res.status).toBe(409);
  });

  it('GET /releves?annee=&site= : filtre → 200', async () => {
    mockQuery.mockImplementation((sql, params) => {
      if (/FROM energie_releves r/.test(String(sql))) return Promise.resolve({ rows: [{ id: 1, valeur: '1000', compteur_type: 'electricite', periode_annee: params[0] }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/energie/releves?annee=2027&site=1', 'QHSE');
    expect(res.status).toBe(200);
    expect(res.body[0].compteur_type).toBe('electricite');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PLEINS CARBURANT
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /energie/pleins', () => {
  it('POST : type_carburant hors enum → 400 ; MANAGER valide → 201', async () => {
    expect((await post('/api/energie/pleins', 'MANAGER', { date_plein: '2027-01-10', litres: 50, type_carburant: 'kerosene' })).status).toBe(400);
    mockQuery.mockImplementation((sql, params) => {
      if (/INSERT INTO carburant_pleins/.test(String(sql))) return Promise.resolve({ rows: [{ id: 1, vehicle_id: params[0], litres: params[2], type_carburant: params[5] }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/energie/pleins', 'MANAGER', { vehicle_id: 3, date_plein: '2027-01-10', litres: 62.4, km_compteur: 100500 });
    expect(res.status).toBe(201);
    expect(res.body.type_carburant).toBe('gazole'); // défaut
  });

  it('DELETE : COLLABORATEUR → 403 ; ADMIN sur ligne existante → 200', async () => {
    expect((await del('/api/energie/pleins/1', 'COLLABORATEUR')).status).toBe(403);
    mockQuery.mockImplementation((sql) => {
      if (/DELETE FROM carburant_pleins/.test(String(sql))) return Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 });
      return Promise.resolve({ rows: [] });
    });
    expect((await del('/api/energie/pleins/1', 'ADMIN')).status).toBe(200);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// FACTEURS D'ÉMISSION — édition ADMIN/RH seulement
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /energie/facteurs (ADMIN/RH)', () => {
  it('GET : lecture ouverte (MANAGER/QHSE) + avertissement indicatif', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM ges_facteurs/.test(String(sql))) return Promise.resolve({ rows: [{ id: 1, poste: 'gazole', facteur_kgco2e: '2.51000' }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/energie/facteurs', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body.avertissement).toMatch(/indicatif|ajuster/i);
    expect(res.body.facteurs[0].poste).toBe('gazole');
  });

  it('PUT /facteurs/:id : MANAGER refusé (403) ; RH autorisé (200)', async () => {
    // Écriture des facteurs réservée ADMIN/RH (MANAGER a l'écriture des relevés,
    // pas des facteurs d'émission).
    expect((await put('/api/energie/facteurs/1', 'MANAGER', { facteur_kgco2e: 2.6 })).status).toBe(403);
    mockQuery.mockImplementation((sql, params) => {
      if (/UPDATE ges_facteurs SET/.test(String(sql))) return Promise.resolve({ rows: [{ id: 1, facteur_kgco2e: params[0] }], rowCount: 1 });
      return Promise.resolve({ rows: [] });
    });
    const res = await put('/api/energie/facteurs/1', 'RH', { facteur_kgco2e: 2.6 });
    expect(res.status).toBe(200);
    expect(res.body.facteur_kgco2e).toBe(2.6);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DASHBOARD — émissions par poste, tCO2e, intensité, L/100 km, dérive
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /energie/dashboard', () => {
  const wire = (sql, params) => {
    const s = String(sql);
    if (/FROM settings WHERE key/.test(s)) {
      // CA de référence via setting générique ; seuil de dérive au défaut (vide).
      if (params && params[0] === 'energie.ca_reference_annee') return Promise.resolve({ rows: [{ value: '500000' }] });
      return Promise.resolve({ rows: [] });
    }
    if (/FROM energie_releves r/.test(s)) {
      return Promise.resolve({ rows: [
        { poste: 'electricite', conso: '10000', cout: '1500', nb_releves: 12 },
        { poste: 'gaz', conso: '5000', cout: '800', nb_releves: 12 },
        { poste: 'eau', conso: '200', cout: '400', nb_releves: 12 },
      ] });
    }
    if (/GROUP BY type_carburant/.test(s)) {
      return Promise.resolve({ rows: [{ poste: 'gazole', litres: '1000', cout: '1800', nb_pleins: 8 }] });
    }
    if (/FROM ges_facteurs/.test(s)) {
      return Promise.resolve({ rows: [
        { poste: 'electricite', unite: 'kWh', facteur_kgco2e: 0.052, annee: 2024, actif: true },
        { poste: 'gaz', unite: 'kWh', facteur_kgco2e: 0.227, annee: 2024, actif: true },
        { poste: 'eau', unite: 'm3', facteur_kgco2e: 0.132, annee: 2024, actif: true },
        { poste: 'gazole', unite: 'L', facteur_kgco2e: 2.51, annee: 2024, actif: true },
      ] });
    }
    if (/FROM carburant_pleins p/.test(s)) {
      // Un véhicule dont le dernier segment dérive (16 > 8×1,2).
      return Promise.resolve({ rows: [
        { vehicle_id: 3, date_plein: '2027-01-10', litres: 50, km_compteur: 100000, registration: 'AB-123', name: 'Benne 1' },
        { vehicle_id: 3, date_plein: '2027-02-10', litres: 40, km_compteur: 100500, registration: 'AB-123', name: 'Benne 1' },
        { vehicle_id: 3, date_plein: '2027-03-10', litres: 80, km_compteur: 101000, registration: 'AB-123', name: 'Benne 1' },
      ] });
    }
    return Promise.resolve({ rows: [] });
  };

  it('lecture QHSE → 200 ; calcule tCO2e par poste + totaux', async () => {
    mockQuery.mockImplementation(wire);
    const res = await get(`/api/energie/dashboard?annee=${YEAR}`, 'QHSE');
    expect(res.status).toBe(200);
    expect(typeof res.body.generated_at).toBe('string');

    const elec = res.body.energie_batiments.find((e) => e.poste === 'electricite');
    expect(elec.tco2e).toBe(0.52); // 10000 kWh × 0,052 / 1000
    const gaz = res.body.energie_batiments.find((e) => e.poste === 'gaz');
    expect(gaz.tco2e).toBe(1.135); // 5000 × 0,227 / 1000
    const gazole = res.body.carburant_flotte.find((e) => e.poste === 'gazole');
    expect(gazole.tco2e).toBe(2.51); // 1000 L × 2,51 / 1000

    expect(res.body.totaux.tco2e_energie).toBe(1.681); // 0,52 + 1,135 + 0,026
    expect(res.body.totaux.tco2e_carburant).toBe(2.51);
    expect(res.body.totaux.tco2e_total).toBe(4.191);
  });

  it('intensité tCO2e/CA depuis le setting, et L/100km + signal de dérive', async () => {
    mockQuery.mockImplementation(wire);
    const res = await get(`/api/energie/dashboard?annee=${YEAR}`, 'ADMIN');
    expect(res.status).toBe(200);

    // Intensité : CA=500000€ (setting) → 4,191 tCO2e / 500 k€
    expect(res.body.intensite.ca_reference).toBe(500000);
    expect(res.body.intensite.ca_source).toBe('settings');
    expect(res.body.intensite.tco2e_par_keuro_ca).toBe(0.008);

    // L/100km : (40+80)/1000×100 = 12 ; dérive car dernier segment 16 > moyenne 8 ×1,2
    expect(res.body.vehicules).toHaveLength(1);
    expect(res.body.vehicules[0].conso_l_100km).toBe(12);
    expect(res.body.vehicules[0].derive).toBe(true);
    expect(res.body.derives).toHaveLength(1);
    expect(res.body.seuil_derive_pct).toBe(20); // défaut
  });

  it('CA absent (aucune source) → intensité null (jamais de valeur inventée)', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM energie_releves r/.test(s)) return Promise.resolve({ rows: [{ poste: 'electricite', conso: '10000', cout: '0', nb_releves: 1 }] });
      if (/FROM ges_facteurs/.test(s)) return Promise.resolve({ rows: [{ poste: 'electricite', unite: 'kWh', facteur_kgco2e: 0.052, annee: 2024, actif: true }] });
      // settings vides, GL/opérationnel en échec → CA introuvable
      if (/financial_gl_entries|boutique_ventes|vak_ventes|commandes_exutoires/.test(s)) return Promise.reject(new Error('no table'));
      return Promise.resolve({ rows: [] });
    });
    const res = await get(`/api/energie/dashboard?annee=${YEAR}`, 'RH');
    expect(res.status).toBe(200);
    expect(res.body.intensite.ca_reference).toBeNull();
    expect(res.body.intensite.ca_source).toBeNull();
    expect(res.body.intensite.tco2e_par_keuro_ca).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// VSME B3/B6
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /energie/vsme-b3b6', () => {
  it('renvoie B3 (énergie/GES, scopes) et B6 (eau)', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM energie_releves r/.test(s)) {
        return Promise.resolve({ rows: [
          { poste: 'electricite', conso: '10000', cout: '0', nb_releves: 12 },
          { poste: 'gaz', conso: '5000', cout: '0', nb_releves: 12 },
          { poste: 'eau', conso: '200', cout: '0', nb_releves: 12 },
        ] });
      }
      if (/GROUP BY type_carburant/.test(s)) return Promise.resolve({ rows: [{ poste: 'gazole', litres: '1000', cout: '0', nb_pleins: 8 }] });
      if (/FROM ges_facteurs/.test(s)) {
        return Promise.resolve({ rows: [
          { poste: 'electricite', unite: 'kWh', facteur_kgco2e: 0.052, annee: 2024, actif: true },
          { poste: 'gaz', unite: 'kWh', facteur_kgco2e: 0.227, annee: 2024, actif: true },
          { poste: 'eau', unite: 'm3', facteur_kgco2e: 0.132, annee: 2024, actif: true },
          { poste: 'gazole', unite: 'L', facteur_kgco2e: 2.51, annee: 2024, actif: true },
        ] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get(`/api/energie/vsme-b3b6?annee=${YEAR}`, 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body.b3_energie_ges.energie.electricite_kwh).toBe(10000);
    expect(res.body.b3_energie_ges.energie.total_energie_kwh).toBe(15000);
    // Scope 1 = carburant (2,51) + gaz (1,135) = 3,645 ; Scope 2 = électricité (0,52)
    expect(res.body.b3_energie_ges.ges.scope1_tco2e).toBe(3.645);
    expect(res.body.b3_energie_ges.ges.scope2_tco2e).toBe(0.52);
    expect(res.body.b3_energie_ges.ges.total_tco2e).toBe(4.191);
    expect(res.body.b6_eau.consommation_eau_m3).toBe(200);
  });
});
