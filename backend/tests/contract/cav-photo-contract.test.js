// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — photo du point de collecte (CAV)
// ───────────────────────────────────────────────────────────────────────────
// Exigence 08/2026 : chaque CAV doit porter une photo à jour.
//   1. Le chauffeur peut TOUJOURS envoyer une photo du point
//      → POST /api/tours/:id/cav/:cavId/photo-public (JWT chauffeur + périmètre
//        véhicule, comme toutes les routes mobiles « -public »).
//   2. Le mobile sait AVANT de quitter le point si une photo est attendue
//      → `photo_requise` (calculé serveur) + `photo_fraicheur_mois` dans les
//        payloads GET /:id/public et GET /vehicle/:id/today.
//   3. Le back-office horodate ses propres photos
//      → POST /api/cav/:id/photo pose photo_taken_at + photo_source='admin'.
//
// Auth réelle (JWT), DB mockée par routage SQL (pas de séquence fragile).
// Les fichiers réellement écrits par multer sont nettoyés après coup.
// ═══════════════════════════════════════════════════════════════════════════
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET;

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
const { resetPhotoFraicheurCache } = require('../../src/utils/cav-photo');

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

const driverToken = jwt.sign(
  { id: 4, userId: 4, username: 'driver_5', role: 'COLLABORATEUR', vehicle_id: 5, employee_id: 42 },
  JWT_SECRET, { expiresIn: '1h' });
const adminToken = jwt.sign(
  { id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D' },
  JWT_SECRET, { expiresIn: '1h' });

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', require('../../src/routes/tours'));
  app.use('/api/cav', require('../../src/routes/cav'));
});

/**
 * Routeur de mock : chaque requête SQL est reconnue par son texte, ce qui rend
 * le test indépendant de l'ORDRE des appels (la lecture du réglage est mise en
 * cache : elle n'a pas lieu à tous les appels).
 */
function mockDb(handlers, { fraicheurMois = 6 } = {}) {
  mockQuery.mockImplementation((sql, params) => {
    const text = String(sql);
    if (/FROM settings WHERE key/.test(text)) {
      return Promise.resolve({ rows: [{ value: String(fraicheurMois) }] });
    }
    for (const [pattern, rows] of handlers) {
      if (pattern.test(text)) {
        return Promise.resolve({ rows: typeof rows === 'function' ? rows(params) : rows });
      }
    }
    return Promise.resolve({ rows: [] });
  });
}

const cleanupUploaded = (photoPath, ...segments) => {
  if (!photoPath) return;
  const abs = path.join(__dirname, '..', '..', ...segments, path.basename(photoPath));
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
};

beforeEach(() => {
  mockQuery.mockReset();
  resetPhotoFraicheurCache();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/tours/:id/cav/:cavId/photo-public — photo prise par le chauffeur', () => {
  it('200 : écrit la photo de référence du CAV (path + date + origine chauffeur)', async () => {
    mockDb([
      [/SELECT vehicle_id FROM tours/, [{ vehicle_id: 5 }]],
      [/FROM tour_cav tc\s+JOIN tours t/, [{ status: 'in_progress', vehicle_id: 5, photo_path: null }]],
      [/UPDATE cav SET photo_path/, (p) => [{ photo_path: p[0], photo_taken_at: '2026-08-20T10:00:00.000Z' }]],
    ]);

    const res = await request(app)
      .post('/api/tours/90/cav/7/photo-public')
      .set('Authorization', `Bearer ${driverToken}`)
      .attach('photo', PNG, { filename: 'cav.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.photo_path).toMatch(/^\/uploads\/cav-photos\/cav_7_\d+\.png$/);
    expect(res.body.photo_taken_at).toBeTruthy();

    const update = mockQuery.mock.calls.find((c) => /UPDATE cav SET photo_path/.test(String(c[0])));
    expect(String(update[0])).toMatch(/photo_taken_at = NOW\(\)/);
    expect(String(update[0])).toMatch(/photo_source = 'chauffeur'/);
    expect(update[1][1]).toBe(7); // cav ciblé = celui de l'URL

    cleanupUploaded(res.body.photo_path, 'uploads', 'cav-photos');
  });

  it('403 : tournée d\'un autre véhicule (garde de périmètre du jeton chauffeur)', async () => {
    mockDb([
      [/SELECT vehicle_id FROM tours/, [{ vehicle_id: 9 }]], // véhicule ≠ jeton (5)
      [/FROM tour_cav tc\s+JOIN tours t/, [{ status: 'in_progress', vehicle_id: 9, photo_path: null }]],
    ]);

    const res = await request(app)
      .post('/api/tours/91/cav/7/photo-public')
      .set('Authorization', `Bearer ${driverToken}`)
      .attach('photo', PNG, { filename: 'cav.png', contentType: 'image/png' });

    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls.some((c) => /UPDATE cav SET photo_path/.test(String(c[0])))).toBe(false);
  });

  it('404 : le CAV n\'appartient pas à la tournée (pas de photo sur un point arbitraire)', async () => {
    mockDb([
      [/SELECT vehicle_id FROM tours/, [{ vehicle_id: 5 }]],
      [/FROM tour_cav tc\s+JOIN tours t/, []],
    ]);

    const res = await request(app)
      .post('/api/tours/90/cav/999/photo-public')
      .set('Authorization', `Bearer ${driverToken}`)
      .attach('photo', PNG, { filename: 'cav.png', contentType: 'image/png' });

    expect(res.status).toBe(404);
    expect(mockQuery.mock.calls.some((c) => /UPDATE cav SET photo_path/.test(String(c[0])))).toBe(false);
  });

  it('403 : tournée déjà clôturée (le chauffeur n\'y est plus)', async () => {
    mockDb([
      [/SELECT vehicle_id FROM tours/, [{ vehicle_id: 5 }]],
      [/FROM tour_cav tc\s+JOIN tours t/, [{ status: 'completed', vehicle_id: 5, photo_path: null }]],
    ]);

    const res = await request(app)
      .post('/api/tours/90/cav/7/photo-public')
      .set('Authorization', `Bearer ${driverToken}`)
      .attach('photo', PNG, { filename: 'cav.png', contentType: 'image/png' });

    expect(res.status).toBe(403);
  });

  it('400 : fichier non-image refusé (filtre extension + MIME), sans 500 opaque', async () => {
    mockDb([[/SELECT vehicle_id FROM tours/, [{ vehicle_id: 5 }]]]);

    const res = await request(app)
      .post('/api/tours/90/cav/7/photo-public')
      .set('Authorization', `Bearer ${driverToken}`)
      .attach('photo', Buffer.from('<svg onload=alert(1)>'), { filename: 'x.svg', contentType: 'image/svg+xml' });

    expect(res.status).toBe(400);
    expect(mockQuery.mock.calls.some((c) => /UPDATE cav SET photo_path/.test(String(c[0])))).toBe(false);
  });

  it('401 : sans jeton chauffeur (route mobile « -public » = authentifiée)', async () => {
    mockDb([]);
    const res = await request(app)
      .post('/api/tours/90/cav/7/photo-public')
      .attach('photo', PNG, { filename: 'cav.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/tours/:id/public — état photo transmis au mobile', () => {
  const tourRow = { id: 90, vehicle_id: 5, collection_type: 'pav', status: 'in_progress' };
  const points = (cavPhoto) => [{
    id: 1, tour_id: 90, cav_id: 7, position: 1, status: 'pending',
    photo_path: '/uploads/collectes/collecte_1.png', // photo d'AUDIT de la collecte
    cav_photo_path: cavPhoto.path,
    cav_photo_taken_at: cavPhoto.takenAt,
    cav_photo_source: cavPhoto.source || null,
  }];

  const load = async (cavPhoto, fraicheurMois = 6) => {
    mockDb([
      [/SELECT vehicle_id FROM tours/, [{ vehicle_id: 5 }]],
      [/FROM tours t JOIN vehicles v/, [tourRow]],
      [/FROM tour_cav tc JOIN cav c/, points(cavPhoto)],
    ], { fraicheurMois });
    return request(app).get('/api/tours/90/public').set('Authorization', `Bearer ${driverToken}`);
  };

  it('photo_requise = true quand le point n\'a AUCUNE photo', async () => {
    const res = await load({ path: null, takenAt: null });
    expect(res.status).toBe(200);
    expect(res.body.cavs[0].photo_requise).toBe(true);
    expect(res.body.photo_fraicheur_mois).toBe(6);
  });

  it('photo_requise = true quand la photo a plus de 6 mois (caduque)', async () => {
    const old = new Date(Date.now() - 200 * 86400 * 1000).toISOString();
    const res = await load({ path: '/uploads/cav-photos/cav_7_1.png', takenAt: old, source: 'admin' });
    expect(res.body.cavs[0].photo_requise).toBe(true);
  });

  it('photo_requise = false quand la photo est fraîche', async () => {
    const recent = new Date(Date.now() - 10 * 86400 * 1000).toISOString();
    const res = await load({ path: '/uploads/cav-photos/cav_7_1.png', takenAt: recent, source: 'chauffeur' });
    expect(res.body.cavs[0].photo_requise).toBe(false);
  });

  it('le seuil paramétré est appliqué ET renvoyé (photo de 100 j caduque à 3 mois)', async () => {
    const taken = new Date(Date.now() - 100 * 86400 * 1000).toISOString();
    const res = await load({ path: '/uploads/cav-photos/cav_7_1.png', takenAt: taken }, 3);
    expect(res.body.photo_fraicheur_mois).toBe(3);
    expect(res.body.cavs[0].photo_requise).toBe(true);
  });

  it('la photo d\'audit de la collecte (tour_cav.photo_path) n\'est pas écrasée par celle du CAV', async () => {
    const recent = new Date().toISOString();
    const res = await load({ path: '/uploads/cav-photos/cav_7_1.png', takenAt: recent });
    expect(res.body.cavs[0].photo_path).toBe('/uploads/collectes/collecte_1.png');
    expect(res.body.cavs[0].cav_photo_path).toBe('/uploads/cav-photos/cav_7_1.png');
  });

  it('tournée association : aucune exigence photo (ce ne sont pas des CAV)', async () => {
    mockDb([
      [/SELECT vehicle_id FROM tours/, [{ vehicle_id: 5 }]],
      [/FROM tours t JOIN vehicles v/, [{ ...tourRow, collection_type: 'association' }]],
      [/FROM tour_association_point tap/, [{ id: 1, cav_id: 3, position: 1, status: 'pending' }]],
    ]);
    const res = await request(app).get('/api/tours/90/public').set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    expect(res.body.cavs[0].photo_requise).toBe(false);
  });
});

describe('GET /api/tours/vehicle/:vehicleId/today — état photo transmis au mobile', () => {
  it('expose photo_requise par point et photo_fraicheur_mois sur la tournée', async () => {
    mockDb([
      [/FROM tours t\s+JOIN vehicles v/, [{ id: 90, vehicle_id: 5, collection_type: 'pav', status: 'planned' }]],
      [/FROM tour_cav tc\s+JOIN cav c/, [
        { id: 1, cav_id: 7, position: 1, cav_photo_path: null, cav_photo_taken_at: null },
        { id: 2, cav_id: 8, position: 2, cav_photo_path: '/uploads/cav-photos/cav_8.png', cav_photo_taken_at: new Date().toISOString() },
      ]],
    ]);

    const res = await request(app)
      .get('/api/tours/vehicle/5/today')
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(200);
    expect(res.body.tour.photo_fraicheur_mois).toBe(6);
    expect(res.body.cavs.map((c) => c.photo_requise)).toEqual([true, false]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/cav/:id/photo — photo posée au back-office', () => {
  it('horodate la prise de vue et marque l\'origine « admin »', async () => {
    mockDb([
      [/SELECT photo_path FROM cav WHERE id/, [{ photo_path: null }]],
      [/UPDATE cav SET photo_path/, (p) => [{ id: 7, photo_path: p[0], photo_source: 'admin' }]],
    ]);

    const res = await request(app)
      .post('/api/cav/7/photo')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('photo', PNG, { filename: 'cav.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    const update = mockQuery.mock.calls.find((c) => /UPDATE cav SET photo_path/.test(String(c[0])));
    expect(String(update[0])).toMatch(/photo_taken_at = NOW\(\)/);
    expect(String(update[0])).toMatch(/photo_source = 'admin'/);

    cleanupUploaded(res.body.photo_path, 'uploads', 'cav-photos');
  });

  it('DELETE remet les 3 colonnes à NULL (le point redevient à photographier)', async () => {
    mockDb([
      [/SELECT photo_path FROM cav WHERE id/, [{ photo_path: null }]],
      [/UPDATE cav SET photo_path = NULL/, []],
    ]);

    const res = await request(app)
      .delete('/api/cav/7/photo')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const update = mockQuery.mock.calls.find((c) => /UPDATE cav SET photo_path = NULL/.test(String(c[0])));
    expect(String(update[0])).toMatch(/photo_taken_at = NULL/);
    expect(String(update[0])).toMatch(/photo_source = NULL/);
  });

  it('GET /api/cav/:id expose photo_fraicheur_mois (seuil effectif, pas 6 en dur côté front)', async () => {
    mockDb([
      // La requête détail embarque désormais la sous-requête `modeles_tournees`
      // entre le SELECT * et le FROM — on route sur la fin stable de la requête.
      [/SELECT \*[\s\S]*FROM cav WHERE id = \$1/, [{ id: 7, photo_path: null, photo_taken_at: null, photo_source: null, modeles_tournees: [] }]],
      [/FROM tonnage_history/, []],
    ], { fraicheurMois: 4 });

    const res = await request(app).get('/api/cav/7').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.photo_fraicheur_mois).toBe(4);
    // Appartenance aux modèles de tournées (feuille de collecte 21/08/2026) :
    // toujours présente, `[]` pour un CAV hors de tout modèle actif.
    expect(res.body.modeles_tournees).toEqual([]);
  });

  it('GET /api/cav (liste) expose modeles_tournees pour le badge AdminCAV', async () => {
    mockDb([
      [/SELECT \*[\s\S]*modeles_tournees[\s\S]*FROM cav WHERE 1=1/, [
        { id: 7, name: 'CAV A', modeles_tournees: [{ id: 3, name: 'Boos 1' }] },
        { id: 8, name: 'CAV B', modeles_tournees: [] },
      ]],
    ], { fraicheurMois: 4 });

    const res = await request(app).get('/api/cav').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body[0].modeles_tournees).toEqual([{ id: 3, name: 'Boos 1' }]);
    expect(res.body[1].modeles_tournees).toEqual([]);
  });
});
