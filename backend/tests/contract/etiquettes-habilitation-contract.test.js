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
// 2. L'UPCYCLING EST UNE COMBINAISON ORDINAIRE (2.57.0, arbitrage client B).
//    De la 2.53.0 à la 2.56.x, un carton Upcycling s'imprimait sans produit,
//    genre, saison ni gamme (NULL). Désormais c'est la combinaison gamme UP /
//    catégorie Upcycling / produit « Upcycling » / Sans Genre / Sans Saison :
//    plus AUCUN chemin NULL pour une NOUVELLE étiquette — un corps sans
//    déclinaisons est refusé quelle que soit la catégorie, et les anciens
//    cartons à champs NULL restent tels quels en base.
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
const { sansDeclinaison } = require('../../src/utils/etiquettes-categories');

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
  app.use('/api/sortie-cartons', require('../../src/routes/sortie-cartons'));
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

// Routage SQL du client de transaction pour POST /generer (codification v2).
// `combis` : combinaisons considérées ACTIVES et codifiées par la base simulée.
function routerGeneration(combis) {
  mockClientQuery.mockImplementation(async (text, params = []) => {
    const t = String(text);
    if (/FROM etiquettes_combinaisons c/.test(t)) {
      const [g, cat, pid, ge, sa] = params;
      const c = combis.find((x) => x.gamme === g && x.categorie_eco_org === cat && x.produit_id === pid
        && x.genre === ge && x.saison === sa);
      return c ? { rowCount: 1, rows: [{ combinaison_id: c.id, produit: c.produit, ...c }] } : { rowCount: 0, rows: [] };
    }
    if (/FROM postes_etiquetage/.test(t)) return { rowCount: 1, rows: [{ id: 1, numero_poste: 1 }] };
    if (/nextval/.test(t)) return { rows: [{ ref: '1' }] };
    if (/FROM produits_catalogue/.test(t)) return { rowCount: 1, rows: [{ id: 5 }] };
    if (/INSERT INTO produits_finis/.test(t)) return { rows: [{ id: 9, code_barre: params[0], poids_kg: params[7] }] };
    return { rows: [], rowCount: 0 };
  });
}

const COMBI_TEXTILES = {
  id: 1, gamme: 'VAK', categorie_eco_org: 'Textiles', produit_id: 12, produit: 'Paréos', genre: 'Adulte Femme', saison: 'Hiver',
  gamme_code: 3, categorie_code: 1, produit_code: 42, genre_code: 2, saison_code: 2,
};
const COMBI_UPCYCLING = {
  id: 209, gamme: 'UP', categorie_eco_org: 'Upcycling', produit_id: 71, produit: 'Upcycling', genre: 'Sans Genre', saison: 'Sans Saison',
  gamme_code: 5, categorie_code: 9, produit_code: 71, genre_code: 0, saison_code: 0,
};

const CORPS_COMPLET = {
  poste_id: 1, gamme: 'VAK', categorie_eco_org: 'Textiles', produit_id: 12,
  genre: 'Adulte Femme', saison: 'Hiver', poids_kg: 10,
};

// ═══════════════════════════════════════════════════════════════════════════
describe("1. L'habilitation « étiquettes » ferme réellement l'API", () => {
  const ROUTES_ECRAN = [
    ['get', '/api/etiquettes/postes'],
    ['get', '/api/etiquettes/options'],
    ['get', '/api/etiquettes/dimensions'],
    ['get', '/api/etiquettes/lots-actifs'],
    ['get', '/api/etiquettes/referentiel'],
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

  it("la sortie cartons (routeur et habilitation propres) n'est PAS emportée par le refus des étiquettes", async () => {
    refus = [{ role: 'COLLABORATEUR', module_key: 'etiquettes' }];
    const res = await request(app).get('/api/sortie-cartons/commandes-actives/btq')
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
describe('2. Upcycling = combinaison ordinaire (gamme UP), plus aucun chemin NULL', () => {
  it('la règle historique reste lisible pour les anciens cartons (casse et accents tolérés)', () => {
    expect(sansDeclinaison('Upcycling')).toBe(true);
    expect(sansDeclinaison('upcycling')).toBe(true);
    expect(sansDeclinaison('Textiles')).toBe(false);
    expect(sansDeclinaison('')).toBe(false);
    expect(sansDeclinaison(null)).toBe(false);
  });

  it('GET /dimensions (compatibilité) ne sert plus aucune catégorie sans déclinaison', async () => {
    const res = await request(app).get('/api/etiquettes/dimensions').set('Authorization', `Bearer ${TOKENS.ADMIN}`);
    expect(res.status).toBe(200);
    expect(res.body.categorie_eco_org).toEqual(['Textiles', 'Upcycling']);
    expect(res.body.categories_sans_declinaison).toEqual([]);
  });

  it('POST /generer Upcycling (UP / Upcycling / Upcycling / Sans Genre / Sans Saison) → 201, déclinaisons écrites', async () => {
    routerGeneration([COMBI_TEXTILES, COMBI_UPCYCLING]);
    const res = await request(app).post('/api/etiquettes/generer')
      .set('Authorization', `Bearer ${TOKENS.ADMIN}`)
      .send({ poste_id: 1, gamme: 'UP', categorie_eco_org: 'Upcycling', produit_id: 71, genre: 'Sans Genre', saison: 'Sans Saison', poids_kg: 4.2 });
    expect(res.status).toBe(201);
    expect(res.body.code_barre).toBe('5947000000001');
    const insert = mockClientQuery.mock.calls.find((c) => /INSERT INTO produits_finis/.test(String(c[0])));
    const [, catalogue_id, produit, categorie, genre, saison, gamme] = insert[1];
    expect([catalogue_id, produit, categorie, genre, saison, gamme])
      .toEqual([5, 'Upcycling', 'Upcycling', 'Sans Genre', 'Sans Saison', 'UP']);
    expect(insert[0]).toMatch(/'v2'/);
  });

  it('corps Upcycling SANS déclinaisons (forme 2.53.0) → 400, aucune transaction', async () => {
    const res = await request(app).post('/api/etiquettes/generer')
      .set('Authorization', `Bearer ${TOKENS.ADMIN}`)
      .send({ poste_id: 1, categorie_eco_org: 'Upcycling', poids_kg: 4.2 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PARAMETRES');
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("Upcycling hors de sa gamme UP (combinaison absente) → 400 COMBINAISON_INVALIDE, rien n'est écrit", async () => {
    routerGeneration([COMBI_TEXTILES, COMBI_UPCYCLING]);
    const res = await request(app).post('/api/etiquettes/generer')
      .set('Authorization', `Bearer ${TOKENS.ADMIN}`)
      .send({ poste_id: 1, gamme: 'EXTRA', categorie_eco_org: 'Upcycling', produit_id: 71, genre: 'Sans Genre', saison: 'Sans Saison', poids_kg: 3 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COMBINAISON_INVALIDE');
    expect(mockClientQuery.mock.calls.some((c) => /INSERT INTO produits_finis/.test(String(c[0])))).toBe(false);
  });

  it('le poids reste obligatoire (400)', async () => {
    for (const corps of [
      { ...CORPS_COMPLET, poids_kg: undefined },
      { ...CORPS_COMPLET, poids_kg: 0 },
    ]) {
      const res = await request(app).post('/api/etiquettes/generer')
        .set('Authorization', `Bearer ${TOKENS.ADMIN}`).send(corps);
      expect(res.status).toBe(400);
    }
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it('non-régression : une catégorie ordinaire complète passe (201) et lie son catalogue', async () => {
    routerGeneration([COMBI_TEXTILES]);
    const res = await request(app).post('/api/etiquettes/generer')
      .set('Authorization', `Bearer ${TOKENS.ADMIN}`).send(CORPS_COMPLET);
    expect(res.status).toBe(201);
    const insert = mockClientQuery.mock.calls.find((c) => /INSERT INTO produits_finis/.test(String(c[0])));
    expect(insert[1].slice(1, 7)).toEqual([5, 'Paréos', 'Textiles', 'Adulte Femme', 'Hiver', 'VAK']);
  });
});
