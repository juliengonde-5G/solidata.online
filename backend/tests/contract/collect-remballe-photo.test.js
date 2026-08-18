// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — collect-public : remballe + photo d'audit aléatoire
// ───────────────────────────────────────────────────────────────────────────
// Deux ajouts verrouillés ici :
//  1. Case « J'ai fait de la remballe » (FillLevel.jsx) → `remballe` persisté
//     sur tour_cav / tour_association_point.
//  2. Photo d'audit (un point tiré au sort par tournée, services/auditPhoto.js
//     côté mobile) → upload multipart accepté sur collect-public (comme
//     incident-public), `photo_path` JAMAIS écrasé par un re-submit sans
//     nouvelle photo (COALESCE — une correction du niveau ne doit pas effacer
//     une photo déjà reçue).
//
// Auth réelle (JWT chauffeur), DB mockée. Le fichier réellement écrit par
// multer sur le 2e cas est nettoyé après coup (pattern déjà utilisé par
// badgeuse-affichage-contract.test.js).
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(),
}));
jest.mock('../../src/services/push-notifications', () => ({
  sendPushToRoles: jest.fn().mockResolvedValue({ skipped: true }),
  sendPushToUser: jest.fn().mockResolvedValue({ skipped: true }),
  isConfigured: () => false,
  getPublicKey: () => null,
}));

const express = require('express');
const request = require('supertest');

let app;
const driverToken = jwt.sign(
  { id: 4, userId: 4, username: 'driver_5', role: 'COLLABORATEUR', vehicle_id: 5, employee_id: 42 },
  JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', require('../../src/routes/tours'));
});

beforeEach(() => {
  mockQuery.mockReset();
});

describe('PUT /api/tours/:id/cav/:cavId/collect-public — remballe', () => {
  it('persiste remballe=true (JSON, sans photo)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ vehicle_id: 5 }] }) // garde de périmètre véhicule
      .mockResolvedValueOnce({ rows: [{ collection_type: 'pav' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'collected', remballe: true }] });

    const res = await request(app)
      .put('/api/tours/90/cav/7/collect-public')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ status: 'collected', fill_level: 3, qr_scanned: true, remballe: true, notes: '' });

    expect(res.status).toBe(200);
    const update = mockQuery.mock.calls.find((c) => /UPDATE tour_cav/.test(String(c[0])));
    expect(update[1]).toContain(true); // remballe passé au paramètre
    expect(update[0]).toMatch(/remballe = \$\d+/);
  });

  it('persiste remballe=false par défaut (case non cochée)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ vehicle_id: 5 }] })
      .mockResolvedValueOnce({ rows: [{ collection_type: 'pav' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'collected', remballe: false }] });

    const res = await request(app)
      .put('/api/tours/90/cav/7/collect-public')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ status: 'collected', fill_level: 2 });

    expect(res.status).toBe(200);
    const update = mockQuery.mock.calls.find((c) => /UPDATE tour_cav/.test(String(c[0])));
    // Paramètre remballe (position juste avant photo_path) est bien false, pas undefined.
    expect(update[1]).toContain(false);
  });
});

describe('PUT /api/tours/:id/cav/:cavId/collect-public — photo d\'audit', () => {
  it('accepte un upload multipart et construit photo_path (comme incident-public)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ vehicle_id: 5 }] })
      .mockResolvedValueOnce({ rows: [{ collection_type: 'pav' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'collected' }] });

    const res = await request(app)
      .put('/api/tours/90/cav/7/collect-public')
      .set('Authorization', `Bearer ${driverToken}`)
      .field('status', 'collected')
      .field('fill_level', '4')
      .field('remballe', 'true')
      .attach('photo', Buffer.from('89504e470d0a1a0a', 'hex'), { filename: 'cav.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    const update = mockQuery.mock.calls.find((c) => /UPDATE tour_cav/.test(String(c[0])));
    const photoParam = update[1].find((v) => typeof v === 'string' && v.startsWith('/uploads/collectes/'));
    expect(photoParam).toMatch(/^\/uploads\/collectes\/collecte_\d+\.png$/);

    // Nettoyage du fichier réellement écrit par multer.
    const written = path.join(__dirname, '..', '..', 'uploads', 'collectes', path.basename(photoParam));
    if (fs.existsSync(written)) fs.unlinkSync(written);
  });

  it('JSON sans photo : photo_path envoyé à COALESCE(null, photo_path) — ne casse jamais une photo déjà reçue', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ vehicle_id: 5 }] })
      .mockResolvedValueOnce({ rows: [{ collection_type: 'pav' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'collected' }] });

    const res = await request(app)
      .put('/api/tours/90/cav/7/collect-public')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ status: 'collected', fill_level: 3, notes: 'correction sans nouvelle photo' });

    expect(res.status).toBe(200);
    const update = mockQuery.mock.calls.find((c) => /UPDATE tour_cav/.test(String(c[0])));
    expect(String(update[0])).toMatch(/photo_path = COALESCE\(\$\d+, photo_path\)/);
    expect(update[1]).toContain(null);
  });
});
