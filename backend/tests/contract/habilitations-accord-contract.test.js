// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — LA MATRICE D'HABILITATIONS PEUT ACCORDER (2.56.0)
// ───────────────────────────────────────────────────────────────────────────
// Demande client : « la sidebar ne fonctionne pas correctement avec les
// nouveaux profils ». Diagnostic : le retrait de MANAGER/QHSE/FINANCE (2.52.0)
// a resserré 44 entrées de la barre latérale sur le SEUL ADMIN. Aucun profil
// assignable, ni aucun rôle personnalisé (borné aux droits de son rôle de
// base), ne pouvait plus recevoir la Collecte, le Tri, l'Analyse ou la Frip :
// les donner supposait de donner ADMIN, donc aussi les comptes utilisateurs, la
// base de données et le registre RGPD. La matrice sait désormais AJOUTER.
//
// CE QUI EST VERROUILLÉ ICI, ET POURQUOI CHAQUE POINT COMPTE :
//
//   • Un accord ouvre VRAIMENT l'API, pas seulement le lien du menu — sans quoi
//     la barre latérale afficherait des écrans répondant 403.
//   • Un rôle SANS accord reste refusé : l'accord est la seule différence.
//   • Le REFUS prime sur l'accord (une case ne peut pas dire les deux).
//   • L'« Administration » n'est jamais accordable : une case à cocher ne doit
//     pas fabriquer un administrateur en silence.
//   • Une route hors carte ne s'ouvre par aucun accord.
//   • Une matrice ILLISIBLE n'invente aucun accord (fail-closed), alors qu'elle
//     continue de laisser passer sur les refus (fail-open) — l'asymétrie est le
//     cœur de la sûreté du lot.
//
// Auth réelle (JWT), base mockée : aucun accès disque ni réseau.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));

const express = require('express');
const request = require('supertest');
const { authenticate, authorize } = require('../../src/middleware/auth');
const { refreshModuleAccess } = require('../../src/middleware/module-access');

const tokenFor = (role, id = 1) => jwt.sign(
  { id, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' }
);

// État de la matrice simulée : lignes { role, module_key } par nature.
let refus = [];
let accords = [];
let matriceEnPanne = false;
// Compte les lectures métier : un refus qui arrive APRÈS elles serait un refus
// d'affichage, pas un refus d'accès.
let lecturesMetier = 0;

beforeEach(() => {
  refus = [];
  accords = [];
  matriceEnPanne = false;
  lecturesMetier = 0;
  refreshModuleAccess(); // le cache ne doit jamais fuir d'un test à l'autre
  mockQuery.mockReset();
  mockQuery.mockImplementation(async (sql, params) => {
    const texte = String(sql);
    // Compte utilisateur lu par `authenticate`.
    if (/FROM users/i.test(texte)) {
      return { rows: [{ id: 1, username: 'u', role: params?.[0] ?? 'X', is_active: true, token_version: 0 }] };
    }
    if (/FROM custom_roles/i.test(texte)) return { rows: [] };
    if (/FROM role_module_access/i.test(texte)) {
      if (matriceEnPanne) throw new Error('base injoignable');
      if (/grant_access = true/i.test(texte)) return { rows: accords };
      if (/allowed = false/i.test(texte)) return { rows: refus };
      return { rows: [] };
    }
    lecturesMetier += 1;
    return { rows: [] };
  });
});

// `authenticate` relit l'utilisateur en base : on force le rôle du jeton.
function appPour(role, cheminMonte, rolesAutorises) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req._role = role; next(); });
  // Le mock de users renvoie le rôle passé en paramètre : on le pose ici.
  mockQuery.mockImplementation(async (sql) => {
    const texte = String(sql);
    if (/FROM users/i.test(texte)) {
      return { rows: [{ id: 1, username: 'u', role, is_active: true, token_version: 0 }] };
    }
    if (/FROM custom_roles/i.test(texte)) return { rows: [] };
    if (/FROM role_module_access/i.test(texte)) {
      if (matriceEnPanne) throw new Error('base injoignable');
      if (/grant_access = true/i.test(texte)) return { rows: accords };
      if (/allowed = false/i.test(texte)) return { rows: refus };
      return { rows: [] };
    }
    lecturesMetier += 1;
    return { rows: [] };
  });
  app.use(cheminMonte, authenticate, authorize(...rolesAutorises), async (req, res) => {
    // Lecture métier symbolique : elle ne doit pas avoir lieu sur un refus.
    await require('../../src/config/database').query('SELECT 1 FROM cav');
    res.json({ ok: true });
  });
  return app;
}

const appelle = (app, chemin, role) =>
  request(app).get(chemin).set('Authorization', `Bearer ${tokenFor(role)}`);

describe('Un accord de module ouvre réellement la porte', () => {
  test('sans accord, le rôle reste refusé (403) et rien n’est lu en base', async () => {
    const app = appPour('CR_ENCADRANT', '/api/cav', ['ADMIN']);
    const r = await appelle(app, '/api/cav', 'CR_ENCADRANT');
    expect(r.status).toBe(403);
    expect(lecturesMetier).toBe(0);
  });

  test('avec l’accord « operations », le même rôle passe (200)', async () => {
    accords = [{ role: 'CR_ENCADRANT', module_key: 'operations' }];
    const app = appPour('CR_ENCADRANT', '/api/cav', ['ADMIN']);
    const r = await appelle(app, '/api/cav', 'CR_ENCADRANT');
    expect(r.status).toBe(200);
    expect(lecturesMetier).toBe(1);
  });

  test('l’accord ne déborde pas sur un module voisin', async () => {
    // « operations » accordé ne doit pas ouvrir le tri.
    accords = [{ role: 'CR_ENCADRANT', module_key: 'operations' }];
    const app = appPour('CR_ENCADRANT', '/api/production', ['ADMIN']);
    const r = await appelle(app, '/api/production', 'CR_ENCADRANT');
    expect(r.status).toBe(403);
  });

  test('l’accord suit la clé de rôle BRUTE, comme la barre latérale', async () => {
    // Accord posé sur le rôle de BASE : il ne doit pas profiter au rôle dupliqué,
    // sinon l'écran (qui lit la clé brute) et la porte diraient deux choses.
    accords = [{ role: 'COLLABORATEUR', module_key: 'operations' }];
    const app = appPour('CR_ENCADRANT', '/api/cav', ['ADMIN']);
    const r = await appelle(app, '/api/cav', 'CR_ENCADRANT');
    expect(r.status).toBe(403);
  });

  test('un accord sur la section parente ouvre ses sous-branches (frip → VAK)', async () => {
    // `/api/vak` relève de ['vak', 'frip'] : accorder la section « Frip » doit
    // ouvrir la Vente au Kilo, comme le menu où VAK est une sous-branche de Frip.
    accords = [{ role: 'CR_BOUTIQUE', module_key: 'frip' }];
    const app = appPour('CR_BOUTIQUE', '/api/vak', ['ADMIN']);
    const r = await appelle(app, '/api/vak', 'CR_BOUTIQUE');
    expect(r.status).toBe(200);
  });

  test('un accord sur la sous-branche seule n’ouvre pas la section entière', async () => {
    accords = [{ role: 'CR_BOUTIQUE', module_key: 'vak' }];
    const app = appPour('CR_BOUTIQUE', '/api/boutiques', ['ADMIN']);
    const r = await appelle(app, '/api/boutiques', 'CR_BOUTIQUE');
    expect(r.status).toBe(403);
  });

  test('un rôle déjà autorisé par sa liste passe sans consulter la matrice', async () => {
    matriceEnPanne = true; // si la matrice était lue, le test échouerait autrement
    const app = appPour('RH', '/api/employees', ['ADMIN', 'RH']);
    const r = await appelle(app, '/api/employees', 'RH');
    expect(r.status).toBe(200);
  });
});

describe('Bornes — ce qu’un accord ne peut pas ouvrir', () => {
  test('l’Administration n’est jamais accordable (comptes, base, matrice)', async () => {
    accords = [{ role: 'CR_ENCADRANT', module_key: 'admin' }];
    for (const chemin of ['/api/users', '/api/admin-db', '/api/settings']) {
      const app = appPour('CR_ENCADRANT', chemin, ['ADMIN']);
      const r = await appelle(app, chemin, 'CR_ENCADRANT');
      expect(r.status).toBe(403);
    }
  });

  test('une route hors carte ne s’ouvre par aucun accord', async () => {
    accords = [
      { role: 'CR_ENCADRANT', module_key: 'operations' },
      { role: 'CR_ENCADRANT', module_key: 'accueil' },
    ];
    const app = appPour('CR_ENCADRANT', '/api/inconnu', ['ADMIN']);
    const r = await appelle(app, '/api/inconnu', 'CR_ENCADRANT');
    expect(r.status).toBe(403);
  });

  test('le poste badgeuse reste hors d’atteinte d’un accord « badgeuse »', async () => {
    accords = [{ role: 'CR_ENCADRANT', module_key: 'badgeuse' }];
    const app = appPour('CR_ENCADRANT', '/api/badgeuse/device', ['ADMIN']);
    const r = await appelle(app, '/api/badgeuse/device', 'CR_ENCADRANT');
    expect(r.status).toBe(403);
  });
});

describe('Dégradation asymétrique : un accord ne se présume pas', () => {
  test('matrice illisible → l’accord ne s’applique pas (fail-closed)', async () => {
    accords = [{ role: 'CR_ENCADRANT', module_key: 'operations' }];
    matriceEnPanne = true;
    const app = appPour('CR_ENCADRANT', '/api/cav', ['ADMIN']);
    const r = await appelle(app, '/api/cav', 'CR_ENCADRANT');
    expect(r.status).toBe(403); // retour aux seuls droits du rôle
  });

  test('matrice illisible → le refus continue de laisser passer (fail-open)', async () => {
    // Comportement historique conservé : un incident de base ne ferme pas
    // l'atelier. C'est l'autre moitié de l'asymétrie.
    const { requireModule } = require('../../src/middleware/module-access');
    matriceEnPanne = true;
    const app = express();
    app.use((req, _res, next) => { req.user = { id: 1, role: 'COLLABORATEUR' }; next(); });
    app.use('/api/etiquettes', requireModule('etiquettes'), (req, res) => res.json({ ok: true }));
    const r = await request(app).get('/api/etiquettes');
    expect(r.status).toBe(200);
  });
});

describe('Le refus prime sur l’accord', () => {
  test('un module à la fois refusé et accordé reste fermé', async () => {
    // La matrice n'écrit jamais les deux ; on vérifie que même une base
    // retouchée à la main ne peut pas ouvrir par accord ce qu'elle refuse.
    const { requireModule } = require('../../src/middleware/module-access');
    refus = [{ role: 'CR_ENCADRANT', module_key: 'etiquettes' }];
    accords = [{ role: 'CR_ENCADRANT', module_key: 'etiquettes' }];
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 1, role: 'CR_ENCADRANT' }; next(); });
    app.use('/api/etiquettes', requireModule('etiquettes'), authorize('ADMIN'), (req, res) => res.json({ ok: true }));
    const r = await request(app).get('/api/etiquettes');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('MODULE_NON_HABILITE');
  });
});
