// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — REPORTING & PILOTAGE (Vague 3, item 3.A)
// ───────────────────────────────────────────────────────────────────────────
// Verrouille la forme de 3 endpoints réparés aux vagues 0-2 dont le contrat est
// consommé « à plat » par des pages de reporting (constat T3 : désalignements
// silencieux) :
//   - GET /dashboard/alertes         → DashboardExecutif.jsx (Vague 2)
//   - GET /metropole/sortie-dynamique → ReportingMetropole.jsx (Vague 0-1)
//   - GET /refashion/dpav-source     → Refashion.jsx (Vague 1)
//
// Auth réelle (JWT), DB + Redis + activity-logger mockés.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
const mockConnect = jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} }));
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: (...a) => mockConnect(...a),
}));
// Redis indisponible → cacheMiddleware (dashboard.js) devient un no-op.
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

let app;
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/dashboard', require('../../src/routes/dashboard'));
  app.use('/api/metropole', require('../../src/routes/metropole'));
  app.use('/api/refashion', require('../../src/routes/refashion'));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

const get = (path) => request(app).get(path).set('Authorization', `Bearer ${adminToken}`);

// ───────────────────────────────────────────────────────────────────────────
// GET /dashboard/alertes  (Vague 2)
// Écran : DashboardExecutif.jsx (ligne 24 : data.alertes ; 43-55 : a.categorie /
//         a.message / a.link). Contrat « tableau d'alertes typées ».
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /dashboard/alertes → { generated_at, total, seuil_stock_matiere, alertes[] } (DashboardExecutif.jsx)', () => {
  // Aiguillage SQL pour produire au moins une alerte de chaque sévérité utile.
  const wire = (sql) => {
    const s = String(sql);
    if (/FROM incidents\b/.test(s)) return Promise.resolve({ rows: [{ n: 2 }] });        // error
    if (/vehicle_maintenance_alerts/.test(s)) return Promise.resolve({ rows: [{ n: 1 }] }); // warning
    if (/FROM insertion_milestones im/.test(s)) return Promise.resolve({ rows: [{ n: 3 }] });
    if (/indicateur = 'cav_remplissage'/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM cav WHERE status = 'active'/.test(s)) return Promise.resolve({ rows: [{ n: 0 }] });
    if (/JOIN employee_contracts ec/.test(s)) return Promise.resolve({ rows: [{ n: 4 }] });  // info
    if (/indicateur = 'stock_matiere_max'/.test(s)) return Promise.resolve({ rows: [] });    // seuil désactivé
    return Promise.resolve({ rows: [] });
  };

  it('renvoie l’enveloppe typée generated_at / total / seuil_stock_matiere / alertes', async () => {
    mockQuery.mockImplementation(wire);
    const res = await get('/api/dashboard/alertes');
    expect(res.status).toBe(200);
    expect(typeof res.body.generated_at).toBe('string');
    expect(typeof res.body.total).toBe('number');
    // seuil désactivé → null (la clé DOIT exister quand même)
    expect('seuil_stock_matiere' in res.body).toBe(true);
    expect(res.body.seuil_stock_matiere === null || typeof res.body.seuil_stock_matiere === 'number').toBe(true);
    expect(Array.isArray(res.body.alertes)).toBe(true);
  });

  it('chaque alerte porte categorie/severite/count/message/link typés', async () => {
    mockQuery.mockImplementation(wire);
    const { body } = await get('/api/dashboard/alertes');
    expect(body.alertes.length).toBeGreaterThan(0);
    for (const a of body.alertes) {
      expect(typeof a.categorie).toBe('string');   // lu par DashboardExecutif (ALERT_CATEGORY[a.categorie])
      expect(typeof a.severite).toBe('string');     // pilote le tri + la couleur
      expect(typeof a.count).toBe('number');
      expect(typeof a.message).toBe('string');       // rendu tel quel
      expect(typeof a.link).toBe('string');          // cible de navigation au clic
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GET /metropole/sortie-dynamique  (Vague 0-1)
// Écran : ReportingMetropole.jsx (ligne 71 : setSortieDyn(sd) ; 270-275 :
//         sortieDyn.annee / .taux_dynamique_pct / .dynamiques / .total_sorties /
//         .cdi / .cdd / .formation / .creation).
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /metropole/sortie-dynamique → { annee, total_sorties, dynamiques, ... } (ReportingMetropole.jsx)', () => {
  it('porte annee + tous les compteurs de sortie lus par la page', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/milestone_type = 'Bilan Sortie'/.test(String(sql))) {
        // une seule ligne agrégée (COUNT/FILTER) — pg renvoie taux en numeric (string)
        return Promise.resolve({ rows: [{
          total_sorties: 10, dynamiques: 7, cdi: 3, cdd: 2,
          formation: 1, creation: 1, non_dynamiques: 3, taux_dynamique_pct: '70.0',
        }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/metropole/sortie-dynamique?annee=2026');
    expect(res.status).toBe(200);
    expect(typeof res.body.annee).toBe('number');
    for (const k of ['total_sorties', 'dynamiques', 'cdi', 'cdd', 'formation', 'creation']) {
      expect(k in res.body).toBe(true);
      expect(typeof res.body[k]).toBe('number');
    }
    // taux_dynamique_pct présent (front tolère string|null : `!= null ? x + ' %'`)
    expect('taux_dynamique_pct' in res.body).toBe(true);
  });

  it('reste valide (au moins { annee }) même sans aucune sortie', async () => {
    // La requête agrégée renvoie toujours une ligne (COUNT=0). Contrat : annee toujours là.
    mockQuery.mockResolvedValue({ rows: [{ total_sorties: 0, dynamiques: 0, cdi: 0, cdd: 0, formation: 0, creation: 0, non_dynamiques: 0, taux_dynamique_pct: null }] });
    const res = await get('/api/metropole/sortie-dynamique?annee=2026');
    expect(res.status).toBe(200);
    expect(res.body.annee).toBe(2026);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GET /refashion/dpav-source  (Vague 1, item 27)
// Écran : Refashion.jsx (ligne 108 : setDpavSource(Array.isArray(srcRes.data) ?
//         srcRes.data[0] : null) → la réponse DOIT être un TABLEAU ; 169-170,
//         309-317 : dpavSource.collecte_brut_t / .tri_entree_t / .tri_sortie_t /
//         .ecart_pct / .ecart_severite).
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /refashion/dpav-source → tableau de lignes décorées (Refashion.jsx)', () => {
  it('renvoie un TABLEAU (Array.isArray côté front) de lignes ecart-décorées', async () => {
    mockQuery.mockResolvedValue({ rows: [
      { annee: 2026, trimestre: 1, collecte_brut_t: 12.5, tri_entree_t: 11.8, tri_sortie_t: 10.2, ecart_pct: 3.5 },
    ] });
    const res = await get('/api/refashion/dpav-source?annee=2026&trimestre=1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);           // contrat structurant : Array
    const row = res.body[0];
    for (const k of ['collecte_brut_t', 'tri_entree_t', 'tri_sortie_t', 'ecart_pct']) {
      expect(k in row).toBe(true);
    }
    expect(typeof row.ecart_severite).toBe('string');     // ajouté par le back, lu par le badge
  });

  it('classe ecart_severite selon |ecart_pct| : inconnu / ok / attention / critique', async () => {
    mockQuery.mockResolvedValue({ rows: [
      { annee: 2026, trimestre: 1, ecart_pct: null }, // → inconnu
      { annee: 2026, trimestre: 2, ecart_pct: 1 },    // ≤2 → ok
      { annee: 2026, trimestre: 3, ecart_pct: 3.5 },  // ≤5 → attention
      { annee: 2026, trimestre: 4, ecart_pct: 10 },   // >5 → critique
    ] });
    const { body } = await get('/api/refashion/dpav-source?annee=2026');
    expect(body.map((r) => r.ecart_severite)).toEqual(['inconnu', 'ok', 'attention', 'critique']);
  });
});
