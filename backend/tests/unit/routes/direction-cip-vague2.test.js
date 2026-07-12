// Vague 2 — Lot « Boîte du directeur + confort CIP » (items 60 et 61).
// Vérifie :
//  - la « boîte du directeur » : KPIs de la veille, alertes consolidées
//    résilientes, contrôle d'accès (rôles de consultation exclus des routes).
//  - le filtrage RGPD des outils SolidataBot par rôle (tools exposés selon rôle).
//  - le confort CIP : objectif conventionné (ADMIN/RH seulement), CIP référent,
//    référents, cohorte enrichie (agenda + objectif).
// Auth réelle (JWT), DB et Redis mockés.
// insertion/routes.js exige PCM_ENCRYPTION_KEY|JWT_SECRET au chargement → fixés ici.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.PCM_ENCRYPTION_KEY = process.env.PCM_ENCRYPTION_KEY || 'test-pcm-key-0123456789';
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

const mockQuery = jest.fn();
const mockConnect = jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} }));
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: (...a) => mockConnect(...a),
}));
// Redis indisponible → cacheMiddleware devient un no-op (pas de connexion réseau).
jest.mock('../../../src/config/redis', () => ({
  getRedisClient: () => ({}),
  isRedisAvailable: () => false,
}));
// Journal d'activité neutralisé (écrit en base).
jest.mock('../../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

const tok = (role) => jwt.sign({ id: 1, username: role.toLowerCase(), role, first_name: 'T', last_name: role }, JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  ADMIN: tok('ADMIN'), MANAGER: tok('MANAGER'), RH: tok('RH'),
  COLLABORATEUR: tok('COLLABORATEUR'), AUTORITE: tok('AUTORITE'),
  FINANCE: tok('FINANCE'), RESP_BTQ: tok('RESP_BTQ'),
};

const chatRouter = require('../../../src/routes/chat');

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/dashboard', require('../../../src/routes/dashboard'));
  app.use('/api/insertion', require('../../../src/routes/insertion'));
  app.use('/api/chat', chatRouter);
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

const get = (path, role) => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);
const put = (path, role, body = {}) => request(app).put(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);

// ════════════════════════════════════════════════════════════════════
// ITEM 60a — KPIs de la veille (dashboard.js)
// ════════════════════════════════════════════════════════════════════
describe('60a — lastBusinessDay / mondayOfWeek', () => {
  const { lastBusinessDay, mondayOfWeek } = chatRequire('dashboard');

  it('lundi → veille = vendredi précédent', () => {
    const d = lastBusinessDay(new Date('2026-07-13')); // lundi
    expect(d.getDay()).toBe(5); // vendredi
    expect(d.toISOString().slice(0, 10)).toBe('2026-07-10');
  });
  it('dimanche → veille = vendredi', () => {
    const d = lastBusinessDay(new Date('2026-07-12')); // dimanche
    expect(d.getDay()).toBe(5);
    expect(d.toISOString().slice(0, 10)).toBe('2026-07-10');
  });
  it('mardi → veille = lundi (jour ouvré précédent)', () => {
    const d = lastBusinessDay(new Date('2026-07-14')); // mardi
    expect(d.getDay()).toBe(1);
  });
  it('la veille n’est jamais un week-end', () => {
    for (let i = 0; i < 14; i++) {
      const ref = new Date('2026-07-01'); ref.setDate(ref.getDate() + i);
      const d = lastBusinessDay(ref);
      expect([0, 6]).not.toContain(d.getDay());
    }
  });
  it('mondayOfWeek renvoie un lundi', () => {
    expect(mondayOfWeek(new Date('2026-07-15')).getDay()).toBe(1);
  });
});

describe('60a — GET /dashboard/activite-periode', () => {
  const tours = { rows: [{ nb_tournees: 2, terminees: 2, poids_kg: 1500, cav_visites: 20 }] };
  const prod = { rows: [{ kg_trie: 0.5 }] };
  const handler = (sql) => {
    const s = String(sql);
    if (/FROM tours WHERE date BETWEEN/.test(s)) return Promise.resolve(tours);
    if (/FROM production_daily WHERE date BETWEEN/.test(s)) return Promise.resolve(prod);
    return Promise.resolve({ rows: [] });
  };

  it('défaut = veille (jour ouvré) et agrège collecte + production', async () => {
    mockQuery.mockImplementation(handler);
    const res = await get('/api/dashboard/activite-periode', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.periode).toBe('veille');
    expect(res.body.collecte.tonnage_kg).toBe(1500);
    expect(res.body.collecte.cav_visites).toBe(20);
    expect(res.body.production.kg_trie).toBe(500); // 0.5 t → 500 kg
    // du = jour ouvré (jamais samedi/dimanche)
    const jour = new Date(res.body.du).getUTCDay();
    expect([0, 6]).not.toContain(jour);
  });

  it('periode=semaine accepté', async () => {
    mockQuery.mockImplementation(handler);
    const res = await get('/api/dashboard/activite-periode?periode=semaine', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.periode).toBe('semaine');
  });

  it('periode invalide → repli sur veille', async () => {
    mockQuery.mockImplementation(handler);
    const res = await get('/api/dashboard/activite-periode?periode=n_importe_quoi', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body.periode).toBe('veille');
  });
});

// ════════════════════════════════════════════════════════════════════
// ITEM 60b/c — Alertes consolidées (dashboard.js)
// ════════════════════════════════════════════════════════════════════
describe('60b/c — GET /dashboard/alertes', () => {
  const baseHandler = (sql) => {
    const s = String(sql);
    if (/FROM incidents\b/.test(s)) return Promise.resolve({ rows: [{ n: 2 }] });
    if (/vehicle_maintenance_alerts/.test(s)) return Promise.resolve({ rows: [{ n: 1 }] });
    if (/FROM insertion_milestones im/.test(s)) return Promise.resolve({ rows: [{ n: 3 }] });
    if (/indicateur = 'cav_remplissage'/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM cav WHERE status = 'active'/.test(s)) return Promise.resolve({ rows: [{ n: 0 }] });
    if (/JOIN employee_contracts ec/.test(s)) return Promise.resolve({ rows: [{ n: 1 }] });
    if (/indicateur = 'stock_matiere_max'/.test(s)) return Promise.resolve({ rows: [] }); // désactivé
    return Promise.resolve({ rows: [] });
  };

  it('ADMIN : agrège les sources actives, chaque ligne a un lien', async () => {
    mockQuery.mockImplementation(baseHandler);
    const res = await get('/api/dashboard/alertes', 'ADMIN');
    expect(res.status).toBe(200);
    const cats = res.body.alertes.map((a) => a.categorie);
    expect(cats).toEqual(expect.arrayContaining(['incidents', 'maintenance', 'insertion', 'contrats']));
    // CAV plein (0) et stock (seuil désactivé) → absents
    expect(cats).not.toContain('cav_pleins');
    expect(cats).not.toContain('stock');
    // total = somme des counts = 2 + 1 + 3 + 1
    expect(res.body.total).toBe(7);
    // incident = severite error → trié en premier
    expect(res.body.alertes[0].categorie).toBe('incidents');
    res.body.alertes.forEach((a) => expect(typeof a.link).toBe('string'));
  });

  it('résilient : une source qui échoue n’abat pas le widget', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM incidents\b/.test(String(sql))) return Promise.reject(new Error('boom'));
      return baseHandler(sql);
    });
    const res = await get('/api/dashboard/alertes', 'ADMIN');
    expect(res.status).toBe(200);
    const cats = res.body.alertes.map((a) => a.categorie);
    expect(cats).not.toContain('incidents'); // source en échec omise
    expect(cats).toEqual(expect.arrayContaining(['maintenance', 'insertion'])); // les autres restent
  });

  it('seuil stock actif → alerte matière au-dessus du seuil', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/indicateur = 'stock_matiere_max'/.test(s)) return Promise.resolve({ rows: [{ seuil_max: 10000 }] });
      if (/FROM categories_sortantes cs/.test(s)) return Promise.resolve({ rows: [{ nom: 'Crème', stock_kg: 12000 }] });
      return baseHandler(sql);
    });
    const res = await get('/api/dashboard/alertes', 'ADMIN');
    expect(res.status).toBe(200);
    const stock = res.body.alertes.find((a) => a.categorie === 'stock');
    expect(stock).toBeTruthy();
    expect(stock.details[0]).toMatch(/Crème/);
  });

  it('COLLABORATEUR → 403 (route réservée direction)', async () => {
    const res = await get('/api/dashboard/alertes', 'COLLABORATEUR');
    expect(res.status).toBe(403);
  });

  it('AUTORITE (lecture seule) → 403', async () => {
    const res = await get('/api/dashboard/alertes', 'AUTORITE');
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════
// ITEM 60d — SolidataBot : filtrage RGPD des outils par rôle
// ════════════════════════════════════════════════════════════════════
describe('60d — toolsForRole (RGPD tool-gating)', () => {
  const { toolsForRole, EXTENDED_TOOL_ROLES } = chatRouter;
  const names = (role) => toolsForRole(role).map((t) => t.name);

  it('COLLABORATEUR : seulement les 5 outils de base', () => {
    const n = names('COLLABORATEUR');
    expect(n).toHaveLength(5);
    expect(n).not.toContain('resume_finance');
    expect(n).not.toContain('kpis_insertion');
    expect(n).not.toContain('ventes_synthese');
  });
  it('ADMIN : les 5 base + les 3 outils de pilotage', () => {
    const n = names('ADMIN');
    expect(n).toEqual(expect.arrayContaining(['resume_finance', 'kpis_insertion', 'ventes_synthese']));
    expect(n).toHaveLength(8);
  });
  it('RH : insertion oui, finance/ventes non', () => {
    const n = names('RH');
    expect(n).toContain('kpis_insertion');
    expect(n).not.toContain('resume_finance');
    expect(n).not.toContain('ventes_synthese');
  });
  it('FINANCE : finance oui, insertion/ventes non', () => {
    const n = names('FINANCE');
    expect(n).toContain('resume_finance');
    expect(n).not.toContain('kpis_insertion');
    expect(n).not.toContain('ventes_synthese');
  });
  it('RESP_BTQ : ventes oui, finance/insertion non', () => {
    const n = names('RESP_BTQ');
    expect(n).toContain('ventes_synthese');
    expect(n).not.toContain('resume_finance');
    expect(n).not.toContain('kpis_insertion');
  });
  it('AUTORITE (lecture seule) : aucun outil de pilotage', () => {
    const n = names('AUTORITE');
    expect(n).toHaveLength(5);
  });
  it('la table de rôles couvre les 3 outils étendus', () => {
    expect(Object.keys(EXTENDED_TOOL_ROLES).sort()).toEqual(['kpis_insertion', 'resume_finance', 'ventes_synthese']);
    expect(EXTENDED_TOOL_ROLES.resume_finance).toContain('FINANCE');
    expect(EXTENDED_TOOL_ROLES.kpis_insertion).toContain('RH');
    expect(EXTENDED_TOOL_ROLES.ventes_synthese).toContain('RESP_BTQ');
  });
});

describe('60d — GET /chat/suggestions (RGPD par rôle)', () => {
  it('ADMIN reçoit des suggestions de pilotage (finance/insertion/ventes)', async () => {
    const res = await get('/api/chat/suggestions', 'ADMIN');
    expect(res.status).toBe(200);
    const cats = res.body.suggestions.map((s) => s.category);
    expect(cats).toEqual(expect.arrayContaining(['finance', 'insertion', 'ventes']));
  });
  it('COLLABORATEUR ne reçoit aucune suggestion finance/insertion/ventes', async () => {
    const res = await get('/api/chat/suggestions', 'COLLABORATEUR');
    expect(res.status).toBe(200);
    const cats = res.body.suggestions.map((s) => s.category);
    expect(cats).not.toContain('finance');
    expect(cats).not.toContain('insertion');
    expect(cats).not.toContain('ventes');
  });
});

// ════════════════════════════════════════════════════════════════════
// ITEM 61c — Objectif conventionné (settings insertion.objectif_sorties_dynamiques)
// ════════════════════════════════════════════════════════════════════
describe('61c — objectif conventionné', () => {
  it('GET /insertion/objectif-sorties (RH) → lit la valeur en settings', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM settings WHERE key = \$1/.test(String(sql))) return Promise.resolve({ rows: [{ value: '55' }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/objectif-sorties', 'RH');
    expect(res.status).toBe(200);
    expect(res.body.objectif).toBe(55);
  });

  it('PUT /insertion/objectif-sorties (RH, valeur valide) → 200', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await put('/api/insertion/objectif-sorties', 'RH', { objectif: 60 });
    expect(res.status).toBe(200);
    expect(res.body.objectif).toBe(60);
  });

  it('PUT objectif hors bornes (150) → 400', async () => {
    const res = await put('/api/insertion/objectif-sorties', 'RH', { objectif: 150 });
    expect(res.status).toBe(400);
  });

  it('PUT objectif par MANAGER → 403 (écriture réservée ADMIN/RH)', async () => {
    const res = await put('/api/insertion/objectif-sorties', 'MANAGER', { objectif: 60 });
    expect(res.status).toBe(403);
  });

  it('PUT objectif par AUTORITE (lecture seule) → 403', async () => {
    const res = await put('/api/insertion/objectif-sorties', 'AUTORITE', { objectif: 60 });
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════
// ITEM 61b — CIP référent
// ════════════════════════════════════════════════════════════════════
describe('61b — CIP référent', () => {
  it('GET /insertion/cip-referents (RH) → liste RH/ADMIN', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM users\s+WHERE COALESCE\(is_active/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 3, first_name: 'C', last_name: 'IP', role: 'RH' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/cip-referents', 'RH');
    expect(res.status).toBe(200);
    expect(res.body[0].role).toBe('RH');
  });

  it('PUT /insertion/:id/cip-referent (RH, user valide) → 200', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT id FROM users WHERE id = \$1 AND COALESCE\(is_active/.test(s)) return Promise.resolve({ rows: [{ id: 3 }] });
      if (/UPDATE employees SET cip_referent_user_id/.test(s)) return Promise.resolve({ rows: [{ id: 5, cip_referent_user_id: 3 }] });
      if (/SELECT first_name, last_name FROM users WHERE id = \$1/.test(s)) return Promise.resolve({ rows: [{ first_name: 'C', last_name: 'IP' }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await put('/api/insertion/5/cip-referent', 'RH', { user_id: 3 });
    expect(res.status).toBe(200);
    expect(res.body.cip_referent_user_id).toBe(3);
    expect(res.body.cip_referent_nom).toBe('C IP');
  });

  it('PUT cip-referent avec user inexistant/non RH → 400', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT id FROM users WHERE id = \$1 AND COALESCE\(is_active/.test(String(sql))) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = await put('/api/insertion/5/cip-referent', 'RH', { user_id: 999 });
    expect(res.status).toBe(400);
  });

  it('PUT cip-referent avec user_id null (retrait) → 200', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/UPDATE employees SET cip_referent_user_id/.test(String(sql))) return Promise.resolve({ rows: [{ id: 5, cip_referent_user_id: null }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await put('/api/insertion/5/cip-referent', 'RH', { user_id: null });
    expect(res.status).toBe(200);
    expect(res.body.cip_referent_user_id).toBeNull();
  });

  it('PUT cip-referent par MANAGER → 403 (écriture réservée ADMIN/RH)', async () => {
    const res = await put('/api/insertion/5/cip-referent', 'MANAGER', { user_id: 3 });
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════
// ITEM 61a/c — Cohorte enrichie (agenda 30 j + objectif)
// ════════════════════════════════════════════════════════════════════
describe('61a — GET /insertion/cohorte/stats enrichi', () => {
  it('renvoie mine, agenda_30j et objectif_sorties_dynamiques', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM settings WHERE key = \$1/.test(String(sql))) return Promise.resolve({ rows: [{ value: '55' }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/cohorte/stats?mine=1', 'RH');
    expect(res.status).toBe(200);
    expect(res.body.mine).toBe(true);
    expect(Array.isArray(res.body.agenda_30j)).toBe(true);
    expect(res.body.objectif_sorties_dynamiques).toBe(55);
  });

  it('AUTORITE (lecture seule) → 403 sur tout le module insertion', async () => {
    const res = await get('/api/insertion/cohorte/stats', 'AUTORITE');
    expect(res.status).toBe(403);
  });
});

// Petit utilitaire : require le module dashboard (avec ses helpers exposés).
function chatRequire(name) {
  return require(`../../../src/routes/${name}`);
}
