// ═══════════════════════════════════════════════════════════════════════════
// CONTRAT — ÉCRAN « MES ÉCHÉANCES » (PR C, lot 5)
// ───────────────────────────────────────────────────────────────────────────
// `pg` est simulé : on exerce les VRAIS handlers Express à travers le vrai
// routeur monté (`src/routes/insertion`), et on inspecte ce qui sort, ce qui
// est écrit, et ce qui n'est PAS demandé.
//
// Ce que ces tests tiennent :
//   1. FORME — un seul appel rend les cinq blocs du contrat § 5.1, avec la
//      forme d'échéance figée (id, type, niveau, cible, nb_reports).
//   2. HABILITATION — un MANAGER ne reçoit ni le bloc RSA ni les obligations
//      sociales, et un report lui est refusé en 403 **AVANT toute requête** :
//      `pool.query` n'est pas appelé une seule fois.
//   3. REPORT — motif facultatif au 1er, OBLIGATOIRE au 2e (409 MOTIF_REQUIS),
//      type inconnu → 400, ligne agrégée → 400, salarié inconnu → 404.
//   4. JOURNAL BLOQUANT — un report échoue si sa trace ne peut pas s'écrire, et
//      la transaction est annulée : reporter sans laisser de trace une ligne
//      que l'autorité contrôle n'est pas un moindre mal, c'est le défaut.
//   5. `pool.connect()` EN ÉCHEC → 500 propre, sans fuite de connexion.
//   6. COMPTEUR — la pastille ne fait jamais tomber l'application.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;
process.env.PCM_ENCRYPTION_KEY = process.env.PCM_ENCRYPTION_KEY || 'test-pcm-key';

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const clientQuery = jest.fn();
const clientRelease = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: (...a) => mockConnect(...a),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');
const { viderCacheCompteur } = require('../../src/services/echeances-cip');

let app;
const tokenFor = (role) => jwt.sign(
  { id: 7, username: 'cip', role, first_name: 'Claire', last_name: 'MARTIN', mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
  JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = { ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER') };

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/insertion', require('../../src/routes/insertion'));
});

const get = (p, role = 'ADMIN') => request(app).get(p).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (p, role, body = {}) => request(app).post(p).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);

const jourISO = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const SALARIE = {
  id: 5, first_name: 'Amine', last_name: 'BENALI', insertion_status: 'en_parcours',
  insertion_start_date: jourISO(-120), insertion_end_date: null, parcours_num: 1,
  cip_referent_user_id: 7, contract_end: jourISO(90), contrat_fin: jourISO(90),
  pass_iae_number: '2026-03-0441', pass_iae_end: jourISO(400), pass_iae_statut: 'actif',
  cddi_derogation_motif: null, referent_unique_type: 'non_determine',
  ft_categorie: null, ft_categorie_date: null,
};

/** Aiguillage du faux `pg`. `over` surcharge une source par un fragment SQL. */
function branche(over = {}) {
  mockQuery.mockImplementation((sql, params) => {
    const s = String(sql).replace(/\s+/g, ' ');
    for (const [motif, lignes] of Object.entries(over)) {
      if (s.includes(motif)) {
        if (lignes instanceof Error) return Promise.reject(lignes);
        return Promise.resolve({ rows: lignes });
      }
    }
    if (/INSERT INTO rgpd_audit_log/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM employees e WHERE/.test(s)) return Promise.resolve({ rows: [SALARIE] });
    if (/SELECT id FROM employees e/.test(s)) return Promise.resolve({ rows: [{ id: 5 }] });
    if (/COUNT\(\*\)::int AS n FROM insertion_echeance_reports/.test(s)) return Promise.resolve({ rows: [{ n: 0 }] });
    if (/FROM insertion_echeance_reports/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM settings/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
  clientQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (/INSERT INTO insertion_echeance_reports/.test(s)) {
      return Promise.resolve({ rows: [{ id: 1, reporte_jusqu_au: new Date(Date.now() + 48 * 3600000).toISOString() }] });
    }
    return Promise.resolve({ rows: [] });
  });
  mockConnect.mockImplementation(async () => ({ query: clientQuery, release: clientRelease }));
}

beforeEach(() => {
  mockQuery.mockReset(); mockConnect.mockReset(); clientQuery.mockReset(); clientRelease.mockReset();
  viderCacheCompteur();
  branche();
});

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/insertion/echeances — forme de réponse (§ 5.1)', () => {
  test('un seul appel rend les cinq blocs et le compteur', async () => {
    const r = await get('/api/insertion/echeances');
    expect(r.status).toBe(200);
    for (const cle of ['genere_le', 'obligations', 'organisation', 'rendez_vous_reguliers',
      'file_active', 'compteur_rouges', 'reportees', 'sources_indisponibles']) {
      expect(r.body).toHaveProperty(cle);
    }
    expect(Array.isArray(r.body.obligations)).toBe(true);
    expect(Array.isArray(r.body.reportees)).toBe(true);
    for (const k of ['en_parcours', 'retards', 'a_venir_7j', 'sorties_dynamiques_pct',
      'sorties', 'objectif_sorties', 'completude_fse_asi_pct']) {
      expect(r.body.file_active).toHaveProperty(k);
    }
  });

  test('une obligation porte la forme figée du § 5.1.1', async () => {
    const r = await get('/api/insertion/echeances');
    const o = r.body.obligations.find((x) => x.type === 'referent_unique');
    expect(o).toBeDefined();
    expect(o).toMatchObject({
      id: 'referent_unique:5', type: 'referent_unique', niveau: 'rouge',
      employee_id: 5, nom: 'BENALI Amine', nb_reports: 0,
    });
    expect(o.cible).toEqual({ onglet: 'dossier', champ: 'referent_unique' });
    expect(o).toHaveProperty('echeance');
    expect(o).toHaveProperty('jours');
  });

  test('`compteur_rouges` ne compte QUE les rouges non reportées', async () => {
    const r = await get('/api/insertion/echeances');
    expect(r.body.compteur_rouges).toBe(r.body.obligations.filter((o) => o.niveau === 'rouge').length);
  });

  test('une obligation REPORTÉE sort des obligations, entre dans `reportees` et du compteur', async () => {
    branche({
      // Socle complet : la SEULE ligne rouge restante est le référent unique.
      'FROM insertion_diagnostics d WHERE': [{ employee_id: 5, socle_complet: true, fse_entree_complet: true }],
      'FROM insertion_echeance_reports WHERE employee_id = ANY': [
        { employee_id: 5, echeance_type: 'referent_unique', nb: 2, en_cours_jusqu_au: jourISO(1), dernier_motif: 'attente_referent' },
      ],
    });
    const r = await get('/api/insertion/echeances');
    expect(r.body.obligations.find((o) => o.type === 'referent_unique')).toBeUndefined();
    const rep = r.body.reportees.find((o) => o.type === 'referent_unique');
    expect(rep).toBeDefined();
    expect(rep.nb_reports).toBe(2);
    expect(rep.motif_report).toBe('attente_referent');
    expect(r.body.compteur_rouges).toBe(0);
  });

  test('une source en échec NOMME son absence au lieu de vider l’écran en silence', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const boum = Object.assign(new Error('relation absente'), { code: '42P01' });
    branche({ 'FROM insertion_diagnostics d WHERE': boum });
    const r = await get('/api/insertion/echeances');
    expect(r.status).toBe(200);
    expect(r.body.sources_indisponibles).toContain('diagnostics');
    err.mockRestore();
  });

  test('la consultation est journalisée SANS nommer personne', async () => {
    await get('/api/insertion/echeances');
    const j = mockQuery.mock.calls.find(([s]) => String(s).includes('INSERT INTO rgpd_audit_log'));
    expect(j).toBeDefined();
    expect(j[1][1]).toBe('INSERTION_ECHEANCES_CONSULTATION');
    const details = JSON.parse(j[1][4]);
    expect(details).toHaveProperty('nb_obligations');
    expect(JSON.stringify(details)).not.toContain('BENALI');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('périmètre par rôle', () => {
  test('un MANAGER ne reçoit PAS le bloc « rendez-vous réguliers » (ADMIN/RH strict)', async () => {
    const r = await get('/api/insertion/echeances', 'MANAGER');
    expect(r.status).toBe(200);
    expect(r.body.rendez_vous_reguliers).toBeNull();
  });

  test('un ADMIN le reçoit', async () => {
    const r = await get('/api/insertion/echeances', 'ADMIN');
    expect(r.body.rendez_vous_reguliers).not.toBeNull();
    expect(r.body.rendez_vous_reguliers).toHaveProperty('actualisations_ft_du_mois');
  });

  test('aucune obligation SOCIALE n’est rendue à un MANAGER', async () => {
    const r = await get('/api/insertion/echeances', 'MANAGER');
    const types = r.body.obligations.map((o) => o.type);
    for (const t of ['sortie_fse_a_saisir', 'fse_entree_manquant', 'categorie_g', 'sous_15h']) {
      expect(types).not.toContain(t);
    }
  });

  test('`?mine=1` restreint la cohorte au CIP référent', async () => {
    await get('/api/insertion/echeances?mine=1');
    const cohorte = mockQuery.mock.calls.find(([s]) => String(s).replace(/\s+/g, ' ').includes('FROM employees e WHERE'));
    expect(String(cohorte[0])).toContain('cip_referent_user_id');
    expect(cohorte[1]).toContain(7);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/insertion/echeances/compteur', () => {
  test('rend un entier', async () => {
    const r = await get('/api/insertion/echeances/compteur');
    expect(r.status).toBe(200);
    expect(typeof r.body.rouges).toBe('number');
  });

  test('une panne de base ne fait pas tomber la barre latérale', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockQuery.mockImplementation(() => Promise.reject(new Error('base injoignable')));
    const r = await get('/api/insertion/echeances/compteur');
    expect(r.status).toBe(200);
    expect(r.body.rouges).toBe(0);
    err.mockRestore();
  });

  test('le compteur n’est PAS journalisé (la barre latérale l’appelle à chaque page)', async () => {
    await get('/api/insertion/echeances/compteur');
    const j = mockQuery.mock.calls.filter(([s]) => String(s).includes('INSERT INTO rgpd_audit_log'));
    expect(j).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/insertion/echeances/report (§ 5.1.3)', () => {
  test('un MANAGER est refusé en 403 AVANT toute requête', async () => {
    const r = await post('/api/insertion/echeances/report', 'MANAGER', { employee_id: 5, type: 'referent_unique' });
    expect(r.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('1er report : motif FACULTATIF, 201 avec la date de reprise', async () => {
    const r = await post('/api/insertion/echeances/report', 'ADMIN', { employee_id: 5, type: 'referent_unique' });
    expect(r.status).toBe(201);
    expect(r.body.nb_reports).toBe(1);
    expect(r.body).toHaveProperty('reporte_jusqu_au');
    expect(clientRelease).toHaveBeenCalled();
  });

  test('2e report SANS motif : 409 MOTIF_REQUIS, et rien n’est écrit', async () => {
    branche({ 'COUNT(*)::int AS n FROM insertion_echeance_reports': [{ n: 1 }] });
    const r = await post('/api/insertion/echeances/report', 'RH', { employee_id: 5, type: 'referent_unique' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('MOTIF_REQUIS');
    expect(r.body.motifs_acceptes).toEqual(['attente_piece', 'attente_referent', 'personne_absente', 'rdv_planifie', 'autre']);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('2e report AVEC motif : accepté', async () => {
    branche({ 'COUNT(*)::int AS n FROM insertion_echeance_reports': [{ n: 1 }] });
    const r = await post('/api/insertion/echeances/report', 'ADMIN', { employee_id: 5, type: 'referent_unique', motif: 'attente_piece' });
    expect(r.status).toBe(201);
    expect(r.body.nb_reports).toBe(2);
  });

  test('motif hors liste fermée → 400 (validateur, avant toute requête)', async () => {
    const r = await post('/api/insertion/echeances/report', 'ADMIN', { employee_id: 5, type: 'referent_unique', motif: 'parce_que' });
    expect(r.status).toBe(400);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('type inconnu → 400 TYPE_INCONNU', async () => {
    const r = await post('/api/insertion/echeances/report', 'ADMIN', { employee_id: 5, type: 'ce_type_nexiste_pas' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('TYPE_INCONNU');
  });

  test('ligne AGRÉGÉE → 400 LIGNE_AGREGEE (elle ne désigne personne)', async () => {
    const r = await post('/api/insertion/echeances/report', 'ADMIN', { employee_id: 5, type: 'sous_15h' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('LIGNE_AGREGEE');
  });

  test('salarié inconnu → 404', async () => {
    branche({ 'SELECT id FROM employees e': [] });
    const r = await post('/api/insertion/echeances/report', 'ADMIN', { employee_id: 999, type: 'pass_iae' });
    expect(r.status).toBe(404);
  });

  // CORRECTIF m-04 — le report acceptait n'importe quel salarié existant, y
  // compris un PERMANENT : la ligne était créée, journalisée, et le compteur de
  // reports s'incrémentait pour rien (le motif devenant obligatoire au geste
  // suivant sur un dossier où rien n'avait été reporté).
  test('un salarié hors file active → 404 `HORS_FILE_ACTIVE`, et la requête le VÉRIFIE', async () => {
    branche({ 'SELECT id FROM employees e': [] });
    const r = await post('/api/insertion/echeances/report', 'ADMIN', { employee_id: 5, type: 'pass_iae' });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('HORS_FILE_ACTIVE');
    const verif = mockQuery.mock.calls.find(([q]) => /SELECT id FROM employees e/.test(String(q)));
    expect(String(verif[0])).toContain("insertion_status = 'en_parcours'");
  });

  test('le report est journalisé DANS la transaction (trace bloquante)', async () => {
    await post('/api/insertion/echeances/report', 'ADMIN', { employee_id: 5, type: 'pass_iae', motif: null });
    const textes = clientQuery.mock.calls.map(([s]) => String(s));
    expect(textes.some((t) => t.includes('BEGIN'))).toBe(true);
    expect(textes.some((t) => t.includes('INSERT INTO rgpd_audit_log'))).toBe(true);
    expect(textes.some((t) => t.includes('COMMIT'))).toBe(true);
    const journal = clientQuery.mock.calls.find(([s]) => String(s).includes('rgpd_audit_log'));
    expect(journal[1][1]).toBe('INSERTION_ECHEANCE_REPORT');
  });

  test('journal impossible → 500 et ROLLBACK : pas de report sans trace', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    clientQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/rgpd_audit_log/.test(s)) return Promise.reject(new Error('journal indisponible'));
      if (/INSERT INTO insertion_echeance_reports/.test(s)) return Promise.resolve({ rows: [{ id: 1, reporte_jusqu_au: null }] });
      return Promise.resolve({ rows: [] });
    });
    const r = await post('/api/insertion/echeances/report', 'ADMIN', { employee_id: 5, type: 'pass_iae' });
    expect(r.status).toBe(500);
    expect(clientQuery.mock.calls.map(([s]) => String(s)).some((t) => t.includes('ROLLBACK'))).toBe(true);
    expect(clientRelease).toHaveBeenCalled();
    err.mockRestore();
  });

  test('`pool.connect()` en échec → 500 propre, aucune connexion à relâcher', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockConnect.mockImplementation(async () => { throw new Error('pool épuisé'); });
    const r = await post('/api/insertion/echeances/report', 'ADMIN', { employee_id: 5, type: 'pass_iae' });
    expect(r.status).toBe(500);
    expect(clientRelease).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
