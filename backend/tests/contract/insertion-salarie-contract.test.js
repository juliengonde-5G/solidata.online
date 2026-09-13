// ═══════════════════════════════════════════════════════════════════════════
// CONTRAT — DOCUMENTS DU SALARIÉ ET RAPPELS DE RENDEZ-VOUS (PR C, lot 7)
// ───────────────────────────────────────────────────────────────────────────
// `pg` est simulé : on exerce les VRAIS handlers Express à travers le vrai
// routeur monté (`src/routes/insertion`), et on inspecte ce qui sort et ce qui
// est écrit.
//
// Ce que ces tests tiennent :
//   1. HABILITATION — un MANAGER est refusé 403 **AVANT toute requête** :
//      `pool.query` n'est pas appelé une seule fois. Un refus posé après lecture
//      serait un refus d'affichage, pas un refus d'accès (doctrine 2.51.0).
//   2. LISTE BLANCHE — aucune clé interdite dans la sérialisation JSON des deux
//      documents, ni à l'aperçu, ni à la génération, ni à la relecture.
//   3. JOURNALISATION BLOQUANTE — si la trace échoue, le document n'est pas
//      enregistré (ROLLBACK) et la remise n'a pas lieu.
//   4. CONSENTEMENT — destinataire validé, retrait aussi simple que l'accord,
//      colonnes ET `rgpd_consents` écrits dans la MÊME transaction.
//   5. `pool.connect()` en échec → 500 sans fuite et sans requête pendante.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
const mockConnect = jest.fn();
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
const { CLES_INTERDITES } = require('../../src/services/mon-parcours');

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
const post = (p, role = 'ADMIN', body = {}) => request(app).post(p).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const put = (p, role = 'ADMIN', body = {}) => request(app).put(p).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);

const EMP = {
  id: 5, first_name: 'Amine', last_name: 'BENALI', parcours_num: 1,
  insertion_status: 'en_parcours', insertion_start_date: '2026-03-01', insertion_end_date: null,
  referent_unique_type: 'cms', referent_unique_nom: 'Mme L.', referent_unique_contact: '02 35 00 00 00',
  cip_nom_complet: 'Claire MARTIN', cip_prenom: 'Claire', cip_nom: 'MARTIN',
};

const CONSENTEMENT = {
  consent: null, canal: null, destinataire: null, consent_at: null,
  phone: '06 12 34 56 78', email: 'a.benali@solidarite-textiles.fr', personal_email: 'amine@exemple.fr',
  consent_par_nom: null,
};

/** Aiguillage du faux `pg`. `over` remplace la réponse d'une source. */
function branche(over = {}) {
  const impl = (sql) => {
    const s = String(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s.trim())) return Promise.resolve({ rows: [] });
    if (/INSERT INTO rgpd_audit_log/.test(s)) {
      return over.journalEnEchec ? Promise.reject(new Error('journal indisponible')) : Promise.resolve({ rows: [] });
    }
    if (/SELECT COALESCE\(parcours_num, 1\) AS n/.test(s)) return Promise.resolve({ rows: [{ n: 1 }] });
    if (/FROM employees e\s+LEFT JOIN users u ON u\.id = e\.cip_referent_user_id/.test(s)) {
      return Promise.resolve({ rows: over.employee === null ? [] : [over.employee || EMP] });
    }
    if (/FROM employees e\s+LEFT JOIN users u ON u\.id = e\.rappel_rdv_consent_by/.test(s)) {
      return Promise.resolve({ rows: over.consentement === null ? [] : [{ ...CONSENTEMENT, ...(over.consentement || {}) }] });
    }
    if (/INSERT INTO insertion_documents_salarie/.test(s)) {
      return Promise.resolve({ rows: [{ id: 42, genere_le: '2026-09-13T10:00:00Z' }] });
    }
    if (/UPDATE insertion_documents_salarie/.test(s)) {
      return Promise.resolve({ rows: over.remise || [{ id: 42, type: 'mon_parcours', remis_le: '2026-09-12', remis_mode: 'main_propre' }] });
    }
    if (/FROM insertion_documents_salarie/.test(s) && /FOR UPDATE/.test(s)) {
      return Promise.resolve({ rows: over.documentExistant === null ? [] : [over.documentExistant || { id: 42, type: 'mon_parcours', remis_le: null }] });
    }
    if (/FROM insertion_documents_salarie/.test(s) && /contenu/.test(s)) {
      return Promise.resolve({ rows: over.document === null ? [] : [over.document || { id: 42, type: 'mon_parcours', parcours_num: 1, contenu: { personne: { prenom: 'Amine' } }, genere_le: '2026-09-13T10:00:00Z', remis_le: null, remis_mode: null }] });
    }
    if (/FROM insertion_documents_salarie/.test(s)) return Promise.resolve({ rows: over.documents || [] });
    if (/UPDATE employees\s+SET rappel_rdv_consent/.test(s)) {
      return Promise.resolve({ rows: over.majConsentement === null ? [] : [{ id: 5, consent: true, canal: 'sms', consent_at: '2026-09-13T10:00:00Z' }] });
    }
    if (/COALESCE\(insertion_status, 'none'\) AS s FROM employees/.test(s)) {
      return Promise.resolve({ rows: over.salarie || [{ id: 5, s: 'en_parcours' }] });
    }
    if (/INSERT INTO rgpd_consents/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM insertion_rappels_rdv/.test(s)) return Promise.resolve({ rows: over.rappels || [] });
    if (/FROM insertion_objectifs/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM cip_action_plans/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM insertion_milestones/.test(s)) return Promise.resolve({ rows: over.milestones || [] });
    return Promise.resolve({ rows: [] });
  };
  mockQuery.mockImplementation(impl);
  mockConnect.mockImplementation(async () => {
    if (over.connectEnEchec) throw new Error('pool épuisé');
    return { query: (...a) => mockQuery(...a), release: () => {} };
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  branche();
});

const journaux = () => mockQuery.mock.calls.filter(([sql]) => /INSERT INTO rgpd_audit_log/.test(String(sql)));
const journalPour = (action) => journaux().find(([, p]) => p && p[1] === action);
const aExecute = (motif) => mockQuery.mock.calls.some(([sql]) => motif.test(String(sql)));

/** Toutes les clés de l'arbre, à tous les niveaux. */
function clesProfondes(objet, acc = new Set()) {
  if (Array.isArray(objet)) { objet.forEach((v) => clesProfondes(v, acc)); return acc; }
  if (objet && typeof objet === 'object') {
    for (const [k, v] of Object.entries(objet)) { acc.add(k); clesProfondes(v, acc); }
  }
  return acc;
}

// ───────────────────────────────────────────────────────────────────────────
describe('1. habilitations — refus AVANT toute requête', () => {
  const routes = [
    ['get', '/api/insertion/salarie/5/mon-parcours'],
    ['get', '/api/insertion/salarie/5/mon-recap'],
    ['post', '/api/insertion/salarie/5/mon-parcours'],
    ['post', '/api/insertion/salarie/5/mon-recap'],
    ['get', '/api/insertion/salarie/5/documents'],
    ['get', '/api/insertion/salarie/5/documents/42'],
    ['put', '/api/insertion/salarie/5/documents/42/remise'],
    ['get', '/api/insertion/salarie/5/rappels-consentement'],
    ['put', '/api/insertion/salarie/5/rappels-consentement'],
    ['get', '/api/insertion/salarie/5/rappels'],
  ];

  test.each(routes)('MANAGER refusé en 403 sur %s %s', async (verbe, chemin) => {
    const appel = { get, post, put }[verbe];
    const res = await appel(chemin, 'MANAGER');
    expect(res.status).toBe(403);
    // LE point du test : la base n'a pas été touchée.
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('ADMIN et RH sont admis', async () => {
    for (const role of ['ADMIN', 'RH']) {
      mockQuery.mockClear();
      const res = await get('/api/insertion/salarie/5/documents', role);
      expect(res.status).toBe(200);
    }
  });

  test('un identifiant non entier est refusé en 400', async () => {
    const res = await get('/api/insertion/salarie/abc/mon-parcours');
    expect(res.status).toBe(400);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('2. aperçu — compose sans rien enregistrer', () => {
  test('« Mon parcours » : 200, aucune écriture dans la table des documents', async () => {
    const res = await get('/api/insertion/salarie/5/mon-parcours');
    expect(res.status).toBe(200);
    expect(res.body.apercu).toBe(true);
    expect(res.body.type).toBe('mon_parcours');
    expect(Object.keys(res.body.contenu)).toContain('mes_engagements');
    expect(aExecute(/INSERT INTO insertion_documents_salarie/)).toBe(false);
    expect(journalPour('INSERTION_DOC_SALARIE_APERCU')).toBeTruthy();
  });

  test('« Mon Récap » : 200 et son propre jeu de rubriques', async () => {
    const res = await get('/api/insertion/salarie/5/mon-recap');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.contenu)).toContain('etapes');
    expect(Object.keys(res.body.contenu)).not.toContain('mes_heures_semaine');
  });

  test('salarié inconnu → 404, rien n’est composé', async () => {
    branche({ employee: null });
    const res = await get('/api/insertion/salarie/999/mon-parcours');
    expect(res.status).toBe(404);
    expect(aExecute(/INSERT INTO insertion_documents_salarie/)).toBe(false);
  });

  test('AUCUNE clé interdite dans la charge des deux documents', async () => {
    branche({
      milestones: [{ milestone_type: 'bilan_intermediaire', completed_date: '2026-06-01', observations: 'texte CIP', frein_sante: 4 }],
    });
    for (const url of ['mon-parcours', 'mon-recap']) {
      const res = await get(`/api/insertion/salarie/5/${url}`);
      expect(res.status).toBe(200);
      const cles = [...clesProfondes(res.body.contenu)];
      for (const interdit of CLES_INTERDITES) {
        expect({ url, interdit, fautives: cles.filter((k) => k.toLowerCase().includes(interdit)) })
          .toEqual({ url, interdit, fautives: [] });
      }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('3. génération — snapshot et trace, dans la même transaction', () => {
  test('201 avec le contenu, snapshot écrit, journal bloquant présent', async () => {
    const res = await post('/api/insertion/salarie/5/mon-parcours');
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(42);
    expect(res.body.contenu.personne.prenom).toBe('Amine');
    const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO insertion_documents_salarie/.test(String(sql)));
    expect(insert[1][2]).toBe('mon_parcours');
    // Le snapshot écrit est bien le contenu rendu.
    expect(JSON.parse(insert[1][3]).personne.prenom).toBe('Amine');
    expect(journalPour('INSERTION_DOC_SALARIE_GENERATION')).toBeTruthy();
    expect(aExecute(/^COMMIT$/)).toBe(true);
  });

  test('journal en échec → ROLLBACK, 500, aucun document réputé produit', async () => {
    branche({ journalEnEchec: true });
    const res = await post('/api/insertion/salarie/5/mon-recap');
    expect(res.status).toBe(500);
    expect(aExecute(/^ROLLBACK$/)).toBe(true);
    expect(aExecute(/^COMMIT$/)).toBe(false);
  });

  test('`pool.connect()` en échec → 500 sans fuite (la requête reçoit sa réponse)', async () => {
    branche({ connectEnEchec: true });
    const res = await post('/api/insertion/salarie/5/mon-parcours');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Erreur serveur');
    expect(res.body).not.toHaveProperty('stack');
  });

  test('base non migrée (42P01) → 503 explicite, pas un 500 muet', async () => {
    mockConnect.mockImplementation(async () => ({
      query: (sql) => (/INSERT INTO insertion_documents_salarie/.test(String(sql))
        ? Promise.reject(Object.assign(new Error('relation absente'), { code: '42P01' }))
        : Promise.resolve({ rows: [] })),
      release: () => {},
    }));
    const res = await post('/api/insertion/salarie/5/mon-parcours');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/non migrée/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('4. historique et relecture', () => {
  test('la liste ne renvoie JAMAIS le contenu', async () => {
    branche({ documents: [{ id: 42, type: 'mon_parcours', parcours_num: 1, genere_le: '2026-09-13T10:00:00Z', remis_le: null, remis_mode: null, genere_par_nom: 'Claire MARTIN' }] });
    const res = await get('/api/insertion/salarie/5/documents');
    expect(res.status).toBe(200);
    expect(res.body[0]).not.toHaveProperty('contenu');
    const sql = String(mockQuery.mock.calls.find(([s]) => /FROM insertion_documents_salarie/.test(String(s)))[0]);
    expect(sql).not.toMatch(/d\.contenu/);
  });

  test('la relecture est bornée au salarié, et journalisée', async () => {
    const res = await get('/api/insertion/salarie/5/documents/42');
    expect(res.status).toBe(200);
    const sql = String(mockQuery.mock.calls.find(([s]) => /FROM insertion_documents_salarie/.test(String(s)))[0]);
    expect(sql).toMatch(/WHERE id = \$1 AND employee_id = \$2/);
    expect(journalPour('INSERTION_DOC_SALARIE_CONSULTATION')).toBeTruthy();
  });

  test('un document d’un autre salarié rend 404, jamais celui d’à côté', async () => {
    branche({ document: null });
    const res = await get('/api/insertion/salarie/5/documents/99');
    expect(res.status).toBe(404);
  });

  test('base non migrée → liste vide plutôt qu’une erreur', async () => {
    mockQuery.mockImplementation(() => Promise.reject(Object.assign(new Error('relation absente'), { code: '42P01' })));
    const res = await get('/api/insertion/salarie/5/documents');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('5. remise — tracée une seule fois, jamais dans le futur', () => {
  test('200, trace écrite, journal bloquant présent', async () => {
    const res = await put('/api/insertion/salarie/5/documents/42/remise', 'ADMIN', { remis_le: '2026-09-12', remis_mode: 'main_propre' });
    expect(res.status).toBe(200);
    expect(res.body.remis_le).toBe('2026-09-12');
    expect(journalPour('INSERTION_DOC_SALARIE_REMISE')).toBeTruthy();
    expect(aExecute(/^COMMIT$/)).toBe(true);
  });

  test('une remise déjà tracée est refusée en 409, sans rien réécrire', async () => {
    branche({ documentExistant: { id: 42, type: 'mon_parcours', remis_le: '2026-09-01' } });
    const res = await put('/api/insertion/salarie/5/documents/42/remise', 'ADMIN', { remis_le: '2026-09-12', remis_mode: 'email' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REMISE_DEJA_TRACEE');
    expect(aExecute(/UPDATE insertion_documents_salarie/)).toBe(false);
  });

  test('une date future est refusée : c’est une intention, pas une remise', async () => {
    const demain = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);
    const res = await put('/api/insertion/salarie/5/documents/42/remise', 'ADMIN', { remis_le: demain, remis_mode: 'courrier' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/future/);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('un mode hors liste est refusé en 400', async () => {
    const res = await put('/api/insertion/salarie/5/documents/42/remise', 'ADMIN', { remis_le: '2026-09-12', remis_mode: 'pigeon' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Mode de remise invalide/);
  });

  test('une date mal formée est refusée en 400', async () => {
    const res = await put('/api/insertion/salarie/5/documents/42/remise', 'ADMIN', { remis_le: '12/09/2026', remis_mode: 'email' });
    expect(res.status).toBe(400);
  });

  test('document inconnu → 404 après ROLLBACK', async () => {
    branche({ documentExistant: null });
    const res = await put('/api/insertion/salarie/5/documents/99/remise', 'ADMIN', { remis_le: '2026-09-12', remis_mode: 'email' });
    expect(res.status).toBe(404);
    expect(aExecute(/^ROLLBACK$/)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('6. consentement aux rappels', () => {
  test('« jamais demandé » se distingue de « a refusé »', async () => {
    const res = await get('/api/insertion/salarie/5/rappels-consentement');
    expect(res.status).toBe(200);
    expect(res.body.consent).toBeNull();
    branche({ consentement: { consent: false, consent_at: '2026-09-10T09:00:00Z' } });
    const res2 = await get('/api/insertion/salarie/5/rappels-consentement');
    expect(res2.body.consent).toBe(false);
  });

  test('les contacts connus sont proposés MASQUÉS, jamais en clair', async () => {
    const res = await get('/api/insertion/salarie/5/rappels-consentement');
    expect(res.body.contacts_disponibles).toEqual({
      phone_masque: '06 ** ** ** 78',
      email_masque: 'a***@solidarite-textiles.fr',
      personal_email_masque: 'a***@exemple.fr',
    });
    expect(JSON.stringify(res.body)).not.toContain('06 12 34 56 78');
    expect(JSON.stringify(res.body)).not.toContain('amine@exemple.fr');
  });

  test('accord : colonnes ET rgpd_consents écrits dans la MÊME transaction, journal bloquant', async () => {
    const res = await put('/api/insertion/salarie/5/rappels-consentement', 'ADMIN', { consent: true, canal: 'sms', destinataire: '06 12 34 56 78' });
    expect(res.status).toBe(200);
    expect(res.body.destinataire_masque).toBe('06 ** ** ** 78');
    expect(aExecute(/UPDATE employees\s+SET rappel_rdv_consent/)).toBe(true);
    expect(aExecute(/INSERT INTO rgpd_consents/)).toBe(true);
    expect(journalPour('INSERTION_RAPPEL_CONSENTEMENT')).toBeTruthy();
    expect(aExecute(/^COMMIT$/)).toBe(true);
    // Le contact en clair ne ressort jamais de l'API.
    expect(JSON.stringify(res.body)).not.toContain('06 12 34 56 78');
  });

  test('la trace du consentement ne porte pas le contact en clair', async () => {
    await put('/api/insertion/salarie/5/rappels-consentement', 'ADMIN', { consent: true, canal: 'sms', destinataire: '06 12 34 56 78' });
    const details = JSON.parse(journalPour('INSERTION_RAPPEL_CONSENTEMENT')[1][4]);
    expect(details.destinataire_masque).toBe('06 ** ** ** 78');
    expect(JSON.stringify(details)).not.toContain('06 12 34 56 78');
  });

  // ═══ CORRECTIF M-04 — le numéro est NORMALISÉ en E.164 à l'écriture ═══════
  // `services/notification.js` faisait `+33${'{'}phone.substring(1){'}'}` et gardait les
  // espaces : « +336 12 34 56 78 » était refusé par Brevo (« recipient is
  // invalid »), c'est-à-dire que le format encouragé par cet écran était
  // précisément celui qui échouait.
  test('le numéro est stocké en E.164, jamais avec ses séparateurs', async () => {
    await put('/api/insertion/salarie/5/rappels-consentement', 'ADMIN', { consent: true, canal: 'sms', destinataire: '06 12 34 56 78' });
    const maj = mockQuery.mock.calls.find(([q]) => /UPDATE employees\s+SET rappel_rdv_consent/.test(String(q)));
    expect(maj[1]).toContain('+33612345678');
    expect(maj[1]).not.toContain('06 12 34 56 78');
  });

  // ═══ CORRECTIF M-05 — message de VÉRIFICATION du contact ═════════════════
  // Rien ne garantissait que le contact appartienne à la personne : le premier
  // rappel — qui nomme la structure d'insertion — serait parti chez un inconnu
  // sans que personne ne puisse le savoir. Le message part pendant l'entretien,
  // et son issue est rendue à l'écran.
  test('un message de vérification est envoyé au recueil, et son issue est rendue', async () => {
    const res = await put('/api/insertion/salarie/5/rappels-consentement', 'ADMIN', { consent: true, canal: 'sms', destinataire: '0612345678' });
    expect(res.status).toBe(200);
    expect(res.body.verification).toBeTruthy();
    expect(['envoye', 'dry_run', 'echec', 'gabarit_absent']).toContain(res.body.verification.statut);
  });

  // CORRECTIF m-06 — le registre art. 30 déclare des personnes « suivies au
  // titre d'un parcours d'insertion » ; le code acceptait n'importe qui, un
  // permanent compris. Le CODE est aligné sur la déclaration (et non l'inverse).
  test('un PERMANENT ne peut pas consentir — mais il peut toujours RETIRER', async () => {
    // `null` = la mise à jour ne touche AUCUNE ligne (le prédicat de périmètre
    // l'a écartée) ; la route vérifie ensuite si la fiche existe.
    branche({ majConsentement: null, salarie: [{ id: 5, s: 'none' }] });
    const refus = await put('/api/insertion/salarie/5/rappels-consentement', 'ADMIN', { consent: true, canal: 'sms', destinataire: '0612345678' });
    expect(refus.status).toBe(409);
    expect(refus.body.code).toBe('HORS_PARCOURS');
    const maj = mockQuery.mock.calls.find(([q]) => /UPDATE employees\s+SET rappel_rdv_consent/.test(String(q)));
    expect(String(maj[0])).toContain("insertion_status, 'none') <> 'none'");
  });

  test('aucun message de vérification sur un RETRAIT', async () => {
    branche({ majConsentement: [{ id: 5, consent: false, canal: null, consent_at: '2026-09-13T10:00:00Z' }] });
    const res = await put('/api/insertion/salarie/5/rappels-consentement', 'ADMIN', { consent: false });
    expect(res.body.verification).toBeNull();
  });

  test('retrait : `{ consent: false }` suffit, et le destinataire est effacé', async () => {
    branche({ majConsentement: [{ id: 5, consent: false, canal: null, consent_at: '2026-09-13T10:00:00Z' }] });
    const res = await put('/api/insertion/salarie/5/rappels-consentement', 'ADMIN', { consent: false });
    expect(res.status).toBe(200);
    const maj = mockQuery.mock.calls.find(([sql]) => /UPDATE employees\s+SET rappel_rdv_consent/.test(String(sql)));
    expect(maj[1][0]).toBe(false);
    expect(maj[1][1]).toBeNull();  // canal
    expect(maj[1][2]).toBeNull();  // destinataire
  });

  test.each([
    ['sms', '1234', 'Numéro de téléphone invalide'],
    ['sms', 'pas-un-numero', 'Numéro de téléphone invalide'],
    ['email', 'sans-arobase', 'Adresse e-mail invalide'],
  ])('un destinataire %s invalide (« %s ») est refusé en 400 avant toute écriture', async (canal, destinataire, motif) => {
    const res = await put('/api/insertion/salarie/5/rappels-consentement', 'ADMIN', { consent: true, canal, destinataire });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(motif);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test.each([
    ['06 12 34 56 78'], ['0612345678'], ['06.12.34.56.78'], ['+33612345678'],
  ])('un numéro français bien formé (« %s ») est accepté', async (destinataire) => {
    const res = await put('/api/insertion/salarie/5/rappels-consentement', 'ADMIN', { consent: true, canal: 'sms', destinataire });
    expect(res.status).toBe(200);
  });

  test('un canal hors liste, un consentement absent ou non booléen sont refusés', async () => {
    expect((await put('/api/insertion/salarie/5/rappels-consentement', 'ADMIN', { consent: true, canal: 'pigeon', destinataire: 'x' })).status).toBe(400);
    expect((await put('/api/insertion/salarie/5/rappels-consentement', 'ADMIN', {})).status).toBe(400);
    expect((await put('/api/insertion/salarie/5/rappels-consentement', 'ADMIN', { consent: 'oui' })).status).toBe(400);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('un accord sans destinataire est refusé', async () => {
    const res = await put('/api/insertion/salarie/5/rappels-consentement', 'ADMIN', { consent: true, canal: 'sms', destinataire: '   ' });
    expect(res.status).toBe(400);
  });

  test('salarié inconnu → 404 après ROLLBACK', async () => {
    // Aucune ligne mise à jour ET aucune fiche : c'est un 404. (Une fiche qui
    // existe mais hors parcours rend 409 — correctif m-06.)
    branche({ majConsentement: null, salarie: [] });
    const res = await put('/api/insertion/salarie/999/rappels-consentement', 'ADMIN', { consent: false });
    expect(res.status).toBe(404);
    expect(aExecute(/^ROLLBACK$/)).toBe(true);
  });

  test('l’historique des rappels ne renvoie que du masqué', async () => {
    branche({ rappels: [{ id: 1, milestone_id: 12, canal: 'sms', destinataire_masque: '06 ** ** ** 78', statut: 'envoye', envoye_le: '2026-09-14T16:00:00Z' }] });
    const res = await get('/api/insertion/salarie/5/rappels');
    expect(res.status).toBe(200);
    expect(res.body[0].destinataire_masque).toBe('06 ** ** ** 78');
    const sql = String(mockQuery.mock.calls.find(([s]) => /FROM insertion_rappels_rdv/.test(String(s)))[0]);
    expect(sql).not.toMatch(/rappel_rdv_destinataire/);
  });
});
