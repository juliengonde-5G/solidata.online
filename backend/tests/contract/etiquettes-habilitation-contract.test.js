// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — HABILITATION « ÉTIQUETTES » + CATÉGORIE SANS DÉCLINAISON
// ───────────────────────────────────────────────────────────────────────────
// Deux demandes client du 10/09/2026, vérifiées ensemble parce qu'elles
// touchent le même écran (/tri/etiquettes) et le même routeur.
//
// 1. L'HABILITATION EST UNE VRAIE PORTE, PAS UN LIEN MASQUÉ. La matrice
//    /admin/permissions ne fermait historiquement AUCUNE route d'API : décocher
//    retirait l'entrée de la barre latérale, l'URL tapée à la main marchait
//    encore. La clé 'etiquettes' est la première à être appliquée côté serveur.
//    Ce qui est verrouillé ici : le refus tombe sur les cinq routes de l'écran,
//    AVANT toute lecture métier ; il ne déborde pas sur la sortie cartons ; il
//    ne s'applique pas à l'ADMIN (anti-lockout) ; il suit la clé de rôle BRUTE,
//    comme /permissions/my-modules — sans quoi la barre latérale et la porte
//    diraient deux choses différentes à un rôle personnalisé.
//
// 2. L'UPCYCLING SE PASSE DE GENRE / SAISON / GAMME / PRODUIT. On vérifie que
//    rien n'est INVENTÉ à la place (NULL en base, aucune ligne de catalogue
//    créée), et que c'est le SERVEUR qui en décide : envoyer des déclinaisons
//    sur cette catégorie ne les fait pas entrer, ne pas en envoyer sur une
//    catégorie ordinaire reste refusé.
//
// Auth réelle (JWT), base mockée : aucun accès disque ni réseau.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockClientQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

const etiquettes = require('../../src/routes/etiquettes');
const { refreshModuleAccess } = require('../../src/middleware/module-access');
const { refreshCustomRoles } = require('../../src/middleware/auth');
const { CATEGORIES_SANS_DECLINAISON, sansDeclinaison } = require('../../src/utils/etiquettes-categories');

const tokenFor = (role, id = 1) => jwt.sign(
  { id, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = {
  ADMIN: tokenFor('ADMIN'),
  COLLABORATEUR: tokenFor('COLLABORATEUR'),
  CUSTOM: tokenFor('CR_ETIQUETEUR'), // rôle personnalisé dupliqué de COLLABORATEUR
};

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/etiquettes', etiquettes);
});

// Refus courants — `refus` est la liste de lignes { role, module_key } que
// renvoie la table role_module_access pour allowed = false.
let refus = [];
let matriceEnPanne = false;

// Tables dont la lecture prouverait qu'un refus est arrivé TROP TARD.
const TABLES_METIER = /postes_etiquetage|ref_dimensions|produits_catalogue|batch_tracking/;

beforeEach(async () => {
  refus = [];
  matriceEnPanne = false;
  refreshModuleAccess(); // le cache 30 s ne doit pas faire fuiter un cas dans le suivant
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  mockQuery.mockImplementation((text) => {
    const s = String(text);
    // Le rôle personnalisé doit RÉELLEMENT être connu comme dérivé de
    // COLLABORATEUR : sans cette ligne, `resolveBaseRole` serait l'identité et
    // le test de la règle « rôle brut » passerait pour une mauvaise raison
    // (constaté par contre-épreuve).
    if (/FROM custom_roles/.test(s)) {
      return Promise.resolve({ rows: [{ role_key: 'CR_ETIQUETEUR', base_role: 'COLLABORATEUR' }] });
    }
    if (/role_module_access/.test(s)) {
      if (matriceEnPanne) return Promise.reject(new Error('connexion perdue'));
      return Promise.resolve({ rows: refus });
    }
    if (/FROM postes_etiquetage/.test(s)) {
      return Promise.resolve({ rows: [{ id: 1, numero_poste: 1, nom: 'Poste 1', compteur_actuel: 0, is_active: true }] });
    }
    if (/FROM ref_dimensions/.test(s)) {
      return Promise.resolve({
        rows: [
          { id: 1, type: 'categorie_eco_org', valeur: 'Textiles', ordre: 0 },
          { id: 2, type: 'categorie_eco_org', valeur: 'Upcycling', ordre: 50 },
          { id: 3, type: 'genre', valeur: 'Homme', ordre: 0 },
          { id: 4, type: 'saison', valeur: 'Hiver', ordre: 0 },
          { id: 5, type: 'gamme', valeur: 'STANDARD', ordre: 1 },
        ],
      });
    }
    return Promise.resolve({ rows: [] });
  });
  await refreshCustomRoles();
});

const lecturesMetier = () => mockQuery.mock.calls.filter((c) => TABLES_METIER.test(String(c[0])));

// Chemin nominal de POST /generer avec déclinaisons (catalogue existant).
function generationAvecCatalogue() {
  mockClientQuery
    .mockResolvedValueOnce({})                                                            // BEGIN
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, numero_poste: 1, compteur_actuel: 0 }] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5 }] })                            // catalogue trouvé
    .mockResolvedValueOnce({ rows: [{ id: 1, code_barre: 'P10001', poids_kg: 10 }] })      // INSERT PF
    .mockResolvedValueOnce({})                                                            // UPDATE poste
    .mockResolvedValueOnce({});                                                           // COMMIT
}

const CORPS_COMPLET = {
  poste_id: 1, produit: 'Pull', categorie_eco_org: 'Textiles',
  genre: 'Homme', saison: 'Hiver', gamme: 'STANDARD', poids_kg: 10,
};

// ═══════════════════════════════════════════════════════════════════════════
describe("1. L'habilitation « étiquettes » ferme réellement l'API", () => {
  const ROUTES_ECRAN = [
    ['get', '/api/etiquettes/postes'],
    ['get', '/api/etiquettes/options'],
    ['get', '/api/etiquettes/dimensions'],
    ['get', '/api/etiquettes/lots-actifs'],
  ];

  it('sans refus enregistré, tout passe (DENY-overlay : absence de ligne = autorisé)', async () => {
    for (const [methode, url] of ROUTES_ECRAN) {
      const res = await request(app)[methode](url).set('Authorization', `Bearer ${TOKENS.COLLABORATEUR}`);
      expect([url, res.status]).toEqual([url, 200]);
    }
  });

  it.each(ROUTES_ECRAN)('module retiré → 403 MODULE_NON_HABILITE sur %s %s', async (methode, url) => {
    refus = [{ role: 'COLLABORATEUR', module_key: 'etiquettes' }];
    const res = await request(app)[methode](url).set('Authorization', `Bearer ${TOKENS.COLLABORATEUR}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MODULE_NON_HABILITE');
    expect(res.body.module).toBe('etiquettes');
  });

  it('le refus tombe AVANT toute lecture métier', async () => {
    refus = [{ role: 'COLLABORATEUR', module_key: 'etiquettes' }];
    const res = await request(app).get('/api/etiquettes/postes').set('Authorization', `Bearer ${TOKENS.COLLABORATEUR}`);
    expect(res.status).toBe(403);
    expect(lecturesMetier()).toHaveLength(0);
  });

  it('POST /generer est refusé, et aucune transaction n\'est ouverte', async () => {
    refus = [{ role: 'COLLABORATEUR', module_key: 'etiquettes' }];
    const res = await request(app).post('/api/etiquettes/generer')
      .set('Authorization', `Bearer ${TOKENS.COLLABORATEUR}`).send(CORPS_COMPLET);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MODULE_NON_HABILITE');
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("un refus sur un AUTRE module ne ferme pas les étiquettes", async () => {
    refus = [{ role: 'COLLABORATEUR', module_key: 'tri' }, { role: 'COLLABORATEUR', module_key: 'rh' }];
    const res = await request(app).get('/api/etiquettes/postes').set('Authorization', `Bearer ${TOKENS.COLLABORATEUR}`);
    expect(res.status).toBe(200);
  });

  it("un refus visant un AUTRE rôle ne ferme rien pour celui-ci", async () => {
    refus = [{ role: 'RESP_BTQ', module_key: 'etiquettes' }];
    const res = await request(app).get('/api/etiquettes/postes').set('Authorization', `Bearer ${TOKENS.COLLABORATEUR}`);
    expect(res.status).toBe(200);
  });

  it("l'ADMIN n'est jamais restreint, même avec une ligne de refus le visant", async () => {
    refus = [{ role: 'ADMIN', module_key: 'etiquettes' }];
    const res = await request(app).get('/api/etiquettes/postes').set('Authorization', `Bearer ${TOKENS.ADMIN}`);
    expect(res.status).toBe(200);
  });

  it('rôle personnalisé : le refus suit SA clé (comme /permissions/my-modules)', async () => {
    refus = [{ role: 'CR_ETIQUETEUR', module_key: 'etiquettes' }];
    const res = await request(app).get('/api/etiquettes/postes').set('Authorization', `Bearer ${TOKENS.CUSTOM}`);
    expect(res.status).toBe(403);
  });

  it("rôle personnalisé : un refus posé sur son rôle de BASE ne le ferme pas (l'écran dirait l'inverse)", async () => {
    refus = [{ role: 'COLLABORATEUR', module_key: 'etiquettes' }];
    const res = await request(app).get('/api/etiquettes/postes').set('Authorization', `Bearer ${TOKENS.CUSTOM}`);
    expect(res.status).toBe(200);
  });

  it('matrice illisible → on retombe sur le contrôle de rôle, jamais sur une fermeture générale', async () => {
    matriceEnPanne = true;
    const res = await request(app).get('/api/etiquettes/postes').set('Authorization', `Bearer ${TOKENS.COLLABORATEUR}`);
    expect(res.status).toBe(200);
  });

  it("la sortie cartons n'est PAS emportée par le refus des étiquettes", async () => {
    refus = [{ role: 'COLLABORATEUR', module_key: 'etiquettes' }];
    const res = await request(app).get('/api/etiquettes/commandes-actives/btq')
      .set('Authorization', `Bearer ${TOKENS.COLLABORATEUR}`);
    expect(res.status).not.toBe(403);
  });

  it("la clé figure au catalogue d'habilitations (sinon elle serait incochable)", () => {
    // Lecture du source : le catalogue vit dans un module qui monte des routes
    // gardées par requireMfa, l'exercer ici n'apporterait rien de plus.
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/routes/permissions.js'), 'utf-8');
    expect(src).toMatch(/\{ key: 'etiquettes', label: '[^']+' \}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Catégorie sans déclinaison (upcycling)', () => {
  it('la règle est portée par une source unique et tolère casse et accents', () => {
    expect(CATEGORIES_SANS_DECLINAISON).toContain('Upcycling');
    expect(sansDeclinaison('Upcycling')).toBe(true);
    expect(sansDeclinaison('upcycling')).toBe(true);
    expect(sansDeclinaison('Textiles')).toBe(false);
    expect(sansDeclinaison('')).toBe(false);
    expect(sansDeclinaison(null)).toBe(false);
  });

  it('GET /dimensions sert la liste au front (qui ne la recopie donc jamais)', async () => {
    const res = await request(app).get('/api/etiquettes/dimensions').set('Authorization', `Bearer ${TOKENS.ADMIN}`);
    expect(res.status).toBe(200);
    expect(res.body.categorie_eco_org).toEqual(['Textiles', 'Upcycling']);
    expect(res.body.categories_sans_declinaison).toEqual(['Upcycling']);
  });

  it("la liste est bornée au référentiel : catégorie absente → liste vide", async () => {
    mockQuery.mockImplementation((text) => {
      if (/role_module_access/.test(String(text))) return Promise.resolve({ rows: [] });
      if (/FROM ref_dimensions/.test(String(text))) {
        return Promise.resolve({ rows: [{ id: 1, type: 'categorie_eco_org', valeur: 'Textiles', ordre: 0 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).get('/api/etiquettes/dimensions').set('Authorization', `Bearer ${TOKENS.ADMIN}`);
    expect(res.body.categories_sans_declinaison).toEqual([]);
  });

  it('POST /generer : catégorie + poids suffisent (201), et RIEN n\'est inventé', async () => {
    mockClientQuery
      .mockResolvedValueOnce({})                                                             // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, numero_poste: 1, compteur_actuel: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, code_barre: 'P10001', poids_kg: 4.2 }] })      // INSERT PF
      .mockResolvedValueOnce({})                                                             // UPDATE poste
      .mockResolvedValueOnce({});                                                            // COMMIT

    const res = await request(app).post('/api/etiquettes/generer')
      .set('Authorization', `Bearer ${TOKENS.ADMIN}`)
      .send({ poste_id: 1, categorie_eco_org: 'Upcycling', poids_kg: 4.2 });
    expect(res.status).toBe(201);

    // Aucune ligne de catalogue cherchée NI créée : produits_catalogue ne sait
    // pas représenter « pas de produit » (nom et gamme y sont NOT NULL).
    const catalogue = mockClientQuery.mock.calls.filter((c) => /produits_catalogue/.test(String(c[0])));
    expect(catalogue).toHaveLength(0);

    const insert = mockClientQuery.mock.calls.find((c) => /INSERT INTO produits_finis/.test(String(c[0])));
    expect(insert).toBeDefined();
    const [, catalogue_id, produit, categorie, genre, saison, gamme] = insert[1];
    expect(catalogue_id).toBeNull();
    expect(produit).toBeNull();
    expect(genre).toBeNull();
    expect(saison).toBeNull();
    expect(gamme).toBeNull();
    // Seule vérité disponible : la catégorie.
    expect(categorie).toBe('Upcycling');
  });

  it("c'est le SERVEUR qui décide : des déclinaisons envoyées sur cette catégorie n'entrent pas", async () => {
    mockClientQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, numero_poste: 1, compteur_actuel: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, code_barre: 'P10002', poids_kg: 3 }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const res = await request(app).post('/api/etiquettes/generer')
      .set('Authorization', `Bearer ${TOKENS.ADMIN}`)
      .send({ poste_id: 1, categorie_eco_org: 'Upcycling', produit: 'Pull', genre: 'Homme', saison: 'Hiver', gamme: 'EXTRA', poids_kg: 3 });
    expect(res.status).toBe(201);
    const insert = mockClientQuery.mock.calls.find((c) => /INSERT INTO produits_finis/.test(String(c[0])));
    expect(insert[1].slice(2, 7)).toEqual([null, 'Upcycling', null, null, null]);
  });

  it('une catégorie ORDINAIRE exige toujours ses quatre déclinaisons (400)', async () => {
    const res = await request(app).post('/api/etiquettes/generer')
      .set('Authorization', `Bearer ${TOKENS.ADMIN}`)
      .send({ poste_id: 1, categorie_eco_org: 'Textiles', poids_kg: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/produit, genre, saison et gamme/i);
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("le poids reste obligatoire, y compris sans déclinaison (400)", async () => {
    for (const corps of [
      { poste_id: 1, categorie_eco_org: 'Upcycling' },
      { poste_id: 1, categorie_eco_org: 'Upcycling', poids_kg: 0 },
      { poste_id: 1, poids_kg: 5 },
    ]) {
      const res = await request(app).post('/api/etiquettes/generer')
        .set('Authorization', `Bearer ${TOKENS.ADMIN}`).send(corps);
      expect(res.status).toBe(400);
    }
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("non-régression : une catégorie ordinaire complète passe toujours (201) et lie son catalogue", async () => {
    generationAvecCatalogue();
    const res = await request(app).post('/api/etiquettes/generer')
      .set('Authorization', `Bearer ${TOKENS.ADMIN}`).send(CORPS_COMPLET);
    expect(res.status).toBe(201);
    const insert = mockClientQuery.mock.calls.find((c) => /INSERT INTO produits_finis/.test(String(c[0])));
    expect(insert[1].slice(1, 7)).toEqual([5, 'Pull', 'Textiles', 'Homme', 'Hiver', 'STANDARD']);
  });
});
