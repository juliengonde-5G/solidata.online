// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — AUTOMATISATIONS & PURGES RGPD (2.44.0)
// ───────────────────────────────────────────────────────────────────────────
// 1. GET  /api/rgpd/purges              → forme lue telle quelle par l'écran ;
//    un job JAMAIS exécuté renvoie `dernier_passage: null` + `jamais_execute`,
//    jamais une date vide qu'on prendrait pour une exécution muette ;
// 2. POST /api/rgpd/purges/:cle/executer → liste blanche (404 sur clé
//    inconnue), habilitations ADMIN/DPO, et la BONNE ligne dans
//    rgpd_audit_log — écrite même à zéro suppression, puisqu'un humain a agi —
//    doublée dans le journal d'activité générique (table DISTINCTE) ;
// 3. ÉCART DE RECONNAISSANCE COMBLÉ : aucun test ne verrouillait jusqu'ici que
//    POST /registre, /anonymize, /consent et /purge-expired écrivent bien leur
//    ligne de journal. C'est pourtant la demande explicite du client
//    (« vérifier que le registre ET le journal d'audit enregistrent bien »).
//
// Auth réelle (JWT avec claim `mfa: true` — le routeur est sous requireMfa),
// base mockée par routage SQL. Même harnais que rgpd-contract.test.js.
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
const mockLogActivity = jest.fn();
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: (...a) => mockLogActivity(...a),
}));
jest.mock('../../src/services/anonymization', () => ({
  anonymizeCandidate: jest.fn().mockResolvedValue(undefined),
  anonymizeEmployee: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/messagerie', () => ({
  purgeMessagerieRetention: jest.fn().mockResolvedValue({
    ok: true, messages_supprimes: 0, conversations_supprimees: 0,
    pointeurs_recales: 0, retention_jours: 365,
  }),
}));

const express = require('express');
const request = require('supertest');

const rgpd = require('../../src/routes/rgpd');
const { PURGES_RGPD } = require('../../src/services/rgpd-purges');

const tokenFor = (role) => jwt.sign(
  { id: 7, username: 'dpo.test', role, first_name: 'T', last_name: 'U', mfa: true },
  JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  ADMIN: tokenFor('ADMIN'), DPO: tokenFor('DPO'), RH: tokenFor('RH'),
  MANAGER: tokenFor('MANAGER'), COLLABORATEUR: tokenFor('COLLABORATEUR'),
};

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/rgpd', rgpd);
});

/** Runs de jobs présents en base pour ce test (job_name → ligne). */
let jobRuns;
beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset().mockImplementation(async (sql) => {
    // Le client transactionnel de /anonymize relit la personne avant d'agir.
    if (/FROM candidates WHERE id/.test(sql) || /FROM employees WHERE id/.test(sql)) {
      return { rows: [{ first_name: 'Jean', last_name: 'Dupont' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  mockLogActivity.mockReset();
  jobRuns = [];
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM job_runs/.test(sql)) {
      if (/status = 'success'/.test(sql)) {
        return { rows: jobRuns.filter((r) => r.status === 'success').map((r) => ({ job_name: r.job_name, last_success_at: r.started_at })) };
      }
      return { rows: jobRuns };
    }
    if (/INSERT INTO rgpd_registre/.test(sql)) return { rows: [{ id: 11, nom_traitement: 'X' }] };
    if (/INSERT INTO rgpd_consents/.test(sql)) return { rows: [{ id: 5 }] };
    if (/FROM candidates WHERE id/.test(sql)) return { rows: [{ first_name: 'Jean', last_name: 'Dupont' }] };
    return { rows: [], rowCount: 0 };
  });
});

const get = (path, role = 'ADMIN') => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (path, role = 'ADMIN', body = {}) => request(app).post(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const journal = () => mockQuery.mock.calls.filter((c) => /INSERT INTO rgpd_audit_log/.test(c[0]));
const journalClient = () => mockClientQuery.mock.calls.filter((c) => /INSERT INTO rgpd_audit_log/.test(c[0]));

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/rgpd/purges — habilitations', () => {
  it('403 pour un rôle non ADMIN/DPO', async () => {
    for (const role of ['MANAGER', 'RH', 'COLLABORATEUR']) {
      expect((await get('/api/rgpd/purges', role)).status).toBe(403);
    }
  });
  it('200 pour ADMIN et DPO', async () => {
    for (const role of ['ADMIN', 'DPO']) {
      expect((await get('/api/rgpd/purges', role)).status).toBe(200);
    }
  });
  it('401 sans jeton', async () => {
    expect((await request(app).get('/api/rgpd/purges')).status).toBe(401);
  });
});

describe('GET /api/rgpd/purges — forme de la réponse', () => {
  it('liste les purges du registre, chacune décrite en français avec son seuil', async () => {
    const res = await get('/api/rgpd/purges');
    expect(res.status).toBe(200);
    expect(typeof res.body.generated_at).toBe('string');
    expect(Array.isArray(res.body.purges)).toBe(true);
    expect(res.body.purges.map((p) => p.cle)).toEqual(PURGES_RGPD.map((p) => p.cle));
    for (const p of res.body.purges) {
      expect(typeof p.libelle).toBe('string');
      expect(p.description.length).toBeGreaterThan(40);
      expect(typeof p.job_name).toBe('string');
      expect(typeof p.entity_type).toBe('string');
      expect(typeof p.action_manuelle).toBe('string');
      expect(p.retention).toHaveProperty('valeur');
      expect(p.retention).toHaveProperty('unite');
    }
  });

  it('un job JAMAIS exécuté se dit — dernier_passage null, jamais_execute true', async () => {
    const res = await get('/api/rgpd/purges');
    for (const p of res.body.purges) {
      expect(p.jamais_execute).toBe(true);
      expect(p.dernier_passage).toBeNull();
      expect(p.dernier_succes_at).toBeNull();
    }
  });

  it('restitue le dernier passage réel du job (statut, volume, erreur, durée)', async () => {
    jobRuns = [
      { job_name: 'purgePcmNonRecrute', started_at: '2026-08-30T05:00:00.000Z', finished_at: '2026-08-30T05:00:01.000Z',
        status: 'success', error_message: null, items_processed: 4, duration_ms: 1200 },
      { job_name: 'purgeOldGpsPositions', started_at: '2026-08-29T05:00:00.000Z', finished_at: null,
        status: 'error', error_message: 'connexion perdue', items_processed: null, duration_ms: 30 },
    ];
    const res = await get('/api/rgpd/purges');
    const pcm = res.body.purges.find((p) => p.cle === 'pcm_non_recrute');
    expect(pcm.jamais_execute).toBe(false);
    expect(pcm.dernier_passage).toMatchObject({ status: 'success', items_processed: 4, duration_ms: 1200 });
    expect(pcm.dernier_succes_at).toBe('2026-08-30T05:00:00.000Z');

    const gps = res.body.purges.find((p) => p.cle === 'gps_positions');
    expect(gps.dernier_passage.status).toBe('error');
    expect(gps.dernier_passage.error_message).toBe('connexion perdue');
    // Une erreur n'est pas un succès : on n'invente pas une date de réussite.
    expect(gps.dernier_succes_at).toBeNull();

    // Les purges sans run restent honnêtement à « jamais exécuté ».
    expect(res.body.purges.find((p) => p.cle === 'messagerie').jamais_execute).toBe(true);
  });

  it('journal des jobs absent (base non migrée) → 200 dégradé, jamais 500', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM job_runs/.test(sql)) { const e = new Error('relation "job_runs" does not exist'); e.code = '42P01'; throw e; }
      return { rows: [], rowCount: 0 };
    });
    const res = await get('/api/rgpd/purges');
    expect(res.status).toBe(200);
    expect(res.body.journal_disponible).toBe(false);
    expect(res.body.purges.every((p) => p.jamais_execute === true)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/rgpd/purges/:cle/executer', () => {
  it('404 sur une clé inconnue — liste blanche, jamais une fonction désignée par l’appelant', async () => {
    for (const cle of ['inconnue', 'constructor', '__proto__', 'DROP']) {
      const res = await post(`/api/rgpd/purges/${encodeURIComponent(cle)}/executer`);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/inconnue/i);
    }
  });

  it('403 pour un rôle non ADMIN/DPO, et rien n’est exécuté', async () => {
    for (const role of ['MANAGER', 'RH', 'COLLABORATEUR']) {
      const res = await post('/api/rgpd/purges/gps_positions/executer', role);
      expect(res.status).toBe(403);
    }
    expect(mockQuery.mock.calls.some((c) => /DELETE FROM gps_positions/.test(c[0]))).toBe(false);
  });

  it('401 sans jeton', async () => {
    expect((await request(app).post('/api/rgpd/purges/gps_positions/executer')).status).toBe(401);
  });

  it('exécute la purge et écrit la ligne MANUELLE attendue dans rgpd_audit_log', async () => {
    const res = await post('/api/rgpd/purges/pcm_non_recrute/executer', 'DPO');
    expect(res.status).toBe(200);
    expect(res.body.cle).toBe('pcm_non_recrute');
    expect(res.body.action_journalisee).toBe('PURGE_PCM_NON_RECRUTE');
    expect(res.body.resultat).toMatchObject({ cle: 'pcm_non_recrute', retention_jours: 90 });

    const ligne = journal().find((c) => c[1][1] === 'PURGE_PCM_NON_RECRUTE');
    expect(ligne).toBeTruthy();
    expect(ligne[1][0]).toBe(7);                    // user_id du jeton
    expect(ligne[1][2]).toBe('pcm_sessions');
    expect(JSON.parse(ligne[1][3]).trigger).toBe('manual');
  });

  it('journalise même à ZÉRO ligne supprimée (c’est la trace qui prouve la vérification)', async () => {
    const res = await post('/api/rgpd/purges/gps_positions/executer');
    expect(res.body.resultat.total).toBe(0);
    expect(journal().some((c) => c[1][1] === 'PURGE_GPS')).toBe(true);
    // …et le code AUTO_ n'est jamais employé pour une action humaine.
    expect(journal().some((c) => c[1][1] === 'AUTO_PURGE_GPS_90D')).toBe(false);
  });

  it('double la trace dans le journal d’ACTIVITÉ — table distincte du journal RGPD', async () => {
    await post('/api/rgpd/purges/refresh_tokens/executer');
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    const arg = mockLogActivity.mock.calls[0][0];
    expect(arg).toMatchObject({ userId: 7, action: 'purge', entityType: 'rgpd' });
    expect(arg.details.purge).toBe('refresh_tokens');
  });

  it('chaque clé du registre est déclenchable et renvoie un résumé exploitable', async () => {
    for (const p of PURGES_RGPD) {
      mockQuery.mockClear();
      const res = await post(`/api/rgpd/purges/${p.cle}/executer`);
      expect(res.status).toBe(200);
      expect(res.body.resultat.cle).toBe(p.cle);
      expect(typeof res.body.resultat.total).toBe('number');
      expect(journal().some((c) => c[1][1] === p.actionManuelle)
        || journalClient().some((c) => c[1][1] === p.actionManuelle)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ÉCART DE RECONNAISSANCE COMBLÉ — les mutations RGPD historiques écrivaient
// leur ligne de journal sans qu'aucun test ne le vérifie.
// ═══════════════════════════════════════════════════════════════════════════
describe('journal d’audit — les mutations RGPD historiques laissent bien leur trace', () => {
  it('POST /registre → action CREATE sur l’entité « registre », avec l’id créé', async () => {
    const res = await post('/api/rgpd/registre', 'ADMIN', {
      nom_traitement: 'Essai', finalite: 'Essai', base_legale: 'Intérêt légitime',
    });
    expect(res.status).toBe(201);
    const [, params] = journal()[0];
    expect(params[0]).toBe(7);
    expect(params[1]).toBe('CREATE');
    expect(params[2]).toBe('registre');
    expect(params[3]).toBe(11);
  });

  it('GET /export/:type/:id → action EXPORT_DATA (le droit d’accès laisse une trace)', async () => {
    const res = await get('/api/rgpd/export/candidate/3', 'ADMIN');
    expect(res.status).toBe(200);
    const [, params] = journal()[0];
    expect(params[1]).toBe('EXPORT_DATA');
    expect(params[2]).toBe('candidate');
    expect(params[3]).toBe(3);
  });

  it('POST /anonymize/:type/:id → action ANONYMIZE, DANS la transaction, avec le motif', async () => {
    const res = await post('/api/rgpd/anonymize/candidate/12', 'ADMIN', { reason: 'Demande de la personne' });
    expect(res.status).toBe(200);
    const [, params] = journalClient()[0];  // écrite sur le client transactionnel
    expect(params[1]).toBe('ANONYMIZE');
    expect(params[2]).toBe('candidate');
    expect(params[3]).toBe(12);
    expect(JSON.parse(params[4]).reason).toBe('Demande de la personne');
    // Le COMMIT vient APRÈS le journal : une trace manquante annule l'effacement.
    const ordre = mockClientQuery.mock.calls.map((c) => String(c[0]));
    expect(ordre.findIndex((s) => /rgpd_audit_log/.test(s))).toBeLessThan(ordre.lastIndexOf('COMMIT'));
  });

  it('POST /consent → CONSENT_GRANTED ou CONSENT_REVOKED selon la valeur reçue', async () => {
    await post('/api/rgpd/consent', 'ADMIN', { entity_type: 'candidate', entity_id: 4, consent_type: 'pcm', granted: true });
    expect(journal()[0][1][1]).toBe('CONSENT_GRANTED');

    mockQuery.mockClear();
    await post('/api/rgpd/consent', 'ADMIN', { entity_type: 'candidate', entity_id: 4, consent_type: 'pcm', granted: false });
    expect(journal()[0][1][1]).toBe('CONSENT_REVOKED');
  });

  it('POST /purge-expired (bouton historique) → PURGE_EXPIRED sur « candidates », entity_id 0', async () => {
    const res = await post('/api/rgpd/purge-expired', 'ADMIN');
    expect(res.status).toBe(200);
    const [, params] = journal().find((c) => c[1][1] === 'PURGE_EXPIRED');
    expect(params[2]).toBe('candidates');
    expect(params[3]).toBe(0);   // convention des purges de masse
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/rgpd/politique — la règle des 90 jours y figure', () => {
  it('la politique affichée annonce la purge PCM, sinon l’écran de conformité mentirait', async () => {
    const res = await get('/api/rgpd/politique', 'ADMIN');
    expect(res.status).toBe(200);
    const conservation = res.body.categories.find((c) => c.key === 'conservation');
    const regle = conservation.regles.find((r) => /PCM/.test(r.titre));
    expect(regle).toBeDefined();
    expect(regle.valeur).toBe('90 jours');
    // La date de référence doit être dite : c'est tout l'arbitrage du chantier.
    expect(regle.description).toMatch(/PASSATION/);
    expect(regle.reference).toMatch(/rgpd-purges/);
  });

  it('le seuil affiché suit le réglage réel, jamais une valeur figée', async () => {
    mockQuery.mockImplementation(async (sql, params) => {
      if (/FROM settings WHERE key = \$1/.test(sql) && params && params[0] === 'rgpd.pcm_non_recrute_retention_jours') {
        return { rows: [{ value: '45' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await get('/api/rgpd/politique', 'ADMIN');
    const regle = res.body.categories.find((c) => c.key === 'conservation').regles.find((r) => /PCM/.test(r.titre));
    expect(regle.valeur).toBe('45 jours');
    expect(regle.source).toBe('rgpd.pcm_non_recrute_retention_jours');
  });
});
