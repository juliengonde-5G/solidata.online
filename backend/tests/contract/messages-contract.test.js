// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — API /api/messages (lot L1, contrat §2.3)
// ───────────────────────────────────────────────────────────────────────────
// Ce que ces tests verrouillent, endpoint par endpoint :
//
//   • LA FORME des réponses, parce que trois lots (web L2, mobile L3) codent
//     contre elle sans jamais lire ce fichier ;
//   • LE PÉRIMÈTRE, qui EST l'autorisation ici : il n'y a aucun `authorize` par
//     rôle sur cette API — un non-participant doit être refusé, et une
//     conversation à laquelle on ne participe pas ne doit même pas apparaître ;
//   • LA SESSION CHAUFFEUR, dont l'identité est le VÉHICULE et non le compte :
//     le compte `chauffeur` étant PARTAGÉ entre tous les camions, une requête
//     filtrée sur `user_id` enverrait les consignes de tous les camions à tous
//     les téléphones. On vérifie donc la COLONNE de filtrage, pas seulement le
//     code HTTP.
// ═══════════════════════════════════════════════════════════════════════════
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
delete process.env.ANTHROPIC_API_KEY;
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

const mockQuery = jest.fn();
const mockClient = { query: (...a) => mockQuery(...a), release: jest.fn() };
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => mockClient),
}));

const express = require('express');
const request = require('supertest');

const VEHICULE = 1;
// `mfa: true` : depuis le montage de `requireMfa` sur /api/messages, un jeton
// d'un rôle SOUMIS (défaut ADMIN/RH/DPO) sans ce claim est refusé en 403 — ce
// qui est exactement le comportement voulu, couvert par bot-mfa-contract.test.js.
// Le périmètre de CE fichier est la messagerie (participation, identité
// chauffeur), pas la double authentification : les jetons la franchissent donc,
// comme le font déjà employees-masking et effectifs-contract.
const jetonWeb = (id, username, role, first, last) => jwt.sign(
  { id, userId: id, username, role, first_name: first, last_name: last, mfa: true }, JWT_SECRET, { expiresIn: '1h' });

const ADMIN = jetonWeb(1, 'admin', 'ADMIN', 'Julien', 'Gondé');
const TRIEUR = jetonWeb(3, 'ctrieur', 'COLLABORATEUR', 'Karim', 'Benali');
// Rôles à PÉRIMÈTRE RESTREINT (correctif 27/08) : AUTORITE est l'accès EXTERNE
// en lecture seule créé en vague 2 (auditeur Refashion / Métropole) ; FINANCE
// et DPO peuvent être tenus par un prestataire (cabinet comptable, DPO
// externalisé). Aucun des trois n'a à disposer de l'annuaire interne complet.
const AUDITEUR = jetonWeb(8, 'auditeur', 'AUTORITE', 'Claire', 'Renaud');
const COMPTA = jetonWeb(9, 'compta', 'FINANCE', 'Paul', 'Marchand');
// Jeton chauffeur : compte 5 PARTAGÉ, identité réelle = véhicule 1.
const CHAUFFEUR = jwt.sign(
  { id: 5, userId: 5, username: `driver_${VEHICULE}`, role: 'COLLABORATEUR', vehicle_id: VEHICULE },
  JWT_SECRET, { expiresIn: '1h' });
// Jeton HÉRITÉ (émis avant l'ajout du claim `vehicle_id`, valide jusqu'à 8 h).
const CHAUFFEUR_HERITE = jwt.sign(
  { id: 5, userId: 5, username: `driver_${VEHICULE}`, role: 'COLLABORATEUR' },
  JWT_SECRET, { expiresIn: '1h' });

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/messages', require('../../src/routes/messages'));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockClient.release.mockReset();
  // La liste des rôles à périmètre restreint est mise en cache 60 s : sans
  // purge, le premier test imposerait la sienne à tous les suivants.
  require('../../src/routes/messages').resetRolesRestreintsCache();
  // Idem pour le plafond d'envoi par identité : sans purge, les envois d'un
  // test compteraient dans le quota du suivant.
  require('../../src/routes/messages').resetPlafondEnvoi();
});

const get = (t, url) => request(app).get(url).set('Authorization', `Bearer ${t}`);
const post = (t, url, body) => request(app).post(url).set('Authorization', `Bearer ${t}`).send(body || {});

/**
 * @param participant ligne messagerie_participants renvoyée par la garde de
 *   périmètre — `null` = l'appelant N'EST PAS participant.
 */
function mockDb({ participant = null, conversations = [], participants = [], messages = [], nonLus = [] } = {}) {
  mockQuery.mockReset();
  mockClient.release.mockReset();
  mockQuery.mockImplementation((sql, params) => {
    const t = String(sql);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(t)) return Promise.resolve({ rows: [] });
    // Liste des conversations (à discriminer AVANT la garde de périmètre : les
    // deux requêtes partent de messagerie_participants ⋈ messagerie_conversations).
    if (/LEFT JOIN LATERAL/.test(t)) return Promise.resolve({ rows: conversations });
    // Garde de périmètre
    if (/FROM messagerie_participants p\s*\n?\s*JOIN messagerie_conversations c/.test(t)) {
      return Promise.resolve({ rows: participant ? [participant] : [] });
    }
    if (/FROM messagerie_participants p\s*\n?\s*LEFT JOIN users u/.test(t)) {
      return Promise.resolve({ rows: participants });
    }
    if (/FROM messagerie_messages m\s*\n?\s*LEFT JOIN users u/.test(t)) {
      return Promise.resolve({ rows: messages });
    }
    if (/GROUP BY p\.conversation_id/.test(t)) return Promise.resolve({ rows: nonLus });
    if (/UPDATE messagerie_participants/.test(t)) {
      return Promise.resolve({ rows: [{ dernier_lu_message_id: 42 }] });
    }
    if (/INSERT INTO messagerie_messages/.test(t)) {
      return Promise.resolve({
        rows: [{
          id: 77, conversation_id: params[0], auteur_type: params[1],
          auteur_user_id: params[2], auteur_vehicle_id: params[3], texte: params[4],
          type: params[5], source: params[6], lien: params[7], created_at: '2026-08-26T10:00:00Z',
        }],
      });
    }
    if (/INSERT INTO messagerie_conversations/.test(t)) return Promise.resolve({ rows: [{ id: 12 }] });
    if (/UPDATE messagerie_conversations/.test(t)) return Promise.resolve({ rows: [] });
    if (/INSERT INTO messagerie_participants/.test(t)) return Promise.resolve({ rows: [] });
    if (/FROM vehicles/.test(t)) {
      return Promise.resolve({ rows: [{ id: 1, registration: 'AB-123-CD', name: 'Camion 1' }] });
    }
    if (/FROM users u/.test(t) || /FROM users/.test(t)) {
      return Promise.resolve({ rows: [{ id: 2, username: 'mchef', first_name: 'Marie', last_name: 'Lévêque', base_role: 'MANAGER', is_active: true }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

/** Retrouve le premier appel SQL correspondant au motif. */
const appelSql = (motif) => mockQuery.mock.calls.find((c) => motif.test(String(c[0])));

// ── Authentification ───────────────────────────────────────────────────────
describe('authentification', () => {
  it('sans jeton : 401 sur toutes les surfaces', async () => {
    for (const url of ['/api/messages/conversations', '/api/messages/non-lus', '/api/messages/contacts']) {
      const r = await request(app).get(url);
      expect(r.status).toBe(401);
    }
  });

  it('jeton invalide : 401', async () => {
    const r = await request(app).get('/api/messages/conversations').set('Authorization', 'Bearer nimportequoi');
    expect(r.status).toBe(401);
  });
});

// ── GET /conversations ─────────────────────────────────────────────────────
describe('GET /conversations — forme et titre affiché', () => {
  it('renvoie la forme du contrat', async () => {
    mockDb({
      conversations: [{
        id: 12, type: 'directe', titre: null, dernier_message_at: '2026-08-26T10:00:00Z',
        non_lus: 2, dm_id: 77, dm_texte: 'Bonjour', dm_auteur_type: 'utilisateur',
        dm_created_at: '2026-08-26T10:00:00Z',
      }],
      participants: [
        { conversation_id: 12, user_id: 1, first_name: 'Julien', last_name: 'Gondé', username: 'admin' },
        { conversation_id: 12, user_id: 2, first_name: 'Marie', last_name: 'Lévêque', username: 'mchef' },
      ],
    });
    const r = await get(ADMIN, '/api/messages/conversations');
    expect(r.status).toBe(200);
    expect(r.body.conversations).toHaveLength(1);
    const c = r.body.conversations[0];
    expect(Object.keys(c).sort()).toEqual(
      ['dernier_message', 'id', 'non_lus', 'participants', 'titre_affiche', 'type']);
    expect(c.non_lus).toBe(2);
    expect(c.dernier_message).toEqual({
      id: 77, texte: 'Bonjour', auteur_type: 'utilisateur', created_at: '2026-08-26T10:00:00Z',
    });
    expect(c.participants).toEqual([
      { type: 'utilisateur', user_id: 1, nom: 'Julien GONDÉ' },
      { type: 'utilisateur', user_id: 2, nom: 'Marie LÉVÊQUE' },
    ]);
  });

  it("titre affiché = le nom de L'AUTRE (il dépend de qui regarde)", async () => {
    const donnees = {
      conversations: [{ id: 12, type: 'directe', titre: null, dernier_message_at: null, non_lus: 0 }],
      participants: [
        { conversation_id: 12, user_id: 1, first_name: 'Julien', last_name: 'Gondé', username: 'admin' },
        { conversation_id: 12, user_id: 3, first_name: 'Karim', last_name: 'Benali', username: 'ctrieur' },
      ],
    };
    mockDb(donnees);
    expect((await get(ADMIN, '/api/messages/conversations')).body.conversations[0].titre_affiche)
      .toBe('Karim BENALI');
    mockDb(donnees);
    expect((await get(TRIEUR, '/api/messages/conversations')).body.conversations[0].titre_affiche)
      .toBe('Julien GONDÉ');
  });

  it('titres réservés : SOLIDATA (notifications) et SolidataBot', async () => {
    mockDb({
      conversations: [
        { id: 1, type: 'systeme', titre: 'SOLIDATA', dernier_message_at: null, non_lus: 1 },
        { id: 2, type: 'bot', titre: 'SolidataBot', dernier_message_at: null, non_lus: 0 },
      ],
      participants: [{ conversation_id: 1, user_id: 1, username: 'admin' }],
    });
    const r = await get(ADMIN, '/api/messages/conversations');
    expect(r.body.conversations.map((c) => c.titre_affiche)).toEqual(['SOLIDATA', 'SolidataBot']);
  });

  it('tri : dernier message en tête, conversations sans message en dernier', async () => {
    mockDb({ conversations: [] });
    await get(ADMIN, '/api/messages/conversations');
    expect(String(appelSql(/LEFT JOIN LATERAL/)[0]))
      .toMatch(/ORDER BY c\.dernier_message_at DESC NULLS LAST/);
  });
});

// ── PÉRIMÈTRE : la colonne de filtrage ─────────────────────────────────────
describe('périmètre — utilisateur vs VÉHICULE', () => {
  it('utilisateur web : filtrage sur user_id', async () => {
    mockDb({ conversations: [] });
    await get(ADMIN, '/api/messages/conversations');
    const appel = appelSql(/LEFT JOIN LATERAL/);
    expect(String(appel[0])).toMatch(/WHERE p\.user_id = \$1/);
    expect(appel[1]).toEqual([1]);
  });

  it('CHAUFFEUR : filtrage sur vehicle_id — JAMAIS sur le compte partagé', async () => {
    mockDb({ conversations: [] });
    await get(CHAUFFEUR, '/api/messages/conversations');
    const appel = appelSql(/LEFT JOIN LATERAL/);
    expect(String(appel[0])).toMatch(/WHERE p\.vehicle_id = \$1/);
    expect(String(appel[0])).not.toMatch(/WHERE p\.user_id = \$1/);
    expect(appel[1]).toEqual([VEHICULE]);   // le véhicule, pas l'utilisateur 5
  });

  it('JETON HÉRITÉ (sans claim vehicle_id) : même périmètre véhicule', async () => {
    mockDb({ conversations: [] });
    await get(CHAUFFEUR_HERITE, '/api/messages/conversations');
    const appel = appelSql(/LEFT JOIN LATERAL/);
    expect(String(appel[0])).toMatch(/WHERE p\.vehicle_id = \$1/);
    expect(appel[1]).toEqual([VEHICULE]);
  });

  it('même filtrage sur le compteur de non-lus', async () => {
    mockDb({ nonLus: [] });
    await get(CHAUFFEUR, '/api/messages/non-lus');
    const appel = appelSql(/GROUP BY p\.conversation_id/);
    expect(String(appel[0])).toMatch(/WHERE p\.vehicle_id = \$1/);
    expect(appel[1]).toEqual([VEHICULE]);
  });
});

// ── Lecture d'un fil ───────────────────────────────────────────────────────
describe('GET /conversations/:id/messages', () => {
  it('NON-PARTICIPANT : 403, et le fil n’est jamais lu en base', async () => {
    mockDb({ participant: null });
    const r = await get(TRIEUR, '/api/messages/conversations/12/messages');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CONVERSATION_INTERDITE');
    expect(appelSql(/FROM messagerie_messages m/)).toBeUndefined();
  });

  it('participant : messages du plus ancien au plus récent + a_plus', async () => {
    mockDb({
      participant: { id: 9, conversation_id: 12, user_id: 1, vehicle_id: null, type: 'directe' },
      // Lignes complètes, comme les renvoie PostgreSQL : les colonnes non
      // renseignées valent NULL, elles ne DISPARAISSENT pas de la projection.
      messages: [
        { id: 3, conversation_id: 12, auteur_type: 'utilisateur', auteur_user_id: 1, auteur_vehicle_id: null, texte: 'trois', type: 'texte', source: null, lien: null, created_at: 'c', auteur_first_name: 'Julien', auteur_last_name: 'Gondé' },
        { id: 2, conversation_id: 12, auteur_type: 'utilisateur', auteur_user_id: 1, auteur_vehicle_id: null, texte: 'deux', type: 'texte', source: null, lien: null, created_at: 'b' },
        { id: 1, conversation_id: 12, auteur_type: 'utilisateur', auteur_user_id: 1, auteur_vehicle_id: null, texte: 'un', type: 'texte', source: null, lien: null, created_at: 'a' },
      ],
    });
    const r = await get(ADMIN, '/api/messages/conversations/12/messages?limit=2');
    expect(r.status).toBe(200);
    expect(r.body.messages.map((m) => m.texte)).toEqual(['deux', 'trois']);
    expect(r.body.a_plus).toBe(true);
    expect(Object.keys(r.body.messages[0]).sort()).toEqual([
      'auteur_nom', 'auteur_type', 'auteur_user_id', 'auteur_vehicle_id', 'conversation_id',
      'created_at', 'id', 'lien', 'source', 'texte', 'type',
    ]);
  });

  it('limite : défaut 50, plafond 200, pagination par avant_id', async () => {
    mockDb({ participant: { id: 9, conversation_id: 12, user_id: 1, type: 'directe' } });
    await get(ADMIN, '/api/messages/conversations/12/messages');
    expect(appelSql(/FROM messagerie_messages m/)[1]).toEqual([12, null, 51]);

    mockDb({ participant: { id: 9, conversation_id: 12, user_id: 1, type: 'directe' } });
    await get(ADMIN, '/api/messages/conversations/12/messages?limit=9999&avant_id=40');
    expect(appelSql(/FROM messagerie_messages m/)[1]).toEqual([12, 40, 201]);
  });

  it('avant_id illisible : 400 explicite', async () => {
    mockDb({ participant: { id: 9, conversation_id: 12, user_id: 1, type: 'directe' } });
    const r = await get(ADMIN, '/api/messages/conversations/12/messages?avant_id=abc');
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PAGINATION_INVALIDE');
  });
});

// ── Envoi ──────────────────────────────────────────────────────────────────
describe('POST /conversations/:id/messages', () => {
  const participantDirecte = { id: 9, conversation_id: 12, user_id: 1, vehicle_id: null, type: 'directe' };

  it('NON-PARTICIPANT : 403, et RIEN n’est écrit', async () => {
    mockDb({ participant: null });
    const r = await post(TRIEUR, '/api/messages/conversations/12/messages', { texte: 'coucou' });
    expect(r.status).toBe(403);
    expect(appelSql(/INSERT INTO messagerie_messages/)).toBeUndefined();
  });

  it('texte vide ou blanc : 400', async () => {
    mockDb({ participant: participantDirecte });
    expect((await post(ADMIN, '/api/messages/conversations/12/messages', { texte: '   ' })).status).toBe(400);
    mockDb({ participant: participantDirecte });
    expect((await post(ADMIN, '/api/messages/conversations/12/messages', {})).status).toBe(400);
  });

  it('au-delà de 4000 caractères : 400 avec la limite dans le message', async () => {
    mockDb({ participant: participantDirecte });
    const r = await post(ADMIN, '/api/messages/conversations/12/messages', { texte: 'x'.repeat(4001) });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('TEXTE_TROP_LONG');
    expect(r.body.error).toMatch(/4000/);
  });

  it('201 avec le message projeté, auteur « utilisateur »', async () => {
    mockDb({ participant: participantDirecte });
    const r = await post(ADMIN, '/api/messages/conversations/12/messages', { texte: 'Bonjour Marie' });
    expect(r.status).toBe(201);
    expect(r.body.message).toMatchObject({
      id: 77, conversation_id: 12, auteur_type: 'utilisateur', auteur_user_id: 1,
      auteur_vehicle_id: null, texte: 'Bonjour Marie', auteur_nom: 'Julien GONDÉ',
    });
  });

  it('CHAUFFEUR : auteur « chauffeur » porté par le VÉHICULE, pas par le compte', async () => {
    mockDb({ participant: { id: 9, conversation_id: 12, user_id: null, vehicle_id: VEHICULE, type: 'directe' } });
    const r = await post(CHAUFFEUR, '/api/messages/conversations/12/messages', { texte: "J'ai compris" });
    expect(r.status).toBe(201);
    expect(r.body.message.auteur_type).toBe('chauffeur');
    expect(r.body.message.auteur_vehicle_id).toBe(VEHICULE);
    expect(r.body.message.auteur_user_id).toBeNull();   // JAMAIS le compte partagé
  });

  it('la conversation SOLIDATA refuse les réponses (409), au lieu de les avaler', async () => {
    mockDb({ participant: { id: 9, conversation_id: 1, user_id: 1, vehicle_id: null, type: 'systeme' } });
    const r = await post(ADMIN, '/api/messages/conversations/1/messages', { texte: 'ok merci' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CONVERSATION_SYSTEME_LECTURE_SEULE');
    expect(appelSql(/INSERT INTO messagerie_messages/)).toBeUndefined();
  });

  it("bot sans clé IA : le message de l'utilisateur est CONSERVÉ, l'indisponibilité est DITE", async () => {
    mockDb({ participant: { id: 9, conversation_id: 20, user_id: 1, vehicle_id: null, type: 'bot' } });
    const r = await post(ADMIN, '/api/messages/conversations/20/messages', { texte: 'Quel est le stock ?' });
    expect(r.status).toBe(201);
    expect(r.body.message.texte).toBe('Quel est le stock ?');
    expect(r.body.bot_erreur).toBe('IA_NON_CONFIGUREE');
    expect(r.body.reponse_bot.auteur_type).toBe('bot');
    expect(r.body.reponse_bot.texte).toMatch(/pas disponible/);
  });
});

// ── Accusé de lecture ──────────────────────────────────────────────────────
describe('POST /conversations/:id/lu', () => {
  it('NON-PARTICIPANT : 403', async () => {
    mockDb({ participant: null });
    expect((await post(TRIEUR, '/api/messages/conversations/12/lu', { dernier_lu_message_id: 5 })).status).toBe(403);
  });

  it('identifiant illisible : 400', async () => {
    mockDb({ participant: { id: 9, conversation_id: 12, user_id: 1, type: 'directe' } });
    const r = await post(ADMIN, '/api/messages/conversations/12/lu', { dernier_lu_message_id: 'abc' });
    expect(r.status).toBe(400);
  });

  it('borné au dernier message RÉEL et jamais en arrière (GREATEST/LEAST)', async () => {
    mockDb({ participant: { id: 9, conversation_id: 12, user_id: 1, type: 'directe' } });
    const r = await post(ADMIN, '/api/messages/conversations/12/lu', { dernier_lu_message_id: 999999 });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, dernier_lu_message_id: 42 });
    const sql = String(appelSql(/UPDATE messagerie_participants/)[0]);
    expect(sql).toMatch(/GREATEST/);
    expect(sql).toMatch(/LEAST\(\$2, COALESCE\(\(SELECT MAX\(m\.id\)/);
  });
});

// ── Contacts ───────────────────────────────────────────────────────────────
describe('GET /contacts — champs minimaux et périmètre', () => {
  it('utilisateurs + véhicules, aucun champ personnel superflu', async () => {
    mockQuery.mockImplementation((sql) => {
      const t = String(sql);
      if (/FROM users u/.test(t)) {
        return Promise.resolve({ rows: [{ id: 2, username: 'mchef', first_name: 'Marie', last_name: 'Lévêque', base_role: 'MANAGER' }] });
      }
      if (/FROM vehicles/.test(t)) {
        return Promise.resolve({ rows: [{ id: 1, registration: 'AB-123-CD', name: 'Camion 1' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await get(ADMIN, '/api/messages/contacts?q=mar');
    expect(r.status).toBe(200);
    expect(r.body.contacts).toEqual([
      { type: 'utilisateur', user_id: 2, nom: 'Marie LÉVÊQUE', role: 'MANAGER' },
      { type: 'vehicule', vehicle_id: 1, nom: 'AB-123-CD — Camion 1' },
    ]);
  });

  it('la recherche est repliée (casse et accents) AVANT le plafond', async () => {
    mockDb({});
    await get(ADMIN, '/api/messages/contacts?q=LÉVÊQUE');
    const appel = appelSql(/FROM users u/);
    expect(appel[1][1]).toBe('leveque');
    expect(String(appel[0])).toMatch(/translate\(lower\(/);
    expect(String(appel[0])).toMatch(/LIMIT \$4/);
  });

  it('comptes inactifs et compte partagé « chauffeur » exclus par la requête', async () => {
    mockDb({});
    await get(ADMIN, '/api/messages/contacts');
    const sql = String(appelSql(/FROM users u/)[0]);
    expect(sql).toMatch(/u\.is_active = true/);
    expect(sql).toMatch(/u\.username <> 'chauffeur'/);
  });

  it('véhicules : ni démo, ni hors service', async () => {
    mockDb({});
    await get(ADMIN, '/api/messages/contacts');
    const sql = String(appelSql(/FROM vehicles/)[0]);
    expect(sql).toMatch(/COALESCE\(is_demo, false\) = false/);
    expect(sql).toMatch(/status <> 'out_of_service'/);
  });

  it('CHAUFFEUR : ADMIN/MANAGER seulement, et AUCUN véhicule listé', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM users u/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 2, username: 'mchef', first_name: 'Marie', last_name: 'Lévêque', base_role: 'MANAGER' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await get(CHAUFFEUR, '/api/messages/contacts');
    expect(r.body.contacts.every((c) => c.type === 'utilisateur')).toBe(true);
    expect(appelSql(/FROM vehicles/)).toBeUndefined();
    const appel = appelSql(/FROM users u/);
    expect(appel[1][2]).toBe(true);                       // drapeau « session chauffeur »
    expect(String(appel[0])).toMatch(/IN \('ADMIN', 'MANAGER'\)/);
    // Le rôle est résolu par son rôle DE BASE : un rôle personnalisé dérivé de
    // MANAGER reste joignable depuis un camion.
    expect(String(appel[0])).toMatch(/COALESCE\(cr\.base_role, u\.role\)/);
  });

  it('le plafond ne fait jamais disparaître une famille entière', () => {
    const routeur = require('../../src/routes/messages');
    const users = Array.from({ length: 30 }, (_, i) => ({ type: 'utilisateur', user_id: i }));
    const vehicules = Array.from({ length: 5 }, (_, i) => ({ type: 'vehicule', vehicle_id: i }));
    const fusion = routeur.fusionnerContacts(users, vehicules, 20);
    expect(fusion).toHaveLength(20);
    expect(fusion.filter((c) => c.type === 'vehicule')).toHaveLength(5);
    expect(fusion.filter((c) => c.type === 'utilisateur')).toHaveLength(15);
  });
});

// ── Non-lus ────────────────────────────────────────────────────────────────
describe('GET /non-lus', () => {
  it('total et détail par conversation (clés en chaîne, pour un objet JSON)', async () => {
    mockDb({ nonLus: [{ conversation_id: 12, n: 3 }, { conversation_id: 20, n: 1 }] });
    const r = await get(ADMIN, '/api/messages/non-lus');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ total: 4, par_conversation: { 12: 3, 20: 1 } });
  });

  it('aucun non-lu : total 0 et objet vide, jamais null', async () => {
    mockDb({ nonLus: [] });
    expect((await get(ADMIN, '/api/messages/non-lus')).body).toEqual({ total: 0, par_conversation: {} });
  });
});

// ── Ouverture de conversation ──────────────────────────────────────────────
describe('POST /conversations', () => {
  it('destinataire manquant : 400', async () => {
    mockDb({});
    expect((await post(ADMIN, '/api/messages/conversations', {})).status).toBe(400);
  });

  it('avec soi-même : 400', async () => {
    mockDb({});
    const r = await post(ADMIN, '/api/messages/conversations', { destinataire: { type: 'utilisateur', user_id: 1 } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('DESTINATAIRE_SOI_MEME');
  });

  it('utilisateur inconnu ou inactif : 404', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
    const r = await post(ADMIN, '/api/messages/conversations', { destinataire: { type: 'utilisateur', user_id: 99 } });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('DESTINATAIRE_INCONNU');
  });

  it('clé unique calculée SERVEUR (le client ne la fournit jamais)', async () => {
    mockDb({});
    await post(ADMIN, '/api/messages/conversations', { destinataire: { type: 'utilisateur', user_id: 2 } });
    const appel = appelSql(/INSERT INTO messagerie_conversations/);
    expect(appel[1]).toEqual(['directe', null, 'directe:u1:u2', 1]);
    expect(String(appel[0])).toMatch(/ON CONFLICT \(cle_unique\) DO NOTHING/);
  });

  it('CHAUFFEUR → bot : 403 (le mobile est un outil de conduite)', async () => {
    mockDb({});
    const r = await post(CHAUFFEUR, '/api/messages/conversations', { destinataire: { type: 'bot' } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('BOT_INDISPONIBLE_CHAUFFEUR');
  });

  it('CHAUFFEUR → autre véhicule : 403', async () => {
    mockDb({});
    const r = await post(CHAUFFEUR, '/api/messages/conversations', { destinataire: { type: 'vehicule', vehicle_id: 2 } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('DESTINATAIRE_NON_AUTORISE');
  });

  // ANTI-ÉNUMÉRATION (correctif 27/08) : depuis un jeton VÉHICULE, un compte
  // existant mais hors exploitation renvoyait 403 quand un identifiant
  // inexistant renvoyait 404 — deux réponses discriminantes qui permettaient de
  // balayer les identifiants et de cartographier les comptes, leur activité et
  // leur niveau de responsabilité. Le jeton chauffeur est la crédential la plus
  // exposée du parc (raccourci permanent sur un téléphone d'équipage) : il
  // reçoit désormais la MÊME réponse dans les deux cas.
  it('CHAUFFEUR → utilisateur hors exploitation : 404 indiscernable d’un identifiant inconnu', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM users u/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 3, username: 'ctrieur', is_active: true, base_role: 'COLLABORATEUR' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const existant = await post(CHAUFFEUR, '/api/messages/conversations', { destinataire: { type: 'utilisateur', user_id: 3 } });
    expect(existant.status).toBe(404);
    expect(existant.body.code).toBe('DESTINATAIRE_INCONNU');

    // Contre-épreuve : l'identifiant qui n'existe PAS doit rendre exactement la
    // même chose. C'est l'égalité des deux réponses qui ferme l'énumération —
    // pas le code 404 pris isolément.
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
    const inexistant = await post(CHAUFFEUR, '/api/messages/conversations', { destinataire: { type: 'utilisateur', user_id: 4242 } });
    expect(inexistant.status).toBe(existant.status);
    expect(inexistant.body).toEqual(existant.body);
  });

  it('CHAUFFEUR → MANAGER : autorisé, et c’est le VÉHICULE qui devient participant', async () => {
    mockQuery.mockImplementation((sql) => {
      const t = String(sql);
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(t)) return Promise.resolve({ rows: [] });
      if (/FROM users u/.test(t)) {
        return Promise.resolve({ rows: [{ id: 2, username: 'mchef', is_active: true, base_role: 'MANAGER' }] });
      }
      if (/INSERT INTO messagerie_conversations/.test(t)) return Promise.resolve({ rows: [{ id: 30 }] });
      return Promise.resolve({ rows: [] });
    });
    const r = await post(CHAUFFEUR, '/api/messages/conversations', { destinataire: { type: 'utilisateur', user_id: 2 } });
    expect(r.status).toBe(200);
    expect(appelSql(/INSERT INTO messagerie_conversations/)[1][2]).toBe('directe:u2:v1');
    const participants = mockQuery.mock.calls
      .filter((c) => /INSERT INTO messagerie_participants/.test(String(c[0]))).map((c) => c[1]);
    expect(participants).toEqual([[30, null, VEHICULE], [30, 2, null]]);
  });

  it("compte partagé « chauffeur » comme destinataire : refus renvoyant vers le véhicule", async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM users u/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 5, username: 'chauffeur', is_active: true, base_role: 'COLLABORATEUR' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await post(ADMIN, '/api/messages/conversations', { destinataire: { type: 'utilisateur', user_id: 5 } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('DESTINATAIRE_COMPTE_PARTAGE');
  });
});

// ── Extraction traiterMessageBot : l'endpoint /api/chat est INCHANGÉ ───────
//
// Le lot L1 ne touche à `routes/chat.js` que pour EXTRAIRE la logique du
// `POST /` dans `traiterMessageBot`, afin que la messagerie l'appelle sans la
// dupliquer. Le risque de cette manœuvre est unique et connu : que l'ordre des
// contrôles change et que l'endpoint historique se mette à répondre autre chose.
// On vérifie donc les trois refus ET LEUR ORDRE (débit AVANT clé), sur le vrai
// routeur monté comme en production.
describe('routes/chat — extraction sans changement de comportement', () => {
  let appChat;
  beforeAll(() => {
    appChat = express();
    appChat.use(express.json());
    appChat.use('/api/chat', require('../../src/routes/chat'));
  });

  it('la fonction partagée est exportée pour la messagerie', () => {
    expect(typeof require('../../src/routes/chat').traiterMessageBot).toBe('function');
  });

  it('message vide : 400 « Message requis » (inchangé)', async () => {
    mockDb({});
    const r = await request(appChat).post('/api/chat')
      .set('Authorization', `Bearer ${ADMIN}`).send({ message: '   ' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Message requis');
  });

  it('sans clé IA : 503 avec le message d’origine (inchangé)', async () => {
    mockDb({});
    const r = await request(appChat).post('/api/chat')
      .set('Authorization', `Bearer ${ADMIN}`).send({ message: 'Quel est le stock ?' });
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/Service IA non configuré/);
  });

  it('ORDRE PRÉSERVÉ : la limitation de débit passe AVANT le contrôle de clé', async () => {
    mockDb({});
    // L'utilisateur 3 n'a encore rien envoyé : 20 messages passent le débit et
    // s'arrêtent sur l'absence de clé (503), le 21e est refusé pour débit (429).
    const envoyer = () => request(appChat).post('/api/chat')
      .set('Authorization', `Bearer ${TRIEUR}`).send({ message: 'bonjour' });
    const codes = [];
    for (let i = 0; i < 21; i += 1) codes.push((await envoyer()).status);   // eslint-disable-line no-await-in-loop
    expect(codes.slice(0, 20).every((c) => c === 503)).toBe(true);
    expect(codes[20]).toBe(429);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PÉRIMÈTRE DES RÔLES EXTERNES (correctif du 27/08)
// ───────────────────────────────────────────────────────────────────────────
// DÉFAUT CORRIGÉ : le filtre de contacts ne visait que les équipages. Un compte
// AUTORITE — créé PRÉCISÉMENT comme un accès externe en lecture seule (auditeur
// Refashion / Métropole) — obtenait l'annuaire interne complet des salariés
// actifs et tout le parc de véhicules, et pouvait ouvrir une conversation
// privée avec n'importe qui. La garde manquait côté serveur, pas seulement au
// menu.
// ═══════════════════════════════════════════════════════════════════════════
describe('rôles à périmètre restreint (AUTORITE, FINANCE, DPO)', () => {
  const usersEtVehicules = () => {
    mockQuery.mockImplementation((sql) => {
      const t = String(sql);
      if (/FROM users u/.test(t)) {
        return Promise.resolve({ rows: [{ id: 2, username: 'mchef', first_name: 'Marie', last_name: 'Lévêque', base_role: 'MANAGER' }] });
      }
      if (/FROM vehicles/.test(t)) {
        return Promise.resolve({ rows: [{ id: 1, registration: 'AB-123-CD', name: 'Camion 1' }] });
      }
      return Promise.resolve({ rows: [] });
    });
  };

  it('AUTORITE : annuaire borné aux ADMIN/MANAGER, aucun véhicule listé', async () => {
    usersEtVehicules();
    const r = await get(AUDITEUR, '/api/messages/contacts');
    expect(r.status).toBe(200);
    expect(r.body.contacts.every((c) => c.type === 'utilisateur')).toBe(true);
    // Le parc n'est même pas interrogé : rien à filtrer côté client.
    expect(appelSql(/FROM vehicles/)).toBeUndefined();
    const appel = appelSql(/FROM users u/);
    expect(appel[1][2]).toBe(true);                       // drapeau « périmètre restreint »
    expect(String(appel[0])).toMatch(/IN \('ADMIN', 'MANAGER'\)/);
  });

  it('FINANCE : même borne que l’auditeur', async () => {
    usersEtVehicules();
    const r = await get(COMPTA, '/api/messages/contacts');
    expect(r.status).toBe(200);
    expect(appelSql(/FROM users u/)[1][2]).toBe(true);
    expect(appelSql(/FROM vehicles/)).toBeUndefined();
  });

  it('un rôle INTERNE garde l’annuaire complet (aucune régression)', async () => {
    usersEtVehicules();
    const r = await get(TRIEUR, '/api/messages/contacts');
    expect(r.status).toBe(200);
    expect(appelSql(/FROM users u/)[1][2]).toBe(false);
    expect(r.body.contacts.some((c) => c.type === 'vehicule')).toBe(true);
  });

  it('AUTORITE → salarié hors exploitation : 403 motivé (la garde n’est pas qu’au menu)', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM users u/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 3, username: 'ctrieur', is_active: true, base_role: 'COLLABORATEUR' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await post(AUDITEUR, '/api/messages/conversations', { destinataire: { type: 'utilisateur', user_id: 3 } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('DESTINATAIRE_NON_AUTORISE');
    // Un compte web est identifié : il doit COMPRENDRE le refus, sinon il le
    // prendra pour un défaut de l'application (contrairement au jeton chauffeur,
    // à qui l'on rend un 404 indiscernable — voir plus haut).
    expect(r.body.error).toMatch(/responsables d'exploitation/i);
  });

  it('AUTORITE → MANAGER : autorisé (le canal reste utile)', async () => {
    mockQuery.mockImplementation((sql, params) => {
      const t = String(sql);
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(t)) return Promise.resolve({ rows: [] });
      if (/FROM users u/.test(t) && /LEFT JOIN custom_roles/.test(t)) {
        return Promise.resolve({ rows: [{ id: 2, username: 'mchef', is_active: true, base_role: 'MANAGER' }] });
      }
      if (/INSERT INTO messagerie_conversations/.test(t) || /FROM messagerie_conversations/.test(t)) {
        return Promise.resolve({ rows: [{ id: 30, type: 'directe', titre: null, cle_unique: 'directe:u2:u8', created_at: null, dernier_message_at: null }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await post(AUDITEUR, '/api/messages/conversations', { destinataire: { type: 'utilisateur', user_id: 2 } });
    expect(r.status).toBe(200);
  });

  it('AUTORITE → véhicule : 403 (pas de consigne à un équipage en tournée)', async () => {
    mockDb({});
    const r = await post(AUDITEUR, '/api/messages/conversations', { destinataire: { type: 'vehicule', vehicle_id: 1 } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('DESTINATAIRE_NON_AUTORISE');
  });

  it('la liste est PARAMÉTRABLE : un réglage qui vide AUTORITE lui rend l’annuaire', async () => {
    mockQuery.mockImplementation((sql) => {
      const t = String(sql);
      if (/FROM settings WHERE key = 'messagerie\.roles_perimetre_restreint'/.test(t)) {
        return Promise.resolve({ rows: [{ value: '["DPO"]' }] });
      }
      if (/FROM users u/.test(t)) return Promise.resolve({ rows: [] });
      if (/FROM vehicles/.test(t)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const r = await get(AUDITEUR, '/api/messages/contacts');
    expect(r.status).toBe(200);
    expect(appelSql(/FROM users u/)[1][2]).toBe(false);
  });

  it('réglage illisible : la garde reste ARMÉE sur le défaut, jamais désactivée en silence', async () => {
    mockQuery.mockImplementation((sql) => {
      const t = String(sql);
      if (/FROM settings WHERE key = 'messagerie\.roles_perimetre_restreint'/.test(t)) {
        return Promise.resolve({ rows: [{ value: 'ceci n est pas du JSON' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await get(AUDITEUR, '/api/messages/contacts');
    expect(r.status).toBe(200);
    expect(appelSql(/FROM users u/)[1][2]).toBe(true);
  });
});
