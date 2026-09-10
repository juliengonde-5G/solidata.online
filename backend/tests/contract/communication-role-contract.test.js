// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — RÔLE « CHARGÉ DE COMMUNICATION » (COMMUNICATION)
// ───────────────────────────────────────────────────────────────────────────
// Son périmètre tient en une phrase : tableau de bord, fil d'actualité, et la
// diffusion des contenus sur l'écran du poste de pointage. Rien d'autre.
//
// Ce qui est verrouillé ici, et pourquoi chaque point compte :
//
//  1. IL PUBLIE SUR L'ÉCRAN. Écrire une playlist était réservé à ADMIN/RH ;
//     sans une surface d'autorisation dédiée, lui accorder cette écriture
//     revenait à lui donner tout le module (corrections de pointage, exports
//     de paie, badges…).
//  2. IL NE VOIT AUCUNE DONNÉE DE PERSONNEL. Journal, feuilles de temps,
//     anomalies, badges, relevés individuels, paramètres RH, supervision des
//     postes : refusés — et refusés AVANT toute lecture en base. Un refus posé
//     après la requête serait un refus d'affichage, pas un refus d'accès.
//  3. IL TIENT LE FIL D'ACTUALITÉ (écriture), que MANAGER n'a jamais eue :
//     la non-régression est vérifiée dans les deux sens.
//  4. LES ÉCRANS SUIVENT LE SERVEUR. La page Temps & Présence ne lui montre
//     que « Affichage » et « Écran en direct » : sans ce filtrage, l'onglet
//     par défaut « Journal » s'ouvrirait sur un 403 dès l'arrivée.
//
// Auth réelle (JWT), base mockée : aucun accès disque ni réseau.
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

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const badgeuse = require('../../src/routes/badgeuse');
const newsfeed = require('../../src/routes/newsfeed');
const chat = require('../../src/routes/chat');
const { traiterMessageBot } = require('../../src/routes/chat');
const { BUILTIN_ROLES, isValidRole } = require('../../src/utils/roles');

const tokenFor = (role, id = 1) => jwt.sign(
  { id, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = {
  ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'),
  // Rôle RETIRÉ le 10/09/2026 : il ne doit plus rien ouvrir nulle part.
  RETIRE: tokenFor('MANAGER'),
  COLLABORATEUR: tokenFor('COLLABORATEUR'), COMMUNICATION: tokenFor('COMMUNICATION'),
};

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/badgeuse', badgeuse);
  app.use('/api/news', newsfeed);
  app.use('/api/chat', chat);
});

// Tables dont la lecture prouverait qu'un refus est arrivé TROP TARD.
const TABLES_INTERDITES = /badgeuse_pointages|badgeuse_badges|badgeuse_feuilles_temps|badgeuse_corrections|badgeuse_devices|FROM employees/;

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockImplementation((text) => {
    const s = String(text);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
});

const requetesMetier = () => mockQuery.mock.calls
  .map((c) => String(c[0]))
  .filter((s) => TABLES_INTERDITES.test(s));

const appel = (methode, chemin, role, body) => {
  const r = request(app)[methode](chemin).set('Authorization', `Bearer ${TOKENS[role]}`);
  return body === undefined ? r : r.send(body);
};

// ═══════════════════════════════════════════════════════════════════════════
describe('le rôle existe et est assignable', () => {
  test('COMMUNICATION fait partie des rôles intégrés', () => {
    expect(BUILTIN_ROLES).toContain('COMMUNICATION');
  });

  test('isValidRole l’accepte — sans passer par la table des rôles personnalisés', async () => {
    await expect(isValidRole('COMMUNICATION')).resolves.toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('il peut servir de base à un rôle personnalisé, et jamais ADMIN', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/routes/permissions.js'), 'utf8');
    const ligne = src.match(/const BASE_ROLES = \[[^\]]*\]/);
    expect(ligne).not.toBeNull();
    expect(ligne[0]).toContain("'COMMUNICATION'");
    expect(ligne[0]).not.toContain("'ADMIN'");
    expect(src).toContain("COMMUNICATION: 'Chargé de communication'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('écran du poste : il diffuse', () => {
  const AUTORISE = [
    ['get', '/api/badgeuse/contenus'],
    ['get', '/api/badgeuse/contenus/vak-agenda'],
    ['get', '/api/badgeuse/contenus/upload-limites'],
    ['get', '/api/badgeuse/ecran-direct'],
    ['get', '/api/badgeuse/social/status'],
  ];
  test.each(AUTORISE)('%s %s : autorisé', async (methode, chemin) => {
    const res = await appel(methode, chemin, 'COMMUNICATION');
    expect(res.status).not.toBe(403);
  });

  test('il crée un contenu', async () => {
    const res = await appel('post', '/api/badgeuse/contenus', 'COMMUNICATION',
      { type: 'message', titre: 'Portes ouvertes', corps: 'Samedi 14 h', duree_sec: 12 });
    expect(res.status).not.toBe(403);
  });

  test('il modifie et supprime un contenu', async () => {
    const maj = await appel('put', '/api/badgeuse/contenus/1', 'COMMUNICATION',
      { type: 'message', titre: 'Portes ouvertes', corps: 'Samedi 14 h', duree_sec: 12 });
    expect(maj.status).not.toBe(403);
    const sup = await appel('delete', '/api/badgeuse/contenus/1', 'COMMUNICATION');
    expect(sup.status).not.toBe(403);
  });

  test('il partage un lien', async () => {
    const res = await appel('post', '/api/badgeuse/contenus/lien', 'COMMUNICATION',
      { url: 'https://example.org/affiche.jpg', titre: 'Affiche' });
    expect(res.status).not.toBe(403);
  });

  test('un COLLABORATEUR, lui, ne diffuse rien (non-régression)', async () => {
    for (const chemin of ['/api/badgeuse/contenus', '/api/badgeuse/ecran-direct']) {
      expect((await appel('get', chemin, 'COLLABORATEUR')).status).toBe(403);
    }
    expect((await appel('post', '/api/badgeuse/contenus', 'COLLABORATEUR', {})).status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('reste du module : rien, et refusé avant toute lecture en base', () => {
  const REFUSE = [
    ['get', '/api/badgeuse/pointages'],
    ['get', '/api/badgeuse/badges'],
    ['get', '/api/badgeuse/feuilles-temps'],
    ['get', '/api/badgeuse/feuilles-temps/1'],
    ['get', '/api/badgeuse/anomalies'],
    ['get', '/api/badgeuse/corrections'],
    ['get', '/api/badgeuse/orphelins'],
    ['get', '/api/badgeuse/parametres'],
    ['get', '/api/badgeuse/devices'],
    ['get', '/api/badgeuse/sites'],
    ['get', '/api/badgeuse/exports/paie'],
    ['get', '/api/badgeuse/exports/iae'],
    ['get', '/api/badgeuse/salaries/1/releve'],
  ];
  test.each(REFUSE)('%s %s : 403', async (methode, chemin) => {
    const res = await appel(methode, chemin, 'COMMUNICATION');
    expect(res.status).toBe(403);
    expect(requetesMetier()).toEqual([]);
  });

  test('il ne modifie ni les règles de gestion ni les postes', async () => {
    expect((await appel('put', '/api/badgeuse/parametres', 'COMMUNICATION', { dpms_allumage: '04:00' })).status).toBe(403);
    expect((await appel('post', '/api/badgeuse/devices', 'COMMUNICATION', { code: 'X' })).status).toBe(403);
    expect((await appel('post', '/api/badgeuse/corrections', 'COMMUNICATION', {})).status).toBe(403);
    expect(requetesMetier()).toEqual([]);
  });

  test('ADMIN et RH conservent leur accès (non-régression)', async () => {
    for (const role of ['ADMIN', 'RH']) {
      expect((await appel('get', '/api/badgeuse/pointages', role)).status).not.toBe(403);
      expect((await appel('get', '/api/badgeuse/parametres', role)).status).not.toBe(403);
      expect((await appel('get', '/api/badgeuse/devices', role)).status).not.toBe(403);
      expect((await appel('get', '/api/badgeuse/contenus', role)).status).not.toBe(403);
    }
    expect((await appel('post', '/api/badgeuse/contenus', 'RH',
      { type: 'message', titre: 'T', corps: 'C', duree_sec: 10 })).status).not.toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fil d’actualité : il publie', () => {
  const ARTICLE = { category: 'metier', title: 'Collecte solidaire', summary: 'Samedi' };

  test('il crée, modifie et supprime un article', async () => {
    expect((await appel('post', '/api/news', 'COMMUNICATION', ARTICLE)).status).not.toBe(403);
    expect((await appel('put', '/api/news/1', 'COMMUNICATION', ARTICLE)).status).not.toBe(403);
    expect((await appel('delete', '/api/news/1', 'COMMUNICATION')).status).not.toBe(403);
  });

  test('la lecture reste ouverte à tous, l’écriture reste fermée aux autres', async () => {
    expect((await appel('get', '/api/news', 'COLLABORATEUR')).status).not.toBe(403);
    expect((await appel('post', '/api/news', 'COLLABORATEUR', ARTICLE)).status).toBe(403);
    // Un rôle RETIRÉ n'écrit rien non plus : l'ouverture au chargé de
    // communication ne doit avoir élargi personne au passage.
    expect((await appel('post', '/api/news', 'RETIRE', ARTICLE)).status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L'assistant est une surface d'ACCÈS AUX DONNÉES : il sert à tout rôle de
// bureau les outils de base (stock, planning, collecte, heures, CAV). Ouvert à
// ce profil, il rendrait par la conversation ce que l'application lui refuse
// en face — le défaut fermé en 2.44.0 sur requireMfa, à l'identique.
describe('assistant : fermé, et fermé des DEUX côtés', () => {
  test('le widget répond 403, avec un code exploitable par l’écran', async () => {
    const res = await appel('post', '/api/chat', 'COMMUNICATION', { message: 'Quel est le stock ?' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ASSISTANT_HORS_PERIMETRE');
  });

  test('le refus tombe AVANT toute lecture — et avant même la clé du service IA', async () => {
    await expect(traiterMessageBot({
      userId: 1, role: 'COMMUNICATION', message: 'Quel est le stock ?', sessionId: 's1',
    })).rejects.toMatchObject({ code: 'ASSISTANT_HORS_PERIMETRE' });
    expect(requetesMetier()).toEqual([]);
  });

  test('la conversation « SolidataBot » de la messagerie passe par le MÊME refus', () => {
    // Les deux surfaces appellent `traiterMessageBot` : le refus posé dans la
    // fonction partagée les couvre toutes les deux. Poser la garde sur
    // /api/chat seul aurait laissé la messagerie grande ouverte.
    const src = fs.readFileSync(path.join(__dirname, '../../src/routes/chat.js'), 'utf8');
    const corps = src.slice(src.indexOf('async function traiterMessageBot'));
    expect(corps).toContain('ROLES_SANS_ASSISTANT.has(resolveBaseRole(role))');
    const msg = fs.readFileSync(path.join(__dirname, '../../src/routes/messages.js'), 'utf8');
    expect(msg).toContain("err.code === 'ASSISTANT_HORS_PERIMETRE'");
  });

  test('les autres rôles gardent l’assistant (non-régression)', async () => {
    // Sans clé Anthropic dans les tests, le traitement échoue PLUS LOIN
    // (IA_NON_CONFIGUREE) : c'est précisément la preuve que le contrôle de
    // périmètre les a laissés passer.
    for (const role of ['ADMIN', 'RH', 'COLLABORATEUR']) {
      await expect(traiterMessageBot({
        userId: 1, role, message: 'Bonjour', sessionId: 's1',
      })).rejects.not.toMatchObject({ code: 'ASSISTANT_HORS_PERIMETRE' });
    }
  });

  test('l’écran ne montre pas un onglet qui répondrait 403', () => {
    const layout = fs.readFileSync(path.join(__dirname, '../../../frontend/src/components/Layout.jsx'), 'utf8');
    expect(layout).toContain("const assistantActif = (user?.base_role || user?.role) !== 'COMMUNICATION';");
    expect(layout).toContain('assistantActif={assistantActif}');
    const dock = fs.readFileSync(path.join(__dirname, '../../../frontend/src/components/messagerie/DockUnifie.jsx'), 'utf8');
    expect(dock).toContain('...(assistantActif');
    // Sans assistant, l'onglet par défaut ne peut pas rester « assistant ».
    expect(dock).toContain('return assistantActif ? ONGLET_ASSISTANT : ONGLET_NOTIFICATIONS;');
    // Et le bouton de la barre supérieure ne doit pas PROMETTRE un assistant
    // que le panneau ne contient pas — la règle était déjà écrite pour la
    // messagerie, elle vaut à l'identique ici.
    const topbar = fs.readFileSync(path.join(__dirname, '../../../frontend/src/components/TopBar.jsx'), 'utf8');
    expect(topbar).toContain('avecAssistant = true,');
    expect(topbar).toContain('{intituleCourt}');
    expect(topbar).not.toContain("avecMessagerie ? 'Assistant & messages' : 'Assistant IA'}</span>");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Gardes statiques : les écrans doivent suivre le serveur, sans quoi le rôle
// arriverait sur des onglets qui répondent 403.
describe('les écrans suivent le périmètre du serveur', () => {
  const lire = (rel) => fs.readFileSync(path.join(__dirname, '../../../frontend/src', rel), 'utf8');

  test('la route /badgeuse accepte le rôle', () => {
    expect(lire('App.jsx')).toContain(
      `<Route path="/badgeuse" element={<ProtectedRoute roles={['ADMIN', 'RH', 'COMMUNICATION']}>`
    );
  });

  test('la barre latérale lui montre Temps & Présence', () => {
    expect(lire('components/Layout.jsx')).toContain(
      "path: '/badgeuse', icon: Fingerprint, roles: ['ADMIN', 'RH', 'COMMUNICATION']"
    );
  });

  test('la page ne lui montre que « Affichage » et « Écran en direct »', () => {
    const src = lire('pages/TempsPresence.jsx');
    expect(src).toContain("const isComm = base === 'COMMUNICATION'");
    expect(src).toContain("const ONGLETS_COMMUNICATION = ['affichage', 'direct']");
    // L'onglet rendu est celui du PÉRIMÈTRE, pas l'état brut : sinon
    // « Journal », valeur initiale, s'ouvrirait sur un 403.
    expect(src).toMatch(/const ongletActif = TABS\.some\(\(t\) => t\.id === tab\) \? tab : TABS\[0\]\.id;/);
    expect(src).not.toMatch(/\{tab === '/);
  });

  test('le bouton « Publier » du fil lui est visible', () => {
    const src = lire('pages/NewsFeed.jsx');
    expect(src).toContain("['ADMIN', 'RH', 'COMMUNICATION'].includes(user?.base_role || user?.role)");
  });

  test('il peut écrire la playlist depuis l’écran', () => {
    const src = lire('pages/TempsPresence.jsx');
    expect(src).toContain('const canWriteAffichage = canWriteRh || isComm;');
    expect(src).toContain('<PlaylistAffichage canWrite={canWriteAffichage} />');
    // Les surfaces sensibles gardent leur garde RH/ADMIN.
    expect(src).toContain('<GestionBadges canWrite={canWriteRh} />');
    expect(src).toContain('<ParametresBadgeuse canWrite={canWriteRh} />');
  });
});
