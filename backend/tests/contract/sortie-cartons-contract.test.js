// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — SORTIE DE CARTONS (2.57.0, contrat § 2.2 et § 2.3)
// ───────────────────────────────────────────────────────────────────────────
// Ce qui est verrouillé ici :
//  1. CHAQUE scan est journalisé — réussi OU refusé (ok, inconnu, deja_sorti,
//     commande_fermee, invalide) — par le POOL, jamais par le client de la
//     transaction : un refus ne doit pas annuler sa propre trace.
//  2. Le journal ne porte JAMAIS l'identité de la personne.
//  3. Les réponses ont la forme figée (resultat, code, format, message).
//  4. Annuler une sortie libre CONTRE-PASSE le mouvement de stock, jamais de DELETE.
//  5. Habilitation `sortie_cartons` (403 MODULE_NON_HABILITE) et périmètre du
//     rôle OPERATEUR_STOCK (refusé ailleurs, p. ex. /api/employees).
//
// Auth réelle (JWT), base mockée : aucun accès disque ni réseau.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockPoolQuery = jest.fn();
const mockClientQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockPoolQuery(...a),
  connect: async () => ({ query: (...a) => mockClientQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { refreshModuleAccess } = require('../../src/middleware/module-access');
const { BUILTIN_ROLES, isValidRole } = require('../../src/utils/roles');
const { MODULE_PAR_ROUTEUR } = require('../../src/utils/module-routes');

const USER_ID = 4242;
const tokenFor = (role, id = USER_ID) => jwt.sign(
  { id, username: 'poste', role, first_name: 'P', last_name: 'S' }, JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = {
  ADMIN: tokenFor('ADMIN'), COLLABORATEUR: tokenFor('COLLABORATEUR'),
  OPERATEUR_STOCK: tokenFor('OPERATEUR_STOCK'), RH: tokenFor('RH'),
};

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/sortie-cartons', require('../../src/routes/sortie-cartons'));
  app.use('/api/etiquettes', require('../../src/routes/etiquettes'));
  app.use('/api/employees', require('../../src/routes/employees'));
});

// ── État simulé ─────────────────────────────────────────────────────────────
let cartons; let commandes; let journal; let mouvements; let refus; let supprimes;
const J_COLS = ['session_id', 'code_lu', 'code_normalise', 'format', 'resultat', 'produit_fini_id', 'commande_type', 'commande_id', 'message'];

function reset() {
  cartons = {
    '312A02200001F': { id: 1, code_barre: '312A02200001F', codification: 'v2', status: 'en_stock', date_sortie: null, poids_kg: 10, produit: 'Paréos', categorie_eco_org: 'Textiles', genre: 'Adulte Femme', saison: 'Hiver', gamme: 'VAK' },
    P10AAH: { id: 2, code_barre: 'P10AAH', codification: 'ancien', status: 'en_stock', date_sortie: null, poids_kg: 8, produit: 'Pulls', categorie_eco_org: 'Textiles', genre: 'Homme', saison: 'Hiver', gamme: 'BTQ STAND' },
    SORTI: { id: 3, code_barre: '312A022000020', codification: 'v2', status: 'expedie', date_sortie: '2026-09-22T08:00:00Z', sortie_commande_type: 'libre', poids_kg: 5 },
  };
  cartons['312A022000020'] = cartons.SORTI; delete cartons.SORTI;
  commandes = { btq: { 10: { id: 10, reference: 'BTQ-10', statut: 'envoyee' }, 11: { id: 11, reference: 'BTQ-11', statut: 'expediee' } }, vak: {} };
  journal = []; mouvements = []; supprimes = [];
}

function clientHandler(text, params = []) {
  const s = String(text);
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(s.trim())) return { rows: [] };
  if (/DELETE/i.test(s)) { supprimes.push(s); return { rows: [], rowCount: 0 }; }
  if (/FROM produits_finis/.test(s) && /FOR UPDATE/.test(s)) {
    const [cands] = params;
    let c = cands.map((k) => cartons[k]).find(Boolean);
    if (c && /sortie_commande_type = \$2/.test(s)) {
      const ok = c.date_sortie && c.sortie_commande_type === params[1]
        && (/sortie_commande_id IS NULL/.test(s) ? c.sortie_commande_id == null : c.sortie_commande_id === params[2]);
      if (!ok) c = null;
    }
    return c ? { rows: [{ ...c }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/FROM boutique_commandes WHERE id/.test(s)) {
    const c = commandes.btq[params[0]]; return c ? { rows: [c], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/FROM commandes_exutoires WHERE id/.test(s)) return { rows: [], rowCount: 0 };
  if (/UPDATE produits_finis SET\s+date_sortie = NOW\(\)/.test(s)) {
    const c = Object.values(cartons).find((x) => x.id === params[3]);
    Object.assign(c, { status: 'expedie', date_sortie: '2026-09-23T09:00:00Z', sortie_commande_type: params[0], sortie_commande_id: params[1] });
    return { rows: [{ ...c }], rowCount: 1 };
  }
  if (/UPDATE produits_finis SET\s+date_sortie = NULL/.test(s)) {
    const c = Object.values(cartons).find((x) => x.id === params[0]);
    Object.assign(c, { status: 'en_stock', date_sortie: null, sortie_commande_type: null, sortie_commande_id: null });
    return { rows: [{ ...c }], rowCount: 1 };
  }
  if (/FROM categories_sortantes/.test(s)) return { rows: [] };
  if (/INSERT INTO stock_movements/.test(s)) {
    const id = mouvements.length + 1;
    if (/'sortie_carton'/.test(s)) mouvements.push({ id, type: 'sortie', origine: 'sortie_carton', produit_fini_id: params[4], poids_kg: params[0], date: '2026-09-23', code_barre: params[2] });
    else mouvements.push({ id, type: 'entree', origine: 'annulation', produit_fini_id: params[6], reversed_of_id: params[7], reversal_reason: params[8] });
    return { rows: [{ id }] };
  }
  if (/SELECT \* FROM stock_movements/.test(s)) {
    return { rows: mouvements.filter((m) => m.produit_fini_id === params[0] && m.origine === 'sortie_carton' && !m.reversal_movement_id) };
  }
  if (/UPDATE stock_movements SET reversal_movement_id/.test(s)) {
    const m = mouvements.find((x) => x.id === params[1]); m.reversal_movement_id = params[0]; m.reversed_at = 'now';
    return { rows: [], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}

beforeEach(() => {
  reset();
  refus = [];
  refreshModuleAccess();
  mockPoolQuery.mockReset();
  mockClientQuery.mockReset();
  mockClientQuery.mockImplementation(async (t, p) => clientHandler(t, p));
  mockPoolQuery.mockImplementation(async (text, params = []) => {
    const s = String(text);
    if (/role_module_access/.test(s)) return { rows: /allowed = false/.test(s) ? refus : [] };
    if (/INSERT INTO sortie_cartons_journal/.test(s)) {
      journal.push({ text: s, params, row: Object.fromEntries(J_COLS.map((k, i) => [k, params[i]])) });
      return { rows: [] };
    }
    if (/FROM sortie_cartons_journal j WHERE/.test(s) && /GROUP BY/.test(s)) {
      return { rows: [{ resultat: 'ok', n: 2 }, { resultat: 'inconnu', n: 1 }] };
    }
    if (/FROM sortie_cartons_journal j/.test(s)) {
      return { rows: [{ id: '5', scanned_at: '2026-09-23T08:00:00.000Z', code_lu: 'P10AAH', code_normalise: 'P10AAH', format: 'ancien_base24', resultat: 'ok', message: null, commande_type: 'libre', commande_id: null, pf_code_barre: 'P10AAH', pf_produit: 'Pulls', pf_gamme: 'BTQ STAND', pf_poids_kg: 8 }] };
    }
    if (/FROM produits_finis/.test(s)) return { rows: [] };
    return { rows: [], rowCount: 0 };
  });
});

const scan = (body, role = 'OPERATEUR_STOCK') => request(app).post('/api/sortie-cartons/scan')
  .set('Authorization', `Bearer ${TOKENS[role]}`).send(body);

/** Le journal n'a jamais été écrit par le client de transaction. */
const journalHorsTransaction = () => mockClientQuery.mock.calls.every((c) => !/sortie_cartons_journal/.test(String(c[0])));

// ═══════════════════════════════════════════════════════════════════════════
describe('1. POST /scan — chaque issue', () => {
  it('ok (sortie libre) → 200, mouvement de sortie, journal « ok »', async () => {
    const res = await scan({ code_barre: '312A02200001F', commande_type: 'libre', session_id: 'sess-1' });
    expect(res.status).toBe(200);
    expect(res.body.resultat).toBe('ok');
    expect(res.body.carton).toMatchObject({ code_barre: '312A02200001F', code_lisible: '3-1-2A-02-2-00001F', codification: 'v2', produit: 'Paréos' });
    expect(res.body.commande).toBeNull();
    expect(mouvements).toHaveLength(1);
    expect(journal).toHaveLength(1);
    expect(journal[0].row).toMatchObject({ resultat: 'ok', format: 'v2', produit_fini_id: 1, commande_type: 'libre', session_id: 'sess-1' });
    expect(journalHorsTransaction()).toBe(true);
  });

  it('ok (commande BTQ) → pas de mouvement de stock (anti-double-compte)', async () => {
    const res = await scan({ code_barre: '312A02200001F', commande_type: 'btq', commande_id: 10 });
    expect(res.status).toBe(200);
    expect(res.body.commande).toEqual({ id: 10, reference: 'BTQ-10', statut: 'envoyee' });
    expect(mouvements).toHaveLength(0);
    expect(journal[0].row).toMatchObject({ resultat: 'ok', commande_type: 'btq', commande_id: 10 });
  });

  it('ancien code (base24) lu tel quel → ok', async () => {
    const res = await scan({ code_barre: ' p10aah\r\n', commande_type: 'libre' });
    expect(res.status).toBe(200);
    expect(res.body.carton.code_barre).toBe('P10AAH');
    expect(journal[0].row.format).toBe('ancien_base24');
  });

  it('inconnu (ancien format) → 404, message « absent du stock importé », journal écrit', async () => {
    const res = await scan({ code_barre: 'P1NNNN', commande_type: 'libre' });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ resultat: 'inconnu', code: 'NOT_FOUND', format: 'ancien_base24', code_normalise: 'P1NNNN' });
    expect(res.body.format_libelle).toBeTruthy();
    expect(res.body.error).toMatch(/absent du stock importé/);
    expect(journal).toHaveLength(1);
    expect(journal[0].row).toMatchObject({ resultat: 'inconnu', code_lu: 'P1NNNN', format: 'ancien_base24', produit_fini_id: null });
    expect(journalHorsTransaction()).toBe(true);
  });

  it('inconnu (format non reconnu) → message distinct', async () => {
    const res = await scan({ code_barre: 'HELLO-WORLD', commande_type: 'libre' });
    expect(res.status).toBe(404);
    expect(res.body.format).toBe('inconnu');
    expect(res.body.error).toMatch(/Format non reconnu/);
    expect(journal[0].row.resultat).toBe('inconnu');
  });

  it('déjà sorti → 409 ALREADY_OUT avec date et type de sortie, journal écrit', async () => {
    const res = await scan({ code_barre: '312A022000020', commande_type: 'libre' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ resultat: 'deja_sorti', code: 'ALREADY_OUT' });
    expect(res.body.carton).toMatchObject({ date_sortie: '2026-09-22T08:00:00Z', sortie_commande_type: 'libre' });
    expect(journal[0].row).toMatchObject({ resultat: 'deja_sorti', produit_fini_id: 3 });
    expect(mockClientQuery.mock.calls.map((c) => String(c[0]))).toContain('ROLLBACK');
  });

  it('second scan du même carton → deja_sorti', async () => {
    await scan({ code_barre: '312A02200001F', commande_type: 'libre' });
    const res = await scan({ code_barre: '312A02200001F', commande_type: 'libre' });
    expect(res.body.resultat).toBe('deja_sorti');
    expect(journal.map((j) => j.row.resultat)).toEqual(['ok', 'deja_sorti']);
  });

  it('commande fermée → 409 COMMANDE_FERMEE, carton inchangé, journal écrit', async () => {
    const res = await scan({ code_barre: '312A02200001F', commande_type: 'btq', commande_id: 11 });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ resultat: 'commande_fermee', code: 'COMMANDE_FERMEE' });
    expect(cartons['312A02200001F'].status).toBe('en_stock');
    expect(journal[0].row).toMatchObject({ resultat: 'commande_fermee', commande_type: 'btq', commande_id: 11 });
  });

  it.each([
    [{ code_barre: '', commande_type: 'libre' }, 'CODE_VIDE'],
    [{ code_barre: '\r\n', commande_type: 'libre' }, 'CODE_VIDE'],
    [{ code_barre: 'P10AAH', commande_type: 'autre' }, 'PARAMETRES'],
    [{ code_barre: 'P10AAH', commande_type: 'btq' }, 'PARAMETRES'],
  ])('invalide %j → 400 %s, journal écrit, aucune transaction', async (body, code) => {
    const res = await scan(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ resultat: 'invalide', code });
    expect(journal).toHaveLength(1);
    expect(journal[0].row.resultat).toBe('invalide');
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("le journal ne porte JAMAIS l'identifiant de l'utilisateur", async () => {
    await scan({ code_barre: '312A02200001F', commande_type: 'libre' });
    await scan({ code_barre: 'INCONNU99', commande_type: 'libre' });
    await scan({ code_barre: '', commande_type: 'libre' });
    expect(journal).toHaveLength(3);
    for (const j of journal) {
      expect(j.text).not.toMatch(/user|scanned_by|created_by/i);
      expect(JSON.stringify(j.params)).not.toContain(String(USER_ID));
    }
  });

  it('code lu tronqué à 64, session à 40', async () => {
    await scan({ code_barre: 'X'.repeat(100), commande_type: 'libre', session_id: 'S'.repeat(80) });
    expect(journal[0].row.code_lu).toHaveLength(64);
    expect(journal[0].row.session_id).toHaveLength(40);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. POST /annuler', () => {
  it('sortie libre → contre-écriture (entree, annulation, reversed_of_id), jamais de DELETE', async () => {
    await scan({ code_barre: '312A02200001F', commande_type: 'libre' });
    const res = await request(app).post('/api/sortie-cartons/annuler')
      .set('Authorization', `Bearer ${TOKENS.OPERATEUR_STOCK}`)
      .send({ code_barre: '312A02200001F', commande_type: 'libre', motif: 'Erreur de carton' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.carton.code_barre).toBe('312A02200001F');
    expect(cartons['312A02200001F'].status).toBe('en_stock');
    expect(mouvements).toHaveLength(2);
    expect(mouvements[1]).toMatchObject({ type: 'entree', origine: 'annulation', reversed_of_id: 1, reversal_reason: 'Erreur de carton' });
    expect(mouvements[0].reversal_movement_id).toBe(2);
    expect(supprimes).toHaveLength(0);
    expect(journal.map((j) => j.row.resultat)).toEqual(['ok', 'annulation']);
  });

  it('BTQ → remis en stock, aucun mouvement à contre-passer', async () => {
    await scan({ code_barre: '312A02200001F', commande_type: 'btq', commande_id: 10 });
    const res = await request(app).post('/api/sortie-cartons/annuler')
      .set('Authorization', `Bearer ${TOKENS.COLLABORATEUR}`)
      .send({ code_barre: '312A02200001F', commande_type: 'btq', commande_id: 10 });
    expect(res.status).toBe(200);
    expect(mouvements).toHaveLength(0);
  });

  it('carton non sorti par CETTE commande → 404', async () => {
    await scan({ code_barre: '312A02200001F', commande_type: 'btq', commande_id: 10 });
    const res = await request(app).post('/api/sortie-cartons/annuler')
      .set('Authorization', `Bearer ${TOKENS.ADMIN}`)
      .send({ code_barre: '312A02200001F', commande_type: 'libre' });
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. GET /journal et /session', () => {
  it('forme figée : items (carton joint) + compteurs complets', async () => {
    const res = await request(app).get('/api/sortie-cartons/journal')
      .set('Authorization', `Bearer ${TOKENS.OPERATEUR_STOCK}`);
    expect(res.status).toBe(200);
    expect(res.body.compteurs).toEqual({ ok: 2, inconnu: 1, deja_sorti: 0, commande_fermee: 0, invalide: 0, annulation: 0 });
    expect(res.body.items[0]).toMatchObject({
      id: 5, code_lu: 'P10AAH', format: 'ancien_base24', resultat: 'ok', commande_type: 'libre',
      carton: { code_barre: 'P10AAH', produit: 'Pulls', gamme: 'BTQ STAND', poids_kg: 8 },
    });
    // Jour courant heure de Paris par défaut, limite 200.
    const sql = mockPoolQuery.mock.calls.map((c) => String(c[0])).find((s) => /ORDER BY j\.scanned_at/.test(s));
    expect(sql).toMatch(/Europe\/Paris/);
    const params = mockPoolQuery.mock.calls.find((c) => /ORDER BY j\.scanned_at/.test(String(c[0])))[1];
    expect(params.at(-1)).toBe(200);
  });

  it('limit plafonnée à 1000, date mal formée → 400', async () => {
    await request(app).get('/api/sortie-cartons/journal?limit=5000').set('Authorization', `Bearer ${TOKENS.ADMIN}`);
    const params = mockPoolQuery.mock.calls.find((c) => /ORDER BY j\.scanned_at/.test(String(c[0])))[1];
    expect(params.at(-1)).toBe(1000);
    const ko = await request(app).get('/api/sortie-cartons/journal?date=23/09/2026').set('Authorization', `Bearer ${TOKENS.ADMIN}`);
    expect(ko.status).toBe(400);
  });

  it('date de la bonne forme mais inexistante (2026-13-45, 2026-02-30) → 400, jamais un 500 du cast SQL', async () => {
    // Audit 2.57.0 : la forme AAAA-MM-JJ passait, puis `$1::date` échouait en
    // 22008 → « Erreur serveur ». Une saisie fausse n'est pas une panne.
    for (const d of ['2026-13-45', '2026-02-30', '2026-00-10']) {
      mockPoolQuery.mockClear();
      const ko = await request(app).get(`/api/sortie-cartons/journal?date=${d}`).set('Authorization', `Bearer ${TOKENS.ADMIN}`);
      expect(ko.status).toBe(400);
      expect(ko.body.code).toBe('PARAMETRES');
      expect(mockPoolQuery.mock.calls.some((c) => /sortie_cartons_journal/.test(String(c[0])))).toBe(false);
    }
    const ok = await request(app).get('/api/sortie-cartons/journal?date=2024-02-29').set('Authorization', `Bearer ${TOKENS.ADMIN}`);
    expect(ok.status).toBe(200);
  });

  it('GET /session/:type/:id → { items, count, total_kg }', async () => {
    const res = await request(app).get('/api/sortie-cartons/session/btq/10').set('Authorization', `Bearer ${TOKENS.ADMIN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], count: 0, total_kg: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Habilitation `sortie_cartons` et rôle OPERATEUR_STOCK', () => {
  it('module retiré → 403 MODULE_NON_HABILITE, sans transaction ni journal', async () => {
    refus = [{ role: 'OPERATEUR_STOCK', module_key: 'sortie_cartons' }];
    const res = await scan({ code_barre: '312A02200001F', commande_type: 'libre' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'MODULE_NON_HABILITE', module: 'sortie_cartons' });
    expect(mockClientQuery).not.toHaveBeenCalled();
    expect(journal).toHaveLength(0);
  });

  it('retirer les étiquettes ne coupe pas la sortie de cartons', async () => {
    refus = [{ role: 'OPERATEUR_STOCK', module_key: 'etiquettes' }];
    const res = await scan({ code_barre: '312A02200001F', commande_type: 'libre' });
    expect(res.status).toBe(200);
  });

  it('RH refusé sur la sortie (403), sans journal', async () => {
    const res = await scan({ code_barre: '312A02200001F', commande_type: 'libre' }, 'RH');
    expect(res.status).toBe(403);
    expect(journal).toHaveLength(0);
  });

  it('OPERATEUR_STOCK est un rôle intégré, et il est refusé ailleurs (/api/employees)', async () => {
    expect(BUILTIN_ROLES).toContain('OPERATEUR_STOCK');
    await expect(isValidRole('OPERATEUR_STOCK')).resolves.toBe(true);
    const res = await request(app).get('/api/employees').set('Authorization', `Bearer ${TOKENS.OPERATEUR_STOCK}`);
    expect(res.status).toBe(403);
  });

  it('libellé, clé de module et carte routeur → module', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/routes/permissions.js'), 'utf8');
    expect(src).toContain("OPERATEUR_STOCK: 'Opérateur étiquetage & sortie de stock'");
    expect(src).toMatch(/\{ key: 'sortie_cartons', label: '[^']+' \}/);
    expect(MODULE_PAR_ROUTEUR['/api/sortie-cartons']).toEqual(['sortie_cartons']);
  });

  it("OPERATEUR_STOCK n'apparaît dans AUCUN authorize hors étiquettes / sortie de cartons", () => {
    const racine = path.join(__dirname, '../../src');
    const coupables = [];
    const parcourir = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) parcourir(p);
        else if (e.name.endsWith('.js')) {
          const rel = path.relative(racine, p);
          if (['routes/etiquettes.js', 'routes/sortie-cartons.js'].includes(rel)) continue;
          const src = fs.readFileSync(p, 'utf8');
          for (const appel of src.match(/authorize\([^()]*\)/g) || []) {
            if (appel.includes('OPERATEUR_STOCK')) coupables.push(`${rel} → ${appel}`);
          }
        }
      }
    };
    parcourir(racine);
    expect(coupables).toEqual([]);
  });

  it("l'assistant est fermé à OPERATEUR_STOCK des DEUX côtés : serveur (chat.js) ET barre supérieure (Layout.jsx)", () => {
    // Audit 2.57.0 : le serveur refusait déjà (403 ASSISTANT_HORS_PERIMETRE),
    // mais Layout.jsx ne fermait l'onglet que pour COMMUNICATION — l'écran
    // annonçait un assistant qui répondait 403 (règle 2.51.0).
    const chat = fs.readFileSync(path.join(__dirname, '../../src/routes/chat.js'), 'utf8');
    expect(chat).toMatch(/ROLES_SANS_ASSISTANT = new Set\(\[[^\]]*'OPERATEUR_STOCK'[^\]]*\]\)/);
    const layout = fs.readFileSync(path.join(__dirname, '../../../frontend/src/components/Layout.jsx'), 'utf8');
    expect(layout).toMatch(/ROLES_SANS_ASSISTANT = \[[^\]]*'OPERATEUR_STOCK'[^\]]*\]/);
    expect(layout).toContain('!ROLES_SANS_ASSISTANT.includes(user?.base_role || user?.role)');
  });

  it('les routes de sortie ont quitté le routeur des étiquettes', async () => {
    const res = await request(app).post('/api/etiquettes/sortie-scan')
      .set('Authorization', `Bearer ${TOKENS.ADMIN}`).send({ code_barre: 'P10AAH', commande_type: 'libre' });
    expect(res.status).toBe(404);
  });
});
