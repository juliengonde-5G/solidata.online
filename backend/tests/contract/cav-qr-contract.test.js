// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — QR code d'un point de collecte (CAV)
// ───────────────────────────────────────────────────────────────────────────
// Constaté en production le 24/08/2026 : la fiche d'un CAV restait bloquée sur
// « Chargement... » parce que GET /api/cav/:id/qr-code répondait 404. Le CAV
// portait bien un qr_code_data — celui imprimé sur la borne — mais plus aucune
// image sur le disque.
//
// L'image d'un QR est une fonction PURE de la donnée encodée : la redessiner
// ne fabrique aucune information. Le contrat vérifié ici :
//   1. Pas de qr_code_data  → 404 « QR code non généré » (rien à encoder).
//   2. Fichier présent      → il est servi tel quel (l'image collée sur la
//                             borne reste la référence).
//   3. Fichier absent       → l'image est REDESSINÉE et servie en 200,
//                             puis réenregistrée sur le disque.
//   4. CAV inexistant       → 404 « CAV non trouvé ».
//
// Auth réelle (JWT), DB mockée par routage SQL.
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

const adminToken = jwt.sign(
  { id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D' },
  JWT_SECRET, { expiresIn: '1h' });

const QR_DIR = path.join(__dirname, '..', '..', 'uploads', 'qrcodes');
const ecrits = [];

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/cav', require('../../src/routes/cav'));
});

function mockCav(row) {
  mockQuery.mockImplementation((sql) => {
    const text = String(sql);
    if (/FROM settings WHERE key/.test(text)) return Promise.resolve({ rows: [{ value: '6' }] });
    if (/SELECT qr_code_data, qr_code_image_path, name FROM cav/.test(text)) {
      return Promise.resolve({ rows: row ? [row] : [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => { mockQuery.mockReset(); });

afterAll(() => {
  for (const f of ecrits) { if (fs.existsSync(f)) fs.unlinkSync(f); }
});

const get = (id) => request(app).get(`/api/cav/${id}/qr-code`).set('Authorization', `Bearer ${adminToken}`);

describe('GET /api/cav/:id/qr-code', () => {
  test('CAV inexistant → 404 explicite', async () => {
    mockCav(null);
    const res = await get(999);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/CAV non trouvé/);
  });

  test("sans qr_code_data, rien à encoder → 404 « QR code non généré »", async () => {
    mockCav({ qr_code_data: null, qr_code_image_path: null, name: 'Borne A' });
    const res = await get(1);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/non généré/);
  });

  test('fichier présent → il est servi tel quel, jamais redessiné', async () => {
    if (!fs.existsSync(QR_DIR)) fs.mkdirSync(QR_DIR, { recursive: true });
    const nom = `qr_TEST_CONTRAT_${process.pid}.png`;
    const abs = path.join(QR_DIR, nom);
    // En-tête PNG minimal : ce qui compte est que CE contenu précis ressorte.
    const contenuOriginal = Buffer.from('89504e470d0a1a0a4f524947494e414c', 'hex');
    fs.writeFileSync(abs, contenuOriginal);
    ecrits.push(abs);

    mockCav({
      qr_code_data: 'SOLIDATA-CAV-208-1-abcd',
      qr_code_image_path: `/uploads/qrcodes/${nom}`,
      name: 'Borne 208',
    });

    const res = await get(208);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(Buffer.from(res.body).equals(contenuOriginal)).toBe(true);
  });

  test("fichier absent → l'image est redessinée, servie en 200, et réenregistrée", async () => {
    const qrData = `SOLIDATA-CAV-208-REGEN-${process.pid}`;
    mockCav({
      qr_code_data: qrData,
      qr_code_image_path: '/uploads/qrcodes/fichier-qui-nexiste-pas.png',
      name: 'Borne 208',
    });

    const res = await get(208);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    // Signature PNG : c'est une vraie image, pas un message d'erreur déguisé.
    expect(Buffer.from(res.body).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(Buffer.from(res.body).length).toBeGreaterThan(100);

    // La réparation du disque est faite après l'envoi : on la laisse aboutir.
    await new Promise((r) => setTimeout(r, 60));
    const attendu = path.join(QR_DIR, `qr_${qrData}.png`);
    ecrits.push(attendu);
    expect(fs.existsSync(attendu)).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE cav SET qr_code_image_path/),
      [`/uploads/qrcodes/qr_${qrData}.png`, '208'],
    );
  });

  test("chemin jamais renseigné mais donnée présente → redessiné plutôt que refusé", async () => {
    const qrData = `SOLIDATA-CAV-42-NOPATH-${process.pid}`;
    mockCav({ qr_code_data: qrData, qr_code_image_path: null, name: 'Borne 42' });

    const res = await get(42);
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

    await new Promise((r) => setTimeout(r, 60));
    ecrits.push(path.join(QR_DIR, `qr_${qrData}.png`));
  });
});
