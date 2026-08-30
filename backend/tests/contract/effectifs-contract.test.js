// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — MODULE « EFFECTIFS CONVENTIONNÉS (ETP) »
// ───────────────────────────────────────────────────────────────────────────
// Verrouille la forme de réponse et la matrice d'habilitations de
// routes/effectifs.js (le frontend consomme ce contrat tel quel) :
//   - GET /parametres  (sources annee / cible_insertion / defaut — jamais de
//     valeur inventée)
//   - PUT /parametres  (upsert settings effectifs.convention_<annee>)
//   - GET /grille      (semaines ISO, sections par équipe, quotités signé/
//     présumé, vue réalisée, totaux hebdo + mensuels)
//   - GET /ecarts      (par personne, filtre écart ≠ 0 / ?tous=1)
//   - GET /synthese    (ASP fait foi, écarts convention, besoins recrutement)
//   - POST/DELETE /asp/:annee/:mois (upsert + journal rgpd_audit_log en TX)
//   - GET /export      (.xlsx)
// Habilitations : lecture ADMIN/RH/MANAGER ; écriture ADMIN/RH ; DELETE ASP ADMIN.
//
// Auth réelle (JWT sans `tv`), DB mockée, activity-logger mocké. Même harnais
// que energie-contract.test.js. Déterminisme temporel : la vue réalisée est
// testée sur une année PASSÉE (2024) et « à venir » sur une année FUTURE (2030)
// — le module utilise la date du jour (Paris), jamais figée en dur.
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

const express = require('express');
const request = require('supertest');

const effectifs = require('../../src/routes/effectifs');

const tokenFor = (role) => jwt.sign({ id: 1, username: 'u', role, first_name: 'T', last_name: 'U', mfa: true }, JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER'),
  COLLABORATEUR: tokenFor('COLLABORATEUR'),
};

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/effectifs', effectifs);
});

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockClear();
  mockQuery.mockResolvedValue({ rows: [] });
});

const get = (path, role = 'ADMIN') => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (path, role, body = {}) => request(app).post(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const put = (path, role, body = {}) => request(app).put(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const del = (path, role) => request(app).delete(path).set('Authorization', `Bearer ${TOKENS[role]}`);

/**
 * Installe un mock DB par motif SQL. `settings` est un objet clé→valeur mutable
 * (les upserts PUT /parametres y écrivent, les SELECT suivants le relisent).
 */
function installMocks({ employees = [], contracts = [], leaves = [], settings = {}, asp = [] } = {}) {
  mockQuery.mockImplementation((sql, params) => {
    const s = String(sql);
    if (/FROM employees e/.test(s)) return Promise.resolve({ rows: employees });
    if (/FROM employee_contracts ec/.test(s)) return Promise.resolve({ rows: contracts });
    if (/FROM employee_leaves el/.test(s)) return Promise.resolve({ rows: leaves });
    if (/SELECT value FROM settings WHERE key = \$1/.test(s)) {
      const key = params && params[0];
      return Promise.resolve({ rows: settings[key] != null ? [{ value: settings[key] }] : [] });
    }
    if (/INSERT INTO settings/.test(s)) {
      settings[params[0]] = params[1];
      return Promise.resolve({ rows: [] });
    }
    if (/INSERT INTO etp_asp_mensuel/.test(s)) {
      return Promise.resolve({
        rows: [{
          id: 7, annee: params[0], mois: params[1], etp_asp: params[2],
          commentaire: params[3], saisi_par: params[4], valide_le: '2026-08-05T10:00:00.000Z',
        }],
      });
    }
    if (/DELETE FROM etp_asp_mensuel/.test(s)) {
      return Promise.resolve({ rows: asp.length ? [{ id: 7, etp_asp: asp[0].etp_asp }] : [] });
    }
    if (/FROM etp_asp_mensuel/.test(s)) return Promise.resolve({ rows: asp });
    return Promise.resolve({ rows: [] });
  });
  return settings;
}

// Fixture 2024 (année entièrement passée → réalisé déterministe, 52 semaines ISO).
const EMP_2024 = [{
  id: 11, first_name: 'Marie', last_name: 'Dupont', team_id: 1, team_name: 'Tri',
  insertion_status: 'en_parcours', cddi_derogation_motif: null, pass_iae_end: '2025-06-30',
  fiche_contract_type: 'CDDI', fiche_contract_start: null, fiche_contract_end: null, fiche_weekly_hours: 26,
}, {
  id: 12, first_name: 'Ali', last_name: 'Benali', team_id: 2, team_name: 'Collecte',
  insertion_status: 'en_parcours', cddi_derogation_motif: null, pass_iae_end: null,
  fiche_contract_type: 'CDDI', fiche_contract_start: null, fiche_contract_end: null, fiche_weekly_hours: 35,
}];
const CONTRATS_2024 = [
  { employee_id: 11, contract_type: 'CDDI', start_date: '2024-01-01', end_date: '2024-12-31', official_start_date: '2024-01-01', weekly_hours: 26 },
  { employee_id: 12, contract_type: 'CDDI', start_date: '2024-01-01', end_date: '2024-06-30', official_start_date: '2024-01-01', weekly_hours: 35 },
];

// ───────────────────────────────────────────────────────────────────────────
// HABILITATIONS
// ───────────────────────────────────────────────────────────────────────────
describe('HABILITATIONS', () => {
  it('lecture (grille/parametres/ecarts/synthese) : ADMIN/RH/MANAGER 200, COLLABORATEUR 403', async () => {
    installMocks();
    for (const role of ['ADMIN', 'RH', 'MANAGER']) {
      expect((await get('/api/effectifs/parametres?annee=2026', role)).status).toBe(200);
      expect((await get('/api/effectifs/grille?annee=2026', role)).status).toBe(200);
      expect((await get('/api/effectifs/ecarts?annee=2026', role)).status).toBe(200);
      expect((await get('/api/effectifs/synthese?annee=2026', role)).status).toBe(200);
    }
    for (const path of ['parametres', 'grille', 'ecarts', 'synthese', 'export']) {
      expect((await get(`/api/effectifs/${path}?annee=2026`, 'COLLABORATEUR')).status).toBe(403);
    }
  });

  it('PUT /parametres : MANAGER/COLLABORATEUR 403 ; RH 200', async () => {
    installMocks();
    expect((await put('/api/effectifs/parametres', 'MANAGER', { annee: 2026 })).status).toBe(403);
    expect((await put('/api/effectifs/parametres', 'COLLABORATEUR', { annee: 2026 })).status).toBe(403);
    expect((await put('/api/effectifs/parametres', 'RH', { annee: 2026, etp_conventionnes: 25.17 })).status).toBe(200);
  });

  it('POST /asp : MANAGER 403 ; RH 200 — DELETE /asp : RH 403, ADMIN passe', async () => {
    installMocks({ asp: [{ mois: 1, etp_asp: 24.5 }] });
    expect((await post('/api/effectifs/asp/2026/1', 'MANAGER', { etp_asp: 24.5 })).status).toBe(403);
    expect((await post('/api/effectifs/asp/2026/1', 'RH', { etp_asp: 24.5 })).status).toBe(200);
    expect((await del('/api/effectifs/asp/2026/1', 'RH')).status).toBe(403);
    expect((await del('/api/effectifs/asp/2026/1', 'ADMIN')).status).toBe(200);
  });

  it('sans token → 401', async () => {
    expect((await request(app).get('/api/effectifs/grille')).status).toBe(401);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PARAMÈTRES DE CONVENTION — sources honnêtes
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /effectifs/parametres', () => {
  it('rien de paramétré → tout null + source defaut (jamais de valeur inventée)', async () => {
    installMocks();
    const res = await get('/api/effectifs/parametres?annee=2026', 'RH');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      annee: 2026, etp_conventionnes: null, etp_cdi_inclusion: null,
      heures_annuelles_etp: null, date_debut: null, date_fin: null, source: 'defaut',
    });
  });

  it('clé annuelle paramétrée → source annee, valeurs restituées', async () => {
    installMocks({
      settings: {
        'effectifs.convention_2026': JSON.stringify({
          etp_conventionnes: 25.17, etp_cdi_inclusion: 1, heures_annuelles_etp: 1820,
          date_debut: '2026-01-01', date_fin: '2026-12-31',
        }),
      },
    });
    const res = await get('/api/effectifs/parametres?annee=2026');
    expect(res.body).toEqual({
      annee: 2026, etp_conventionnes: 25.17, etp_cdi_inclusion: 1,
      heures_annuelles_etp: 1820, date_debut: '2026-01-01', date_fin: '2026-12-31', source: 'annee',
    });
  });

  it("repli sur insertion.cible_etp_conventionnes (cohérence AuditInsertion) → source cible_insertion", async () => {
    installMocks({ settings: { 'insertion.cible_etp_conventionnes': '24.76' } });
    const res = await get('/api/effectifs/parametres?annee=2026');
    expect(res.body.etp_conventionnes).toBe(24.76);
    expect(res.body.source).toBe('cible_insertion');
    expect(res.body.heures_annuelles_etp).toBeNull();
  });

  it('PUT upsert + relecture : renvoie l\'objet relu source annee', async () => {
    const settings = installMocks();
    const res = await put('/api/effectifs/parametres', 'ADMIN', {
      annee: 2026, etp_conventionnes: 25.17, etp_cdi_inclusion: 1,
      heures_annuelles_etp: 1820, date_debut: '2026-01-01', date_fin: '2026-12-31',
    });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('annee');
    expect(res.body.etp_conventionnes).toBe(25.17);
    expect(JSON.parse(settings['effectifs.convention_2026']).heures_annuelles_etp).toBe(1820);
  });

  it('PUT validations : annee manquante → 400 ; etp négatif → 400 ; date invalide → 400 ; date_fin < date_debut → 400', async () => {
    installMocks();
    expect((await put('/api/effectifs/parametres', 'RH', {})).status).toBe(400);
    expect((await put('/api/effectifs/parametres', 'RH', { annee: 2026, etp_conventionnes: -3 })).status).toBe(400);
    expect((await put('/api/effectifs/parametres', 'RH', { annee: 2026, date_debut: '01/01/2026' })).status).toBe(400);
    expect((await put('/api/effectifs/parametres', 'RH', { annee: 2026, date_debut: '2026-12-31', date_fin: '2026-01-01' })).status).toBe(400);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GRILLE — forme, semaines ISO, statuts signé/présumé, vue réalisée
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /effectifs/grille', () => {
  it('vue prévisionnelle : semaines ISO (52 en 2024), sections par équipe triées, quotités + statuts, totaux', async () => {
    installMocks({ employees: EMP_2024, contracts: CONTRATS_2024 });
    const res = await get('/api/effectifs/grille?annee=2024&vue=previsionnel');
    expect(res.status).toBe(200);
    expect(res.body.annee).toBe(2024);
    expect(res.body.semaines).toHaveLength(52);
    expect(res.body.semaines[0]).toEqual({ num: 1, lundi: '2024-01-01', mois: 1 });
    expect(res.body).toHaveProperty('convention.source', 'defaut');

    // Sections triées par nom d'équipe (Collecte avant Tri).
    expect(res.body.sections.map((s) => s.team_name)).toEqual(['Collecte', 'Tri']);
    const tri = res.body.sections[1];
    expect(tri.team_id).toBe(1);
    const marie = tri.personnes[0];
    expect(marie.nom).toBe('DUPONT Marie'); // NOM Prénom (règle 2.20.0)
    expect(marie.employee_id).toBe(11);
    expect(marie.pass_iae_end).toBe('2025-06-30');
    expect(marie.fin_dernier_contrat).toBe('2024-12-31');
    expect(marie.quotites).toHaveLength(52);
    // 26 h → 0.74, contrat signé toute l'année.
    expect(marie.quotites[10]).toEqual({ s: 11, q: 0.74, statut: 'signe' });

    // Ali : CDDI 35 h jusqu'au 30/06 puis renouvellement PRÉSUMÉ (en_parcours,
    // borne 1er CDDI + 24 mois) → S30 (jeudi 25/07/2024) présumé, q = 1.
    const collecte = res.body.sections[0];
    const ali = collecte.personnes[0];
    expect(ali.nom).toBe('BENALI Ali');
    const s10 = ali.quotites.find((c) => c.s === 10);
    expect(s10).toEqual({ s: 10, q: 1, statut: 'signe' });
    const s30 = ali.quotites.find((c) => c.s === 30);
    expect(s30).toEqual({ s: 30, q: 1, statut: 'presume' });

    // Totaux : S10 = 0.74 + 1 = 1.74 ; totaux mensuels sur 12 mois.
    const t10 = res.body.totaux.par_semaine.find((t) => t.s === 10);
    expect(t10.etp).toBe(1.74);
    expect(res.body.totaux.par_mois).toHaveLength(12);
    expect(res.body.totaux.par_mois[0]).toEqual({ mois: 1, etp: 1.74 });
    // Totaux de section (même forme [{ s, etp }]).
    expect(tri.totaux_semaine.find((t) => t.s === 10).etp).toBe(0.74);
  });

  it('vue réalisée (année passée) : maladie 3 j ouvrés → ×0.4 ; holiday non déduit ; le présumé ne produit AUCUN réalisé', async () => {
    installMocks({
      employees: EMP_2024,
      contracts: CONTRATS_2024,
      leaves: [
        // Semaine du lundi 2024-03-04 (S10) : maladie mar 05 → jeu 07 = 3 j ouvrés.
        { employee_id: 11, type_category: 'sick', start_date: '2024-03-05', end_date: '2024-03-07' },
        // Congés payés (holiday) : la catégorie est filtrée en SQL — même si des
        // lignes arrivaient, le moteur ne déduit que sick/absence.
      ],
    });
    const res = await get('/api/effectifs/grille?annee=2024&vue=realise');
    expect(res.status).toBe(200);
    expect(res.body.vue).toBe('realise');

    const marie = res.body.sections[1].personnes[0];
    const s10 = marie.quotites.find((c) => c.s === 10);
    // 0.74 × (1 − 3/5) = 0.296 → 0.3
    expect(s10).toEqual({ s: 10, q: 0.3, statut: 'realise' });
    const s11 = marie.quotites.find((c) => c.s === 11);
    expect(s11).toEqual({ s: 11, q: 0.74, statut: 'realise' });

    // Ali S30 est en zone présumée → réalisé null (contrats signés uniquement).
    const ali = res.body.sections[0].personnes[0];
    expect(ali.quotites.find((c) => c.s === 30)).toEqual({ s: 30, q: null, statut: null });
    // S10 signé passé → réalisé plein.
    expect(ali.quotites.find((c) => c.s === 10)).toEqual({ s: 10, q: 1, statut: 'realise' });
  });

  it('vue réalisée (année future) : q null + statut a_venir sur les semaines couvertes', async () => {
    installMocks({
      employees: [{ ...EMP_2024[0], pass_iae_end: null, insertion_status: 'en_parcours' }],
      contracts: [{ employee_id: 11, contract_type: 'CDDI', start_date: '2030-01-01', end_date: '2030-12-31', official_start_date: '2030-01-01', weekly_hours: 26 }],
    });
    const res = await get('/api/effectifs/grille?annee=2030&vue=realise');
    const marie = res.body.sections[0].personnes[0];
    expect(marie.quotites.every((c) => c.q === null)).toBe(true);
    expect(marie.quotites.find((c) => c.s === 5).statut).toBe('a_venir');
    // Totaux réalisés d'une semaine non écoulée → null (jamais 0 inventé).
    expect(res.body.totaux.par_semaine.find((t) => t.s === 5).etp).toBeNull();
    expect(res.body.totaux.par_mois[0].etp).toBeNull();
  });

  it('un CDI ordinaire hors insertion n\'entre jamais dans la grille', async () => {
    installMocks({
      employees: [{
        id: 20, first_name: 'Jean', last_name: 'Martin', team_id: 1, team_name: 'Tri',
        insertion_status: 'none', cddi_derogation_motif: null, pass_iae_end: null,
        fiche_contract_type: 'CDI', fiche_contract_start: '2024-01-01', fiche_contract_end: null, fiche_weekly_hours: 35,
      }],
      contracts: [{ employee_id: 20, contract_type: 'CDI', start_date: '2024-01-01', end_date: null, official_start_date: '2024-01-01', weekly_hours: 35 }],
    });
    const res = await get('/api/effectifs/grille?annee=2024');
    expect(res.body.sections).toEqual([]);
  });

  it('données héritées : un CDD porté par un salarié en parcours est requalifié CDDI (grille non vide)', async () => {
    // Base non réimportée depuis 2.20.0 : l'ancien import stockait le type brut
    // Malibou « CDD » — sans requalification de lecture, la grille sortait vide.
    installMocks({
      employees: [{
        id: 30, first_name: 'Fatou', last_name: 'Cisse', team_id: 1, team_name: 'Tri',
        insertion_status: 'en_parcours', cddi_derogation_motif: null,
        pass_iae_end: '2024-12-31',
        fiche_contract_type: 'CDD', fiche_contract_start: null, fiche_contract_end: null, fiche_weekly_hours: 26,
      }],
      contracts: [{ employee_id: 30, contract_type: 'CDD', start_date: '2024-01-01', end_date: '2024-06-30', official_start_date: '2024-01-01', weekly_hours: 26 }],
    });
    const res = await get('/api/effectifs/grille?annee=2024');
    expect(res.body.sections).toHaveLength(1);
    const fatou = res.body.sections[0].personnes[0];
    expect(fatou.nom).toBe('CISSE Fatou');
    // S10 (jeudi 07/03/2024) couverte par le CDD requalifié → 26 h = 0.74 signé.
    expect(fatou.quotites.find((c) => c.s === 10)).toEqual({ s: 10, q: 0.74, statut: 'signe' });
    // Renouvellement présumé après le 30/06 (en_parcours, borne pass IAE 31/12) :
    // le CDD hérité alimente aussi la borne « 1er CDDI + 24 mois ».
    expect(fatou.quotites.find((c) => c.s === 30)).toEqual({ s: 30, q: 0.74, statut: 'presume' });
  });

  it('données héritées : un CDD d\'un parcours CLÔTURÉ (termine) apparaît dans la grille historique, sans présomption', async () => {
    // Revue Codex PR#87 : la sélection SQL des salariés reflète hasParcours()
    // (tout insertion_status ≠ none, y compris termine/abandon) — sinon les
    // parcours passés en CDD hérité disparaissaient des grilles historiques.
    installMocks({
      employees: [{
        id: 31, first_name: 'Dany', last_name: 'Pean', team_id: 1, team_name: 'Tri',
        insertion_status: 'termine', cddi_derogation_motif: null, pass_iae_end: null,
        fiche_contract_type: 'CDD', fiche_contract_start: null, fiche_contract_end: null, fiche_weekly_hours: 26,
      }],
      contracts: [{ employee_id: 31, contract_type: 'CDD', start_date: '2024-01-01', end_date: '2024-06-30', official_start_date: '2024-01-01', weekly_hours: 26 }],
    });
    const res = await get('/api/effectifs/grille?annee=2024');
    expect(res.body.sections).toHaveLength(1);
    const dany = res.body.sections[0].personnes[0];
    expect(dany.quotites.find((c) => c.s === 10)).toEqual({ s: 10, q: 0.74, statut: 'signe' });
    // Parcours clôturé → jamais de renouvellement présumé après la fin du contrat.
    expect(dany.quotites.find((c) => c.s === 30)).toEqual({ s: 30, q: null, statut: null });
  });

  it('validation : vue inconnue → 400 ; annee hors bornes → 400', async () => {
    installMocks();
    expect((await get('/api/effectifs/grille?annee=2026&vue=mensuelle')).status).toBe(400);
    expect((await get('/api/effectifs/grille?annee=1990')).status).toBe(400);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ÉCARTS
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /effectifs/ecarts', () => {
  it('tableau par personne, seules les personnes avec écart ≠ 0 (sauf ?tous=1)', async () => {
    installMocks({
      employees: EMP_2024,
      contracts: CONTRATS_2024,
      leaves: [{ employee_id: 11, type_category: 'sick', start_date: '2024-03-05', end_date: '2024-03-07' }],
    });
    const res = await get('/api/effectifs/ecarts?annee=2024');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Marie a un écart (maladie en mars) ; Ali n'en a pas → filtré.
    expect(res.body.map((p) => p.employee_id)).toEqual([11]);
    const mars = res.body[0].mois.find((m) => m.mois === 3);
    expect(mars.jours_absence).toBe(3);
    expect(mars.previsionnel).toBe(0.74);
    // 4 semaines rattachées à mars 2024 (S10 réalisée 0.3) : (0.3 + 3×0.74)/4 = 0.63
    expect(mars.realise).toBe(0.63);
    expect(mars.ecart).toBe(-0.11);
    expect(res.body[0]).toHaveProperty('nom', 'DUPONT Marie');
    expect(res.body[0]).toHaveProperty('team_name', 'Tri');
    expect(res.body[0].mois).toHaveLength(12);

    const resTous = await get('/api/effectifs/ecarts?annee=2024&tous=1');
    expect(resTous.body.map((p) => p.employee_id).sort()).toEqual([11, 12]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SYNTHÈSE — l'ASP validé FAIT FOI
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /effectifs/synthese', () => {
  it('12 mois, écarts convention prév./ASP, statut ASP, besoins de recrutement', async () => {
    installMocks({
      employees: EMP_2024,
      contracts: CONTRATS_2024,
      settings: {
        'effectifs.convention_2024': JSON.stringify({
          etp_conventionnes: 25.17, etp_cdi_inclusion: 1, heures_annuelles_etp: 1820,
          date_debut: '2024-01-01', date_fin: '2024-12-31',
        }),
      },
      asp: [{ mois: 1, etp_asp: '24.50', commentaire: 'État ASP janvier', valide_le: '2024-02-10T09:00:00.000Z', valide_first_name: 'Claire', valide_last_name: 'Cip' }],
    });
    const res = await get('/api/effectifs/synthese?annee=2024');
    expect(res.status).toBe(200);
    expect(res.body.mois).toHaveLength(12);
    expect(res.body.convention.etp_conventionnes).toBe(25.17);

    const janv = res.body.mois[0];
    expect(janv.mois).toBe(1);
    expect(janv.etp_previsionnel).toBe(1.74); // 0.74 + 1 toutes les semaines de janvier
    expect(janv.etp_realise).toBe(1.74); // année passée, aucune absence
    expect(janv.etp_asp).toBe(24.5);
    expect(janv.asp_statut).toBe('valide');
    expect(janv.asp_valide_par).toBe('CIP Claire');
    expect(janv.asp_commentaire).toBe('État ASP janvier');
    // L'ASP fait foi : écart convention lu sur l'ASP (24.5 − 25.17 = −0.67).
    expect(janv.ecart_convention_asp).toBe(-0.67);
    expect(janv.ecart_convention_prev).toBe(engineRound2(1.74 - 25.17));
    expect(janv.taux_realisation).toBe(1);

    const fev = res.body.mois[1];
    expect(fev.etp_asp).toBeNull();
    expect(fev.asp_statut).toBeNull();
    expect(fev.ecart_convention_asp).toBeNull();

    // Besoins de recrutement : max(0, 25.17 − prévisionnel).
    const besoinJanv = res.body.besoins_recrutement.find((b) => b.mois === 1);
    expect(besoinJanv.etp_manquants).toBe(engineRound2(25.17 - 1.74));
  });

  it('convention non paramétrée → écarts convention et besoins null (jamais inventés)', async () => {
    installMocks({ employees: EMP_2024, contracts: CONTRATS_2024 });
    const res = await get('/api/effectifs/synthese?annee=2024');
    expect(res.body.mois[0].ecart_convention_prev).toBeNull();
    expect(res.body.besoins_recrutement.every((b) => b.etp_manquants === null)).toBe(true);
  });

  function engineRound2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }
});

// ───────────────────────────────────────────────────────────────────────────
// VALIDATION ASP — upsert + journal rgpd_audit_log en transaction
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /effectifs/asp', () => {
  it('POST : upsert horodaté, renvoie la ligne, JOURNALISE dans rgpd_audit_log dans la transaction', async () => {
    installMocks();
    const res = await post('/api/effectifs/asp/2026/3', 'RH', { etp_asp: 24.85, commentaire: 'État ASP mars' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ annee: 2026, mois: 3, etp_asp: 24.85 });
    expect(res.body).toHaveProperty('valide_le');

    const calls = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(calls.some((s) => /^BEGIN$/.test(s))).toBe(true);
    expect(calls.some((s) => /INSERT INTO etp_asp_mensuel/.test(s))).toBe(true);
    const auditIdx = calls.findIndex((s) => /INSERT INTO rgpd_audit_log/.test(s));
    expect(auditIdx).toBeGreaterThan(-1);
    const auditParams = mockQuery.mock.calls[auditIdx][1];
    expect(auditParams[1]).toBe('ETP_ASP_VALIDATION');
    expect(auditParams[2]).toBe('etp_asp_mensuel');
    expect(JSON.parse(auditParams[4])).toMatchObject({ annee: 2026, mois: 3, etp_asp: 24.85 });
    expect(calls.some((s) => /^COMMIT$/.test(s))).toBe(true);
  });

  it('POST validations : etp_asp manquant/négatif → 400 ; mois 13 → 400 ; annee invalide → 400', async () => {
    installMocks();
    expect((await post('/api/effectifs/asp/2026/1', 'RH', {})).status).toBe(400);
    expect((await post('/api/effectifs/asp/2026/1', 'RH', { etp_asp: -2 })).status).toBe(400);
    expect((await post('/api/effectifs/asp/2026/13', 'RH', { etp_asp: 24 })).status).toBe(400);
    expect((await post('/api/effectifs/asp/1990/1', 'RH', { etp_asp: 24 })).status).toBe(400);
  });

  it('DELETE : efface + journalise (ADMIN) ; mois sans validation → 404', async () => {
    installMocks({ asp: [{ mois: 1, etp_asp: 24.5 }] });
    const res = await del('/api/effectifs/asp/2026/1', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, annee: 2026, mois: 1 });
    const calls = mockQuery.mock.calls.map((c) => String(c[0]));
    const auditIdx = calls.findIndex((s) => /INSERT INTO rgpd_audit_log/.test(s));
    expect(mockQuery.mock.calls[auditIdx][1][1]).toBe('ETP_ASP_SUPPRESSION');

    installMocks({ asp: [] });
    expect((await del('/api/effectifs/asp/2026/2', 'ADMIN')).status).toBe(404);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// EXPORT XLSX
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /effectifs/export', () => {
  it('renvoie un classeur .xlsx (Content-Type + Content-Disposition)', async () => {
    installMocks({ employees: EMP_2024, contracts: CONTRATS_2024 });
    const res = await get('/api/effectifs/export?annee=2024', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('effectifs_etp_2024.xlsx');
  });
});
