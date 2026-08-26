// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — on ne réclame plus une pesée quand il n'y a rien à peser
// ───────────────────────────────────────────────────────────────────────────
// Constat client du 26/08/2026, compte rendu de tournée à l'appui : vidage à
// 16 h 29 (980 kg), puis « pesée finale » à 0 kg dix minutes plus tard, sans
// une seule collecte entre les deux. L'équipage n'avait pas le choix : l'écran
// exigeait un poids pour un camion qu'on venait de vider.
//
// Contrat vérifié ici :
//   1. `arrive-public` dit au mobile s'il y a quelque chose à peser.
//   2. EN CAS DE DOUTE, C'EST OUI — donnée incomplète ou requête en échec.
//   3. La clé se tait là où aucune pesée n'est proposée (pause déjeuner).
//   4. Clôturer SANS pesée finale ne perd NI le poids déjà pesé, NI le tonnage,
//      NI l'entrée de stock : le total est recalculé depuis `tour_weights`.
//
// Le point 4 est le vrai risque du correctif : c'est la pesée finale qui, seule,
// basculait la tournée en « completed » et déclenchait ses effets métier.
// ═══════════════════════════════════════════════════════════════════════════
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

const mockQuery = jest.fn();
const mockClient = { query: (...a) => mockQuery(...a), release: jest.fn() };
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => mockClient),
}));
jest.mock('../../src/services/push-notifications', () => ({
  sendPushToRoles: jest.fn().mockResolvedValue({ skipped: true }),
  sendPushToUser: jest.fn().mockResolvedValue({ skipped: true }),
  isConfigured: () => false,
  getPublicKey: () => null,
}));
jest.mock('../../src/config/redis', () => ({
  getRedisClient: () => ({}),
  isRedisAvailable: () => false,
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

const TOUR_ID = 363;
const ARRET_ID = 900;
const VEHICLE_ID = 5;

const driverToken = jwt.sign(
  { id: 4, userId: 4, username: `driver_${VEHICLE_ID}`, role: 'COLLABORATEUR', vehicle_id: VEHICLE_ID },
  JWT_SECRET, { expiresIn: '1h' }
);

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', require('../../src/routes/tours'));
});

/**
 * @param motif        motif de l'arrêt dont on déclare l'arrivée
 * @param attendue     ce que renvoie la requête « y a-t-il quelque chose à
 *                     peser ? » — ou l'exception qu'elle lève
 */
function mockDb({ motif = 'fin_tournee', attendue = false } = {}) {
  mockQuery.mockImplementation((sql) => {
    const t = String(sql);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(t)) return Promise.resolve({ rows: [] });
    if (/SELECT vehicle_id FROM tours WHERE id/.test(t)) {
      return Promise.resolve({ rows: [{ vehicle_id: VEHICLE_ID }] });
    }
    if (/UPDATE tour_arret_technique/.test(t) && /RETURNING/.test(t)) {
      return Promise.resolve({
        rows: [{ id: ARRET_ID, motif, position: 12, arrived_at: '2026-08-26T16:39:00Z' }],
      });
    }
    if (/WITH derniere AS/.test(t) && /AS attendue/.test(t)) {
      if (attendue instanceof Error) return Promise.reject(attendue);
      return Promise.resolve({ rows: [{ attendue }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => { mockQuery.mockReset(); mockClient.release.mockReset(); });

const arriver = () => request(app)
  .post(`/api/tours/${TOUR_ID}/arret/${ARRET_ID}/arrive-public`)
  .set('Authorization', `Bearer ${driverToken}`).send({});

describe('POST /:id/arret/:arretId/arrive-public — pesee_attendue', () => {
  test('rien de collecté depuis la dernière pesée → pesee_attendue = false', async () => {
    mockDb({ motif: 'fin_tournee', attendue: false });
    const res = await arriver();

    expect(res.status).toBe(200);
    expect(res.body.suite).toBe('pesee_finale');
    expect(res.body.pesee_attendue).toBe(false);
  });

  test('du textile chargé depuis → pesee_attendue = true', async () => {
    mockDb({ motif: 'fin_tournee', attendue: true });
    const res = await arriver();

    expect(res.body.pesee_attendue).toBe(true);
  });

  test('vidage intermédiaire : la question se pose aussi', async () => {
    mockDb({ motif: 'vidage', attendue: true });
    const res = await arriver();

    expect(res.body.suite).toBe('pesee_intermediaire');
    expect(res.body.pesee_attendue).toBe(true);
  });

  test('LE DOUTE NE SUPPRIME JAMAIS UNE PESÉE : requête en échec → true', async () => {
    mockDb({ motif: 'fin_tournee', attendue: new Error('colonne absente') });
    const res = await arriver();

    expect(res.status).toBe(200);
    expect(res.body.pesee_attendue).toBe(true);
  });

  test('valeur inattendue (null) → true, jamais une pesée escamotée', async () => {
    mockDb({ motif: 'fin_tournee', attendue: null });
    const res = await arriver();

    expect(res.body.pesee_attendue).toBe(true);
  });

  test('pause déjeuner : aucune pesée proposée, la clé se tait', async () => {
    mockDb({ motif: 'pause_dejeuner', attendue: false });
    const res = await arriver();

    expect(res.body.suite).toBe('reprise_tournee');
    expect('pesee_attendue' in res.body).toBe(false);
  });

  test('départ du matin : la clé se tait également', async () => {
    mockDb({ motif: 'depart_centre', attendue: false });
    const res = await arriver();

    expect('pesee_attendue' in res.body).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Le poids ne se perd pas quand l'équipage ne repasse pas par la pesée.
// ───────────────────────────────────────────────────────────────────────────
describe('Clôture sans pesée finale — le poids déjà pesé est conservé', () => {
  const { applyCompletionSideEffects, poidsTotalPese } = require('../../src/routes/tours/completion-effects');

  /** Journalise les écritures pour pouvoir affirmer ce qui a été écrit. */
  function mockCloture({ pese = 0, collectes = 2 } = {}) {
    const ecrits = { updateTotal: null, tonnage: [], stock: [], stockOriginal: [] };
    mockQuery.mockImplementation((sql, params) => {
      const t = String(sql);
      if (/COALESCE\(SUM\(weight_kg\), 0\) AS total FROM tour_weights/.test(t)) {
        return Promise.resolve({ rows: [{ total: pese }] });
      }
      if (/UPDATE tours SET total_weight_kg/.test(t)) {
        ecrits.updateTotal = params[0];
        return Promise.resolve({ rows: [] });
      }
      if (/SELECT cav_id FROM tour_cav WHERE tour_id/.test(t)) {
        return Promise.resolve({ rows: Array.from({ length: collectes }, (_, i) => ({ cav_id: i + 1 })) });
      }
      if (/INSERT INTO tonnage_history/.test(t)) { ecrits.tonnage.push(params); return Promise.resolve({ rows: [] }); }
      if (/INSERT INTO stock_movements/.test(t)) { ecrits.stock.push(params); return Promise.resolve({ rows: [] }); }
      if (/INSERT INTO stock_original_movements/.test(t)) { ecrits.stockOriginal.push(params); return Promise.resolve({ rows: [] }); }
      return Promise.resolve({ rows: [] });
    });
    return ecrits;
  }

  const tournee = { id: TOUR_ID, date: '2026-08-26', vehicle_id: VEHICLE_ID, collection_type: 'pav', total_weight_kg: 0 };

  test('le total est recalculé depuis les pesées, pas lu dans la colonne périmée', async () => {
    const ecrits = mockCloture({ pese: 980 });
    await applyCompletionSideEffects({ ...tournee }, TOUR_ID, 1);

    // Le cas exact du client : colonne à 0, 980 kg réellement pesés.
    expect(ecrits.updateTotal).toBe(980);
    expect(ecrits.tonnage).toHaveLength(2);
    expect(ecrits.tonnage.map((p) => p[2])).toEqual([490, 490]);   // réparti à parts égales
    expect(ecrits.stock[0][1]).toBe(980);
    expect(ecrits.stockOriginal[0][1]).toBe(980);
  });

  test('un total déjà juste n’est pas réécrit inutilement', async () => {
    const ecrits = mockCloture({ pese: 1200 });
    await applyCompletionSideEffects({ ...tournee, total_weight_kg: 1200 }, TOUR_ID, 1);

    expect(ecrits.updateTotal).toBeNull();
    expect(ecrits.stock[0][1]).toBe(1200);
  });

  test('aucune pesée du tout : aucun tonnage ni stock inventé', async () => {
    const ecrits = mockCloture({ pese: 0 });
    await applyCompletionSideEffects({ ...tournee }, TOUR_ID, 1);

    expect(ecrits.tonnage).toHaveLength(0);
    expect(ecrits.stock).toHaveLength(0);
    expect(ecrits.stockOriginal).toHaveLength(0);
  });

  test('aucune pesée en base mais un total déjà stocké : on ne le rase pas', async () => {
    // Reprise manuelle, import, historique : ce poids vient d'ailleurs et rien
    // ne permettrait de le retrouver. Le correctif ne peut qu'AJOUTER du poids
    // qui se perdait, jamais en retirer.
    const ecrits = mockCloture({ pese: 0 });
    await applyCompletionSideEffects({ ...tournee, total_weight_kg: 750 }, TOUR_ID, 1);

    expect(ecrits.updateTotal).toBeNull();          // aucune remise à zéro
    expect(ecrits.stock[0][1]).toBe(750);           // le stock reçoit bien les 750 kg
    expect(ecrits.tonnage.map((p) => p[2])).toEqual([375, 375]);
  });

  test('poidsTotalPese somme TOUTES les pesées, intermédiaires comprises', async () => {
    mockQuery.mockResolvedValue({ rows: [{ total: '1891.5' }] });
    await expect(poidsTotalPese(TOUR_ID)).resolves.toBe(1891.5);

    const [sql] = mockQuery.mock.calls[0];
    expect(String(sql)).not.toMatch(/is_intermediate/);   // aucun filtre : tout compte
  });
});
