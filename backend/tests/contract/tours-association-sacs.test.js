// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — nombre de sacs déclaré chez une association
// ───────────────────────────────────────────────────────────────────────────
// Demande client (08/2026) : « ajouter un indicateur de remplissage en
// déclarant le nombre de sacs collectés ».
//
// Ce que ces tests verrouillent, côté HTTP :
//   1. le NIVEAU 0-4 est DÉRIVÉ des sacs par le SERVEUR — le mobile n'en envoie
//      plus, et un client qui en enverrait un ne doit pas primer sur le
//      compteur (sinon deux sources de vérité pour la même colonne) ;
//   2. `0` et « non déclaré » restent distincts jusque dans le paramètre SQL ;
//   3. un renvoi SANS compteur n'efface pas une déclaration (COALESCE) ;
//   4. un compteur illisible est ÉCARTÉ, jamais refusé en 4xx — la file hors
//      ligne du mobile purge sur 4xx, un refus ferait disparaître la collecte
//      entière pour un champ mal formé ;
//   5. un client mobile ANTÉRIEUR (qui envoie encore fill_level, jamais de
//      sacs) continue de fonctionner à l'identique.
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
  getRedisClient: () => ({}), isRedisAvailable: () => false,
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(), logActivity: () => {},
}));
// La ré-optimisation part en arrière-plan après la réponse : neutralisée, elle
// n'a rien à voir avec le compteur de sacs et polluerait le journal SQL.
jest.mock('../../src/routes/tours/reoptimize-service', () => ({
  proposeReoptimization: jest.fn().mockResolvedValue(null),
}));

const express = require('express');
const request = require('supertest');
const { resetBornesCache } = require('../../src/routes/tours/sacs');

const TOUR_ID = 610;
const POINT_ID = 42;
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
 * Base simulée. `reglage` pilote la valeur lue dans `settings` — c'est ce qui
 * permet de prouver que les bornes sont bien PARAMÉTRABLES et non codées.
 * `ligne` est la ligne renvoyée par l'UPDATE (état après écriture).
 */
function branche({ reglage = null, ligne = {} } = {}) {
  mockQuery.mockReset();
  resetBornesCache();
  const journal = [];
  mockQuery.mockImplementation(async (text, params) => {
    journal.push({ text: String(text).replace(/\s+/g, ' ').trim(), params });
    if (/SELECT collection_type FROM tours/i.test(text)) {
      return { rows: [{ collection_type: 'association' }] };
    }
    if (/FROM settings WHERE key/i.test(text)) {
      return { rows: reglage === null ? [] : [{ value: reglage }] };
    }
    if (/UPDATE tour_association_point/i.test(text)) {
      return {
        rows: [{
          id: 1, tour_id: TOUR_ID, association_point_id: POINT_ID,
          status: 'collected', fill_level: null, nb_sacs: null,
          arrived_at: null, collected_at: new Date().toISOString(),
          duree_prevue_min: null, ...ligne,
        }],
      };
    }
    if (/vehicle_id FROM tours/i.test(text)) return { rows: [{ vehicle_id: VEHICLE_ID }] };
    return { rows: [], rowCount: 0 };
  });
  return journal;
}

/** L'UPDATE réellement émis, avec ses paramètres — la preuve de ce qui est écrit. */
const updateAsso = (journal) => journal.find((q) => /UPDATE tour_association_point/i.test(q.text));

const collecter = (corps) => request(app)
  .put(`/api/tours/${TOUR_ID}/cav/${POINT_ID}/collect-public`)
  .set('Authorization', `Bearer ${driverToken}`)
  .send({ status: 'collected', ...corps });

describe('collect-public association — le niveau est DÉRIVÉ des sacs', () => {
  test.each([
    [0, 0], [1, 1], [5, 1], [6, 2], [15, 2], [16, 3], [30, 3], [31, 4], [120, 4],
  ])('%i sac(s) → fill_level %i écrit en base', async (sacs, niveau) => {
    const journal = branche();
    const res = await collecter({ nb_sacs: sacs });
    expect(res.status).toBe(200);
    const up = updateAsso(journal);
    expect(up.params[1]).toBe(niveau);   // $2 = fill_level
    expect(up.params[8]).toBe(sacs);     // $9 = nb_sacs
  });

  test('le compteur PRIME sur un fill_level envoyé par le client', async () => {
    const journal = branche();
    // Un client qui enverrait les deux : le serveur ne doit pas avoir deux
    // sources de vérité pour la même colonne.
    await collecter({ nb_sacs: 40, fill_level: 1 });
    expect(updateAsso(journal).params[1]).toBe(4);
  });

  test('la provenance du niveau est exposée à l’écran', async () => {
    branche({ ligne: { fill_level: 4, nb_sacs: 40 } });
    const res = await collecter({ nb_sacs: 40 });
    expect(res.body.fill_level_source).toBe('sacs');
    expect(res.body.nb_sacs).toBe(40);
  });

  test('bornes PARAMÉTRABLES : le même compteur donne un autre niveau', async () => {
    const journal = branche({ reglage: '[1,3,6,10]' });
    await collecter({ nb_sacs: 4 });
    expect(updateAsso(journal).params[1]).toBe(2);      // 2 avec [1,3,6,10]…
    const j2 = branche({ reglage: null });
    await collecter({ nb_sacs: 4 });
    expect(updateAsso(j2).params[1]).toBe(1);           // …1 avec les défauts
  });

  test('réglage illisible : défauts appliqués, la collecte passe quand même', async () => {
    const journal = branche({ reglage: 'n’importe quoi' });
    const res = await collecter({ nb_sacs: 6 });
    expect(res.status).toBe(200);
    expect(updateAsso(journal).params[1]).toBe(2);
  });
});

describe('collect-public association — « 0 » et « non déclaré » ne se confondent pas', () => {
  test('0 sac est ÉCRIT (déclaration « rien chargé »), pas ignoré', async () => {
    const journal = branche();
    await collecter({ nb_sacs: 0 });
    const up = updateAsso(journal);
    expect(up.params[8]).toBe(0);
    expect(up.params[1]).toBe(0);
  });

  test('aucun compteur envoyé → paramètre null, et le COALESCE protège l’existant', async () => {
    const journal = branche();
    await collecter({ fill_level: 3 });
    const up = updateAsso(journal);
    expect(up.params[8]).toBeNull();
    expect(up.text).toMatch(/nb_sacs = CASE WHEN .*COALESCE\(\$9::int, nb_sacs\)/i);
    // Client antérieur : son fill_level est conservé tel quel.
    expect(up.params[1]).toBe(3);
  });

  test('un point SAUTÉ n’a pas de sacs : la colonne est remise à NULL', async () => {
    const journal = branche({ ligne: { status: 'skipped' } });
    await collecter({ status: 'skipped', skip_reason: 'acces_impossible', nb_sacs: 12 });
    const up = updateAsso(journal);
    expect(up.text).toMatch(/nb_sacs = CASE WHEN \$1::varchar = 'skipped' THEN NULL/i);
    expect(up.params[1]).toBeNull();   // ni niveau…
  });
});

describe('collect-public association — un compteur illisible ne coûte JAMAIS la collecte', () => {
  test.each([
    ['texte', 'douze'], ['négatif', -3], ['décimal', 2.5], ['aberrant', 999999],
  ])('%s : 200, collecte enregistrée, compteur écarté', async (_l, valeur) => {
    const journal = branche();
    const res = await collecter({ nb_sacs: valeur });
    // 200 et non 4xx : la file hors ligne du mobile purge sur 4xx.
    expect(res.status).toBe(200);
    const up = updateAsso(journal);
    expect(up).toBeDefined();
    expect(up.params[8]).toBeNull();
  });

  test('la valeur écartée est JOURNALISÉE, jamais avalée en silence', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    branche();
    await collecter({ nb_sacs: 'douze' });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Nombre de sacs ignoré/));
    warn.mockRestore();
  });

  test('multipart : le compteur arrive en CHAÎNE et reste exploité', async () => {
    const journal = branche();
    await collecter({ nb_sacs: '40' });
    expect(updateAsso(journal).params[8]).toBe(40);
    expect(updateAsso(journal).params[1]).toBe(4);
  });
});
