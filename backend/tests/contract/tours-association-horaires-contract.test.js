// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — TOURNÉES ASSOCIATION : HORAIRES, RENDEZ-VOUS, DURÉES
// ───────────────────────────────────────────────────────────────────────────
// Verrouille la surface d'API consommée par les écrans de planification :
//   - POST /tours/estimate    : `association_points: [{id, duree_min}]`,
//                               `demande_ids`, `violations`, `ordre_suggere` ;
//   - POST /tours/association : refus 409 `ASSOCIATION_HORS_HORAIRES` et
//                               `RDV_NON_TENABLE` (formes EXACTES du contrat),
//                               ordre de contrôle imposé, forçage tracé ;
//   - écriture de `duree_prevue_min` et `demande_id` sur le passage ;
//   - AUCUNE régression sur les tournées CAV ordinaires.
//
// Le module PUR d'horaires (`services/association-horaires`) et l'extension
// `windows` / `anchor` / `violations` du moteur de temps ne sont PAS mockés :
// ce test les traverse RÉELLEMENT — c'est l'intégration des trois briques qui
// est vérifiée, pas seulement le câblage de la route. Seuls la base, OSRM et le
// contexte météo/trafic sont doublés (aucun réseau, aucun PostgreSQL).
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

// OSRM : 10 min / 5 km par tronçon, pas d'optimisation « Trip ».
jest.mock('../../src/routes/tours/geo', () => {
  const actual = jest.requireActual('../../src/routes/tours/geo');
  return {
    ...actual,
    osrmRouteSegment: jest.fn(async () => ({ distance_km: 5, duration_min: 10 })),
    osrmOptimizedTrip: jest.fn(async () => null),
  };
});

jest.mock('../../src/routes/tours/context', () => {
  const actual = jest.requireActual('../../src/routes/tours/context');
  return {
    ...actual,
    getContextForDate: jest.fn(async () => ({ weatherFactor: 1, trafficFactor: 1, durationFactor: 1 })),
    getLocalEventsForDate: jest.fn(async () => []),
  };
});

const express = require('express');
const request = require('supertest');
const { authenticate } = require('../../src/middleware/auth');
const crudRouter = require('../../src/routes/tours/crud');

const tokenFor = (role) => jwt.sign(
  { id: 1, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = { ADMIN: tokenFor('ADMIN'), MANAGER: tokenFor('MANAGER') };

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', authenticate, crudRouter);
});

const post = (path, role, body = {}) => request(app)
  .post(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);

// ── Jeu de données ─────────────────────────────────────────────────────────
// 2026-09-01 est un MARDI. Départ 08:00, 10 min de trajet par tronçon.
const DATE = '2026-09-01';
const VEHICLE = { id: 3, registration: 'AB-123-CD', name: 'Camion 1', max_capacity_kg: 3500, status: 'available' };

const SEMAINE = (plages) => ({
  lundi: plages, mardi: plages, mercredi: plages, jeudi: plages,
  vendredi: plages, samedi: [], dimanche: [],
});

const ASSO = (id, { horaires = null, duree = null, x = 0 } = {}) => ({
  id,
  name: `Association ${id}`,
  address: `${id} rue des Dons`,
  commune: 'Rouen',
  latitude: 49.44 + x / 100,
  longitude: 1.10,
  duree_collecte_min: duree,
  horaires_accessibilite: horaires,
  horaires_notes: null,
});

// Scénario « fermé entre midi et deux » : le point 51 est ouvert de 08:00 à
// 17:00 et occupe l'équipage 4 h ; le point 52 ferme de 12:00 à 14:00 et serait
// donc desservi porte close. Départ 08:00, 10 min de trajet par tronçon.
const FERME_A_MIDI = [
  ASSO(51, { horaires: SEMAINE([{ debut: '08:00', fin: '17:00' }]), duree: 240, x: 1 }),
  ASSO(52, { horaires: SEMAINE([{ debut: '09:00', fin: '12:00' }, { debut: '14:00', fin: '17:00' }]), x: 2 }),
];

function installMocks(etat = {}) {
  const {
    vehicle = VEHICLE, associationPoints = [], demandes = [], conflict = [],
    cavs = [], inserted = { id: 101 },
  } = etat;
  const calls = [];
  mockQuery.mockImplementation((sql, params) => {
    const s = String(sql).replace(/\s+/g, ' ');
    calls.push({ sql: s, params });
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM vehicles WHERE id = \$1/.test(s)) return Promise.resolve({ rows: vehicle ? [vehicle] : [] });
    if (/FROM tours WHERE vehicle_id = \$1 AND date = \$2/.test(s)) return Promise.resolve({ rows: conflict });
    if (/FROM association_points WHERE id = ANY/.test(s)) {
      const ids = (params[0] || []).map(Number);
      return Promise.resolve({ rows: associationPoints.filter((p) => ids.includes(p.id)) });
    }
    if (/FROM association_collecte_demandes WHERE id = ANY/.test(s)) {
      const ids = (params[0] || []).map(Number);
      return Promise.resolve({ rows: demandes.filter((d) => ids.includes(d.id)) });
    }
    if (/FROM cav WHERE id = ANY/.test(s)) {
      const ids = (params[0] || []).map(Number);
      return Promise.resolve({ rows: cavs.filter((c) => ids.includes(c.id)) });
    }
    if (/FROM ml_fill_predictions/.test(s) || /FROM cav_collection_times/.test(s)) {
      return Promise.resolve({ rows: [] });
    }
    if (/INSERT INTO tours/.test(s)) {
      return Promise.resolve({ rows: [{ ...inserted, date: params[0], vehicle_id: params[1] }] });
    }
    return Promise.resolve({ rows: [] });
  });
  return calls;
}

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockClear();
  installMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/tours/estimate — sélection association et durées ajustées', () => {
  it('accepte `association_points` avec la durée ajustée et la consomme', async () => {
    installMocks({ associationPoints: [ASSO(51), ASSO(52)] });
    const court = await post('/api/tours/estimate', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_points: [{ id: 51 }, { id: 52 }],
    });
    expect(court.status).toBe(200);

    installMocks({ associationPoints: [ASSO(51), ASSO(52)] });
    const long = await post('/api/tours/estimate', 'MANAGER', {
      vehicle_id: 3, date: DATE,
      association_points: [{ id: 51, duree_min: 60 }, { id: 52, duree_min: 60 }],
    });
    expect(long.status).toBe(200);
    // 2 × (60 − 10 min de défaut) = 100 min de travail en plus.
    expect(long.body.estimation.duree_travail_min - court.body.estimation.duree_travail_min).toBe(100);
  });

  it('la durée de la FICHE s’applique quand aucun ajustement n’est saisi', async () => {
    installMocks({ associationPoints: [ASSO(51, { duree: 40 }), ASSO(52)] });
    const res = await post('/api/tours/estimate', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_point_ids: [51, 52],
    });
    expect(res.status).toBe(200);
    // Référence : 2 points à 10 min. Ici 40 + 10 → +30 min.
    installMocks({ associationPoints: [ASSO(51), ASSO(52)] });
    const ref = await post('/api/tours/estimate', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_point_ids: [51, 52],
    });
    expect(res.body.estimation.duree_travail_min - ref.body.estimation.duree_travail_min).toBe(30);
  });

  it('`association_points` est prioritaire sur `association_point_ids`', async () => {
    const calls = installMocks({ associationPoints: [ASSO(51), ASSO(52), ASSO(53)] });
    const res = await post('/api/tours/estimate', 'ADMIN', {
      vehicle_id: 3, date: DATE,
      association_points: [{ id: 53 }],
      association_point_ids: [51, 52],
    });
    expect(res.status).toBe(200);
    expect(res.body.estimation.nb_points).toBe(1);
    const lecture = calls.find((c) => /FROM association_points WHERE id = ANY/.test(c.sql));
    expect(lecture.params[0]).toEqual([53]);
  });

  it('expose `violations` et `ordre_suggere` (tableau vide / null quand tout va bien)', async () => {
    installMocks({ associationPoints: [ASSO(51), ASSO(52)] });
    const res = await post('/api/tours/estimate', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_point_ids: [51, 52],
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.violations)).toBe(true);
    expect(res.body.violations).toHaveLength(0);
    expect(res.body.ordre_suggere).toBeNull();
    expect(Array.isArray(res.body.estimation.violations)).toBe(true);
  });

  it('signale les violations d’horaires AVANT toute création', async () => {
    // Le 1er point est ouvert toute la journée et occupe l'équipe 4 h ; le 2e,
    // fermé entre 12:00 et 14:00, serait desservi en plein créneau de fermeture.
    installMocks({ associationPoints: FERME_A_MIDI });
    const res = await post('/api/tours/estimate', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_point_ids: [51, 52],
    });
    expect(res.status).toBe(200);
    const v = res.body.violations.find((x) => x.type === 'hors_horaires');
    expect(v).toBeTruthy();
    expect(v.point_id).toBe(52);
    expect(v.heure_prevue).toMatch(/^\d{2}:\d{2}/);
    expect(v.plages).toEqual(['09:00-12:00', '14:00-17:00']);
    expect(v.prochain_creneau).toBe('14:00');
  });

  it('propose un ordre tenant le rendez-vous quand l’ordre soumis le manque', async () => {
    installMocks({
      associationPoints: [ASSO(51, { duree: 180, x: 1 }), ASSO(52, { x: 2 })],
      demandes: [{
        id: 7, association_point_id: 52, date_souhaitee: DATE,
        heure_debut: '09:00:00', heure_fin: null, tolerance_min: 15, annulee_le: null,
      }],
    });
    const res = await post('/api/tours/estimate', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_point_ids: [51, 52], demande_ids: [7],
    });
    expect(res.status).toBe(200);
    expect(res.body.violations.some((v) => v.type === 'rdv_manque')).toBe(true);
    // Le point ancré doit passer EN PREMIER pour tenir 09:00 (±15 min).
    expect(res.body.ordre_suggere).toEqual([52, 51]);
  });

  it('préfère un ordre SANS AUCUNE violation, et le dit quand il n’en existe pas', async () => {
    // Même géométrie dans les deux cas ; seule l'heure d'ouverture du point
    // ancré change. Le rendez-vous de 09:00 ±15 min autorise une arrivée à
    // 08:45 : le local ouvert dès 08:00 la reçoit, celui qui ouvre à 09:00 non.
    const scenario = (ouverture) => ({
      associationPoints: [
        ASSO(51, { duree: 60, x: 1 }),
        ASSO(52, { horaires: SEMAINE([{ debut: ouverture, fin: '17:00' }]), x: 2 }),
      ],
      demandes: [{
        id: 7, association_point_id: 52, date_souhaitee: DATE,
        heure_debut: '09:00:00', heure_fin: null, tolerance_min: 15, annulee_le: null,
      }],
    });
    const estimer = async () => {
      const r = await post('/api/tours/estimate', 'MANAGER', {
        vehicle_id: 3, date: DATE, association_point_ids: [51, 52], demande_ids: [7],
      });
      expect(r.status).toBe(200);
      expect(r.body.violations.some((v) => v.type === 'rdv_manque')).toBe(true);
      return r.body.ordre_suggere;
    };

    // 1. Ouvert dès 08:00 : l'ordre inversé ne viole PLUS RIEN — il est proposé.
    installMocks(scenario('08:00'));
    expect(await estimer()).toEqual([52, 51]);

    // 2. Ouvert à 09:00 seulement : aucun ordre n'est pleinement conforme.
    //    L'ordre proposé tient au moins le rendez-vous (c'est l'objet de la
    //    règle) ; la violation d'horaires qui subsiste sera signalée à son tour
    //    à la prochaine estimation — jamais tue, jamais résolue en silence.
    installMocks(scenario('09:00'));
    expect(await estimer()).toEqual([52, 51]);
  });

  it('un rendez-vous en avance fait ATTENDRE l’équipage, et l’attente est du travail', async () => {
    installMocks({
      associationPoints: [ASSO(51, { x: 1 })],
      demandes: [{
        id: 7, association_point_id: 51, date_souhaitee: DATE,
        heure_debut: '10:00:00', heure_fin: null, tolerance_min: 15, annulee_le: null,
      }],
    });
    const res = await post('/api/tours/estimate', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_point_ids: [51], demande_ids: [7],
    });
    expect(res.status).toBe(200);
    const e = res.body.estimation;
    // Départ 08:00, 10 min de route : arrivée 08:10 pour une fenêtre ouverte à
    // 09:45 → 95 min d'attente, comptées dans la journée (arbitrage n°3).
    expect(e.duree_attente_min).toBe(95);
    expect(e.timeline.some((t) => t.type === 'attente')).toBe(true);
    expect(res.body.violations).toHaveLength(0);
    // 10 (aller) + 95 (attente) + 10 (collecte) + 10 (retour) = 125 min.
    expect(e.duree_travail_min).toBe(125);
  });

  it('le réglage `attenteCompteTravail` sort l’attente du temps de travail', async () => {
    const { getScoringConfig, setScoringConfig } = require('../../src/routes/tours/predictions');
    const avant = getScoringConfig();
    expect(avant.rdvToleranceMin).toBe(15);
    expect(avant.attenteCompteTravail).toBe(true);
    setScoringConfig({ ...avant, attenteCompteTravail: false });
    try {
      installMocks({
        associationPoints: [ASSO(51, { x: 1 })],
        demandes: [{
          id: 7, association_point_id: 51, date_souhaitee: DATE,
          heure_debut: '10:00:00', heure_fin: null, tolerance_min: 15, annulee_le: null,
        }],
      });
      const res = await post('/api/tours/estimate', 'MANAGER', {
        vehicle_id: 3, date: DATE, association_point_ids: [51], demande_ids: [7],
      });
      expect(res.status).toBe(200);
      expect(res.body.estimation.duree_attente_min).toBe(95);
      expect(res.body.estimation.duree_travail_min).toBe(30); // l'attente n'est plus du travail
    } finally {
      setScoringConfig(avant);
    }
  });

  it('la tolérance de rendez-vous par défaut (15 min) s’applique quand la demande n’en porte pas', async () => {
    installMocks({
      associationPoints: [ASSO(51, { duree: 240, x: 1 }), ASSO(52, { x: 2 })],
      demandes: [{
        id: 7, association_point_id: 52, date_souhaitee: DATE,
        heure_debut: '09:00:00', heure_fin: null, tolerance_min: null, annulee_le: null,
      }],
    });
    const res = await post('/api/tours/association', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_point_ids: [51, 52], demande_ids: [7],
    });
    expect(res.status).toBe(409);
    expect(res.body.violations[0].fenetre).toBe('08:45-09:15');
  });

  it('refuse une demande inconnue, annulée ou étrangère à la tournée (jamais en silence)', async () => {
    const base = {
      associationPoints: [ASSO(51), ASSO(52)],
      demandes: [
        { id: 8, association_point_id: 99, date_souhaitee: DATE, heure_debut: '10:00:00', heure_fin: null, tolerance_min: null, annulee_le: null },
        { id: 9, association_point_id: 51, date_souhaitee: DATE, heure_debut: '10:00:00', heure_fin: null, tolerance_min: null, annulee_le: '2026-08-30T10:00:00Z' },
      ],
    };
    installMocks(base);
    const inconnue = await post('/api/tours/estimate', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_point_ids: [51], demande_ids: [404],
    });
    expect(inconnue.status).toBe(400);
    expect(inconnue.body.error).toMatch(/introuvable/i);

    installMocks(base);
    const annulee = await post('/api/tours/estimate', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_point_ids: [51], demande_ids: [9],
    });
    expect(annulee.status).toBe(400);
    expect(annulee.body.error).toMatch(/annulée/i);

    installMocks(base);
    const etrangere = await post('/api/tours/estimate', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_point_ids: [51], demande_ids: [8],
    });
    expect(etrangere.status).toBe(400);
    expect(etrangere.body.error).toMatch(/absent de cette tournée/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/tours/association — 409 ASSOCIATION_HORS_HORAIRES', () => {
  const HORS_HORAIRES = { associationPoints: FERME_A_MIDI };

  it('refuse avec la forme EXACTE du contrat et n’écrit rien', async () => {
    const calls = installMocks(HORS_HORAIRES);
    const res = await post('/api/tours/association', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_point_ids: [51, 52],
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ASSOCIATION_HORS_HORAIRES');
    expect(res.body.estimation).toBeTruthy();
    expect(Array.isArray(res.body.violations)).toBe(true);
    const v = res.body.violations[0];
    expect(Object.keys(v).sort()).toEqual(
      ['heure_prevue', 'name', 'plages', 'point_id', 'prochain_creneau'].sort()
    );
    expect(v.point_id).toBe(52);
    expect(v.name).toBe('Association 52');
    expect(v.heure_prevue).toMatch(/^\d{2}:\d{2}/);
    expect(v.plages).toEqual(['09:00-12:00', '14:00-17:00']);
    expect(v.prochain_creneau).toBe('14:00');
    expect(calls.some((c) => /INSERT INTO tours/.test(c.sql))).toBe(false);
  });

  it('un jour FERMÉ bloque quelle que soit l’heure (plages vides)', async () => {
    installMocks({
      associationPoints: [ASSO(51, { horaires: SEMAINE([]) })], // mardi fermé
    });
    const res = await post('/api/tours/association', 'ADMIN', {
      vehicle_id: 3, date: DATE, association_point_ids: [51],
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ASSOCIATION_HORS_HORAIRES');
    expect(res.body.violations[0].plages).toEqual([]);
    expect(res.body.violations[0].prochain_creneau).toBeNull();
    expect(res.body.error).toMatch(/fermé ce jour-là/i);
  });

  it('des horaires NON RENSEIGNÉS ne bloquent jamais (information inconnue ≠ interdit)', async () => {
    const calls = installMocks({ associationPoints: [ASSO(51), ASSO(52)] });
    const res = await post('/api/tours/association', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_point_ids: [51, 52],
    });
    expect(res.status).toBe(201);
    expect(calls.some((c) => /INSERT INTO tours/.test(c.sql))).toBe(true);
  });

  it('force:true crée la tournée ET trace le forçage dans ai_explanation', async () => {
    const calls = installMocks(HORS_HORAIRES);
    const res = await post('/api/tours/association', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_point_ids: [51, 52], force: true,
    });
    expect(res.status).toBe(201);
    const insert = calls.find((c) => /INSERT INTO tours/.test(c.sql));
    expect(String(insert.params[4])).toMatch(/hors horaires d'accessibilité/i);
    expect(String(insert.params[4])).toMatch(/Association 52/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/tours/association — 409 RDV_NON_TENABLE', () => {
  const RDV_MANQUE = {
    associationPoints: [ASSO(51, { duree: 180, x: 1 }), ASSO(52, { x: 2 })],
    demandes: [{
      id: 7, association_point_id: 52, date_souhaitee: DATE,
      heure_debut: '09:00:00', heure_fin: null, tolerance_min: 15, annulee_le: null,
    }],
  };

  it('refuse avec la forme EXACTE du contrat, ordre suggéré joint', async () => {
    const calls = installMocks(RDV_MANQUE);
    const res = await post('/api/tours/association', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_point_ids: [51, 52], demande_ids: [7],
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RDV_NON_TENABLE');
    expect(res.body.estimation).toBeTruthy();
    expect(res.body.ordre_suggere).toEqual([52, 51]);
    const v = res.body.violations[0];
    expect(Object.keys(v).sort()).toEqual(
      ['demande_id', 'fenetre', 'heure_prevue', 'name', 'point_id'].sort()
    );
    expect(v.demande_id).toBe(7);
    expect(v.point_id).toBe(52);
    expect(v.fenetre).toBe('08:45-09:15'); // 09:00 ± 15 min
    expect(calls.some((c) => /INSERT INTO tours/.test(c.sql))).toBe(false);
  });

  it('force:true crée la tournée, trace le rendez-vous manqué et rattache la demande', async () => {
    const calls = installMocks(RDV_MANQUE);
    const res = await post('/api/tours/association', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_point_ids: [51, 52], demande_ids: [7], force: true,
    });
    expect(res.status).toBe(201);
    const insert = calls.find((c) => /INSERT INTO tours/.test(c.sql));
    expect(String(insert.params[4])).toMatch(/rendez-vous non tenu/i);
    const passages = calls.filter((c) => /INSERT INTO tour_association_point/.test(c.sql));
    expect(passages).toHaveLength(2);
    // [tourId, pointId, position, duree_prevue_min, demande_id]
    expect(passages[1].params[1]).toBe(52);
    expect(passages[1].params[4]).toBe(7);
    expect(passages[0].params[4]).toBeNull();
  });

  it('un rendez-vous TENABLE ne bloque pas et est rattaché au passage', async () => {
    const calls = installMocks({
      associationPoints: [ASSO(51, { x: 1 }), ASSO(52, { x: 2 })],
      demandes: [{
        id: 7, association_point_id: 52, date_souhaitee: DATE,
        heure_debut: '09:00:00', heure_fin: '10:00:00', tolerance_min: null, annulee_le: null,
      }],
    });
    const res = await post('/api/tours/association', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_point_ids: [51, 52], demande_ids: [7],
    });
    expect(res.status).toBe(201);
    const passages = calls.filter((c) => /INSERT INTO tour_association_point/.test(c.sql));
    expect(passages[1].params[4]).toBe(7);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/tours/association — ordre des contrôles et durées', () => {
  it('le dépassement de journée est signalé AVANT les horaires', async () => {
    // 30 points fermés le mardi : les deux règles sont violées à la fois.
    const points = Array.from({ length: 30 }, (_, i) => ASSO(60 + i, { horaires: SEMAINE([]), x: i }));
    installMocks({ associationPoints: points });
    const res = await post('/api/tours/association', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_point_ids: points.map((p) => p.id),
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUREE_MAX_DEPASSEE');
  });

  it('le rendez-vous manqué est signalé AVANT les horaires', async () => {
    installMocks({
      associationPoints: [
        ASSO(51, { horaires: SEMAINE([{ debut: '09:00', fin: '12:00' }]), duree: 180, x: 1 }),
        ASSO(52, { horaires: SEMAINE([{ debut: '09:00', fin: '12:00' }]), x: 2 }),
      ],
      demandes: [{
        id: 7, association_point_id: 52, date_souhaitee: DATE,
        heure_debut: '09:00:00', heure_fin: null, tolerance_min: 15, annulee_le: null,
      }],
    });
    const res = await post('/api/tours/association', 'MANAGER', {
      vehicle_id: 3, date: DATE, association_point_ids: [51, 52], demande_ids: [7],
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RDV_NON_TENABLE');
  });

  it('écrit la durée ajustée sur le passage, null quand elle n’est pas saisie', async () => {
    const calls = installMocks({ associationPoints: [ASSO(51), ASSO(52, { duree: 30 })] });
    const res = await post('/api/tours/association', 'ADMIN', {
      vehicle_id: 3, date: DATE,
      points: [{ id: 51, duree_min: 45 }, { id: 52 }],
    });
    expect(res.status).toBe(201);
    const passages = calls.filter((c) => /INSERT INTO tour_association_point/.test(c.sql));
    expect(passages[0].params[3]).toBe(45);
    // Aucun ajustement pour le 52 : la fiche fera foi à la relecture, on
    // n'écrit PAS sa durée par défaut sur le passage (jamais de recopie).
    expect(passages[1].params[3]).toBeNull();
  });

  it('refuse une liste de points vide (400), quelle que soit la forme', async () => {
    installMocks({ associationPoints: [] });
    const res = await post('/api/tours/association', 'ADMIN', { vehicle_id: 3, date: DATE });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Aucune régression sur les tournées CAV', () => {
  const CAVS = [
    { id: 1, name: 'CAV 1', address: '1 rue', commune: 'Rouen', latitude: 49.43, longitude: 1.09, nb_containers: 1 },
    { id: 2, name: 'CAV 2', address: '2 rue', commune: 'Rouen', latitude: 49.44, longitude: 1.09, nb_containers: 1 },
  ];

  it('une estimation CAV ne porte ni violation ni ordre suggéré', async () => {
    installMocks({ cavs: CAVS });
    const res = await post('/api/tours/estimate', 'MANAGER', {
      vehicle_id: 3, date: DATE, cav_ids: [1, 2],
    });
    expect(res.status).toBe(200);
    expect(res.body.violations).toEqual([]);
    expect(res.body.ordre_suggere).toBeNull();
    expect(res.body.estimation.nb_points).toBe(2);
  });

  it('une tournée manuelle CAV se crée exactement comme avant', async () => {
    const calls = installMocks({ cavs: CAVS });
    const res = await post('/api/tours/manual', 'MANAGER', {
      vehicle_id: 3, date: DATE, cav_ids: [1, 2],
    });
    expect(res.status).toBe(201);
    const passages = calls.filter((c) => /INSERT INTO tour_cav/.test(c.sql));
    expect(passages).toHaveLength(2);
    expect(passages[0].params).toHaveLength(4); // tour, cav, position, fill
  });
});
