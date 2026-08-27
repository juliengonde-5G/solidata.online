// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — Pennylane, lot L7
// ───────────────────────────────────────────────────────────────────────────
// Deux sujets, tous deux vérifiés SANS réseau (le module `https` est simulé)
// et SANS base (le pool pg est simulé) :
//
//  1. FACTURES CLIENTS — la cause racine du « 0 facture remontée ». La synchro
//     lisait ET écrivait `pennylane_config.last_sync_at`, colonne PARTAGÉE avec
//     le test de connexion, le Grand Livre et les transactions bancaires. Le
//     job GL quotidien la repoussant à NOW(), le bouton « Importer les
//     factures » ne demandait plus que les factures d'hier. Ces tests
//     verrouillent le curseur DÉDIÉ `last_invoice_sync_at` et la non-régression
//     (`last_sync_at` ne doit plus jamais être écrite par cette synchro).
//
//  2. CLIENTS — import/rapprochement PULL-only, jamais destructif.
//
// NB : ces tests prouvent la MÉCANIQUE (quel curseur, quel filtre, quelle
// forme de réponse). Ils ne peuvent pas prouver ce que le vrai dossier
// comptable contient — c'est l'objet du bouton « Diagnostic » en production.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// `getEncryptionKey()` (pennylane.js) refuse de déchiffrer sans secret et lève
// une erreur explicite : il faut donc le poser AVANT de charger le module.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const JWT_SECRET = process.env.JWT_SECRET;

// ── Base simulée ───────────────────────────────────────────────────────────
const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

// ── Réseau simulé : aucune requête ne sort ─────────────────────────────────
// `mockAppelsHttp` enregistre les chemins réellement demandés à Pennylane : c'est
// ainsi qu'on vérifie le filtre de date envoyé.
const mockAppelsHttp = [];
let mockReponseHttp = { status: 200, body: { items: [] } };
jest.mock('https', () => ({
  request: (options, cb) => {
    mockAppelsHttp.push(options.path);
    const listeners = {};
    const reponse = {
      statusCode: mockReponseHttp.status,
      headers: {},
      on: (evt, fn) => { listeners[evt] = fn; return reponse; },
    };
    process.nextTick(() => {
      cb(reponse);
      if (listeners.data) listeners.data(JSON.stringify(mockReponseHttp.body));
      if (listeners.end) listeners.end();
    });
    return { on: () => {}, write: () => {}, end: () => {}, destroy: () => {} };
  },
}));

const express = require('express');
const request = require('supertest');

let app;
const pennylane = () => require('../../src/routes/pennylane');
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D' }, JWT_SECRET, { expiresIn: '1h' });

// Clé API chiffrée avec la MÊME dérivation que le module (AES-256-CBC, IV aléatoire).
function chiffrerCle(clair) {
  const derivee = crypto.createHash('sha256').update(process.env.PENNYLANE_ENCRYPTION_KEY || JWT_SECRET).digest();
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', derivee, iv);
  return iv.toString('hex') + ':' + (c.update(clair, 'utf8', 'hex') + c.final('hex'));
}
const CLE_CHIFFREE = chiffrerCle('cle-api-de-test');

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/pennylane', pennylane());
});

beforeEach(() => {
  mockAppelsHttp.length = 0;
  mockReponseHttp = { status: 200, body: { items: [] } };
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

const get = (p) => request(app).get(p).set('Authorization', `Bearer ${adminToken}`);
const post = (p, body) => request(app).post(p).set('Authorization', `Bearer ${adminToken}`).send(body || {});

/** Aiguille les requêtes SQL par expression régulière et note les écritures. */
function brancherSql({ curseurFactures = null, clientsLocaux = [], ecritures = [] } = {}) {
  mockQuery.mockImplementation((sql, params) => {
    const s = String(sql);
    ecritures.push({ sql: s.replace(/\s+/g, ' ').trim(), params });
    if (/SELECT api_key_encrypted/.test(s)) {
      return Promise.resolve({ rows: [{ api_key_encrypted: CLE_CHIFFREE, company_id: 'SOLIDATA' }] });
    }
    if (/SELECT last_invoice_sync_at FROM pennylane_config/.test(s)) {
      return Promise.resolve({ rows: [{ last_invoice_sync_at: curseurFactures }] });
    }
    if (/INSERT INTO pennylane_sync_log/.test(s)) return Promise.resolve({ rows: [{ id: 77 }] });
    if (/FROM clients_exutoires/.test(s)) return Promise.resolve({ rows: clientsLocaux });
    if (/INSERT INTO clients_exutoires/.test(s)) return Promise.resolve({ rows: [{ id: 900, raison_sociale: params?.[0] }] });
    if (/UPDATE clients_exutoires/.test(s)) return Promise.resolve({ rows: [{ id: params?.[params.length - 1], raison_sociale: 'MAJ' }] });
    if (/FROM factures_exutoires/.test(s)) return Promise.resolve({ rows: [] });
    if (/INSERT INTO factures_exutoires/.test(s)) return Promise.resolve({ rows: [{ id: 501 }] });
    return Promise.resolve({ rows: [] });
  });
  return ecritures;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. FACTURES — le curseur dédié
// ═══════════════════════════════════════════════════════════════════════════
describe('CONTRAT POST /pennylane/sync/customer-invoices — curseur dédié', () => {
  it('lit last_invoice_sync_at (et JAMAIS last_sync_at) pour composer le filtre de date', async () => {
    const ecritures = brancherSql({ curseurFactures: '2026-06-01T08:00:00.000Z' });
    const res = await post('/api/pennylane/sync/customer-invoices');

    expect(res.status).toBe(200);
    // Le filtre part bien du curseur DES FACTURES.
    const appelFactures = mockAppelsHttp.find((p) => p.includes('/customer_invoices'));
    expect(decodeURIComponent(appelFactures)).toContain('"value":"2026-06-01"');
    // Non-régression : la synchro des factures ne lit plus la colonne partagée.
    const litLastSync = ecritures.some((e) => /SELECT last_sync_at FROM pennylane_config/.test(e.sql));
    expect(litLastSync).toBe(false);
  });

  it('n\'écrit PAS last_sync_at (colonne partagée avec le GL) mais bien last_invoice_sync_at', async () => {
    const ecritures = brancherSql({ curseurFactures: '2026-06-01T08:00:00.000Z' });
    await post('/api/pennylane/sync/customer-invoices');

    const majPartagee = ecritures.filter((e) => /UPDATE pennylane_config SET last_sync_at/.test(e.sql));
    expect(majPartagee).toHaveLength(0);
    const majDediee = ecritures.filter((e) => /UPDATE pennylane_config SET last_invoice_sync_at/.test(e.sql));
    expect(majDediee).toHaveLength(1);
  });

  it('replie sur 90 jours — pas sur hier — quand aucun curseur n\'est posé', async () => {
    brancherSql({ curseurFactures: null });
    const res = await post('/api/pennylane/sync/customer-invoices');

    const attendu = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(res.body.periode.du).toBe(attendu);
    expect(res.body.since_source).toMatch(/repli 90 jours/);
  });

  it('donne la priorité à la période demandée par l\'utilisateur', async () => {
    brancherSql({ curseurFactures: '2026-08-20T08:00:00.000Z' });
    const res = await post('/api/pennylane/sync/customer-invoices', { since: '2026-01-01' });

    expect(res.body.periode.du).toBe('2026-01-01');
    expect(res.body.since_source).toBe('période demandée');
    const appelFactures = mockAppelsHttp.find((p) => p.includes('/customer_invoices'));
    expect(decodeURIComponent(appelFactures)).toContain('"value":"2026-01-01"');
  });

  it('refuse une date de début mal formée plutôt que d\'interroger Pennylane', async () => {
    brancherSql({});
    const res = await post('/api/pennylane/sync/customer-invoices', { since: '01/01/2026' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SINCE_INVALIDE');
    expect(mockAppelsHttp).toHaveLength(0);
  });
});

describe('CONTRAT réponse de synchro — « 0 » honnête (Pennylane.jsx, ExutoiresControleFacturation.jsx)', () => {
  it('expose periode / recuperees / deja_presentes, et distingue « rien reçu » de « rien de neuf »', async () => {
    brancherSql({ curseurFactures: '2026-06-01T08:00:00.000Z' });
    const res = await post('/api/pennylane/sync/customer-invoices');

    // Ces clés EXACTES sont lues par les écrans pour choisir le bandeau.
    expect(res.body).toHaveProperty('periode.du');
    expect(res.body).toHaveProperty('periode.au');
    expect(res.body.recuperees).toBe(0);
    expect(res.body.deja_presentes).toBe(0);
    // Le message ne doit PAS être un « 0 importée(s) » nu : il dit la période.
    expect(res.body.message).toMatch(/Aucune facture renvoyée par Pennylane sur la période/);
    expect(res.body.message).toContain(res.body.periode.du);
  });

  it('conserve les clés historiques (imported/matched/errors) ET ajoute les alias français', async () => {
    brancherSql({ curseurFactures: '2026-06-01T08:00:00.000Z' });
    mockReponseHttp = {
      status: 200,
      body: { items: [{ id: 4242, invoice_number: 'FA-2026-001', date: '2026-07-15', amount: 1200, customer: { id: 9, name: 'RECYCLO' } }] },
    };
    const res = await post('/api/pennylane/sync/customer-invoices');

    expect(res.body.recuperees).toBe(1);
    for (const cle of ['imported', 'matched', 'errors', 'importees', 'rapprochees', 'erreurs']) {
      expect(res.body).toHaveProperty(cle);
    }
    expect(res.body.importees).toBe(res.body.imported);
    expect(res.body.message).toMatch(/1 facture\(s\) reçue\(s\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1bis. LE CURSEUR N'AVANCE PAS SUR UN SUCCÈS PARTIEL (correctif du 27/08)
// ───────────────────────────────────────────────────────────────────────────
// Le curseur était repoussé à NOW() même quand des factures avaient échoué
// (ROLLBACK par facture). Au passage suivant, la fenêtre repartait d'après
// leur date : une facture tombée en erreur n'était PLUS JAMAIS redemandée, et
// la synchro annonçait honnêtement « 0 récupérée ». C'est exactement le
// symptôme que ce lot répare — simplement déplacé du curseur partagé vers
// l'échec partiel.
// ═══════════════════════════════════════════════════════════════════════════
describe('CONTRAT curseur des factures — jamais avancé sur un succès partiel', () => {
  /** Facture sans identifiant : comptée en erreur par le moteur, sans toucher la base. */
  const FACTURE_SANS_ID = { invoice_number: 'FA-2026-999', date: '2026-07-01', amount: 500 };
  const FACTURE_OK = {
    id: 4242, invoice_number: 'FA-2026-001', date: '2026-07-15', amount: 1200,
    customer: { id: 9, name: 'RECYCLO' },
  };

  it('succès complet → le curseur avance, et la réponse le dit', async () => {
    const ecritures = brancherSql({ curseurFactures: '2026-06-01T08:00:00.000Z' });
    mockReponseHttp = { status: 200, body: { items: [FACTURE_OK] } };
    const res = await post('/api/pennylane/sync/customer-invoices');

    expect(res.body.erreurs).toBe(0);
    expect(res.body.curseur_avance).toBe(true);
    expect(res.body.curseur_motif).toBeNull();
    expect(ecritures.filter((e) => /UPDATE pennylane_config SET last_invoice_sync_at/.test(e.sql))).toHaveLength(1);
  });

  it('une seule facture en erreur → le curseur NE bouge PAS, et le motif est exposé', async () => {
    const ecritures = brancherSql({ curseurFactures: '2026-06-01T08:00:00.000Z' });
    mockReponseHttp = { status: 200, body: { items: [FACTURE_OK, FACTURE_SANS_ID] } };
    const res = await post('/api/pennylane/sync/customer-invoices');

    expect(res.status).toBe(200);
    expect(res.body.erreurs).toBe(1);
    // LE point du correctif : aucune écriture du curseur.
    expect(ecritures.filter((e) => /UPDATE pennylane_config SET last_invoice_sync_at/.test(e.sql))).toHaveLength(0);
    expect(res.body.curseur_avance).toBe(false);
    // Motif exploitable TEL QUEL par le bandeau des deux écrans : il doit dire
    // que rien n'est perdu, pas seulement qu'il y a eu une erreur.
    expect(res.body.curseur_motif).toMatch(/redemandée au prochain passage/);
    expect(res.body.curseur_motif).toContain('1 facture');
  });

  it('un échec d’écriture en base compte aussi : le curseur reste figé', async () => {
    const ecritures = [];
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      ecritures.push({ sql: s.replace(/\s+/g, ' ').trim(), params });
      if (/SELECT api_key_encrypted/.test(s)) {
        return Promise.resolve({ rows: [{ api_key_encrypted: CLE_CHIFFREE, company_id: 'SOLIDATA' }] });
      }
      if (/SELECT last_invoice_sync_at FROM pennylane_config/.test(s)) {
        return Promise.resolve({ rows: [{ last_invoice_sync_at: '2026-06-01T08:00:00.000Z' }] });
      }
      if (/INSERT INTO pennylane_sync_log/.test(s)) return Promise.resolve({ rows: [{ id: 77 }] });
      // L'insertion de la facture échoue : la transaction de CETTE facture est
      // annulée, les autres passent — c'est le comportement voulu du moteur.
      if (/INSERT INTO factures_exutoires/.test(s)) return Promise.reject(new Error('contrainte violée'));
      return Promise.resolve({ rows: [] });
    });
    mockReponseHttp = { status: 200, body: { items: [FACTURE_OK] } };
    const res = await post('/api/pennylane/sync/customer-invoices');

    expect(res.body.erreurs).toBe(1);
    expect(res.body.curseur_avance).toBe(false);
    expect(ecritures.filter((e) => /UPDATE pennylane_config SET last_invoice_sync_at/.test(e.sql))).toHaveLength(0);
    // La facture reste redemandable : la période interrogée n'a pas bougé.
    expect(res.body.periode.du).toBe('2026-06-01');
  });

  it('rien reçu et zéro erreur → le curseur avance (une période vide est un succès)', async () => {
    const ecritures = brancherSql({ curseurFactures: '2026-06-01T08:00:00.000Z' });
    const res = await post('/api/pennylane/sync/customer-invoices');

    expect(res.body.recuperees).toBe(0);
    expect(res.body.erreurs).toBe(0);
    expect(res.body.curseur_avance).toBe(true);
    expect(ecritures.filter((e) => /UPDATE pennylane_config SET last_invoice_sync_at/.test(e.sql))).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. DIAGNOSTIC
// ═══════════════════════════════════════════════════════════════════════════
describe('CONTRAT GET /pennylane/sync/diagnostic-invoices (PennylaneConfig.jsx)', () => {
  it('interroge Pennylane SANS filtre de date — c\'est tout l\'intérêt du diagnostic', async () => {
    brancherSql({});
    await get('/api/pennylane/sync/diagnostic-invoices');
    const appel = mockAppelsHttp.find((p) => p.includes('/customer_invoices'));
    expect(appel).toBeDefined();
    expect(appel).not.toContain('filter');
  });

  it('explique une liste vide au lieu d\'afficher un « 0 » muet', async () => {
    brancherSql({});
    const res = await get('/api/pennylane/sync/diagnostic-invoices');
    expect(res.status).toBe(200);
    expect(res.body.recuperees_sur_cette_page).toBe(0);
    expect(res.body.raison).toMatch(/BROUILLON/);
    expect(res.body.raison).toMatch(/habilitation/);
  });

  it('n\'expose que la liste blanche de champs — jamais la charge Pennylane brute ni la clé', async () => {
    brancherSql({});
    mockReponseHttp = {
      status: 200,
      body: {
        items: [{
          id: 1, invoice_number: 'FA-1', date: '2026-07-01', status: 'finalized', amount: 10,
          customer: { id: 3, name: 'ACME' },
          // Champs qui NE doivent PAS ressortir :
          iban_secret: 'FR76XXXX', internal_token: 'tok_live_123',
        }],
      },
    };
    const res = await get('/api/pennylane/sync/diagnostic-invoices');
    const brut = JSON.stringify(res.body);
    expect(brut).not.toContain('FR76XXXX');
    expect(brut).not.toContain('tok_live_123');
    expect(brut).not.toContain('cle-api-de-test');
    expect(res.body.exemples[0]).toEqual({
      id: 1, invoice_number: 'FA-1', date: '2026-07-01', status: 'finalized',
      draft: null, amount: 10, customer: 'ACME',
    });
  });

  it('remonte un refus d\'habilitation Pennylane (401/403) au lieu d\'un « 0 » trompeur', async () => {
    brancherSql({});
    mockReponseHttp = { status: 403, body: { error: 'forbidden' } };
    const res = await get('/api/pennylane/sync/diagnostic-invoices');
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('PENNYLANE_REFUS');
    expect(res.body.error).toMatch(/401\/403/);
  });

  it('est réservé aux ADMIN', async () => {
    brancherSql({});
    const jetonManager = jwt.sign({ id: 2, username: 'm', role: 'MANAGER' }, JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app).get('/api/pennylane/sync/diagnostic-invoices').set('Authorization', `Bearer ${jetonManager}`);
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. CLIENTS — helpers purs
// ═══════════════════════════════════════════════════════════════════════════
describe('Helpers purs de rapprochement client', () => {
  const { normaliserNomClient, extraireClientPennylane, deciderRapprochement } = pennylane();

  it('neutralise casse, accents, apostrophes, tirets et espaces multiples', () => {
    expect(normaliserNomClient('  Éco-Fibres  ')).toBe('ECO FIBRES');
    expect(normaliserNomClient('Récupé’Tex')).toBe(normaliserNomClient('RECUPE TEX'));
    expect(normaliserNomClient('Textile   Nord')).toBe(normaliserNomClient('textile nord'));
    expect(normaliserNomClient(null)).toBe('');
  });

  it('reste DÉLIBÉRÉMENT littéral : « SARL » et « S.A.R.L. » ne sont pas assimilés', () => {
    // Limite assumée. Rapprocher des formes juridiques abrégées supposerait un
    // dictionnaire, donc des faux positifs — et un faux positif ici FUSIONNE
    // deux clients (commandes et factures mélangées), ce qui est bien pire
    // qu'un doublon visible. Un nom non rapproché ressort simplement en
    // « à créer » dans la prévisualisation, où l'utilisateur tranche.
    expect(normaliserNomClient('RECUPE S.A.R.L.')).not.toBe(normaliserNomClient('RECUPE SARL'));
  });

  it('laisse VIDE ce que Pennylane ne dit pas — jamais une adresse inventée', () => {
    const c = extraireClientPennylane({ id: 12, name: 'RECYCLO' });
    expect(c.nom).toBe('RECYCLO');
    expect(c.adresse).toBe('');
    expect(c.ville).toBe('');
    expect(c.contact_email).toBe('');
    expect(c.siret).toBeNull();
    expect(c.contact_telephone).toBeNull();
  });

  it('ne retient un code postal QUE s\'il a 5 chiffres (la colonne fait 5 caractères)', () => {
    // Tronquer un code étranger le rendrait FAUX au lieu d'absent : on garde la
    // valeur brute à part, pour l'afficher, et on n'écrit rien en base.
    const belge = extraireClientPennylane({ id: 1, name: 'X', billing_address: { postal_code: 'B-1000' } });
    expect(belge.code_postal).toBe('');
    expect(belge.code_postal_brut).toBe('B-1000');

    const francais = extraireClientPennylane({ id: 2, name: 'Y', billing_address: { postal_code: '76770' } });
    expect(francais.code_postal).toBe('76770');
  });

  it('ne retient un SIRET que s\'il a 14 chiffres', () => {
    expect(extraireClientPennylane({ id: 1, name: 'X', reg_no: '123 456 789 00012' }).siret).toBe('12345678900012');
    expect(extraireClientPennylane({ id: 2, name: 'Y', reg_no: '123456789' }).siret).toBeNull(); // SIREN seul
  });

  it('rapproche par identifiant Pennylane en priorité, puis par nom normalisé', () => {
    const locaux = [
      { id: 5, raison_sociale: 'RECYCLO', pennylane_customer_id: '12' },
      { id: 6, raison_sociale: 'Éco-Fibres', pennylane_customer_id: null },
    ];
    expect(deciderRapprochement(extraireClientPennylane({ id: 12, name: 'Nom changé' }), locaux))
      .toMatchObject({ operation: 'inchange', client: { id: 5 } });
    expect(deciderRapprochement(extraireClientPennylane({ id: 99, name: 'ECO FIBRES' }), locaux))
      .toMatchObject({ operation: 'relier', client: { id: 6 } });
    expect(deciderRapprochement(extraireClientPennylane({ id: 42, name: 'Inconnu SAS' }), locaux))
      .toMatchObject({ operation: 'creer' });
  });

  it('ne tranche JAMAIS un homonyme : deux clients de même nom = ambigu', () => {
    // Fusionner deux homonymes au hasard mélangerait leurs commandes et leurs
    // factures — un dégât silencieux et difficile à défaire.
    const locaux = [
      { id: 7, raison_sociale: 'TEXTILE NORD', ville: 'Rouen', pennylane_customer_id: null },
      { id: 8, raison_sociale: 'Textile Nord', ville: 'Le Havre', pennylane_customer_id: null },
    ];
    const d = deciderRapprochement(extraireClientPennylane({ id: 55, name: 'TEXTILE NORD' }), locaux);
    expect(d.operation).toBe('ambigu');
    expect(d.candidats).toHaveLength(2);
  });

  it('ignore un client Pennylane sans raison sociale', () => {
    const d = deciderRapprochement(extraireClientPennylane({ id: 60 }), []);
    expect(d.operation).toBe('ignore');
    expect(d.motif).toMatch(/sans raison sociale/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. CLIENTS — routes
// ═══════════════════════════════════════════════════════════════════════════
describe('CONTRAT GET /pennylane/customers (ExutoiresClients.jsx — prévisualisation)', () => {
  it('annonce l\'opération prévue pour chaque client AVANT toute écriture', async () => {
    const ecritures = brancherSql({
      clientsLocaux: [{ id: 6, raison_sociale: 'Éco-Fibres', pennylane_customer_id: null }],
    });
    mockReponseHttp = { status: 200, body: { items: [{ id: 99, name: 'ECO FIBRES' }, { id: 100, name: 'NOUVEAU SAS' }] } };

    const res = await get('/api/pennylane/customers?limit=50');
    expect(res.status).toBe(200);
    expect(res.body.resume).toEqual({ a_creer: 1, a_relier: 1, deja_lies: 0, ambigus: 0 });
    expect(res.body.clients.map((c) => c.operation)).toEqual(['relier', 'creer']);

    // Une PRÉVISUALISATION n'écrit rien.
    const ecrit = ecritures.some((e) => /^(INSERT|UPDATE|DELETE)/i.test(e.sql));
    expect(ecrit).toBe(false);
  });
});

describe('CONTRAT POST /pennylane/customers/import — jamais destructif', () => {
  it('crée les absents, relie les rapprochés, et laisse les ambigus de côté', async () => {
    const ecritures = brancherSql({
      clientsLocaux: [
        { id: 6, raison_sociale: 'Éco-Fibres', pennylane_customer_id: null },
        { id: 7, raison_sociale: 'TEXTILE NORD', pennylane_customer_id: null },
        { id: 8, raison_sociale: 'Textile Nord', pennylane_customer_id: null },
      ],
    });
    mockReponseHttp = {
      status: 200,
      body: { items: [{ id: 99, name: 'ECO FIBRES' }, { id: 100, name: 'NOUVEAU SAS' }, { id: 101, name: 'Textile Nord' }] },
    };

    const res = await post('/api/pennylane/customers/import');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ recuperes: 3, crees: 1, relies: 1, erreurs: 0 });
    expect(res.body.ambigus).toHaveLength(1);
    expect(res.body.ambigus[0].nom).toBe('Textile Nord');

    // AUCUNE suppression, sous aucune forme.
    const detruit = ecritures.some((e) => /DELETE FROM clients_exutoires|SET actif = FALSE/i.test(e.sql));
    expect(detruit).toBe(false);
    // L'ambigu n'a donné lieu à aucune écriture sur un client.
    const ecrituresClients = ecritures.filter((e) => /(INSERT INTO|UPDATE) clients_exutoires/i.test(e.sql));
    expect(ecrituresClients).toHaveLength(2); // 1 création + 1 rapprochement
  });

  it('ne comble QUE les champs vides de l\'ERP (aucun écrasement d\'une saisie)', async () => {
    const ecritures = brancherSql({
      clientsLocaux: [{ id: 6, raison_sociale: 'RECYCLO', pennylane_customer_id: null }],
    });
    mockReponseHttp = { status: 200, body: { items: [{ id: 99, name: 'RECYCLO', billing_address: { city: 'Rouen' } }] } };

    await post('/api/pennylane/customers/import');
    const maj = ecritures.find((e) => /UPDATE clients_exutoires SET/.test(e.sql));
    expect(maj).toBeDefined();
    // Chaque champ importé passe par COALESCE(NULLIF(colonne, ''), $n) :
    // une valeur déjà saisie l'emporte toujours sur l'annuaire comptable.
    for (const col of ['siret', 'adresse', 'code_postal', 'ville', 'contact_nom', 'contact_email']) {
      expect(maj.sql).toMatch(new RegExp(`${col}\\s*=\\s*COALESCE\\(NULLIF\\(${col}, ''\\)`));
    }
    // La raison sociale de l'ERP n'est jamais réécrite par Pennylane.
    expect(maj.sql).not.toMatch(/raison_sociale\s*=/);
  });

  it('dit qu\'il faut migrer la base plutôt que de renvoyer un 500 opaque', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT api_key_encrypted/.test(s)) return Promise.resolve({ rows: [{ api_key_encrypted: CLE_CHIFFREE, company_id: 'S' }] });
      if (/INSERT INTO pennylane_sync_log/.test(s)) return Promise.resolve({ rows: [{ id: 77 }] });
      if (/FROM clients_exutoires/.test(s)) {
        return Promise.reject(Object.assign(new Error('column "pennylane_customer_id" does not exist'), { code: '42703' }));
      }
      return Promise.resolve({ rows: [] });
    });
    mockReponseHttp = { status: 200, body: { items: [{ id: 1, name: 'X' }] } };

    const res = await post('/api/pennylane/customers/import');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('BASE_NON_MIGREE');
  });
});
