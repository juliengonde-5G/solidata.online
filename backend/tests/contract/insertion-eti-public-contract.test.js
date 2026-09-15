// ═══════════════════════════════════════════════════════════════════════════
// CONTRAT — ÉCRAN ETI À JETON PUBLIC (PR C, lot 5)
// ───────────────────────────────────────────────────────────────────────────
// Deux surfaces, deux régimes :
//   - `/api/eti/renouvellement/:token` est montée SANS authentification (comme
//     `/api/enquetes/public/:token`) : n'importe qui porteur du lien y écrit.
//     Ce test vérifie donc surtout ce qu'elle NE rend PAS.
//   - `POST /api/insertion/renouvellements/:id/lien-eti` produit le jeton, et
//     reste soumise aux habilitations du module (dont la garde d'appartenance
//     du MANAGER).
//
// Ce que ces tests tiennent :
//   1. 404 UNIFORME — jeton malformé, inconnu, entretien d'un autre type :
//      même réponse. Distinguer ferait de la route un oracle d'existence.
//   2. 410 — expiré (`LIEN_EXPIRE`) et clôturé (`ENTRETIEN_CLOTURE`) sont deux
//      situations distinctes pour l'encadrant ; aucune écriture n'a lieu.
//   3. PÉRIMÈTRE DE LA RÉPONSE — prénom, nom, poste, fin de contrat, le
//      formulaire, rien d'autre : ni freins, ni statut social, ni référent, ni
//      `employee_id`.
//   4. LISTE BLANCHE D'ÉCRITURE — 3 champs, `champs_refuses` sinon, et la
//      réponse est `{ ok: true }`, jamais la ligne.
//   5. VALIDATION HORODATÉE `mode: 'jeton'` — on doit pouvoir dire par quelle
//      porte un avis est entré sur une pièce qui fonde un renouvellement.
//   6. GÉNÉRATION — 400 hors renouvellement, 409 verrouillé, 403 pour un
//      MANAGER qui n'est pas l'encadrant référent, journal bloquant.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;
process.env.PCM_ENCRYPTION_KEY = process.env.PCM_ENCRYPTION_KEY || 'test-pcm-key';
process.env.PUBLIC_BASE_URL = 'https://solidata.online';

const mockQuery = jest.fn();
const releases = [];
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => {
    if (global.__CONNECT_KO__) throw new Error('pool épuisé');
    return { query: (...a) => mockQuery(...a), release: () => releases.push(1) };
  },
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
  // La MÊME limite qu'en production (`src/index.js`) : sans elle, un corps de
  // 2 Mo serait refusé par le parseur (413) et la borne applicative qu'on
  // vérifie ici ne serait jamais exercée.
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/eti', require('../../src/routes/insertion/eti-public'));
  app.use('/api/insertion', require('../../src/routes/insertion'));
});

const JETON = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const demain = () => new Date(Date.now() + 86400000).toISOString();
const hier = () => new Date(Date.now() - 86400000).toISOString();

const ENTRETIEN = {
  id: 42, employee_id: 5, milestone_type: 'renouvellement', status: 'planifie',
  locked_at: null, eti_token_expires_at: demain(),
  // Le formulaire tel que l'ENCADRANT l'a commencé — `rempli_par: 'eti'` est
  // posé par le serveur à l'écriture, et c'est lui qui autorise la relecture.
  renouvellement_form: { assiduite: 'bonne', rempli_par: 'eti' }, renouvellement_avis: null,
  renouvellement_duree_mois: null, validations: [{ role: 'cip', at: '2026-01-01T00:00:00Z' }],
  first_name: 'Amine', last_name: 'BENALI', position: 'Agent de tri',
  contract_end: '2026-12-31',
  // Champs qui ne doivent JAMAIS sortir : ils ne sont pas dans la projection
  // SQL de la route, mais un faux `pg` peut les rendre — c'est précisément ce
  // qu'on veut vérifier côté réponse.
};

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
    if (/WHERE m\.eti_token = \$1/.test(s)) return Promise.resolve({ rows: [ENTRETIEN] });
    if (/UPDATE insertion_milestones SET/.test(s)) return Promise.resolve({ rows: [{ eti_token_expires_at: demain() }] });
    if (/FROM insertion_milestones WHERE id/.test(s)) {
      return Promise.resolve({ rows: [{ id: 42, employee_id: 5, milestone_type: 'renouvellement', locked_at: null }] });
    }
    if (/FROM settings/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => { mockQuery.mockReset(); branche(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/eti/renouvellement/:token', () => {
  test('jeton valide → le formulaire et RIEN d’autre', async () => {
    const r = await request(app).get(`/api/eti/renouvellement/${JETON}`);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual([
      'avis', 'contract_end', 'duree_mois', 'expire_le', 'formulaire', 'lecture_seule', 'nom', 'poste', 'prenom',
    ]);
    expect(r.body.prenom).toBe('Amine');
    expect(r.body.formulaire).toEqual({ assiduite: 'bonne', rempli_par: 'eti' });
    expect(r.body.lecture_seule).toBe(false);
  });

  // ═══ CORRECTIF B-02 ═════════════════════════════════════════════════════
  // `renouvellement_form` est écrit par DEUX formulaires : celui-ci et la trame
  // INTERNE de renouvellement que la CIP remplit dans la fiche, dont le champ
  // « Motifs / commentaires » est un texte libre. Le GET public rendait le blob
  // ENTIER — et l'écran public le pré-remplissait — à qui détient un lien de
  // 60 jours, transmissible, sans session.
  test('le texte libre de la CIP ne sort JAMAIS, ni son avis', async () => {
    branche({
      'WHERE m.eti_token = $1': [{
        ...ENTRETIEN,
        renouvellement_form: {
          assiduite: 'moyenne',
          commentaires: "Arrêts maladie répétés depuis janvier ; suivi psy en cours. Ne pas renouveler.",
        },
        renouvellement_avis: 'defavorable',
        renouvellement_duree_mois: 2,
      }],
    });
    const r = await request(app).get(`/api/eti/renouvellement/${JETON}`);
    expect(r.status).toBe(200);
    const brut = JSON.stringify(r.body);
    expect(brut).not.toContain('hospitalisation');
    expect(brut).not.toContain('Arrêts maladie');
    expect(brut).not.toContain('suivi psy');
    // Trame interne non commencée par l'encadrant → écran VIERGE, et ni l'avis
    // de la structure ni la durée qu'elle propose ne sont montrés avant qu'il
    // ait donné le sien.
    expect(r.body.formulaire).toEqual({});
    expect(r.body.avis).toBeNull();
    expect(r.body.duree_mois).toBeNull();
  });

  test('une clé étrangère glissée dans le blob n’est pas relayée (liste BLANCHE)', async () => {
    branche({
      'WHERE m.eti_token = $1': [{
        ...ENTRETIEN,
        renouvellement_form: { assiduite: 'bonne', rempli_par: 'eti', commentaire_cip_interne: 'SECRET', frein_sante: 5 },
      }],
    });
    const r = await request(app).get(`/api/eti/renouvellement/${JETON}`);
    const brut = JSON.stringify(r.body);
    expect(brut).not.toContain('SECRET');
    expect(brut).not.toContain('frein_sante');
    expect(r.body.formulaire).toEqual({ assiduite: 'bonne', rempli_par: 'eti' });
  });

  test('aucun identifiant de salarié ni d’entretien ne sort', async () => {
    const r = await request(app).get(`/api/eti/renouvellement/${JETON}`);
    const brut = JSON.stringify(r.body);
    expect(r.body).not.toHaveProperty('employee_id');
    expect(r.body).not.toHaveProperty('id');
    expect(brut).not.toContain('employee_id');
    // … ni aucun des champs que seul le module authentifié doit servir.
    for (const interdit of ['frein_', 'brsa', 'ft_categorie', 'referent_unique', 'insertion_status', 'pass_iae']) {
      expect(brut).not.toContain(interdit);
    }
  });

  test('jeton MALFORMÉ → 404 uniforme, sans toucher la base', async () => {
    for (const mauvais of ['zzz', '123', 'a1b2c3d4e5f60718293a4b5c6d7e8f9', `${JETON}00`, 'SELECT']) {
      const r = await request(app).get(`/api/eti/renouvellement/${mauvais}`);
      expect(r.status).toBe(404);
      expect(r.body.code).toBe('LIEN_INCONNU');
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('jeton INCONNU → 404, avec le MÊME message qu’un jeton malformé', async () => {
    branche({ 'WHERE m.eti_token = $1': [] });
    const r = await request(app).get(`/api/eti/renouvellement/${JETON}`);
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('LIEN_INCONNU');
  });

  test('entretien d’un AUTRE type → 404 (jamais « ce lien existe mais… »)', async () => {
    branche({ 'WHERE m.eti_token = $1': [{ ...ENTRETIEN, milestone_type: 'bilan_intermediaire' }] });
    const r = await request(app).get(`/api/eti/renouvellement/${JETON}`);
    expect(r.status).toBe(404);
  });

  test('jeton EXPIRÉ → 410 LIEN_EXPIRE', async () => {
    branche({ 'WHERE m.eti_token = $1': [{ ...ENTRETIEN, eti_token_expires_at: hier() }] });
    const r = await request(app).get(`/api/eti/renouvellement/${JETON}`);
    expect(r.status).toBe(410);
    expect(r.body.code).toBe('LIEN_EXPIRE');
  });

  test('entretien VERROUILLÉ → 410 ENTRETIEN_CLOTURE (autre situation, autre message)', async () => {
    branche({ 'WHERE m.eti_token = $1': [{ ...ENTRETIEN, locked_at: '2026-05-01T10:00:00Z' }] });
    const r = await request(app).get(`/api/eti/renouvellement/${JETON}`);
    expect(r.status).toBe(410);
    expect(r.body.code).toBe('ENTRETIEN_CLOTURE');
  });

  test('une échéance ABSENTE vaut expiré (jamais « valable pour toujours »)', async () => {
    branche({ 'WHERE m.eti_token = $1': [{ ...ENTRETIEN, eti_token_expires_at: null }] });
    const r = await request(app).get(`/api/eti/renouvellement/${JETON}`);
    expect(r.status).toBe(410);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('PUT /api/eti/renouvellement/:token', () => {
  const put = (corps, token = JETON) => request(app).put(`/api/eti/renouvellement/${token}`).send(corps);

  test('écrit les trois champs et rend `{ ok: true }`, jamais la ligne', async () => {
    const r = await put({ renouvellement_form: { assiduite: 'bonne' }, renouvellement_avis: 'favorable', renouvellement_duree_mois: 6 });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    const maj = mockQuery.mock.calls.find(([s]) => String(s).includes('UPDATE insertion_milestones SET'));
    expect(maj).toBeDefined();
    expect(String(maj[0])).toContain('renouvellement_form = $1');
    expect(String(maj[0])).toContain('validations = $4');
  });

  // ═══ CORRECTIF M-02 — la VALEUR est bornée, pas seulement le nom du champ ══
  // Mesuré sur le routeur réel, sans authentification : 2 Mo écrits dans une
  // colonne JSONB, et 20 000 niveaux d'imbrication faisant tomber le
  // sérialiseur. Le rate limit borne le débit, jamais la taille.
  test('un formulaire de 2 Mo est REFUSÉ — avant toute requête', async () => {
    const r = await put({ renouvellement_form: { commentaires: 'x'.repeat(2 * 1024 * 1024) } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('FORMULAIRE_INVALIDE');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('un formulaire profondément imbriqué est REFUSÉ (aucune pile épuisée)', async () => {
    let profond = {};
    for (let i = 0; i < 2000; i += 1) profond = { a: profond };
    const r = await put({ renouvellement_form: { commentaires: profond } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('FORMULAIRE_INVALIDE');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('une clé inconnue, un tableau trop long, un objet imbriqué → 400', async () => {
    expect((await put({ renouvellement_form: { frein_sante: 5 } })).status).toBe(400);
    expect((await put({ renouvellement_form: { motifs: Array(21).fill('x') } })).status).toBe(400);
    expect((await put({ renouvellement_form: { commentaires: { a: 1 } } })).status).toBe(400);
    expect((await put({ renouvellement_form: [] })).status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // ═══ CORRECTIF M-09 — l'écriture ANONYME est transactionnelle et tracée ═══
  // Snapshot, UPDATE et journal RGPD étaient trois gestes indépendants dont
  // deux avalaient leurs erreurs : une écriture faite SANS COMPTE pouvait
  // aboutir sans une seule ligne au registre. La trace est ici la seule chose
  // qui reste.
  test('BEGIN / COMMIT encadrent l’écriture, et le journal est DANS la transaction', async () => {
    const r = await put({ renouvellement_avis: 'favorable' });
    expect(r.status).toBe(200);
    const ordre = mockQuery.mock.calls.map(([q]) => String(q).trim().split(/\s+/).slice(0, 3).join(' '));
    expect(ordre).toContain('BEGIN');
    expect(ordre).toContain('COMMIT');
    const iJournal = mockQuery.mock.calls.findIndex(([q]) => /INSERT INTO rgpd_audit_log/.test(String(q)));
    const iCommit = ordre.indexOf('COMMIT');
    expect(iJournal).toBeGreaterThan(-1);
    expect(iJournal).toBeLessThan(iCommit);
  });

  test('journal RGPD en échec → 500, ROLLBACK, et AUCUNE écriture conservée', async () => {
    mockQuery.mockImplementation((sql) => {
      const q = String(sql);
      if (/INSERT INTO rgpd_audit_log/.test(q)) return Promise.reject(new Error('registre indisponible'));
      if (/WHERE m\.eti_token = \$1/.test(q)) return Promise.resolve({ rows: [ENTRETIEN] });
      return Promise.resolve({ rows: [] });
    });
    const r = await put({ renouvellement_avis: 'favorable' });
    expect(r.status).toBe(500);
    const ordre = mockQuery.mock.calls.map(([q]) => String(q).trim().split(/\s+/)[0]);
    expect(ordre).toContain('ROLLBACK');
    expect(ordre).not.toContain('COMMIT');
  });

  test('`pool.connect()` en échec → 500 sans fuite et sans message technique', async () => {
    global.__CONNECT_KO__ = true;
    const r = await put({ renouvellement_avis: 'favorable' });
    global.__CONNECT_KO__ = false;
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('pool épuisé');
  });

  test('le serveur POSE `rempli_par: eti` — un client ne décide pas de ce qui sera relu', async () => {
    const r = await put({ renouvellement_form: { assiduite: 'bonne', rempli_par: 'cip' } });
    expect(r.status).toBe(200);
    const maj = mockQuery.mock.calls.find(([s]) => String(s).includes('UPDATE insertion_milestones SET'));
    expect(JSON.parse(maj[1][0]).rempli_par).toBe('eti');
  });

  test('un champ hors liste blanche → 400 `champs_refuses`, AVANT toute requête', async () => {
    const r = await put({ renouvellement_avis: 'favorable', status: 'realise', freins: 5 });
    expect(r.status).toBe(400);
    expect(r.body.champs_refuses.sort()).toEqual(['freins', 'status']);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('un corps vide → 400, sans requête', async () => {
    const r = await put({});
    expect(r.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('un avis hors liste → 400 ; une durée hors bornes → 400', async () => {
    expect((await put({ renouvellement_avis: 'super' })).status).toBe(400);
    expect((await put({ renouvellement_duree_mois: 99 })).status).toBe(400);
    expect((await put({ renouvellement_duree_mois: 0 })).status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('entretien VERROUILLÉ → 410 et AUCUNE écriture', async () => {
    branche({ 'WHERE m.eti_token = $1': [{ ...ENTRETIEN, locked_at: '2026-05-01T10:00:00Z' }] });
    const r = await put({ renouvellement_avis: 'favorable' });
    expect(r.status).toBe(410);
    expect(r.body.code).toBe('ENTRETIEN_CLOTURE');
    expect(mockQuery.mock.calls.some(([s]) => String(s).includes('UPDATE insertion_milestones'))).toBe(false);
  });

  test('jeton expiré → 410 et AUCUNE écriture', async () => {
    branche({ 'WHERE m.eti_token = $1': [{ ...ENTRETIEN, eti_token_expires_at: hier() }] });
    const r = await put({ renouvellement_avis: 'favorable' });
    expect(r.status).toBe(410);
    expect(mockQuery.mock.calls.some(([s]) => String(s).includes('UPDATE insertion_milestones'))).toBe(false);
  });

  test('la validation porte `mode: "jeton"` et le PRÉFIXE du jeton, jamais le jeton entier', async () => {
    await put({ renouvellement_avis: 'favorable' });
    const maj = mockQuery.mock.calls.find(([s]) => String(s).includes('UPDATE insertion_milestones SET'));
    const validations = JSON.parse(maj[1][maj[1].length - 2]);
    const eti = validations.find((v) => v.role === 'eti');
    expect(eti).toMatchObject({ role: 'eti', mode: 'jeton', token_prefix: JETON.slice(0, 6) });
    expect(JSON.stringify(validations)).not.toContain(JETON);
    // La signature de la CIP est PRÉSERVÉE : seule celle de l'encadrant est
    // remplacée (un formulaire re-signé remplace la signature précédente).
    expect(validations.find((v) => v.role === 'cip')).toBeDefined();
  });

  test('le geste est journalisé sans compte (`user_id` NULL) et sans le contenu de l’avis', async () => {
    await put({ renouvellement_avis: 'defavorable', renouvellement_form: { commentaires: 'trop absent' } });
    const j = mockQuery.mock.calls.find(([s]) => String(s).includes('INSERT INTO rgpd_audit_log'));
    expect(j).toBeDefined();
    expect(j[1][0]).toBeNull();                    // user_id
    expect(j[1][1]).toBe('INSERTION_ETI_FORMULAIRE_JETON');
    const details = JSON.parse(j[1][4]);
    expect(details).toMatchObject({ milestone_id: 42, token_prefix: JETON.slice(0, 6) });
    expect(JSON.stringify(details)).not.toContain('defavorable');
    expect(JSON.stringify(details)).not.toContain('trop absent');
  });

  test('un entretien déjà RÉALISÉ est historisé avant modification (RES-02)', async () => {
    branche({ 'WHERE m.eti_token = $1': [{ ...ENTRETIEN, status: 'realise' }] });
    await put({ renouvellement_avis: 'favorable' });
    expect(mockQuery.mock.calls.some(([s]) => String(s).includes('INSERT INTO insertion_milestones_history'))).toBe(true);
  });

  test('toute autre adresse sous /api/eti → 404 uniforme', async () => {
    const r = await request(app).get('/api/eti/salaries');
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('LIEN_INCONNU');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/insertion/renouvellements/:id/lien-eti', () => {
  const gen = (role = 'ADMIN', id = 42) => request(app)
    .post(`/api/insertion/renouvellements/${id}/lien-eti`)
    .set('Authorization', `Bearer ${TOKENS[role]}`).send({});

  test('produit un lien PUBLIC et sa date d’expiration', async () => {
    const r = await gen('ADMIN');
    expect(r.status).toBe(201);
    expect(r.body.lien).toMatch(/^https:\/\/solidata\.online\/eti\/renouvellement\/[0-9a-f]{32}$/);
    expect(r.body).toHaveProperty('expire_le');
  });

  test('le jeton écrit en base fait 32 caractères hexadécimaux', async () => {
    await gen('ADMIN');
    const maj = mockQuery.mock.calls.find(([s]) => String(s).includes('SET eti_token = $1'));
    expect(maj[1][0]).toMatch(/^[0-9a-f]{32}$/);
  });

  test('la génération est journalisée avec le PRÉFIXE du jeton seulement', async () => {
    await gen('ADMIN');
    const j = mockQuery.mock.calls.find(([s]) => String(s).includes('INSERT INTO rgpd_audit_log'));
    expect(j[1][1]).toBe('INSERTION_ETI_LIEN_GENERATION');
    const details = JSON.parse(j[1][4]);
    expect(details.token_prefix).toHaveLength(6);
    const maj = mockQuery.mock.calls.find(([s]) => String(s).includes('SET eti_token = $1'));
    expect(JSON.stringify(details)).not.toContain(maj[1][0]);
  });

  test('entretien introuvable → 404 ; type ≠ renouvellement → 400', async () => {
    branche({ 'FROM insertion_milestones WHERE id': [] });
    expect((await gen('ADMIN')).status).toBe(404);
    branche({ 'FROM insertion_milestones WHERE id': [{ id: 42, employee_id: 5, milestone_type: 'bilan_sortie', locked_at: null }] });
    const r = await gen('ADMIN');
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('TYPE_INVALIDE');
  });

  test('entretien VERROUILLÉ → 409, et aucun jeton n’est posé', async () => {
    branche({ 'FROM insertion_milestones WHERE id': [{ id: 42, employee_id: 5, milestone_type: 'renouvellement', locked_at: '2026-05-01T10:00:00Z' }] });
    const r = await gen('ADMIN');
    expect(r.status).toBe(409);
    expect(mockQuery.mock.calls.some(([s]) => String(s).includes('SET eti_token = $1'))).toBe(false);
  });

  test('un MANAGER qui n’est pas l’encadrant référent → 403, sans poser de jeton', async () => {
    branche({
      'FROM insertion_milestones WHERE id': [{ id: 42, employee_id: 5, milestone_type: 'renouvellement', locked_at: null }],
      'LEFT JOIN employees mgr': [{ cip_referent_user_id: 99, manager_user_id: 99 }],
    });
    const r = await gen('MANAGER');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('renouvellement_non_autorise');
    expect(mockQuery.mock.calls.some(([s]) => String(s).includes('SET eti_token = $1'))).toBe(false);
  });

  test('un MANAGER encadrant référent PEUT produire le lien', async () => {
    branche({
      'FROM insertion_milestones WHERE id': [{ id: 42, employee_id: 5, milestone_type: 'renouvellement', locked_at: null }],
      'LEFT JOIN employees mgr': [{ cip_referent_user_id: null, manager_user_id: 7 }],
    });
    expect((await gen('MANAGER')).status).toBe(201);
  });
});
