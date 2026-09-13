// ═══════════════════════════════════════════════════════════════════════════
// CONTRAT — CADRE RSA, STRUCTURE D'ACCUEIL (PR B, lot 3)
// ───────────────────────────────────────────────────────────────────────────
// `pg` est simulé : on exerce les VRAIS handlers Express à travers le vrai
// routeur monté (`src/routes/insertion`), et on inspecte ce qui sort et ce qui
// est écrit.
//
// Ce que ces tests tiennent :
//   1. HABILITATION — un MANAGER est refusé en 403 **AVANT toute requête** :
//      `pool.query` n'est pas appelé une seule fois. Un refus posé après la
//      lecture serait un refus d'affichage, pas un refus d'accès (doctrine
//      2.51.0).
//   2. RÉFÉRENT NON DÉTERMINÉ → 409 `REFERENT_NON_DETERMINE`, à l'aperçu comme
//      à la génération : un document sans destinataire n'existe pas, et rien
//      n'est composé ni enregistré.
//   3. LISTE BLANCHE — la fiche enregistrée porte neuf clés, sans santé ni
//      judiciaire, et le SNAPSHOT est bien ce qui est écrit en base.
//   4. « SANS RELEVÉ » ≠ « 0 H » de bout en bout, à travers l'API.
//   5. ACTUALISATION FRANCE TRAVAIL — douze mois rendus, les mois sans ligne à
//      `null` et jamais à `false` ; refus 409 pour une personne non soumise.
//   6. JOURNALISATION — chaque geste laisse une trace, et la trace ne porte
//      jamais le contenu du document.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

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
const put = (p, role, body = {}) => request(app).put(p).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);

const EMP = {
  id: 5, first_name: 'Amine', last_name: 'BENALI', malibou_id: 'M-0912', weekly_hours: 26,
  parcours_num: 1, pass_iae_number: '2026-03-0441', pass_iae_start: '2026-03-01',
  pass_iae_end: '2028-02-29', pass_iae_statut: 'actif',
  referent_unique_type: 'cms', referent_unique_nom: 'Mme L. (CMS Elbeuf)', referent_unique_contact: '02 35 00 00 00',
  insertion_start_date: '2026-03-01', insertion_end_date: null,
  contract_type: 'CDD', contrat_debut: '2026-03-01', contrat_fin: '2026-09-30', contrat_heures: 26,
  cip_nom: 'Claire MARTIN', cip_email: 'claire.martin@solidarite-textiles.fr',
};

/** Aiguillage du faux `pg`. Chaque source a sa réponse ; `over` en surcharge une. */
function branche(over = {}) {
  mockQuery.mockImplementation((sql, params) => {
    const s = String(sql);
    if (/INSERT INTO rgpd_audit_log/.test(s)) return Promise.resolve({ rows: [] });
    if (/SELECT id FROM employees WHERE id/.test(s)) return Promise.resolve({ rows: over.existe ?? [{ id: 5 }] });
    // La requête de SOUMISSION est testée AVANT celle du référent : les deux
    // projettent `referent_unique_type`, seule la seconde est plus spécifique.
    if (/COALESCE\(actualisation_ft_requise, false\) AS requise/.test(s)) {
      return Promise.resolve({ rows: over.soumission ?? [{ type: 'france_travail', requise: true }] });
    }
    if (/COALESCE\(referent_unique_type, 'non_determine'\) AS type/.test(s)) {
      return Promise.resolve({ rows: over.referent ?? [{ id: 5, type: 'cms', referent_unique_nom: 'Mme L.' }] });
    }
    if (/SELECT COALESCE\(parcours_num, 1\) AS n/.test(s)) return Promise.resolve({ rows: [{ n: 1 }] });
    if (/FROM employees e\s+LEFT JOIN employee_contracts/.test(s)) return Promise.resolve({ rows: over.employees ?? [EMP] });
    if (/INSERT INTO insertion_alimentations_referent/.test(s)) {
      return Promise.resolve({ rows: [{ id: 42, genere_le: '2026-06-30T10:00:00Z' }] });
    }
    if (/FROM insertion_alimentations_referent/.test(s)) return Promise.resolve({ rows: over.alimentations ?? [] });
    if (/UPDATE insertion_alimentations_referent/.test(s)) return Promise.resolve({ rows: over.remise ?? [{ id: 42, remis_referent_le: '2026-06-30', remis_referent_mode: 'mail', remis_salarie_le: null }] });
    if (/INSERT INTO insertion_actualisations_ft/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM insertion_actualisations_ft/.test(s)) return Promise.resolve({ rows: over.actualisations ?? [] });
    if (/UPDATE employees e SET/.test(s)) return Promise.resolve({ rows: [] });
    if (/absence_motif/.test(s)) return Promise.resolve({ rows: over.entretiens ?? [] });
    if (/frein_mobilite/.test(s)) return Promise.resolve({ rows: over.freins ?? [] });
    if (/FROM insertion_milestones/.test(s)) return Promise.resolve({ rows: over.prochains ?? [] });
    if (/FROM cip_action_plans/.test(s)) return Promise.resolve({ rows: over.actions ?? [] });
    if (/FROM insertion_objectifs/.test(s)) return Promise.resolve({ rows: over.objectifs ?? [] });
    if (/FROM employee_leaves/.test(s)) return Promise.resolve({ rows: over.conges ?? [] });
    if (/FROM employee_week_hours/.test(s)) return Promise.resolve({ rows: over.weekHours ?? [] });
    if (/FROM insertion_pmsmp/.test(s)) return Promise.resolve({ rows: over.pmsmp ?? [] });
    if (/FROM settings/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  branche();
});

const journaux = () => mockQuery.mock.calls.filter(([sql]) => /INSERT INTO rgpd_audit_log/.test(String(sql)));
const journalPour = (action) => journaux().find(([, p]) => p && p[1] === action);

// ───────────────────────────────────────────────────────────────────────────
describe('1. habilitations — refus AVANT toute requête', () => {
  const routes = [
    ['get', '/api/insertion/rsa/5/activite'],
    ['get', '/api/insertion/rsa/5/assiduite'],
    ['get', '/api/insertion/rsa/5/fiche-referent'],
    ['get', '/api/insertion/rsa/5/alimentations'],
    ['get', '/api/insertion/rsa/5/actualisations-ft'],
    ['get', '/api/insertion/rsa/echeances-periodiques'],
  ];

  test.each(routes)('MANAGER refusé en 403 sur %s %s', async (verbe, chemin) => {
    const res = await (verbe === 'get' ? get(chemin, 'MANAGER') : post(chemin, 'MANAGER'));
    expect(res.status).toBe(403);
    // LE point du test : la base n'a pas été touchée. Un refus après lecture
    // serait un refus d'affichage, pas un refus d'accès.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('MANAGER refusé aussi en écriture, sans aucune requête', async () => {
    const res = await post('/api/insertion/rsa/5/fiche-referent', 'MANAGER', { moment: 'entree' });
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('ADMIN et RH passent', async () => {
    for (const role of ['ADMIN', 'RH']) {
      mockQuery.mockClear();
      const res = await get('/api/insertion/rsa/5/activite', role);
      expect(res.status).toBe(200);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('2. compteur d’activité', () => {
  test('« sans relevé » ≠ « 0 h », jusque dans la réponse HTTP', async () => {
    branche({ weekHours: [{ iso_year: 2026, iso_week: 10, hours_worked: 26, hours_contract: 26 }] });
    const res = await get('/api/insertion/rsa/5/activite?annee=2026');
    expect(res.status).toBe(200);
    const s11 = res.body.semaines.find((s) => s.iso_week === 11);
    expect(s11.sans_releve).toBe(true);
    expect(s11.heures_travail).toBeNull();
    expect(s11.total_heures).toBeNull();
    expect(s11.sous_seuil).toBeNull();
    expect(res.body.nb_semaines_sous_seuil).toBe(0);
  });

  test('l’alerte ne se lève pas pendant un arrêt déclaré', async () => {
    branche({
      weekHours: [
        { iso_year: 2026, iso_week: 10, hours_worked: 6, hours_contract: 26 },
        { iso_year: 2026, iso_week: 11, hours_worked: 6, hours_contract: 26 },
      ],
      conges: [{ type_category: 'sick', start_date: '2026-03-02', end_date: '2026-03-13' }],
    });
    const res = await get('/api/insertion/rsa/5/activite?annee=2026');
    expect(res.body.alerte.active).toBe(false);
    // … mais les semaines sont comptées (indicateur de volume, amendement A4).
    expect(res.body.nb_semaines_sous_seuil).toBe(2);
    // `iso_year` accompagne chaque raison depuis le correctif m-01 : la fiche
    // pour le référent apparie les raisons aux semaines sur le COUPLE
    // (année, semaine), une période à cheval sur deux années civiles ayant
    // sinon recopié la raison de la S3 2025 sur la S3 2026.
    expect(res.body.raisons).toEqual([
      { iso_year: 2026, iso_week: 10, categorie: 'arret' },
      { iso_year: 2026, iso_week: 11, categorie: 'arret' },
    ]);
  });

  test('sans arrêt, deux semaines consécutives lèvent l’alerte', async () => {
    branche({
      weekHours: [
        { iso_year: 2026, iso_week: 10, hours_worked: 6, hours_contract: 26 },
        { iso_year: 2026, iso_week: 11, hours_worked: 6, hours_contract: 26 },
      ],
    });
    const res = await get('/api/insertion/rsa/5/activite?annee=2026');
    expect(res.body.alerte).toEqual({ active: true, depuis_semaine: 10 });
  });

  test('salarié inconnu → 404', async () => {
    branche({ existe: [] });
    expect((await get('/api/insertion/rsa/9999/activite')).status).toBe(404);
  });

  test('consultation journalisée, sans le détail des semaines', async () => {
    await get('/api/insertion/rsa/5/activite?annee=2026');
    const j = journalPour('INSERTION_ACTIVITE_CONSULTATION');
    expect(j).toBeDefined();
    expect(j[1][2]).toBe('insertion_rsa');
    const details = JSON.parse(j[1][4]);
    expect(details).toEqual({ employee_id: 5, annee: 2026, nb_semaines_sous_seuil: 0 });
    expect(JSON.stringify(details)).not.toMatch(/heures_travail/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('3. fiche pour le référent', () => {
  test('référent non déterminé → 409 REFERENT_NON_DETERMINE, RIEN n’est composé', async () => {
    branche({ referent: [{ id: 5, type: 'non_determine', referent_unique_nom: null }] });
    const res = await get('/api/insertion/rsa/5/fiche-referent');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REFERENT_NON_DETERMINE');
    expect(res.body.hint).toMatch(/Dossier administratif/);
    // Aucune donnée du dossier n'a été lue pour un document qui ne partira nulle part.
    const lectures = mockQuery.mock.calls.map(([s]) => String(s));
    expect(lectures.some((s) => /FROM employees e\s+LEFT JOIN employee_contracts/.test(s))).toBe(false);
  });

  test('référent non déterminé → 409 AUSSI à la génération, sans écriture', async () => {
    branche({ referent: [{ id: 5, type: 'non_determine', referent_unique_nom: null }] });
    const res = await post('/api/insertion/rsa/5/fiche-referent', 'ADMIN', { moment: 'entree' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REFERENT_NON_DETERMINE');
    const ecritures = mockQuery.mock.calls.map(([s]) => String(s));
    expect(ecritures.some((s) => /INSERT INTO insertion_alimentations_referent/.test(s))).toBe(false);
  });

  test('aperçu : neuf clés, aucune écriture, journalisé', async () => {
    const res = await get('/api/insertion/rsa/5/fiche-referent?du=2026-03-01&au=2026-06-30');
    expect(res.status).toBe(200);
    expect(res.body.apercu).toBe(true);
    expect(Object.keys(res.body.contenu).sort()).toEqual([
      'actions', 'activite', 'assiduite', 'freins', 'identite', 'mentions',
      'objectifs', 'prochaines_echeances', 'situation_emploi',
    ]);
    const ecritures = mockQuery.mock.calls.map(([s]) => String(s));
    expect(ecritures.some((s) => /INSERT INTO insertion_alimentations_referent/.test(s))).toBe(false);
    expect(journalPour('INSERTION_FICHE_REFERENT_APERCU')).toBeDefined();
  });

  test('moment invalide → 400 avant toute lecture du dossier', async () => {
    const res = await post('/api/insertion/rsa/5/fiche-referent', 'ADMIN', { moment: 'quand_je_veux' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Moment invalide/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('période incohérente → 400', async () => {
    const res = await post('/api/insertion/rsa/5/fiche-referent', 'ADMIN', { moment: 'entree', du: '2026-06-30', au: '2026-03-01' });
    expect(res.status).toBe(400);
  });

  test('génération : 201, snapshot écrit en base, destinataire RECOPIÉ', async () => {
    const res = await post('/api/insertion/rsa/5/fiche-referent', 'ADMIN', {
      moment: 'renouvellement', du: '2026-03-01', au: '2026-06-30',
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(42);

    const ins = mockQuery.mock.calls.find(([s]) => /INSERT INTO insertion_alimentations_referent/.test(String(s)));
    expect(ins).toBeDefined();
    const [, params] = ins;
    expect(params[0]).toBe(5);            // employee_id
    expect(params[2]).toBe('renouvellement'); // moment
    expect(params[3]).toBe('2026-03-01');
    expect(params[4]).toBe('2026-06-30');
    expect(params[5]).toBe('cms');        // destinataire_type recopié à la génération
    // Le snapshot est bien le CONTENU rendu, pas une référence à recalculer.
    const snapshot = JSON.parse(params[7]);
    expect(Object.keys(snapshot).sort()).toEqual(Object.keys(res.body.contenu).sort());
  });

  test('le snapshot ne porte ni frein santé ni frein judiciaire', async () => {
    branche({
      freins: [{
        completed_date: '2026-04-10', frein_mobilite: 4, frein_logement: 5,
        frein_sante: 5, frein_judiciaire: 4,
      }],
    });
    await post('/api/insertion/rsa/5/fiche-referent', 'ADMIN', { moment: 'entree' });
    const ins = mockQuery.mock.calls.find(([s]) => /INSERT INTO insertion_alimentations_referent/.test(String(s)));
    const brut = ins[1][7];
    expect(brut).not.toMatch(/judiciaire/i);
    const snapshot = JSON.parse(brut);
    expect(snapshot.freins.map((f) => f.axe)).not.toContain('sante');
  });

  test('génération journalisée — la trace dit QUOI, jamais ce que la fiche raconte', async () => {
    await post('/api/insertion/rsa/5/fiche-referent', 'ADMIN', { moment: 'sortie', du: '2026-03-01', au: '2026-06-30' });
    const j = journalPour('INSERTION_FICHE_REFERENT_GENERATION');
    expect(j).toBeDefined();
    const details = JSON.parse(j[1][4]);
    expect(details).toEqual({
      employee_id: 5, alimentation_id: 42, moment: 'sortie',
      du: '2026-03-01', au: '2026-06-30', destinataire_type: 'cms',
    });
    expect(JSON.stringify(details)).not.toMatch(/BENALI|Amine|frein/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('4. historique des fiches et trace de remise', () => {
  test('la LISTE ne renvoie jamais le contenu', async () => {
    branche({ alimentations: [{ id: 42, moment: 'entree', genere_le: '2026-06-30T10:00:00Z' }] });
    const res = await get('/api/insertion/rsa/5/alimentations');
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls.map(([s]) => String(s)).find((s) => /FROM insertion_alimentations_referent/.test(s));
    expect(sql).not.toMatch(/a\.contenu/);
  });

  test('la consultation d’une fiche enregistrée est journalisée', async () => {
    branche({ alimentations: [{ id: 42, moment: 'entree', contenu: { identite: {} } }] });
    const res = await get('/api/insertion/rsa/5/alimentations/42');
    expect(res.status).toBe(200);
    expect(journalPour('INSERTION_FICHE_REFERENT_CONSULTATION')).toBeDefined();
  });

  test('fiche inconnue → 404', async () => {
    branche({ alimentations: [] });
    expect((await get('/api/insertion/rsa/5/alimentations/999')).status).toBe(404);
  });

  test('remise : date FUTURE refusée en 400 (une intention n’est pas une remise)', async () => {
    const futur = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const res = await put('/api/insertion/rsa/5/alimentations/42/remise', 'ADMIN', { remis_referent_le: futur });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/date future/);
    const ecritures = mockQuery.mock.calls.map(([s]) => String(s));
    expect(ecritures.some((s) => /UPDATE insertion_alimentations_referent/.test(s))).toBe(false);
  });

  test('remise : mode hors liste refusé', async () => {
    const res = await put('/api/insertion/rsa/5/alimentations/42/remise', 'ADMIN', { remis_referent_mode: 'pigeon' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Mode de remise invalide/);
  });

  test('remise : champs partiels acceptés et journalisés', async () => {
    const res = await put('/api/insertion/rsa/5/alimentations/42/remise', 'ADMIN', {
      remis_referent_le: '2026-06-30', remis_referent_mode: 'mail',
    });
    expect(res.status).toBe(200);
    const j = journalPour('INSERTION_FICHE_REFERENT_REMISE');
    expect(j).toBeDefined();
    expect(JSON.parse(j[1][4])).toMatchObject({ alimentation_id: 42, referent: true, salarie: false });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('5. actualisation France Travail', () => {
  test('douze mois rendus ; un mois sans ligne est null PARTOUT, jamais false', async () => {
    branche({ actualisations: [{ mois: '2026-03-01', rappel_le: '2026-03-05', honoree: true, constat_le: '2026-03-08' }] });
    const res = await get('/api/insertion/rsa/5/actualisations-ft?annee=2026');
    expect(res.status).toBe(200);
    expect(res.body.mois).toHaveLength(12);
    expect(res.body.mois[2]).toEqual({ mois: '2026-03', rappel_le: '2026-03-05', honoree: true, constat_le: '2026-03-08' });
    // C'est LA règle de cette table : un « non honorée » déduit du silence
    // accuserait la personne d'un manquement que personne n'a constaté.
    expect(res.body.mois[3]).toEqual({ mois: '2026-04', rappel_le: null, honoree: null, constat_le: null });
  });

  // CORRECTIF D-01 (bloquant) — le pilote rend une colonne `DATE` sous forme
  // d'OBJET `Date`, pas de chaîne. Le rangement par
  // `Number(String(l.mois).slice(5, 7))` valait donc NaN et AUCUN des douze
  // mois ne retrouvait sa ligne : l'écran restait vide quoi qu'on enregistre.
  // Ce test rejoue la forme réelle du pilote (objets `Date`), que le `pg`
  // simulé des autres tests ne produit pas — c'est précisément ce qui avait
  // laissé passer le défaut.
  test('D-01 — les lignes sont retrouvées même rendues en objets Date par le pilote', async () => {
    branche({
      actualisations: [{
        mois_num: 3,
        mois: new Date(2026, 2, 1),
        rappel_le: new Date(2026, 2, 5),
        honoree: true,
        constat_le: new Date(2026, 2, 8),
      }],
    });
    const res = await get('/api/insertion/rsa/5/actualisations-ft?annee=2026');
    expect(res.body.mois[2]).toEqual({ mois: '2026-03', rappel_le: '2026-03-05', honoree: true, constat_le: '2026-03-08' });
    expect(res.body.mois.filter((m) => m.honoree === true)).toHaveLength(1);
  });

  test('D-01 — sans `mois_num`, le repli du helper partagé range quand même la ligne', async () => {
    branche({ actualisations: [{ mois: new Date(2026, 6, 1), rappel_le: null, honoree: false, constat_le: null }] });
    const res = await get('/api/insertion/rsa/5/actualisations-ft?annee=2026');
    expect(res.body.mois[6]).toEqual({ mois: '2026-07', rappel_le: null, honoree: false, constat_le: null });
  });

  test('personne non soumise → 409 ACTUALISATION_FT_NON_REQUISE, aucune écriture', async () => {
    branche({ soumission: [{ type: 'cms', requise: false }] });
    const res = await put('/api/insertion/rsa/5/actualisations-ft/2026-04', 'ADMIN', { honoree: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ACTUALISATION_FT_NON_REQUISE');
    const ecritures = mockQuery.mock.calls.map(([s]) => String(s));
    expect(ecritures.some((s) => /INSERT INTO insertion_actualisations_ft/.test(s))).toBe(false);
  });

  test('référent CMS mais actualisation explicitement requise → accepté', async () => {
    branche({ soumission: [{ type: 'cms', requise: true }] });
    const res = await put('/api/insertion/rsa/5/actualisations-ft/2026-04', 'ADMIN', { honoree: false });
    expect(res.status).toBe(200);
  });

  test('mois mal formé → 400 avant toute lecture', async () => {
    const res = await put('/api/insertion/rsa/5/actualisations-ft/avril', 'ADMIN', { honoree: true });
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('valeur de « honoree » hors oui/non/vide → 400', async () => {
    const res = await put('/api/insertion/rsa/5/actualisations-ft/2026-04', 'ADMIN', { honoree: 'peut-être' });
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('les deux colonnes de synthèse d’`employees` sont recalculées, jamais incrémentées', async () => {
    await put('/api/insertion/rsa/5/actualisations-ft/2026-04', 'ADMIN', { honoree: false, constat_le: '2026-04-20' });
    const maj = mockQuery.mock.calls.find(([s]) => /UPDATE employees e SET/.test(String(s)));
    expect(maj).toBeDefined();
    expect(String(maj[0])).toMatch(/MAX\(mois\) FILTER \(WHERE honoree = true\)/);
    expect(String(maj[0])).toMatch(/COUNT\(\*\) FILTER \(WHERE honoree = false\)/);
  });

  test('écriture journalisée, avec les NOMS des champs et non leurs valeurs', async () => {
    await put('/api/insertion/rsa/5/actualisations-ft/2026-04', 'ADMIN', { rappel_le: '2026-04-03', honoree: true });
    const j = journalPour('INSERTION_ACTUALISATION_FT_MAJ');
    expect(j).toBeDefined();
    const details = JSON.parse(j[1][4]);
    expect(details.mois).toBe('2026-04');
    expect(details.champs.sort()).toEqual(['honoree', 'rappel_le']);
    expect(JSON.stringify(details)).not.toMatch(/2026-04-03/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('6. relevé d’assiduité par l’API', () => {
  test('variante tiers par défaut, journalisée', async () => {
    const res = await get('/api/insertion/rsa/5/assiduite?du=2026-03-01&au=2026-06-30');
    expect(res.status).toBe(200);
    expect(res.body.variante).toBe('tiers');
    const j = journalPour('INSERTION_ASSIDUITE_CONSULTATION');
    expect(JSON.parse(j[1][4])).toMatchObject({ du: '2026-03-01', au: '2026-06-30', variante: 'tiers' });
  });

  test('la variante dossier se demande EXPLICITEMENT', async () => {
    const res = await get('/api/insertion/rsa/5/assiduite?variante=dossier');
    expect(res.body.variante).toBe('dossier');
  });

  test('une absence sans motif ressort « sans_motif » — jamais « injustifiée »', async () => {
    branche({
      entretiens: [{ id: 3, milestone_type: 'bilan_intermediaire', status: 'realise', completed_date: '2026-05-10', presence: 'absent', absence_motif: null }],
    });
    const res = await get('/api/insertion/rsa/5/assiduite?du=2026-03-01&au=2026-06-30');
    expect(res.body.totaux.sans_motif).toBe(1);
    expect(JSON.stringify(res.body)).not.toMatch(/injustifi/i);
  });

  test('période incohérente → 400', async () => {
    const res = await get('/api/insertion/rsa/5/assiduite?du=2026-06-30&au=2026-03-01');
    expect(res.status).toBe(400);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('7. échéances périodiques (bloc « Rendez-vous réguliers et rappels »)', () => {
  test('la forme attendue par l’écran est complète, même sur une base vide', async () => {
    const res = await get('/api/insertion/rsa/echeances-periodiques');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'actualisations_ft_du_mois', 'dtr', 'periodicite_point_referent_mois',
      'points_referent_dus', 'referents_non_determines', 'semaines_sous_seuil',
    ]);
    expect(res.body.semaines_sous_seuil).toEqual({ nb_salaries: 0, employes: [] });
  });

  // CORRECTIF D-03 — la sentinelle '1900-01-01' a disparu du SQL : `GREATEST`
  // de PostgreSQL ignore les NULL et n'en rend un que si les deux membres le
  // sont. La reconnaître côté JS supposait de comparer `String(uneDate)` à une
  // chaîne, ce que le pilote rendait impossible (« Mon Jan 01 » > '1900-01-01'
  // est VRAI en ASCII) : la branche « jamais de contact tracé » était morte et
  // l'écran affichait « dernier contact il y a null j ».
  test('un dossier sans AUCUN contact rend `dernier_le: null` (jamais un nombre de jours absurde)', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/points_referent|remis_referent_le\)/.test(s) && /GREATEST/.test(s)) {
        return Promise.resolve({ rows: [{ employee_id: 8, first_name: 'Sonia', last_name: 'REY', dernier_le: null }] });
      }
      if (/FROM settings/.test(s)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/rsa/echeances-periodiques');
    expect(res.body.points_referent_dus).toEqual([
      { employee_id: 8, nom: 'REY Sonia', dernier_le: null, du_depuis_jours: null },
    ]);
  });

  test('la requête ne porte PLUS de sentinelle de date (D-03)', async () => {
    await get('/api/insertion/rsa/echeances-periodiques');
    const sqls = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /1900-01-01/.test(s))).toBe(false);
    expect(sqls.some((s) => /GREATEST\(MAX\(m\.completed_date\), MAX\(a\.remis_referent_le\)\)/.test(s))).toBe(true);
  });

  // Et le cas vivant : une date réelle ressort en 'AAAA-MM-JJ' avec son
  // ancienneté en jours, jamais « Sun Mar 02 » (famille D-02).
  test('un dossier AVEC contact rend une date ISO et un nombre de jours', async () => {
    const { decalerJours, aujourdhuiParis } = require('../../src/utils/date-iso');
    const ilY100Jours = decalerJours(aujourdhuiParis(), -100);
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/GREATEST/.test(s)) {
        return Promise.resolve({ rows: [{ employee_id: 9, first_name: 'Amel', last_name: 'NASRI', dernier_le: ilY100Jours }] });
      }
      if (/FROM settings/.test(s)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/rsa/echeances-periodiques');
    expect(res.body.points_referent_dus).toEqual([
      { employee_id: 9, nom: 'NASRI Amel', dernier_le: ilY100Jours, du_depuis_jours: 100 },
    ]);
  });

  test('un point récent n’est pas signalé comme dû', async () => {
    const recent = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/dernier_brut/.test(s)) {
        return Promise.resolve({ rows: [{ employee_id: 8, first_name: 'Sonia', last_name: 'REY', dernier_brut: recent }] });
      }
      if (/FROM settings/.test(s)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/rsa/echeances-periodiques');
    expect(res.body.points_referent_dus).toEqual([]);
  });

  test('« référent non déterminé » remonte en clair, avec le nom de la personne', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/COALESCE\(referent_unique_type, 'non_determine'\) = 'non_determine'/.test(s)) {
        return Promise.resolve({ rows: [{ employee_id: 11, first_name: 'Karim', last_name: 'OULD' }] });
      }
      if (/FROM settings/.test(s)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/rsa/echeances-periodiques');
    expect(res.body.referents_non_determines).toEqual([{ employee_id: 11, nom: 'OULD Karim' }]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('8. types d’entretien du cadre RSA (retouche de routes.js)', () => {
  test('« Point avec le référent » est acceptable à la création', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT COALESCE\(parcours_num, 1\)/.test(s)) return Promise.resolve({ rows: [{ n: 1 }] });
      if (/INSERT INTO insertion_milestones/.test(s)) {
        return Promise.resolve({ rows: [{ id: 77, milestone_type: 'point_etape_referent', titre: 'Point avec le référent' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/milestones', 'ADMIN', {
      employee_id: 5, milestone_type: 'point_etape_referent', due_date: '2026-07-01',
    });
    expect(res.status).toBe(201);
    // Titre auto : le libellé français du type, pas le code brut.
    const ins = mockQuery.mock.calls.find(([s]) => /INSERT INTO insertion_milestones/.test(String(s)));
    expect(ins[1][3]).toBe('Point avec le référent');
  });

  test('« Entretien de conciliation » aussi', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT COALESCE\(parcours_num, 1\)/.test(s)) return Promise.resolve({ rows: [{ n: 1 }] });
      if (/INSERT INTO insertion_milestones/.test(s)) return Promise.resolve({ rows: [{ id: 78 }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/milestones', 'ADMIN', {
      employee_id: 5, milestone_type: 'conciliation', due_date: '2026-07-01',
    });
    expect(res.status).toBe(201);
    const ins = mockQuery.mock.calls.find(([s]) => /INSERT INTO insertion_milestones/.test(String(s)));
    expect(ins[1][3]).toBe('Entretien de conciliation (protection des droits)');
  });

  // ── § 6.3 : « Point avec le référent » HORS compteur d'entretiens ────────
  // Vérification, pas correctif : `gatherAuditKpis` projette sur la liste FIXE
  // `MILESTONE_TYPES` d'engine.js (six types techniques), à laquelle les deux
  // types du cadre RSA n'appartiennent pas. Un point avec le référent ne peut
  // donc pas gonfler le taux de réalisation des bilans servi à l'autorité —
  // ce qui reviendrait à compter deux fois un accompagnement qui n'a pas eu
  // lieu. Ce test verrouille la propriété : élargir `MILESTONE_TYPES` demain
  // sans y penser le fait tomber.
  test('« point_etape_referent » n’entre PAS dans les indicateurs d’entretiens', () => {
    const { MILESTONE_TYPES } = require('../../src/routes/insertion/engine');
    expect(MILESTONE_TYPES).not.toContain('point_etape_referent');
    expect(MILESTONE_TYPES).not.toContain('conciliation');
    // … alors qu'il est bien CRÉABLE (les deux tests ci-dessus) : la liste des
    // types acceptés en écriture et la liste des types comptés en pilotage sont
    // deux choses différentes, et c'est délibéré.
    expect(MILESTONE_TYPES).toHaveLength(6);
  });

  test('un type inventé reste refusé en 400', async () => {
    const res = await post('/api/insertion/milestones', 'ADMIN', {
      employee_id: 5, milestone_type: 'convocation_disciplinaire', due_date: '2026-07-01',
    });
    expect(res.status).toBe(400);
  });

  test('un MOTIF de conciliation hors liste fermée est refusé (jamais de texte libre)', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [{ id: 77, status: 'planifie' }] }));
    const res = await put('/api/insertion/milestones/77', 'ADMIN', {
      conciliation_motifs: ['sante', 'je raconte ce que je veux ici'],
    });
    expect(res.status).toBe(400);
  });

  test('les motifs de la liste fermée passent, et sont écrits en JSONB', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT \* FROM insertion_milestones WHERE id/.test(s)) {
        return Promise.resolve({ rows: [{ id: 77, status: 'planifie', locked_at: null, milestone_type: 'conciliation' }] });
      }
      return Promise.resolve({ rows: [{ id: 77, milestone_type: 'conciliation' }] });
    });
    const res = await put('/api/insertion/milestones/77', 'ADMIN', {
      conciliation_motifs: ['sante', 'garde_enfant'], conciliation_issue: 'reprise', referent_modalite: 'tripartite',
    });
    expect(res.status).toBe(200);
    const upd = mockQuery.mock.calls.find(([s]) => /UPDATE insertion_milestones SET/.test(String(s)));
    expect(String(upd[0])).toMatch(/conciliation_motifs = \$/);
    expect(upd[1]).toContain('["sante","garde_enfant"]');
    expect(upd[1]).toContain('reprise');
    expect(upd[1]).toContain('tripartite');
  });

  test('une modalité de point avec le référent hors liste est refusée', async () => {
    const res = await put('/api/insertion/milestones/77', 'ADMIN', { referent_modalite: 'par_telepathie' });
    expect(res.status).toBe(400);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('9. date de réalisation d’une action CIP (retouche de routes.js)', () => {
  test('passer une action à « réalisé » pose la date du jour SANS écraser une date existante', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [{ id: 3, status: 'realise' }] }));
    const res = await put('/api/insertion/action-plans/3', 'ADMIN', { status: 'realise' });
    expect(res.status).toBe(200);
    const upd = mockQuery.mock.calls.find(([s]) => /UPDATE cip_action_plans SET/.test(String(s)));
    // COALESCE : repasser une action déjà réalisée par « réalisé » ne doit pas
    // déplacer sa date vers aujourd'hui — elle changerait de semaine dans le
    // compteur d'activité.
    expect(String(upd[0])).toMatch(/date_realisation = COALESCE\(date_realisation, CURRENT_DATE\)/);
  });

  test('une date explicite est écrite telle quelle, sans COALESCE', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [{ id: 3 }] }));
    await put('/api/insertion/action-plans/3', 'ADMIN', { status: 'realise', date_realisation: '2026-04-02' });
    const upd = mockQuery.mock.calls.find(([s]) => /UPDATE cip_action_plans SET/.test(String(s)));
    expect(String(upd[0])).not.toMatch(/COALESCE\(date_realisation/);
    expect(upd[1]).toContain('2026-04-02');
  });

  test('un autre statut ne pose aucune date', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [{ id: 3 }] }));
    await put('/api/insertion/action-plans/3', 'ADMIN', { status: 'en_cours' });
    const upd = mockQuery.mock.calls.find(([s]) => /UPDATE cip_action_plans SET/.test(String(s)));
    expect(String(upd[0])).not.toMatch(/date_realisation/);
  });
});
