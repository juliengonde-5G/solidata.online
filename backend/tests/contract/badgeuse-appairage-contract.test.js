// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — APPAIRAGE PAR CODE COURT + PURGE D'UN POSTE (ADR-0005)
// ───────────────────────────────────────────────────────────────────────────
// Verrouille les trois surfaces du lot (CONTRAT_API_DEVICE §3ter, v1.4) :
//
//   1. ÉMISSION  POST /api/badgeuse/devices/:id/code-appairage (ADMIN)
//      — code XXXX-XXXX tiré d'un alphabet sans caractères ambigus, condensat
//        SEUL stocké, échéance calée sur `badgeuse.appairage_ttl_minutes`,
//        journalisation DANS la transaction.
//   2. RÉCLAMATION  POST /api/badgeuse/device/v1/appairage (PUBLIC)
//      — usage UNIQUE (le second essai échoue), clé du poste RÉGÉNÉRÉE (donc
//        l'ancienne cesse de valoir), casse et tirets tolérés, message d'échec
//        GÉNÉRIQUE et identique pour inconnu / expiré / consommé, aucun
//        condensat dans la réponse, aucun `X-Device-Key` requis.
//   3. SUPPRESSION  DELETE /api/badgeuse/devices/:id (ADMIN)
//      — REFUSÉE (409 + compte) dès qu'un pointage existe : un poste qui a
//        compté des heures appartient à la piste d'audit.
//
// Et l'invariant qui tient tout : LE CODE NE FUIT NULLE PART — ni en base
// (seul son SHA-256 y entre), ni dans les journaux (espion sur console).
//
// Auth réelle (JWT sans `tv` → aucune lecture base), DB mockée par un magasin
// de postes en mémoire. Même harnais que badgeuse-contract.test.js.
// ═══════════════════════════════════════════════════════════════════════════
const crypto = require('crypto');
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

const {
  APPAIRAGE_ALPHABET, generateAppairageCode, formatAppairageCode,
  normalizeAppairageCode, hashAppairageCode, hashDeviceKey, encryptSecret,
} = require('../../src/utils/badgeuse-crypto');

const badgeuse = require('../../src/routes/badgeuse');
const deviceRouter = require('../../src/routes/badgeuse-device');

const tokenFor = (role, id = 1) => jwt.sign(
  { id, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = { ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER') };

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/badgeuse/device', deviceRouter);
  app.use('/api/badgeuse', badgeuse);
});

// ── Magasin de postes en mémoire ────────────────────────────────────────────
// Le mock reproduit ce que la base garantit vraiment : l'expiration filtre les
// candidats, la consommation efface les colonnes, le compteur de pointages
// existe. Sans quoi les tests d'usage unique ne prouveraient rien.
const CLE_INITIALE = 'a'.repeat(64);
let store;
let settings;
let pointagesParDevice;

function resetStore() {
  store = new Map([[1, {
    id: 1, code: 'LH-P1', libelle: 'Entrée atelier', site_id: 1, cible: 'pi5', actif: true,
    api_key_hash: hashDeviceKey(CLE_INITIALE),
    appairage_code_hash: null, appairage_expire_le: null,
  }]]);
  settings = {};
  pointagesParDevice = new Map();
}

/**
 * Le mock HONORE LES TRANSACTIONS : instantané à BEGIN, restauration à
 * ROLLBACK. Sans cela, les chemins d'échec (clé de site illisible, code déjà
 * consommé) sembleraient laisser des écritures derrière eux et le test
 * « aucune rotation silencieuse » ne prouverait rien — c'est justement le
 * ROLLBACK qui protège les clés existantes.
 */
let instantane = null;
function snapshot() {
  return {
    store: new Map([...store].map(([k, v]) => [k, { ...v }])),
    settings: { ...settings },
  };
}

function installMocks() {
  mockQuery.mockImplementation((sql, params = []) => {
    const s = String(sql);
    if (/^\s*BEGIN/.test(s)) { instantane = snapshot(); return Promise.resolve({ rows: [] }); }
    if (/^\s*COMMIT/.test(s)) { instantane = null; return Promise.resolve({ rows: [] }); }
    if (/^\s*ROLLBACK/.test(s)) {
      if (instantane) { store = instantane.store; settings = instantane.settings; instantane = null; }
      return Promise.resolve({ rows: [] });
    }

    // ── settings ──
    if (/SELECT key, value FROM settings WHERE key LIKE/.test(s)) {
      return Promise.resolve({ rows: Object.entries(settings).map(([key, value]) => ({ key, value })) });
    }
    if (/SELECT key, value FROM settings WHERE key IN/.test(s)) {
      return Promise.resolve({
        rows: Object.entries(settings).filter(([k]) => params.includes(k)).map(([key, value]) => ({ key, value })),
      });
    }
    if (/SELECT value FROM settings/.test(s)) {
      const k = params[0];
      return Promise.resolve({ rows: settings[k] != null ? [{ value: settings[k] }] : [] });
    }
    if (/INSERT INTO settings/.test(s)) { settings[params[0]] = params[1]; return Promise.resolve({ rows: [] }); }

    // ── émission du code (back-office) ──
    if (/SET appairage_code_hash = \$2/.test(s)) {
      const d = store.get(params[0]);
      if (!d) return Promise.resolve({ rows: [] });
      d.appairage_code_hash = params[1];
      d.appairage_expire_le = new Date(Date.now() + Number(params[2]) * 60000).toISOString();
      return Promise.resolve({ rows: [{ ...d }] });
    }

    // ── candidats à la réclamation (expiration appliquée, comme en base) ──
    if (/FROM badgeuse_devices\s+WHERE actif = true/.test(s)) {
      const rows = [...store.values()].filter((d) => d.actif && d.appairage_code_hash
        && d.appairage_expire_le && new Date(d.appairage_expire_le).getTime() > Date.now());
      return Promise.resolve({ rows: rows.map((d) => ({ ...d })) });
    }

    // ── consommation atomique ──
    if (/SET api_key_hash = \$2, appairage_code_hash = NULL/.test(s)) {
      const d = store.get(params[0]);
      const encoreValide = d && d.appairage_code_hash === params[2]
        && d.appairage_expire_le && new Date(d.appairage_expire_le).getTime() > Date.now();
      if (!encoreValide) return Promise.resolve({ rows: [] });
      d.api_key_hash = params[1];
      d.appairage_code_hash = null;
      d.appairage_expire_le = null;
      return Promise.resolve({ rows: [{ ...d }] });
    }

    // ── suppression ──
    if (/FROM badgeuse_devices WHERE id = \$1 FOR UPDATE/.test(s)) {
      const d = store.get(params[0]);
      return Promise.resolve({ rows: d ? [{ ...d }] : [] });
    }
    if (/COUNT\(\*\)::int AS n FROM badgeuse_pointages/.test(s)) {
      return Promise.resolve({ rows: [{ n: pointagesParDevice.get(params[0]) || 0 }] });
    }
    if (/DELETE FROM badgeuse_devices/.test(s)) { store.delete(params[0]); return Promise.resolve({ rows: [] }); }

    if (/INSERT INTO rgpd_audit_log/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockClear();
  resetStore();
  instantane = null;
  installMocks();
});

const post = (path, role, body = {}) => request(app).post(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const del = (path, role) => request(app).delete(path).set('Authorization', `Bearer ${TOKENS[role]}`);
/** Réclamation : AUCUN en-tête d'authentification (le poste n'a pas de clé). */
const reclamer = (code) => request(app).post('/api/badgeuse/device/v1/appairage').send({ code });

/** Toutes les instructions SQL passées au mock, dans l'ordre. */
const sqlTrace = () => mockQuery.mock.calls.map(([s]) => String(s).replace(/\s+/g, ' ').trim());

// ═══════════════════════════════════════════════════════════════════════════
// 1. ÉMISSION DU CODE
// ═══════════════════════════════════════════════════════════════════════════
describe('émission du code d\'appairage (ADMIN)', () => {
  test('le code est tiré d\'un alphabet SANS caractères ambigus (200 tirages)', () => {
    // Ni I/L/O/U ni 0/1 : ce sont les six symboles que l'on confond en dictant
    // un code ou en le recopiant depuis un écran.
    const AMBIGUS = /[ILOU01]/;
    const vus = new Set();
    for (let i = 0; i < 200; i += 1) {
      const code = generateAppairageCode();
      expect(code).toHaveLength(8);
      expect(code).not.toMatch(AMBIGUS);
      expect(code).toMatch(new RegExp(`^[${APPAIRAGE_ALPHABET}]{8}$`));
      [...code].forEach((c) => vus.add(c));
    }
    // 1600 symboles tirés : un alphabet de 30 doit être couvert en entier —
    // un tirage qui n'atteindrait qu'une partie de l'alphabet serait suspect.
    expect(vus.size).toBe(APPAIRAGE_ALPHABET.length);
  });

  test('renvoie un code formaté XXXX-XXXX et son échéance, une seule fois', async () => {
    const res = await post('/api/badgeuse/devices/1/code-appairage', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/);
    expect(res.body.expire_le).toBeTruthy();
    expect(res.body.ttl_minutes).toBe(15); // défaut documenté
    expect(res.body.device).toMatchObject({ id: 1, code: 'LH-P1' });
  });

  test('SEUL le condensat SHA-256 entre en base — jamais le code en clair', async () => {
    const res = await post('/api/badgeuse/devices/1/code-appairage', 'ADMIN');
    const code = res.body.code;              // « XXXX-XXXX »
    const nu = code.replace('-', '');        // le secret lui-même

    // La colonne porte le condensat du code NORMALISÉ, et rien d'autre.
    const stocke = store.get(1).appairage_code_hash;
    expect(stocke).toBe(hashAppairageCode(code));
    expect(stocke).toBe(crypto.createHash('sha256').update(nu).digest('hex'));
    expect(stocke).toMatch(/^[0-9a-f]{64}$/);

    // Aucun paramètre SQL, nulle part, ne transporte le code lisible.
    const tousLesParams = mockQuery.mock.calls
      .map(([, p]) => JSON.stringify(p || []))
      .join(' ');
    expect(tousLesParams).not.toContain(nu);
    expect(tousLesParams).not.toContain(code);
  });

  test('l\'échéance suit le réglage badgeuse.appairage_ttl_minutes', async () => {
    settings['badgeuse.appairage_ttl_minutes'] = 25;
    const res = await post('/api/badgeuse/devices/1/code-appairage', 'ADMIN');
    expect(res.body.ttl_minutes).toBe(25);
    const restant = (new Date(store.get(1).appairage_expire_le).getTime() - Date.now()) / 60000;
    expect(restant).toBeGreaterThan(24);
    expect(restant).toBeLessThanOrEqual(25);
  });

  test('l\'émission est journalisée DANS la transaction', async () => {
    await post('/api/badgeuse/devices/1/code-appairage', 'ADMIN');
    const trace = sqlTrace();
    const iBegin = trace.findIndex((s) => /^BEGIN/.test(s));
    const iUpdate = trace.findIndex((s) => /SET appairage_code_hash/.test(s));
    const iAudit = trace.findIndex((s) => /INSERT INTO rgpd_audit_log/.test(s));
    const iCommit = trace.findIndex((s) => /^COMMIT/.test(s));
    expect(iBegin).toBeGreaterThanOrEqual(0);
    expect(iUpdate).toBeGreaterThan(iBegin);
    expect(iAudit).toBeGreaterThan(iUpdate);
    expect(iCommit).toBeGreaterThan(iAudit);

    const audit = mockQuery.mock.calls.find(([s]) => /INSERT INTO rgpd_audit_log/.test(String(s)));
    expect(audit[1][1]).toBe('BADGEUSE_CODE_APPAIRAGE');
    expect(audit[1][2]).toBe('badgeuse_devices');
    // Le journal décrit l'acte, il ne recopie pas le secret.
    expect(JSON.parse(audit[1][4])).toMatchObject({ device_code: 'LH-P1', ttl_minutes: 15 });
  });

  test('404 sur un poste inexistant, 403 hors ADMIN', async () => {
    expect((await post('/api/badgeuse/devices/999/code-appairage', 'ADMIN')).status).toBe(404);
    expect((await post('/api/badgeuse/devices/1/code-appairage', 'RH')).status).toBe(403);
    expect((await post('/api/badgeuse/devices/1/code-appairage', 'MANAGER')).status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. RÉCLAMATION PAR LE POSTE (surface publique)
// ═══════════════════════════════════════════════════════════════════════════
describe('réclamation de configuration par le poste', () => {
  /** Émet un code et renvoie sa forme lisible « XXXX-XXXX ». */
  async function emettre() {
    const res = await post('/api/badgeuse/devices/1/code-appairage', 'ADMIN');
    expect(res.status).toBe(200);
    return res.body.code;
  }

  test('un code valide rend la configuration complète, SANS X-Device-Key', async () => {
    const code = await emettre();
    const res = await reclamer(code);

    expect(res.status).toBe(200);
    expect(res.body.device_code).toBe('LH-P1');
    expect(res.body.device_key).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.hmac_key).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.cible).toBe('pi5');
    // Cascade honnête : aucun réglage, aucun PUBLIC_BASE_URL → domaine documenté.
    expect(res.body.server_url).toBe('https://solidata.online');
  });

  test('la clé du poste est RÉGÉNÉRÉE : l\'ancienne cesse de valoir', async () => {
    const avant = store.get(1).api_key_hash;
    expect(avant).toBe(hashDeviceKey(CLE_INITIALE));

    const res = await reclamer(await emettre());
    const apres = store.get(1).api_key_hash;

    expect(apres).not.toBe(avant);                       // l'ancienne clé est révoquée
    expect(apres).toBe(hashDeviceKey(res.body.device_key)); // la nouvelle est bien celle remise
  });

  test('USAGE UNIQUE : le second appel avec le même code échoue', async () => {
    const code = await emettre();
    expect((await reclamer(code)).status).toBe(200);
    expect(store.get(1).appairage_code_hash).toBeNull();
    expect(store.get(1).appairage_expire_le).toBeNull();

    const second = await reclamer(code);
    expect(second.status).toBe(404);
    expect(second.body).toEqual({ error: 'code_invalide' });
  });

  test('un code EXPIRÉ est refusé, du même refus générique', async () => {
    const code = await emettre();
    store.get(1).appairage_expire_le = new Date(Date.now() - 1000).toISOString();
    const res = await reclamer(code);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'code_invalide' });
  });

  test('un code INCONNU (ou malformé) est refusé, du même refus générique', async () => {
    await emettre();
    for (const faux of ['ZZZZ-ZZZZ', 'AB', 'K7M29PQ0', '']) {
      const res = await reclamer(faux);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'code_invalide' }); // inconnu ≡ expiré ≡ consommé
    }
    // Aucun refus n'a consommé le code légitime.
    expect(store.get(1).appairage_code_hash).not.toBeNull();
  });

  test('casse et tirets tolérés : « k7m2-9pqx » vaut « K7M29PQX »', async () => {
    const code = await emettre();                        // « XXXX-XXXX »
    const saisi = code.toLowerCase();                    // minuscules + tiret
    expect(normalizeAppairageCode(saisi)).toBe(code.replace('-', ''));

    const res = await reclamer(saisi);
    expect(res.status).toBe(200);
    expect(res.body.device_key).toMatch(/^[0-9a-f]{64}$/);
  });

  test('la réponse ne contient AUCUN condensat', async () => {
    const code = await emettre();
    const codeHash = store.get(1).appairage_code_hash;
    const res = await reclamer(code);

    const corps = JSON.stringify(res.body);
    expect(corps).not.toContain('appairage_code_hash');
    expect(corps).not.toContain('api_key_hash');
    expect(corps).not.toContain(codeHash);
    // Le poste reçoit la CLÉ, le serveur ne garde que son condensat : les deux
    // ne doivent jamais voyager ensemble.
    expect(corps).not.toContain(store.get(1).api_key_hash);
  });

  test('la clé HMAC du site déjà en place est RENDUE, jamais tournée en douce', async () => {
    settings['badgeuse.hmac_key_site_1'] = encryptSecret('b'.repeat(64));
    const cleSiteAvant = settings['badgeuse.hmac_key_site_1'];
    const res = await reclamer(await emettre());
    expect(res.status).toBe(200);
    expect(res.body.hmac_key).toBe('b'.repeat(64));
    // La clé du site n'a pas été RÉÉCRITE : les uid_hmac déjà calculés pour ce
    // site restent valides (une rotation obligerait à réenrôler tous les badges).
    expect(settings['badgeuse.hmac_key_site_1']).toBe(cleSiteAvant);
    expect(sqlTrace().filter((x) => /INSERT INTO settings/.test(x))).toHaveLength(0);
  });

  test('une clé HMAC de site ILLISIBLE échoue franchement (aucune rotation silencieuse)', async () => {
    settings['badgeuse.hmac_key_site_1'] = 'v1:corrompu:corrompu:corrompu';
    const res = await reclamer(await emettre());
    expect(res.status).toBe(503);
    // Ni nouvelle clé de site, ni clé de poste changée : rien n'a été détruit.
    expect(sqlTrace().filter((s) => /INSERT INTO settings/.test(s))).toHaveLength(0);
    expect(store.get(1).api_key_hash).toBe(hashDeviceKey(CLE_INITIALE));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. SUPPRESSION D'UN POSTE
// ═══════════════════════════════════════════════════════════════════════════
describe('suppression d\'un poste (ADMIN)', () => {
  test('REFUSÉE en 409 dès qu\'un pointage existe, avec leur nombre', async () => {
    pointagesParDevice.set(1, 4231);
    const res = await del('/api/badgeuse/devices/1', 'ADMIN');
    expect(res.status).toBe(409);
    expect(res.body.pointages).toBe(4231);
    expect(res.body.error).toMatch(/4231/);
    expect(res.body.error).toMatch(/[Dd]ésactivez/); // la manœuvre de repli est dite
    expect(store.has(1)).toBe(true);                 // rien n'a été détruit
    expect(sqlTrace().some((s) => /DELETE FROM badgeuse_devices/.test(s))).toBe(false);
  });

  test('supprime et journalise quand le poste n\'a jamais rien enregistré', async () => {
    const res = await del('/api/badgeuse/devices/1', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.supprime).toBe(true);
    expect(store.has(1)).toBe(false);

    const trace = sqlTrace();
    const iDelete = trace.findIndex((s) => /DELETE FROM badgeuse_devices/.test(s));
    const iAudit = trace.findIndex((s) => /INSERT INTO rgpd_audit_log/.test(s));
    const iCommit = trace.findIndex((s) => /^COMMIT/.test(s));
    expect(iDelete).toBeGreaterThan(trace.findIndex((s) => /^BEGIN/.test(s)));
    expect(iAudit).toBeGreaterThan(iDelete);
    expect(iCommit).toBeGreaterThan(iAudit);

    const audit = mockQuery.mock.calls.find(([s]) => /INSERT INTO rgpd_audit_log/.test(String(s)));
    expect(audit[1][1]).toBe('BADGEUSE_DEVICE_SUPPRESSION');
    expect(JSON.parse(audit[1][4])).toMatchObject({ device_code: 'LH-P1', pointages: 0 });
  });

  test('404 sur un poste inexistant, 403 hors ADMIN', async () => {
    expect((await del('/api/badgeuse/devices/999', 'ADMIN')).status).toBe(404);
    expect((await del('/api/badgeuse/devices/1', 'RH')).status).toBe(403);
    expect(store.has(1)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. L'INVARIANT QUI TIENT TOUT : LE CODE NE FUIT PAS DANS LES JOURNAUX
// ═══════════════════════════════════════════════════════════════════════════
describe('minimisation des journaux', () => {
  test('aucun code d\'appairage n\'apparaît dans les sorties console', async () => {
    const sorties = [];
    const espions = ['log', 'info', 'warn', 'error', 'debug'].map((niveau) => jest
      .spyOn(console, niveau)
      .mockImplementation((...args) => { sorties.push(args.map(String).join(' ')); }));

    const emis = await post('/api/badgeuse/devices/1/code-appairage', 'ADMIN');
    const code = emis.body.code;
    const nu = code.replace('-', '');
    await reclamer(code.toLowerCase());
    await reclamer(code);                 // second essai : refusé
    await reclamer('ZZZZ-ZZZZ');          // code inconnu

    espions.forEach((e) => e.mockRestore());

    const journal = sorties.join('\n');
    expect(journal).not.toContain(nu);
    expect(journal).not.toContain(code);
    expect(journal).not.toContain(nu.toLowerCase());
    // Ce que le journal DOIT dire en revanche : quel poste, et que l'acte a eu lieu.
    expect(journal).toMatch(/LH-P1/);
  });

  test('formatAppairageCode n\'invente rien sur une entrée non conforme', () => {
    expect(formatAppairageCode('ABCD2345')).toBe('ABCD-2345');
    expect(formatAppairageCode('court')).toBe('court');
    expect(formatAppairageCode(null)).toBe('');
  });
});
