// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — PR A « Conformité immédiate », LOT 2 « FSE+ »
// ───────────────────────────────────────────────────────────────────────────
// Verrouille ce que l'autorité contrôlera :
//   - GET  /exports/fse-plus        29 colonnes DANS L'ORDRE dicté (09 § 2 (a)),
//                                   en-tête de traçabilité, 409 sur zéro ligne,
//                                   journal RGPD écrit AVANT l'envoi (et son
//                                   échec fait échouer l'export) ;
//   - GET  /exports/fse-plus/bilan  agrégat NON nominatif ;
//   - PUT  /insertion/diagnostic    questionnaire typé (400 hors schéma),
//                                   complétude et suggestions renvoyées ;
//   - POST /insertion/milestones/:id/close  durée et assiduité écrites ;
//   - GET  /insertion/alertes/:id   sortie FSE+ à saisir, référent non déterminé ;
//   - CRUD /insertion/projets       409 sur code dupliqué ;
//   - matrice de rôles : le MANAGER ne lit AUCUN questionnaire FSE+.
// Auth réelle (JWT), DB simulée, activity-logger simulé.
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
const { FREINS } = require('../../src/routes/insertion/freins-registry');

let app;
let appExports;
const tokenFor = (role) => jwt.sign(
  { id: 1, username: 'cip.test', role, first_name: 'T', last_name: 'U', mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
  JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = { ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER') };

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/insertion', require('../../src/routes/insertion'));
  appExports = express();
  appExports.use(express.json());
  appExports.use('/api/exports', require('../../src/routes/exports-fse'));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

const get = (path, role = 'ADMIN') => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (path, role, body = {}) => request(app).post(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const put = (path, role, body = {}) => request(app).put(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const getExport = (path, role = 'ADMIN') => request(appExports).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);

// ── Jeux de données ────────────────────────────────────────────────────────
const PROJET = {
  id: 1, code: 'ASI-2026-2027', nom: 'Accompagnement Social Intensif 2026-2027',
  type: 'asi', financeur: 'FSE+ / Département 76', date_debut: '2026-01-01', date_fin: '2027-12-31',
  convention_ref: null, taux_forfaitaire_pct: null, cofinancement_ue_pct: 60, actif: true,
};

const PARTICIPANT = {
  employee_id: 5, date_entree: '2026-01-01', date_sortie: null,
  id: 5, first_name: 'Karim', last_name: 'Benali', birth_date: '1988-04-12', gender: 'M', city: 'Grand-Quevilly',
  insertion_start_date: '2025-07-15', contract_end: '2026-08-21',
  brsa: true, ft_categorie: 'F', referent_unique_type: 'cms', parcours_num: 1,
  premier_cddi: '2025-07-15',
  fse_entree: { statut_avant_entree: 'demandeur_emploi', duree_sans_emploi: '12_24m', foyer_monoparental: true, sans_domicile_stable: false, ressources_principales: 'rsa' },
  fse_entree_saisie_at: '2025-08-05T10:00:00.000Z', niveau_formation: 'niv3',
  fse_date_sortie: '2026-08-21', situation_sortie: 'emploi_durable', saisie_at: '2026-09-01T09:00:00.000Z',
  situation_6mois: null, date_releve_6mois: null, criteres: 'brsa, deld, qpv',
};

/** Branche les requêtes de l'export (projet, population, contextes, réglages, journal). */
function brancherExport({ participants = [PARTICIPANT], projet = PROJET, journalKo = false } = {}) {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (/FROM insertion_projets WHERE id/.test(s)) return Promise.resolve({ rows: projet ? [projet] : [] });
    if (/FROM insertion_projets WHERE actif/.test(s)) return Promise.resolve({ rows: projet ? [projet] : [] });
    if (/FROM insertion_projet_participants pp\s+JOIN employees/.test(s)) return Promise.resolve({ rows: participants });
    if (/FROM employees e WHERE e\.id = ANY/.test(s)) {
      return Promise.resolve({ rows: participants.map((p) => ({ ...p, pass_iae_statut: 'actif', pass_iae_number: 'P1', pass_iae_end: '2027-03-14', eligibilite_verifiee_le: '2025-07-10', insertion_status: 'termine' })) });
    }
    if (/FROM employee_eligibilite ee/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM insertion_diagnostics d/.test(s)) {
      return Promise.resolve({ rows: participants.map((p) => ({ employee_id: p.id, statut_saisie: 'complet', fse_entree: p.fse_entree, fse_entree_complet: true, fse_entree_saisie_at: p.fse_entree_saisie_at })) });
    }
    if (/FROM insertion_fse_sorties s/.test(s)) {
      return Promise.resolve({ rows: participants.filter((p) => p.fse_date_sortie).map((p) => ({ employee_id: p.id, date_sortie: p.fse_date_sortie, saisie_at: p.saisie_at, source: 'bilan', situation_6mois: p.situation_6mois })) });
    }
    if (/FROM insertion_milestones/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM insertion_projet_participants pp\s+JOIN insertion_projets/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM settings/.test(s)) return Promise.resolve({ rows: [] });
    if (/INSERT INTO rgpd_audit_log/.test(s)) {
      if (journalKo) return Promise.reject(Object.assign(new Error('journal indisponible'), { code: '42P01' }));
      return Promise.resolve({ rows: [] });
    }
    if (/FROM insertion_projet_postes/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM work_hours/.test(s)) return Promise.resolve({ rows: [{ h: '182.50' }] });
    return Promise.resolve({ rows: [] });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
describe('CONTRAT GET /exports/fse-plus — 29 colonnes dictées par l’autorité', () => {
  it('MANAGER refusé (données nominatives d’insertion : ADMIN/RH strict)', async () => {
    const res = await getExport('/api/exports/fse-plus?projet=1', 'MANAGER');
    expect(res.status).toBe(403);
  });

  it('produit exactement les 29 intitulés, dans l’ORDRE, une colonne par item', async () => {
    brancherExport();
    const res = await getExport('/api/exports/fse-plus?projet=1&annee=2026&trimestre=3', 'RH');
    expect(res.status).toBe(200);
    const lignes = res.text.replace(/^﻿/, '').split('\n');
    const entete = lignes.find((l) => !l.startsWith('#') && l.trim() !== '');
    expect(entete.split(';')).toEqual([
      'Identifiant interne', 'NOM', 'Prénom', 'Date de naissance', 'Sexe', 'Commune de résidence',
      'Projet', "Date d'entrée dans le projet", 'Date de sortie du projet',
      "Critères d'éligibilité IAE", 'BRSA', 'Catégorie France Travail', 'Référent unique (type)',
      "Date d'entrée en parcours", 'Date de fin de contrat',
      "Situation avant l'entrée", 'Durée sans emploi', "Niveau d'instruction",
      'Foyer monoparental', 'Sans domicile stable',
      "Date de recueil du questionnaire d'entrée", "Complétude du questionnaire d'entrée (%)",
      "Date de sortie de l'opération", 'Situation à la sortie',
      'Date de saisie de la sortie', 'Délai de saisie (jours)',
      'Situation à +6 mois', 'Date du relevé à +6 mois', 'Complétude du dossier participant (%)',
    ]);
    expect(entete.split(';')).toHaveLength(29);
  });

  it('écrit des LIBELLÉS français, jamais de JSON dans une cellule, et calcule le délai de saisie', async () => {
    brancherExport();
    const res = await getExport('/api/exports/fse-plus?projet=1&annee=2026&trimestre=3', 'ADMIN');
    const lignes = res.text.replace(/^\ufeff/, '').split('\n').filter((l) => l && !l.startsWith('#'));
    const cellules = lignes[1].split(';');
    expect(res.text).not.toMatch(/\{"statut_avant_entree/); // aucun JSON en cellule
    expect(cellules[1]).toBe('BENALI');                     // NOM en majuscules
    expect(cellules[10]).toBe('Oui');                       // BRSA
    expect(cellules[12]).toBe('CMS');                       // référent unique traduit
    expect(cellules[15]).toBe("Demandeur d'emploi");
    expect(cellules[16]).toBe('12 à 24 mois');
    expect(cellules[17]).toBe('Niveau 3 (CAP/BEP)');
    expect(cellules[21]).toBe('100');                       // complétude du questionnaire
    expect(cellules[23]).toBe('Emploi durable');
    expect(cellules[25]).toBe('11');                        // 21/08 → 01/09
    expect(cellules[26]).toBe('Non relevée');               // sortie connue, relevé absent
  });

  it('« Non renseigné » pour un BRSA inconnu, cellule VIDE pour les autres absences', async () => {
    brancherExport({ participants: [{ ...PARTICIPANT, brsa: null, ft_categorie: null, city: null, criteres: null }] });
    const res = await getExport('/api/exports/fse-plus?projet=1', 'ADMIN');
    const ligne = res.text.replace(/^\ufeff/, '').split('\n').filter((l) => l && !l.startsWith('#'))[1].split(';');
    expect(ligne[5]).toBe('');             // commune inconnue → vide
    expect(ligne[9]).toBe('');             // aucun critère → vide
    expect(ligne[10]).toBe('Non renseigné'); // exception dictée par l'autorité
    expect(ligne[11]).toBe('');            // catégorie FT inconnue → vide
  });

  it('porte les 5 lignes d’en-tête de traçabilité (généré le, par, périmètre, lignes, mention)', async () => {
    brancherExport();
    const res = await getExport('/api/exports/fse-plus?projet=1&annee=2026&trimestre=3', 'ADMIN');
    const meta = res.text.replace(/^﻿/, '').split('\n').filter((l) => l.startsWith('#'));
    expect(meta).toHaveLength(5);
    expect(meta[0]).toMatch(/Participants FSE\+/);
    expect(meta[1]).toMatch(/Généré par;cip\.test/);
    expect(meta[2]).toMatch(/Périmètre/);
    expect(meta[3]).toMatch(/Nombre de lignes;1/);
    expect(meta[4]).toMatch(/font foi/);
    expect(res.headers['content-disposition']).toMatch(/fse-participants_ASI-2026-2027_2026_T3\.csv/);
  });

  it('ZÉRO LIGNE → 409 motivé, JAMAIS un fichier vide', async () => {
    brancherExport({ participants: [] });
    const res = await getExport('/api/exports/fse-plus?projet=1&annee=2026&trimestre=1', 'ADMIN');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXPORT_VIDE');
    expect(res.body.error).toMatch(/Aucun participant/);
  });

  it('le journal RGPD est écrit AVANT l’envoi — et son échec fait ÉCHOUER l’export', async () => {
    brancherExport();
    await getExport('/api/exports/fse-plus?projet=1', 'ADMIN');
    const appels = mockQuery.mock.calls.map(([s]) => String(s));
    const iJournal = appels.findIndex((s) => /INSERT INTO rgpd_audit_log/.test(s));
    expect(iJournal).toBeGreaterThan(-1);
    const log = mockQuery.mock.calls[iJournal][1];
    expect(log[1]).toBe('EXPORT_FSE_PLUS');
    expect(JSON.parse(log[4])).toMatchObject({ lignes: 1, projet_code: 'ASI-2026-2027' });

    brancherExport({ journalKo: true });
    const ko = await getExport('/api/exports/fse-plus?projet=1', 'ADMIN');
    expect(ko.status).toBe(500);
    expect(ko.text).not.toMatch(/BENALI/); // aucun fichier nominatif non tracé
  });

  it('sans paramètre « projet » : retombe sur l’unique opération ASI active (le bouton existant continue de fonctionner)', async () => {
    brancherExport();
    const res = await getExport('/api/exports/fse-plus?annee=2026&trimestre=3', 'ADMIN');
    expect(res.status).toBe(200);
  });

  it('plusieurs opérations actives sans « projet » : 400 qui NOMME les candidats', async () => {
    mockQuery.mockImplementation((sql) => (/FROM insertion_projets WHERE actif/.test(String(sql))
      ? Promise.resolve({ rows: [PROJET, { ...PROJET, id: 2, code: 'ASI-2028' }] })
      : Promise.resolve({ rows: [] })));
    const res = await getExport('/api/exports/fse-plus', 'ADMIN');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROJET_REQUIS');
    expect(res.body.projets).toHaveLength(2);
  });
});

describe('CONTRAT GET /exports/fse-plus/bilan — agrégat non nominatif', () => {
  it('rend les 8 sections du bilan d’exécution, sans aucun nom', async () => {
    brancherExport();
    const res = await getExport('/api/exports/fse-plus/bilan?projet=1&annee=2026', 'ADMIN');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(expect.arrayContaining([
      'identification', 'participants', 'indicateurs_entree', 'indicateurs_sortie',
      'indicateurs_six_mois', 'completude', 'moyens', 'methode',
    ]));
    expect(res.body.identification.nominatif).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/Benali|BENALI|Karim/);
    // La ligne « non relevée » est OBLIGATOIRE (elle dit ce qu'on ne sait pas).
    expect(res.body.indicateurs_six_mois.non_relevee).toBe(1);
    // Les heures viennent de work_hours.hours_worked (fin du calcul fautif sur
    // des colonnes start_time/end_time qui n'existent pas).
    expect(res.body.moyens.heures_activite_participants).toBe(182.5);
    expect(res.body.moyens.feuilles_de_temps.validees).toBeNull(); // jamais zéro
    expect(res.body.methode.completude_dossier).toMatch(/sans objet/);
  });

  it('ZÉRO participant → 409, jamais un bilan vide signé par la direction', async () => {
    brancherExport({ participants: [] });
    const res = await getExport('/api/exports/fse-plus/bilan?projet=1&annee=2026', 'ADMIN');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXPORT_VIDE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CONTRAT PUT /insertion/diagnostic/:id — questionnaire FSE+ typé', () => {
  it('REFUSE en 400 une réponse hors schéma, en nommant l’item fautif', async () => {
    const res = await put('/api/insertion/diagnostic/5', 'RH', { fse_entree: { statut_avant_entree: 'retraite' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Questionnaire FSE+ invalide');
    expect(res.body.erreurs[0].cle).toBe('statut_avant_entree');
  });

  it('REFUSE une clé inconnue (sinon la réponse disparaîtrait de l’export sans bruit)', async () => {
    const res = await put('/api/insertion/diagnostic/5', 'RH', { fse_entree: { revenu_mensuel: 800 } });
    expect(res.status).toBe(400);
    expect(res.body.erreurs[0].motif).toMatch(/Champ inconnu/);
  });

  it('enregistre un questionnaire COMPLET, pose la complétude et horodate le PREMIER recueil', async () => {
    let insertSql = null; let insertParams = null;
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/INSERT INTO insertion_diagnostics/.test(s)) {
        insertSql = s; insertParams = params;
        return Promise.resolve({ rows: [{ id: 3, employee_id: 5, fse_entree: params[params.indexOf(params.find((p) => typeof p === 'string' && p.includes('statut_avant_entree')))] }] });
      }
      if (/FROM employees WHERE id/.test(s)) return Promise.resolve({ rows: [{ brsa: true, france_travail_id: null }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await put('/api/insertion/diagnostic/5', 'RH', {
      fse_entree: {
        statut_avant_entree: 'demandeur_emploi', duree_sans_emploi: 'moins_6_mois',
        foyer_monoparental: true, sans_domicile_stable: false, ressources_principales: 'rsa',
      },
    });
    expect(res.status).toBe(200);
    expect(insertSql).toMatch(/fse_entree_complet/);
    expect(insertSql).toMatch(/fse_entree_saisie_at = COALESCE\(insertion_diagnostics\.fse_entree_saisie_at, NOW\(\)\)/);
    expect(insertParams).toContain(true);
    // La valeur héritée « moins_6_mois » est NORMALISÉE avant écriture.
    expect(insertParams.find((p) => typeof p === 'string' && p.includes('duree_sans_emploi'))).toMatch(/"lt_6m"/);
    expect(res.body.fse_completude).toMatchObject({ total: 5 });
    expect(res.body.suggestions_fse).toBeDefined();
  });

  it('la complétude n’est JAMAIS reçue du client (une complétude déclarée est invérifiable)', async () => {
    let params = null;
    mockQuery.mockImplementation((sql, p) => {
      if (/INSERT INTO insertion_diagnostics/.test(String(sql))) { params = p; return Promise.resolve({ rows: [{ id: 3 }] }); }
      return Promise.resolve({ rows: [] });
    });
    const res = await put('/api/insertion/diagnostic/5', 'RH', { fse_entree_complet: true, commentaire_logement: 'x' });
    expect(res.status).toBe(200);
    expect(params).not.toContain(true);
  });

  it('GET /diagnostic renvoie suggestions_fse et fse_completude à côté de la donnée', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM insertion_diagnostics WHERE employee_id/.test(s)) {
        return Promise.resolve({ rows: [{ id: 3, employee_id: 5, logement_statut: 'heberge', fse_entree: {} }] });
      }
      if (/FROM employees WHERE id/.test(s)) return Promise.resolve({ rows: [{ brsa: true, france_travail_id: null }] });
      return Promise.resolve({ rows: [{ pn: 1 }] });
    });
    const res = await get('/api/insertion/diagnostic/5', 'RH');
    expect(res.status).toBe(200);
    expect(res.body.suggestions_fse.sans_domicile_stable).toEqual({ valeur: true, source: 'Logement : hébergé chez un tiers' });
    expect(res.body.fse_completude.renseignes).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CONTRAT clôture d’entretien — durée, assiduité, sortie FSE+', () => {
  const milestoneComplet = (over = {}) => ({
    id: 10, employee_id: 5, parcours_num: 1, milestone_type: 'bilan_intermediaire',
    titre: 'Bilan n° 1', due_date: '2026-06-01', status: 'planifie', completed_date: null,
    locked_at: null, previous_review: null, validations: null,
    sortie_classification: null, sortie_documents: null, fse_sortie: null,
    ...Object.fromEntries(FREINS.map((f) => [f.column, 2])),
    ...over,
  });

  it('REFUSE une durée aberrante (600 minutes = 10 h : au-delà c’est une faute de frappe)', async () => {
    const res = await post('/api/insertion/milestones/10/close', 'RH', { duree_minutes: 1200 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Erreur de validation');
  });

  it('REFUSE un motif d’absence hors de la liste fermée', async () => {
    const res = await post('/api/insertion/milestones/10/close', 'RH', { presence: 'absent', absence_motif: 'arret_maladie_dos' });
    expect(res.status).toBe(400);
  });

  it('écrit durée et présence à la clôture, sans écraser ce qui n’est pas transmis', async () => {
    let closeParams = null;
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/SELECT \* FROM insertion_milestones WHERE id = \$1 FOR UPDATE/.test(s)) return Promise.resolve({ rows: [milestoneComplet()] });
      if (/status = 'planifie' LIMIT 1/.test(s)) return Promise.resolve({ rows: [{ id: 11 }] });
      if (/UPDATE insertion_milestones/.test(s) && /locked_at = NOW\(\)/.test(s)) {
        closeParams = params;
        return Promise.resolve({ rows: [milestoneComplet({ status: 'realise', locked_at: new Date(), duree_minutes: 45, presence: 'present' })] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/milestones/10/close', 'RH', { duree_minutes: 45, presence: 'present' });
    expect(res.status).toBe(200);
    expect(closeParams).toEqual(expect.arrayContaining([45, 'present']));
    expect(res.body.milestone.duree_minutes).toBe(45);
  });

  it('REFUSE la clôture d’un bilan de sortie dont le questionnaire FSE+ est hors schéma (corrigeable AVANT le verrou)', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT \* FROM insertion_milestones WHERE id = \$1 FOR UPDATE/.test(s)) {
        return Promise.resolve({ rows: [milestoneComplet({
          milestone_type: 'bilan_sortie', sortie_classification: 'emploi_durable',
          sortie_documents: { stc: true }, fse_sortie: { type_contrat: 'apprentissage' },
        })] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/milestones/10/close', 'RH', {});
    expect(res.status).toBe(409);
    expect(res.body.problems.map((p) => p.code)).toContain('fse_sortie_invalide');
  });

  it('clôture d’un bilan de sortie classé : la sortie FSE+ est écrite DANS la transaction', async () => {
    let upsert = null;
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/SELECT \* FROM insertion_milestones WHERE id = \$1 FOR UPDATE/.test(s)) {
        return Promise.resolve({ rows: [milestoneComplet({
          milestone_type: 'bilan_sortie', sortie_classification: 'emploi_durable',
          sortie_type: 'CDI', sortie_documents: { stc: true },
        })] });
      }
      if (/UPDATE insertion_milestones/.test(s) && /locked_at = NOW\(\)/.test(s)) {
        return Promise.resolve({ rows: [milestoneComplet({
          milestone_type: 'bilan_sortie', status: 'realise', completed_date: '2026-08-21',
          sortie_classification: 'emploi_durable', sortie_type: 'CDI', locked_at: new Date(),
        })] });
      }
      if (/INSERT INTO insertion_fse_sorties/.test(s)) { upsert = params; return Promise.resolve({ rows: [{ id: 77, source: 'bilan' }] }); }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/milestones/10/close', 'RH', { completed_date: '2026-08-21' });
    expect(res.status).toBe(200);
    expect(upsert).not.toBeNull();
    expect(upsert[4]).toBe('bilan');
    expect(upsert[6]).toBe('emploi_durable');
    expect(res.body.sortie_fse).toMatchObject({ id: 77 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CONTRAT GET /insertion/alertes/:id — obligations FSE+', () => {
  const brancherAlertes = (emp, extra = {}) => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM employees e WHERE e\.id = \$1/.test(s)) return Promise.resolve({ rows: [emp] });
      if (/FROM insertion_projet_participants pp/.test(s) && /pr\.type = 'asi'/.test(s)) return Promise.resolve({ rows: extra.projets || [] });
      if (/FROM insertion_fse_sorties/.test(s)) return Promise.resolve({ rows: extra.sorties || [] });
      if (/fse_entree_complet FROM insertion_diagnostics/.test(s)) return Promise.resolve({ rows: extra.diagnostics || [] });
      return Promise.resolve({ rows: [] });
    });
  };
  const base = {
    id: 5, first_name: 'K', last_name: 'B', insertion_status: 'termine', insertion_start_date: '2025-07-15',
    pass_iae_number: null, pass_iae_end: null, cddi_derogation_motif: null, parcours_num: 1,
    contract_end: null, brsa: null, referent_unique_type: 'cms',
  };
  const types = (body) => body.alertes.map((a) => a.type);

  it('sortie FSE+ à saisir : critique passé le premier seuil, avec le nombre de jours', async () => {
    const finContrat = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
    brancherAlertes({ ...base, contract_end: finContrat });
    const res = await get('/api/insertion/alertes/5', 'RH');
    expect(res.status).toBe(200);
    const a = res.body.alertes.find((x) => x.type === 'fse_sortie_a_saisir');
    expect(a).toBeDefined();
    expect(a.niveau).toBe('critique');
    expect(a.jours).toBeGreaterThanOrEqual(15);
  });

  it('pas d’alerte de sortie tant que le premier seuil n’est pas atteint', async () => {
    brancherAlertes({ ...base, contract_end: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10) });
    const res = await get('/api/insertion/alertes/5', 'RH');
    expect(types(res.body)).not.toContain('fse_sortie_a_saisir');
  });

  it('aucune alerte de sortie quand la sortie EST enregistrée', async () => {
    brancherAlertes(
      { ...base, contract_end: new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10) },
      { sorties: [{ id: 1, date_sortie: '2026-01-01', situation_6mois: 'emploi_durable' }] }
    );
    const res = await get('/api/insertion/alertes/5', 'RH');
    expect(types(res.body)).not.toContain('fse_sortie_a_saisir');
  });

  it('référent unique non déterminé alors que la personne est BRSA → critique', async () => {
    brancherAlertes({ ...base, brsa: true, referent_unique_type: 'non_determine' });
    const res = await get('/api/insertion/alertes/5', 'RH');
    const a = res.body.alertes.find((x) => x.type === 'referent_non_determine');
    expect(a.niveau).toBe('critique');
    expect(a.message).toMatch(/Département/);
  });

  it('questionnaire FSE+ d’entrée manquant pour un participant ASI', async () => {
    brancherAlertes(
      { ...base, insertion_status: 'en_parcours', insertion_start_date: '2026-01-01' },
      { projets: [{ code: 'ASI-2026-2027' }], diagnostics: [{ fse_entree_complet: false }] }
    );
    const res = await get('/api/insertion/alertes/5', 'RH');
    const a = res.body.alertes.find((x) => x.type === 'fse_entree_manquante');
    expect(a).toBeDefined();
    expect(a.niveau).toBe('critique'); // au-delà du délai de diagnostic
  });

  it('aucune alerte FSE+ d’entrée hors opération cofinancée', async () => {
    brancherAlertes({ ...base, insertion_status: 'en_parcours' }, { projets: [] });
    const res = await get('/api/insertion/alertes/5', 'RH');
    expect(types(res.body)).not.toContain('fse_entree_manquante');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CONTRAT /insertion/projets et /insertion/fse — habilitations', () => {
  it('la lecture des projets est ouverte au module (le MANAGER voit l’existence d’un rattachement)', async () => {
    mockQuery.mockResolvedValue({ rows: [{ ...PROJET, nb_participants: 14 }] });
    const res = await get('/api/insertion/projets', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body[0].nb_participants).toBe(14);
  });

  it('l’écriture d’un projet est refusée au MANAGER', async () => {
    const res = await post('/api/insertion/projets', 'MANAGER', { code: 'X', nom: 'X', type: 'asi' });
    expect(res.status).toBe(403);
  });

  it('code dupliqué → 409 explicite', async () => {
    mockQuery.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));
    const res = await post('/api/insertion/projets', 'ADMIN', { code: 'ASI-2026-2027', nom: 'Doublon', type: 'asi' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CODE_DUPLIQUE');
  });

  it('le rattachement d’un participant est JOURNALISÉ (décision opposable)', async () => {
    mockQuery.mockImplementation((sql) => (/INSERT INTO insertion_projet_participants/.test(String(sql))
      ? Promise.resolve({ rows: [{ id: 1, employee_id: 5 }] })
      : Promise.resolve({ rows: [] })));
    const res = await post('/api/insertion/projets/1/participants', 'RH', { employee_id: 5, date_entree: '2026-01-01' });
    expect(res.status).toBe(201);
    const log = mockQuery.mock.calls.find(([s]) => /INSERT INTO rgpd_audit_log/.test(String(s)));
    expect(log[1][1]).toBe('INSERTION_PROJET_PARTICIPANT');
  });

  it('le questionnaire FSE+ d’un salarié est fermé au MANAGER (statuts sociaux)', async () => {
    expect((await get('/api/insertion/fse/5', 'MANAGER')).status).toBe(403);
    expect((await get('/api/insertion/conformite/5', 'MANAGER')).status).toBe(403);
    expect((await post('/api/insertion/fse/5/sortie', 'MANAGER', {})).status).toBe(403);
  });

  it('POST /fse/:id/sortie enregistre une sortie SANS bilan (le point décisif de la PR A)', async () => {
    let upsert = null;
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/SELECT id FROM employees WHERE id/.test(s)) return Promise.resolve({ rows: [{ id: 5 }] });
      if (/COALESCE\(parcours_num, 1\) AS pn FROM employees/.test(s)) return Promise.resolve({ rows: [{ pn: 1 }] });
      if (/INSERT INTO insertion_fse_sorties/.test(s)) { upsert = params; return Promise.resolve({ rows: [{ id: 42 }] }); }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/fse/5/sortie', 'RH', {
      date_sortie: '2026-08-21', situation_sortie: 'chomage',
      fse_sortie: { situation_sortie: 'chomage', type_contrat: 'sans_objet' },
    });
    expect(res.status).toBe(201);
    expect(upsert[4]).toBe('sans_bilan');
    expect(res.body.source).toBe('sans_bilan');
  });

  it('POST /fse/:id/six-mois sans sortie enregistrée → 409 (pas de ligne fantôme)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await post('/api/insertion/fse/5/six-mois', 'RH', { situation_6mois: 'formation' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SORTIE_ABSENTE');
  });

  it('GET /conformite sans projet → 400 plutôt qu’un tableau trompeur', async () => {
    const res = await get('/api/insertion/conformite', 'ADMIN');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROJET_REQUIS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GARDE STATIQUE — la migration doit rester REJOUABLE
// init-db.js s'exécute à chaque démarrage : une instruction non idempotente
// ferait échouer le déploiement suivant, et la transaction entière avec lui.
// ═══════════════════════════════════════════════════════════════════════════
describe('GARDE migrations/insertion-fse.js — idempotence', () => {
  const brut = require('fs').readFileSync(require.resolve('../../src/scripts/migrations/insertion-fse.js'), 'utf8');
  // On raisonne sur le CODE, pas sur les commentaires : un commentaire qui cite
  // « ADD COLUMN » ou « COMMIT » n'est pas une instruction SQL.
  const src = brut.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('chaque CREATE TABLE / CREATE INDEX / ADD COLUMN porte « IF NOT EXISTS »', () => {
    const fautifs = [];
    for (const m of src.matchAll(/CREATE TABLE(?! IF NOT EXISTS)/g)) fautifs.push(`CREATE TABLE @${m.index}`);
    for (const m of src.matchAll(/CREATE INDEX(?! IF NOT EXISTS)/g)) fautifs.push(`CREATE INDEX @${m.index}`);
    for (const m of src.matchAll(/ADD COLUMN(?! IF NOT EXISTS)/g)) fautifs.push(`ADD COLUMN @${m.index}`);
    expect(fautifs).toEqual([]);
  });

  it('les seeds sont gardés (ON CONFLICT DO NOTHING pour les projets, NOT EXISTS pour le registre)', () => {
    expect(src).toMatch(/INSERT INTO insertion_projets[\s\S]*ON CONFLICT \(code\) DO NOTHING/);
    expect(src).toMatch(/INSERT INTO rgpd_registre[\s\S]*WHERE NOT EXISTS/);
    expect(brut).toMatch(/ILIKE 'Cofinancement FSE\+%'/);
  });

  it('les CHECK reconstruits passent par un DO-scan de pg_constraint (jamais un DROP aveugle)', () => {
    expect(src).toMatch(/FROM pg_constraint[\s\S]*insertion_milestones/);
    expect(src).toMatch(/NOT ILIKE '%fse_sortie_j15%'/);
    // Les quatre nouveaux types d'alerte sont bien dans la liste reconstruite.
    const { ALERT_TYPES } = require('../../src/scripts/migrations/insertion-fse');
    expect(ALERT_TYPES).toEqual(expect.arrayContaining(['fse_sortie_j15', 'fse_sortie_j25', 'fse_entree_manquante', 'suivi_6mois']));
    // …et les types HISTORIQUES sont conservés (les reconstruire sans eux
    // rendrait les alertes existantes inécrivables).
    expect(ALERT_TYPES).toEqual(expect.arrayContaining(['planification', 'rappel_j7', 'rappel_j1', 'retard', 'pass_iae_7m', 'pass_iae_2m']));
  });

  it('aucune transaction interne (init-db possède la sienne)', () => {
    expect(src).not.toMatch(/'BEGIN'/);
    expect(src).not.toMatch(/'COMMIT'/);
    expect(src).not.toMatch(/'ROLLBACK'/);
  });
});
