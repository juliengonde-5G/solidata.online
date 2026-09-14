// ═══════════════════════════════════════════════════════════════════════════
// CONTRAT — REPORTING AUTORITÉ (PR D, lot 6)
// ───────────────────────────────────────────────────────────────────────────
// `pg` est simulé : on exerce les VRAIS handlers Express à travers le vrai
// routeur monté (`src/routes/insertion`), et on inspecte ce qui sort et ce qui
// est écrit.
//
// Ce que ces tests tiennent :
//   1. HABILITATION — le MANAGER LIT (le document ne porte aucune projection
//      nominative), mais n'ENREGISTRE pas : la génération produit une pièce
//      datée qui engage la structure vis-à-vis de son financeur. Le refus tombe
//      AVANT toute requête : `pool.query` n'est pas appelé une seule fois.
//   2. EXPORT VIDE — 409 `EXPORT_VIDE` motivé, jamais un fichier vide, et
//      AUCUNE écriture (ni snapshot, ni journal).
//   3. JOURNAL BLOQUANT — sur la génération enregistrée, un journal qui échoue
//      fait échouer le geste : pas de snapshot sans sa trace.
//   4. NON NOMINATIF — aucune des neuf clés interdites dans la sérialisation.
//   5. k-ANONYMAT — un agrégat à 4 personnes est rendu `null` et son chemin
//      figure dans `sous_seuil`.
//   6. SNAPSHOT — un document rejoué rend ce qui a été ENREGISTRÉ, pas ce que
//      le dossier dit aujourd'hui.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;
process.env.PCM_ENCRYPTION_KEY = process.env.PCM_ENCRYPTION_KEY || 'test-pcm-key-0123456789abcdef';

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

// Les deux services externes rendent délibérément leur forme NOMINATIVE
// complète : ce qui est éprouvé ici, c'est la PROJECTION.
jest.mock('../../src/services/temps-accompagnement', () => ({
  heuresAccompagnement: jest.fn(async () => ({
    annee: 2026, global_minutes: 6000, nb_salaries_concernes: 12,
    moyenne_minutes_par_salarie: 500,
    par_salarie: [{ employee_id: 41, nom: 'PREVOST Sandrine', minutes: 2400 }],
    par_intervenant: [{ user_id: 7, nom: 'DURAND Amel', minutes: 6000 }],
  })),
}));
jest.mock('../../src/services/fse-participants', () => ({
  conformiteProjet: jest.fn(async () => ({
    projet: { id: 1, code: 'ASI-2026-2027', nom: 'ASI' },
    participants: [{ employee_id: 41, nom: 'PREVOST', prenom: 'Sandrine' }],
    nb_total: 9, nb_complets: 7, taux_completude: 78,
  })),
  chargerContextes: jest.fn(async () => new Map()),
  composerPieces: jest.fn(() => []),
  bornesPeriode: jest.fn(() => null),
}));
jest.mock('../../src/services/activite-hebdo', () => ({
  activiteHebdo: jest.fn(async () => ({})),
  activiteHebdoCohorte: jest.fn(async () => new Map([[1, { nb_semaines_sous_seuil: 2 }]])),
  lireReglages: jest.fn(async () => ({})),
}));

const express = require('express');
const request = require('supertest');

let app;
const tokenFor = (role) => jwt.sign(
  { id: 7, username: 'cip', role, first_name: 'Claire', last_name: 'MARTIN', mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
  JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = {
  ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER'),
  QHSE: tokenFor('QHSE'), COLLABORATEUR: tokenFor('COLLABORATEUR'),
};

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/insertion', require('../../src/routes/insertion'));
});

const get = (p, role = 'ADMIN') => request(app).get(p).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (p, role, body = {}) => request(app).post(p).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);

/** Les neuf clés que le document ne doit JAMAIS porter (contrat 25 § 8). */
const CLES_INTERDITES = ['nom', 'prenom', 'employee_id', 'first_name', 'last_name',
  'birth_date', 'email', 'phone', 'matricule'];

const personne = (id, over = {}) => ({
  id, gender: 'F', birth_date: '1985-04-02', brsa: true, ft_categorie: 'G',
  referent_unique_type: 'cms', niveau_formation: 'niv3', ...over,
});

/** Aiguillage du faux `pg`. `over` surcharge une source. */
function branche(over = {}) {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (/INSERT INTO rgpd_audit_log/.test(s)) {
      if (over.journalEnEchec) return Promise.reject(Object.assign(new Error('journal indisponible'), { code: '42P01' }));
      return Promise.resolve({ rows: [] });
    }
    if (/INSERT INTO insertion_dialogues_gestion/.test(s)) {
      return Promise.resolve({ rows: [{ id: 12, genere_le: '2026-01-15T09:00:00Z' }] });
    }
    if (/FROM insertion_dialogues_gestion d/.test(s)) return Promise.resolve({ rows: over.historique ?? [] });
    if (/FROM insertion_dialogues_gestion WHERE id/.test(s)) return Promise.resolve({ rows: over.snapshot ?? [] });
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(s.trim())) return Promise.resolve({ rows: [] });
    if (/FROM settings/.test(s)) return Promise.resolve({ rows: [] });
    if (/AS entree_frein_/.test(s)) return Promise.resolve({ rows: over.freins ?? [] });
    if (/FROM employees e\s+LEFT JOIN insertion_diagnostics d/.test(s)) {
      return Promise.resolve({ rows: over.cohorte ?? [personne(1)] });
    }
    if (/FROM insertion_projets/.test(s)) return Promise.resolve({ rows: [{ id: 1, code: 'ASI-2026-2027', nom: 'ASI' }] });
    if (/FROM etp_asp_salaries/.test(s)) return Promise.resolve({ rows: [{ n: 0 }] });
    if (/FROM employees e\s+WHERE COALESCE\(e\.insertion_status/.test(s)) return Promise.resolve({ rows: [{ id: 1 }] });
    if (/insertion_end_date BETWEEN/.test(s)) return Promise.resolve({ rows: over.fins ?? [] });
    if (/milestone_type = 'bilan_sortie'/.test(s)) return Promise.resolve({ rows: over.bilans ?? [] });
    return Promise.resolve({ rows: over.defaut ?? [] });
  });
}

beforeEach(() => { mockQuery.mockReset(); branche(); });

const journaux = () => mockQuery.mock.calls.filter(([sql]) => /INSERT INTO rgpd_audit_log/.test(String(sql)));
const journalPour = (action) => journaux().find(([, p]) => p && p[1] === action);

// ───────────────────────────────────────────────────────────────────────────
describe('1. habilitations', () => {
  it('les rôles hors module sont refusés par le routeur parent (403), sans aucune requête', async () => {
    for (const role of ['QHSE', 'COLLABORATEUR']) {
      mockQuery.mockClear();
      const res = await get('/api/insertion/reporting/dialogue-gestion?annee=2026', role);
      expect(res.status).toBe(403);
      expect(mockQuery).not.toHaveBeenCalled();
    }
  });

  it('le MANAGER LIT la synthèse : aucune projection nominative n’existe dans ce document', async () => {
    const res = await get('/api/insertion/reporting/dialogue-gestion?annee=2026', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body.blocs['2_publics_entree']).toBeTruthy();
  });

  it('le MANAGER n’ENREGISTRE pas — refus AVANT toute requête', async () => {
    mockQuery.mockClear();
    const res = await post('/api/insertion/reporting/dialogue-gestion', 'MANAGER', { annee: 2026 });
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('ADMIN et RH enregistrent', async () => {
    branche({ cohorte: [personne(1)] });
    for (const role of ['ADMIN', 'RH']) {
      const res = await post('/api/insertion/reporting/dialogue-gestion', role, { annee: 2026 });
      expect(res.status).toBe(201);
    }
  });
});

describe('2. aperçu (GET) — journal TOLÉRANT, document non nominatif', () => {
  it('journalise l’aperçu sans le contenu du document', async () => {
    const res = await get('/api/insertion/reporting/dialogue-gestion?annee=2026', 'RH');
    expect(res.status).toBe(200);
    const j = journalPour('INSERTION_DIALOGUE_GESTION_APERCU');
    expect(j).toBeTruthy();
    const details = JSON.parse(j[1][4]);
    expect(details).toEqual(expect.objectContaining({ annee: 2026, trimestre: null }));
    // La trace dit QUE le document a été composé, jamais CE QU'IL dit.
    expect(JSON.stringify(details)).not.toMatch(/blocs|effectif|taux/);
  });

  it('un journal indisponible n’empêche PAS de relire l’écran (tolérant)', async () => {
    branche({ journalEnEchec: true });
    const res = await get('/api/insertion/reporting/dialogue-gestion?annee=2026', 'RH');
    expect(res.status).toBe(200);
  });

  it('aucune clé nominative dans la réponse, quel que soit le rôle', async () => {
    for (const role of ['ADMIN', 'MANAGER']) {
      const res = await get('/api/insertion/reporting/dialogue-gestion?annee=2026', role);
      const brut = JSON.stringify(res.body);
      for (const cle of CLES_INTERDITES) expect(brut).not.toMatch(new RegExp(`"${cle}"`));
      expect(brut).not.toMatch(/PREVOST|Sandrine|DURAND|Amel|MARTIN/);
    }
  });

  it('l’en-tête porte le rôle, la période, le périmètre et la mention', async () => {
    const res = await get('/api/insertion/reporting/dialogue-gestion?annee=2026', 'RH');
    expect(res.body.en_tete).toEqual(expect.objectContaining({
      structure: 'Solidarité Textiles',
      annee: 2026,
      trimestre: null,
      genere_par_role: 'RH',
      type: 'annuelle',
      k_anonymat: 5,
    }));
    expect(res.body.en_tete.mention).toMatch(/non nominatif/i);
  });

  it('année ou trimestre invalides → 400 (jamais une période inventée)', async () => {
    expect((await get('/api/insertion/reporting/dialogue-gestion?annee=1800', 'RH')).status).toBe(400);
    expect((await get('/api/insertion/reporting/dialogue-gestion?annee=2026&trimestre=9', 'RH')).status).toBe(400);
    expect((await get('/api/insertion/reporting/dialogue-gestion?annee=2026&format=pdf', 'RH')).status).toBe(400);
  });

  it('trimestre → version allégée : blocs 2 et 8 seulement', async () => {
    const res = await get('/api/insertion/reporting/dialogue-gestion?annee=2026&trimestre=3', 'RH');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.blocs).sort()).toEqual(['2_publics_entree', '8_conformite', '9_methode']);
    expect(res.body.en_tete.type).toBe('trimestrielle_allegee');
  });
});

describe('3. k-anonymat', () => {
  it('un agrégat à 4 personnes est rendu null et son chemin figure dans sous_seuil', async () => {
    branche({ cohorte: [1, 2, 3, 4].map((i) => personne(i)) });
    const res = await get('/api/insertion/reporting/dialogue-gestion?annee=2026', 'RH');
    const b = res.body.blocs['2_publics_entree'];
    expect(b.effectif).toBe(4);              // tête de chapitre : jamais masquée
    expect(b.par_categorie_ft.G).toBeNull(); // 4 personnes → sous le seuil
    // CORRECTIF B-01 — `sous_seuil` COMPTE par bloc : le chemin exact désignait
    // la case à reconstituer par soustraction de l'effectif publié.
    const bloc2 = res.body.sous_seuil.find((x) => x.bloc === '2_publics_entree');
    expect(bloc2.nb).toBeGreaterThan(0);
    expect(bloc2.libelle).toMatch(/Publics/);
    expect(JSON.stringify(res.body.sous_seuil)).not.toMatch(/par_categorie_ft/);
    expect(res.body.sous_seuil_total).toBeGreaterThanOrEqual(bloc2.nb);
  });

  it('à 5 personnes, l’agrégat est rendu et sous_seuil ne le liste pas', async () => {
    branche({ cohorte: [1, 2, 3, 4, 5].map((i) => personne(i)) });
    const res = await get('/api/insertion/reporting/dialogue-gestion?annee=2026', 'RH');
    expect(res.body.blocs['2_publics_entree'].par_categorie_ft.G).toBe(5);
    expect(res.body.sous_seuil).not.toContain('blocs.2_publics_entree.par_categorie_ft.G');
  });

  it('ZÉRO reste zéro : une catégorie vide n’est pas masquée', async () => {
    branche({ cohorte: [1, 2, 3, 4, 5].map((i) => personne(i)) });
    const res = await get('/api/insertion/reporting/dialogue-gestion?annee=2026', 'RH');
    expect(res.body.blocs['2_publics_entree'].par_categorie_ft.A).toBe(0);
    expect(res.body.sous_seuil).not.toContain('blocs.2_publics_entree.par_categorie_ft.A');
  });
});

describe('4. le judiciaire est ABSENT du bloc 3 et de l’évolution, sans mention', () => {
  it('huit axes, aucun judiciaire, et sa colonne n’est pas lue en SQL', async () => {
    const res = await get('/api/insertion/reporting/dialogue-gestion?annee=2026', 'RH');
    const bloc = res.body.blocs['3_freins'];
    expect(bloc.par_axe.map((a) => a.axe)).not.toContain('judiciaire');
    expect(bloc.par_axe).toHaveLength(8);
    // Le bloc ne MENTIONNE pas l'exclusion : mentionner, c'est encore désigner.
    expect(JSON.stringify(bloc)).not.toMatch(/judiciaire/i);
    const sqlFreins = mockQuery.mock.calls.map(([s]) => String(s)).find((s) => /AS entree_frein_/.test(s));
    expect(sqlFreins).toBeTruthy();
    expect(sqlFreins).not.toMatch(/frein_judiciaire/);
  });
});

describe('5. export CSV — les trois règles communes', () => {
  it('période sans données → 409 EXPORT_VIDE motivé, et AUCUNE écriture', async () => {
    branche({ cohorte: [], fins: [], bilans: [] });
    mockQuery.mockClear();
    branche({ cohorte: [], fins: [], bilans: [] });
    const res = await get('/api/insertion/reporting/dialogue-gestion?annee=2026&format=csv', 'RH');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXPORT_VIDE');
    expect(res.body.error).toMatch(/aucun fichier n'est produit/);
    expect(res.body.hint).toBeTruthy();
    expect(journalPour('EXPORT_DIALOGUE_GESTION')).toBeUndefined();
  });

  it('en-tête de traçabilité, colonnes Bloc;Indicateur;Valeur, BOM, journal BLOQUANT', async () => {
    const res = await get('/api/insertion/reporting/dialogue-gestion?annee=2026&format=csv', 'RH');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/dialogue-gestion_2026\.csv/);
    expect(res.text.charCodeAt(0)).toBe(0xFEFF); // BOM : ouverture directe sous Excel FR
    const texte = res.text.replace(/^﻿/, '');
    expect(texte).toMatch(/^# Export;Synthèse de dialogue de gestion/);
    expect(texte).toMatch(/# Généré le;.*Généré par \(rôle\);RH/);
    expect(texte).toMatch(/# Périmètre;.*hors permanents/);
    expect(texte).toMatch(/# Nombre de lignes;\d+;Version de l'outil;/);
    expect(texte).toMatch(/saisies officielles.*font foi/);
    expect(texte.split('\n')).toContain('Bloc;Indicateur;Valeur');
    expect(texte).toContain('9. Méthode');
    expect(journalPour('EXPORT_DIALOGUE_GESTION')).toBeTruthy();
  });

  it('un journal en échec fait ÉCHOUER l’export : aucun fichier non tracé', async () => {
    branche({ journalEnEchec: true });
    const res = await get('/api/insertion/reporting/dialogue-gestion?annee=2026&format=csv', 'RH');
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).not.toMatch(/text\/csv/);
  });

  it('les formules sont neutralisées : une cellule en « = » ne s’évalue pas chez l’instructrice', async () => {
    // Le nom d'un partenaire atterrit directement dans la colonne « Valeur » :
    // c'est la voie par laquelle une cellule peut commencer par « = ». Le
    // guillemetage CSV ne suffirait pas — le tableur retire les guillemets à la
    // lecture PUIS évalue le contenu.
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/ROW_NUMBER\(\) OVER \(PARTITION BY a\.frein_type/.test(s)) {
        return Promise.resolve({ rows: [{ axe: 'mobilite', nom: '=HYPERLINK("http://x";"Cliquez")' }] });
      }
      if (/INSERT INTO rgpd_audit_log/.test(s)) return Promise.resolve({ rows: [] });
      if (/AS entree_frein_/.test(s)) return Promise.resolve({ rows: [] });
      if (/FROM employees e\s+LEFT JOIN insertion_diagnostics d/.test(s)) return Promise.resolve({ rows: [personne(1)] });
      if (/FROM insertion_projets/.test(s)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/reporting/dialogue-gestion?annee=2026&format=csv', 'RH');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/'=HYPERLINK/); // apostrophe de neutralisation
    expect(res.text).not.toMatch(/;=HYPERLINK/);
  });

  it('une valeur non rendue s’écrit cellule VIDE, jamais zéro', async () => {
    branche({ cohorte: [personne(1)] });
    const res = await get('/api/insertion/reporting/dialogue-gestion?annee=2026&format=csv', 'RH');
    const ligne = res.text.split('\n').find((l) => /Catégorie France Travail G/.test(l));
    expect(ligne).toBe("2. Publics à l'entrée;Catégorie France Travail G;");
  });
});

describe('6. génération enregistrée (POST)', () => {
  it('écrit le snapshot ET sa trace dans la MÊME transaction', async () => {
    const res = await post('/api/insertion/reporting/dialogue-gestion', 'RH', { annee: 2026 });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(12);
    expect(res.body.contenu.blocs['9_methode']).toBeTruthy();
    const appels = mockQuery.mock.calls.map(([s]) => String(s).trim());
    const iBegin = appels.findIndex((s) => /^BEGIN/.test(s));
    const iInsert = appels.findIndex((s) => /INSERT INTO insertion_dialogues_gestion/.test(s));
    const iJournal = appels.findIndex((s) => /INSERT INTO rgpd_audit_log/.test(s));
    const iCommit = appels.findIndex((s) => /^COMMIT/.test(s));
    expect(iBegin).toBeGreaterThanOrEqual(0);
    expect(iInsert).toBeGreaterThan(iBegin);
    expect(iJournal).toBeGreaterThan(iInsert);
    expect(iCommit).toBeGreaterThan(iJournal);
    expect(journalPour('INSERTION_DIALOGUE_GESTION_GENERATION')).toBeTruthy();
  });

  it('un journal en échec ANNULE la génération : pas de snapshot sans sa trace', async () => {
    branche({ journalEnEchec: true });
    const res = await post('/api/insertion/reporting/dialogue-gestion', 'RH', { annee: 2026 });
    expect(res.status).toBe(500);
    const appels = mockQuery.mock.calls.map(([s]) => String(s).trim());
    expect(appels.some((s) => /^ROLLBACK/.test(s))).toBe(true);
    expect(appels.some((s) => /^COMMIT/.test(s))).toBe(false);
  });

  it('période sans données → 409 EXPORT_VIDE, AUCUN snapshot enregistré', async () => {
    branche({ cohorte: [], fins: [], bilans: [] });
    const res = await post('/api/insertion/reporting/dialogue-gestion', 'RH', { annee: 2026 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXPORT_VIDE');
    const appels = mockQuery.mock.calls.map(([s]) => String(s));
    expect(appels.some((s) => /INSERT INTO insertion_dialogues_gestion/.test(s))).toBe(false);
  });

  it('le contenu enregistré est non nominatif (c’est lui qui sera rejoué)', async () => {
    const res = await post('/api/insertion/reporting/dialogue-gestion', 'RH', { annee: 2026 });
    const insert = mockQuery.mock.calls.find(([s]) => /INSERT INTO insertion_dialogues_gestion/.test(String(s)));
    const contenu = insert[1][2];
    for (const cle of CLES_INTERDITES) expect(contenu).not.toMatch(new RegExp(`"${cle}"`));
    expect(contenu).not.toMatch(/PREVOST|DURAND/);
    expect(res.status).toBe(201);
  });

  it('année invalide → 400', async () => {
    expect((await post('/api/insertion/reporting/dialogue-gestion', 'RH', { annee: 1800 })).status).toBe(400);
    expect((await post('/api/insertion/reporting/dialogue-gestion', 'RH', { annee: 2026, trimestre: 7 })).status).toBe(400);
  });
});

describe('7. historique et rejeu d’un snapshot', () => {
  it('l’historique rend le PRÉNOM et l’initiale du générateur, jamais le nom complet', async () => {
    branche({
      historique: [{
        id: 12, annee: 2026, trimestre: null, genere_le: '2026-01-15T09:00:00Z',
        version_application: '2.55.0', genere_prenom: 'Claire', genere_initiale: 'M', genere_role: 'RH',
      }],
    });
    const res = await get('/api/insertion/reporting/dialogue-gestion/historique', 'RH');
    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual(expect.objectContaining({
      id: 12, annee: 2026, genere_par: 'Claire M.', genere_par_role: 'RH', type: 'annuelle',
    }));
    expect(JSON.stringify(res.body)).not.toMatch(/MARTIN/);
  });

  it('CORRECTIF m-07 — au MANAGER, l’historique ne rend que le RÔLE du générateur', async () => {
    // Le document lui-même ne porte que le rôle (« l'autorité veut savoir à
    // quel titre il a été produit, pas recevoir un répertoire du personnel ») :
    // son historique n'a pas de raison d'en dire plus que la pièce qu'il retrace.
    branche({
      historique: [{
        id: 12, annee: 2026, trimestre: null, genere_le: '2026-01-15T09:00:00Z',
        version_application: '2.55.0', genere_prenom: 'Claire', genere_initiale: 'M', genere_role: 'RH',
      }],
    });
    const res = await get('/api/insertion/reporting/dialogue-gestion/historique', 'MANAGER');
    expect(res.status).toBe(200);
    expect('genere_par' in res.body[0]).toBe(false);
    expect(res.body[0].genere_par_role).toBe('RH');
    expect(JSON.stringify(res.body)).not.toMatch(/Claire/);
  });

  it('rejouer un snapshot rend ce qui a été ENREGISTRÉ, et journalise la consultation', async () => {
    branche({
      snapshot: [{
        id: 12, annee: 2026, trimestre: null, genere_le: '2026-01-15T09:00:00Z',
        version_application: '2.55.0',
        contenu: { en_tete: { annee: 2026 }, blocs: { '2_publics_entree': { effectif: 44 } }, sous_seuil: [] },
      }],
    });
    const res = await get('/api/insertion/reporting/dialogue-gestion/12', 'RH');
    expect(res.status).toBe(200);
    // 44 : la valeur du jour de la génération, pas celle que la base dit
    // aujourd'hui (la cohorte simulée n'a qu'une personne).
    expect(res.body.blocs['2_publics_entree'].effectif).toBe(44);
    expect(journalPour('INSERTION_DIALOGUE_GESTION_CONSULTATION')).toBeTruthy();
  });

  it('snapshot inexistant → 404', async () => {
    branche({ snapshot: [] });
    expect((await get('/api/insertion/reporting/dialogue-gestion/999', 'RH')).status).toBe(404);
  });

  it('« historique » n’est pas capté par la route /:id', async () => {
    const res = await get('/api/insertion/reporting/dialogue-gestion/historique', 'RH');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('8. sorties — la méthode B et sa règle arrivent jusqu’à la réponse', () => {
  it('dénominateur = fins de parcours, ligne « non documentée » apparente', async () => {
    branche({
      cohorte: [personne(1)],
      fins: [{ employee_id: 1, parcours_num: 1 }, { employee_id: 2, parcours_num: 1 }],
      bilans: [{ employee_id: 1, parcours_num: 1, sortie_classification: 'emploi_durable', sortie_type: 'CDI' }],
    });
    const res = await get('/api/insertion/reporting/dialogue-gestion?annee=2026', 'RH');
    const b = res.body.blocs['6_sorties'];
    expect(b.methode_b.denominateur).toBe(2);
    expect(b.methode_b.non_documentees).toBe(1);
    expect(b.methode_b.par_classification.non_documentee).toBe(1);
    expect(b.regles.join(' ')).toMatch(/indicateur de qualité de la saisie, pas une faute/);
    expect(b.rapprochement_asp.sorties_asp).toBeNull(); // aucun état ASP importé
  });
});
