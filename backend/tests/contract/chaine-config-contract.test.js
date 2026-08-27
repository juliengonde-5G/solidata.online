// ═══════════════════════════════════════════════════════════════════════════
// TEST DE CONTRAT — API DU CONFIGURATEUR 2D DE LA CHAÎNE DE TRI (lot L4)
// ───────────────────────────────────────────────────────────────────────────
// Verrouille la forme que consomme l'écran `/tri/configurateur` : habilitations,
// codes d'erreur stables, remplacement COMPLET des blocs, activation unique et
// — le point de doctrine du lot — un dépassement d'effectif SIGNALÉ mais
// jamais bloqué : un plan à 17 personnes doit pouvoir s'enregistrer pendant
// qu'on l'arbitre, sinon l'atelier travaille hors de l'outil.
//
// Base mockée : le SQL exact est prouvé sur PostgreSQL 16 réel (33 vérifications
// vertes, seed + endpoints joués par les vrais handlers Express).
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} })),
}));

const express = require('express');
const request = require('supertest');
const routeur = require('../../src/routes/chaine-config');

const jeton = (role) => jwt.sign(
  { id: 3, username: 'chef', role, first_name: 'C', last_name: 'T' }, JWT_SECRET, { expiresIn: '1h' },
);
const ADMIN = jeton('ADMIN');
const MANAGER = jeton('MANAGER');

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/chaine-config', routeur);
});

const LAYOUT = {
  id: 4, nom: 'Plan V7 — 15 personnes', description: 'Deux lignes',
  effectif_max: 15, source: 'seed_v7', is_actif: true,
  created_by: null, created_at: '2026-08-26T08:00:00.000Z', updated_at: '2026-08-26T08:00:00.000Z',
};
const POSTE = {
  id: 41, layout_id: 4, code: 'CRAQ_1', libelle: 'Crackage ligne 1', categorie: 'poste',
  x: 24, y: 25, largeur: 8, hauteur: 10, obligatoire: true, actif: true,
  effectif_min: 1, effectif_max: 1, poste_operation_id: null, proprietes: { ligne: 1 },
};
const ZONE = { ...POSTE, id: 42, code: 'Z_DEEE', libelle: 'DEEE', categorie: 'zone_depose', obligatoire: false, effectif_min: 0, effectif_max: 0 };

const sqlJoue = () => mockQuery.mock.calls.map(([s]) => String(s).replace(/\s+/g, ' '));

function installerMocks({ layout = LAYOUT, postes = [POSTE, ZONE], listeVide = false } = {}) {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM chaine_layouts l LEFT JOIN/.test(s)) {
      return Promise.resolve({
        rows: listeVide ? [] : [{ ...layout, effectif_total: 15, nb_postes: 11, nb_blocs: 63 }],
      });
    }
    if (/FROM chaine_layout_postes WHERE layout_id/.test(s)) return Promise.resolve({ rows: postes });
    if (/DELETE FROM chaine_layout_postes/.test(s)) return Promise.resolve({ rows: [], rowCount: postes.length });
    if (/INSERT INTO chaine_layout_postes/.test(s)) return Promise.resolve({ rows: [] });
    if (/INSERT INTO chaine_layouts/.test(s)) return Promise.resolve({ rows: [{ ...layout, id: 9, source: 'duplication', is_actif: false }] });
    if (/UPDATE chaine_layouts/.test(s)) return Promise.resolve({ rows: layout ? [layout] : [], rowCount: layout ? 1 : 0 });
    if (/DELETE FROM chaine_layouts/.test(s)) return Promise.resolve({ rows: [], rowCount: 1 });
    if (/FROM chaine_layouts WHERE/.test(s) || /FROM chaine_layouts ORDER BY id/.test(s)) {
      return Promise.resolve({ rows: layout ? [layout] : [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => { mockQuery.mockReset(); installerMocks(); });

const get = (url, t = ADMIN) => request(app).get(url).set('Authorization', `Bearer ${t}`);
const post = (url, corps, t = ADMIN) => request(app).post(url).set('Authorization', `Bearer ${t}`).send(corps);
const put = (url, corps, t = ADMIN) => request(app).put(url).set('Authorization', `Bearer ${t}`).send(corps);
const del = (url, t = ADMIN) => request(app).delete(url).set('Authorization', `Bearer ${t}`);

const bloc = (o = {}) => ({
  code: 'P1', libelle: 'Poste', categorie: 'poste', x: 10, y: 10,
  effectif_min: 1, effectif_max: 1, obligatoire: true, actif: true, ...o,
});

describe('habilitations', () => {
  test('sans jeton : 401 sur toutes les surfaces', async () => {
    expect((await request(app).get('/api/chaine-config/layouts')).status).toBe(401);
    expect((await request(app).get('/api/chaine-config/layout-actif')).status).toBe(401);
  });

  test('la gestion des plans est réservée à ADMIN/MANAGER', async () => {
    for (const role of ['COLLABORATEUR', 'RH', 'AUTORITE', 'RESP_BTQ']) {
      const t = jeton(role);
      expect((await get('/api/chaine-config/layouts', t)).status).toBe(403);
      expect((await put('/api/chaine-config/layouts/4/postes', { postes: [] }, t)).status).toBe(403);
      expect((await post('/api/chaine-config/layouts/4/activer', {}, t)).status).toBe(403);
    }
  });

  test('le plan ACTIF est lisible par tout rôle authentifié — les autres écrans en dépendent', async () => {
    for (const role of ['COLLABORATEUR', 'RH', 'QHSE']) {
      const r = await get('/api/chaine-config/layout-actif', jeton(role));
      expect(r.status).toBe(200);
      expect(r.body.layout.id).toBe(4);
      expect(r.body.postes).toHaveLength(2);
    }
  });

  test('la suppression reste ADMIN — MANAGER conçoit, il ne détruit pas', async () => {
    installerMocks({ layout: { ...LAYOUT, is_actif: false } });
    expect((await del('/api/chaine-config/layouts/4', MANAGER)).status).toBe(403);
    expect((await del('/api/chaine-config/layouts/4', ADMIN)).status).toBe(200);
  });
});

describe('GET /layout-actif — jamais de chaîne vide silencieuse', () => {
  test('aucun plan actif : layout null ET motif explicite', async () => {
    installerMocks({ layout: null });
    const r = await get('/api/chaine-config/layout-actif');
    expect(r.status).toBe(200);
    expect(r.body.layout).toBeNull();
    expect(r.body.postes).toEqual([]);
    expect(r.body.motif).toMatch(/Aucun plan de chaîne actif/);
  });
});

describe('GET /layouts — indicateurs de la liste', () => {
  test('chaque plan porte effectif_total, effectif_reference et alerte_effectif', async () => {
    const r = await get('/api/chaine-config/layouts');
    expect(r.status).toBe(200);
    const l = r.body.layouts[0];
    expect(l.effectif_total).toBe(15);
    expect(l.effectif_reference).toBe(15);
    expect(l.alerte_effectif).toBe(false);
    expect(l.nb_postes).toBe(11);
  });

  test('le plan actif est en tête de liste', async () => {
    await get('/api/chaine-config/layouts');
    expect(sqlJoue().find((s) => /FROM chaine_layouts l LEFT JOIN/.test(s)))
      .toMatch(/ORDER BY l\.is_actif DESC/);
  });
});

describe('PUT /layouts/:id/postes — enregistrement du plan', () => {
  test('remplacement COMPLET : la purge précède les insertions, dans une transaction', async () => {
    const r = await put('/api/chaine-config/layouts/4/postes', { postes: [bloc(), bloc({ code: 'P2' })] });
    expect(r.status).toBe(200);
    const s = sqlJoue();
    expect(s[0]).toBe('BEGIN');
    expect(s[s.length - 1]).toBe('COMMIT');
    const iSuppr = s.findIndex((q) => /DELETE FROM chaine_layout_postes/.test(q));
    const iIns = s.findIndex((q) => /INSERT INTO chaine_layout_postes/.test(q));
    expect(iSuppr).toBeGreaterThan(-1);
    expect(iIns).toBeGreaterThan(iSuppr);
    expect(s.filter((q) => /INSERT INTO chaine_layout_postes/.test(q))).toHaveLength(2);
  });

  test('le plan est verrouillé le temps de l’écriture (FOR UPDATE)', async () => {
    await put('/api/chaine-config/layouts/4/postes', { postes: [bloc()] });
    expect(sqlJoue().some((s) => /FROM chaine_layouts WHERE id = \$1 FOR UPDATE/.test(s))).toBe(true);
  });

  test('code dupliqué : 400 CODE_DUPLIQUE, le code fautif est nommé, RIEN n’est écrit', async () => {
    const r = await put('/api/chaine-config/layouts/4/postes', { postes: [bloc(), bloc({ libelle: 'Autre' })] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('CODE_DUPLIQUE');
    expect(r.body.error).toMatch(/P1/);
    expect(sqlJoue().some((s) => /DELETE FROM chaine_layout_postes/.test(s))).toBe(false);
  });

  test('effectif minimum > maximum : 400 BLOC_INVALIDE, aucune écriture', async () => {
    const r = await put('/api/chaine-config/layouts/4/postes', { postes: [bloc({ effectif_min: 4, effectif_max: 2 })] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('BLOC_INVALIDE');
    expect(sqlJoue().some((s) => /DELETE FROM chaine_layout_postes/.test(s))).toBe(false);
  });

  test('capacité négative : refusée', async () => {
    const r = await put('/api/chaine-config/layouts/4/postes', { postes: [bloc({ effectif_max: -1 })] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/entiers positifs/);
  });

  test('liste de blocs absente : 400 POSTES_REQUIS (et non un plan vidé par erreur)', async () => {
    const r = await put('/api/chaine-config/layouts/4/postes', {});
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('POSTES_REQUIS');
    expect(sqlJoue().some((s) => /DELETE FROM chaine_layout_postes/.test(s))).toBe(false);
  });

  test('plan introuvable : 404 LAYOUT_INTROUVABLE', async () => {
    installerMocks({ layout: null });
    const r = await put('/api/chaine-config/layouts/999/postes', { postes: [bloc()] });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('LAYOUT_INTROUVABLE');
  });

  test('DÉPASSEMENT D’EFFECTIF : enregistré (200) et signalé — jamais refusé', async () => {
    const gros = { ...POSTE, effectif_max: 9 };
    installerMocks({ postes: [gros, { ...gros, id: 43, code: 'CRAQ_2' }] }); // 18 > 15
    const r = await put('/api/chaine-config/layouts/4/postes', { postes: [bloc({ effectif_max: 9 }), bloc({ code: 'P2', effectif_max: 9 })] });
    expect(r.status).toBe(200);
    expect(r.body.layout.effectif_total).toBe(18);
    expect(r.body.layout.alerte_effectif).toBe(true);
    expect(r.body.avertissement).toMatch(/18 personnes/);
    expect(r.body.avertissement).toMatch(/15/);
  });

  test('sans dépassement, aucun avertissement fabriqué', async () => {
    const r = await put('/api/chaine-config/layouts/4/postes', { postes: [bloc()] });
    expect(r.body.avertissement).toBeNull();
  });
});

describe('POST /layouts — création et duplication', () => {
  test('nom obligatoire : 400 NOM_REQUIS', async () => {
    const r = await post('/api/chaine-config/layouts', { nom: '   ' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('NOM_REQUIS');
  });

  test('duplication : les blocs du plan source sont copiés en une seule requête', async () => {
    const r = await post('/api/chaine-config/layouts', { nom: 'Essai', depuis_layout_id: 4 });
    expect(r.status).toBe(201);
    expect(r.body.layout.source).toBe('duplication');
    expect(r.body.layout.is_actif).toBe(false); // une variante n'entre jamais en service seule
    const copie = sqlJoue().find((s) => /INSERT INTO chaine_layout_postes .* SELECT \$1, code/.test(s));
    expect(copie).toBeTruthy();
  });

  test('plan source introuvable : 404 SOURCE_INTROUVABLE, transaction annulée', async () => {
    installerMocks({ layout: null });
    const r = await post('/api/chaine-config/layouts', { nom: 'Essai', depuis_layout_id: 77 });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('SOURCE_INTROUVABLE');
    expect(sqlJoue()).toContain('ROLLBACK');
  });

  test('création simple : aucune copie de blocs', async () => {
    const r = await post('/api/chaine-config/layouts', { nom: 'Plan vierge' });
    expect(r.status).toBe(201);
    expect(sqlJoue().some((s) => /INSERT INTO chaine_layout_postes/.test(s))).toBe(false);
  });
});

describe('activation et suppression', () => {
  test('activer : tous les plans sont désactivés AVANT que celui-ci ne le soit', async () => {
    const r = await post('/api/chaine-config/layouts/4/activer', {});
    expect(r.status).toBe(200);
    const s = sqlJoue();
    const iTous = s.findIndex((q) => /UPDATE chaine_layouts SET is_actif = false WHERE is_actif = true/.test(q));
    const iUn = s.findIndex((q) => /UPDATE chaine_layouts SET is_actif = true/.test(q));
    expect(iTous).toBeGreaterThan(-1);
    expect(iUn).toBeGreaterThan(iTous);
    expect(s[0]).toBe('BEGIN');
    expect(s[s.length - 1]).toBe('COMMIT');
  });

  test('supprimer le plan ACTIF : 409 LAYOUT_ACTIF, rien n’est supprimé', async () => {
    const r = await del('/api/chaine-config/layouts/4');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('LAYOUT_ACTIF');
    expect(sqlJoue().some((s) => /DELETE FROM chaine_layouts/.test(s))).toBe(false);
  });

  test('supprimer un plan inactif : accepté', async () => {
    installerMocks({ layout: { ...LAYOUT, is_actif: false } });
    const r = await del('/api/chaine-config/layouts/4');
    expect(r.status).toBe(200);
    expect(sqlJoue().some((s) => /DELETE FROM chaine_layouts WHERE id = \$1/.test(s))).toBe(true);
  });

  test('identifiant illisible : 400 ID_INVALIDE (et non une requête sur NaN)', async () => {
    for (const url of ['/api/chaine-config/layouts/abc', '/api/chaine-config/layouts/0']) {
      const r = await get(url);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('ID_INVALIDE');
    }
  });
});

describe('PUT /layouts/:id — identité du plan', () => {
  test('effectif_max explicitement null : le plafond est RETIRÉ (et non ignoré)', async () => {
    installerMocks({ layout: { ...LAYOUT, effectif_max: null } });
    const r = await put('/api/chaine-config/layouts/4', { effectif_max: null });
    expect(r.status).toBe(200);
    expect(r.body.layout.effectif_reference).toBeNull();
    expect(r.body.layout.alerte_effectif).toBe(false);
  });

  test('champ absent : la valeur en base est conservée (drapeau booléen dans le SQL)', async () => {
    await put('/api/chaine-config/layouts/4', { nom: 'Nouveau nom' });
    const maj = sqlJoue().find((s) => /UPDATE chaine_layouts SET nom/.test(s));
    expect(maj).toMatch(/CASE WHEN \$5::boolean THEN \$6::int ELSE effectif_max END/);
    const params = mockQuery.mock.calls
      .find(([s]) => /UPDATE chaine_layouts SET nom/.test(String(s).replace(/\s+/g, ' ')))[1];
    expect(params[4]).toBe(false); // effectif_max non fourni → non touché
  });

  test('effectif de référence non entier : 400 EFFECTIF_INVALIDE', async () => {
    const r = await put('/api/chaine-config/layouts/4', { effectif_max: 'quinze' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('EFFECTIF_INVALIDE');
  });
});
