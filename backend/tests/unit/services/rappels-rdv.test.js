// ═══════════════════════════════════════════════════════════════════════════
// RAPPELS DE RENDEZ-VOUS J-1 — déclenchement, sélection, contenu, trace
// ───────────────────────────────────────────────────────────────────────────
// Ce que ces tests tiennent :
//   1. L'HEURE EST CELLE DE PARIS, sous TZ=UTC comme sous TZ=Europe/Paris, été
//      comme hiver. Le conteneur tourne en UTC : `getHours()` aurait fait partir
//      les rappels à 20 h en juillet.
//   2. LE CONSENTEMENT EST DANS LE `WHERE`, pas dans un filtre après lecture :
//      une personne qui n'a rien demandé n'est jamais chargée en mémoire.
//   3. LE MESSAGE NE NOMME JAMAIS LE RENDEZ-VOUS — et le type d'entretien n'est
//      même pas sélectionné par la requête.
//   4. UN SEUL RAPPEL PAR RENDEZ-VOUS : le 23505 de la contrainte d'unicité est
//      lu « déjà envoyé », pas propagé en erreur.
//   5. LA TRACE NE PORTE QUE DU MASQUÉ.
// ═══════════════════════════════════════════════════════════════════════════

const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));

const mockSend = jest.fn();
jest.mock('../../../src/services/notification', () => ({ sendNotification: (...a) => mockSend(...a) }));

const mockSetting = jest.fn();
jest.mock('../../../src/utils/insertion-settings', () => ({
  readInsertionSetting: (...a) => mockSetting(...a),
  readPostSortieMois: jest.fn(),
  INSERTION_SETTING_DEFAULTS: {},
}));

const svc = require('../../../src/services/rappels-rdv');

/** Rejoue `fn` sous un fuseau donné, et le restaure quoi qu'il arrive. */
function sousFuseau(tz, fn) {
  const avant = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally {
    if (avant === undefined) delete process.env.TZ; else process.env.TZ = avant;
  }
}

const GABARIT_SMS = { id: 1, type: 'sms', subject: null, body: 'Bonjour {prenom}, rappel : vous avez rendez-vous demain {date} à {heure} avec {cip} à Solidarité Textiles.' };
const GABARIT_EMAIL = { id: 2, type: 'email', subject: 'Rappel de votre rendez-vous de demain', body: GABARIT_SMS.body };

const RDV = {
  milestone_id: 12, interview_date: new Date('2026-09-15T12:00:00Z'),
  employee_id: 5, first_name: 'Amine',
  canal: 'sms', destinataire: '06 12 34 56 78',
  int_prenom: 'Claire', int_nom: 'MARTIN', cip_prenom: 'Claire', cip_nom: 'MARTIN',
};

function branche({ rdvs = [RDV], gabarits = [GABARIT_SMS, GABARIT_EMAIL], traceErreur = null } = {}) {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (/FROM insertion_milestones m/.test(s)) return Promise.resolve({ rows: rdvs });
    if (/FROM message_templates/.test(s)) return Promise.resolve({ rows: gabarits });
    if (/INSERT INTO insertion_rappels_rdv/.test(s)) {
      return traceErreur ? Promise.reject(traceErreur) : Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (/INSERT INTO rgpd_audit_log/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockSend.mockReset();
  mockSetting.mockReset();
  mockSend.mockResolvedValue({ ok: true });
  mockSetting.mockResolvedValue(18);
  branche();
});

const traces = () => mockQuery.mock.calls.filter(([sql]) => /INSERT INTO insertion_rappels_rdv/.test(String(sql)));
const journaux = () => mockQuery.mock.calls.filter(([sql]) => /INSERT INTO rgpd_audit_log/.test(String(sql)));

// ───────────────────────────────────────────────────────────────────────────
describe('déclenchement — l’heure de PARIS, pas celle du conteneur', () => {
  // 18 h à Paris : 16 h UTC en été (CEST), 17 h UTC en hiver (CET).
  const ETE_18H = new Date('2026-07-15T16:00:00Z');
  const ETE_17H = new Date('2026-07-15T15:00:00Z');
  const ETE_19H = new Date('2026-07-15T17:00:00Z');
  const HIVER_18H = new Date('2026-01-15T17:00:00Z');
  const HIVER_17H = new Date('2026-01-15T16:00:00Z');
  const HIVER_19H = new Date('2026-01-15T18:00:00Z');

  test.each(['UTC', 'Europe/Paris'])('sous TZ=%s, 18 h Paris déclenche été ET hiver', (tz) => {
    sousFuseau(tz, () => {
      expect(svc.doitEnvoyerRappels(ETE_18H, 18)).toBe(true);
      expect(svc.doitEnvoyerRappels(HIVER_18H, 18)).toBe(true);
    });
  });

  test.each(['UTC', 'Europe/Paris'])('sous TZ=%s, 17 h et 19 h Paris ne déclenchent pas', (tz) => {
    sousFuseau(tz, () => {
      for (const instant of [ETE_17H, ETE_19H, HIVER_17H, HIVER_19H]) {
        expect(svc.doitEnvoyerRappels(instant, 18)).toBe(false);
      }
    });
  });

  test('l’heure lue est bien l’heure MURALE de Paris', () => {
    sousFuseau('UTC', () => {
      expect(svc.heureParis(ETE_18H)).toBe(18);   // +2 en été
      expect(svc.heureParis(HIVER_18H)).toBe(18); // +1 en hiver
    });
  });

  test('une heure d’envoi illisible ou hors bornes ne déclenche JAMAIS', () => {
    for (const v of [null, undefined, 'dix-huit', -1, 24, 99]) {
      expect(svc.doitEnvoyerRappels(new Date('2026-07-15T16:00:00Z'), v)).toBe(false);
    }
  });

  test('le réglage est borné [0 ; 23] — hors bornes, on retombe sur 18 h', async () => {
    mockSetting.mockResolvedValue(99);
    expect(await svc.lireHeureEnvoi()).toBe(18);
    mockSetting.mockResolvedValue(7);
    expect(await svc.lireHeureEnvoi()).toBe(7);
    // `Number(null)` vaut 0, et 0 est une heure valide (minuit) : l'absence se
    // teste AVANT la conversion, sinon un réglage manquant enverrait les
    // rappels à minuit.
    mockSetting.mockResolvedValue(null);
    expect(await svc.lireHeureEnvoi()).toBe(18);
    mockSetting.mockResolvedValue(0);
    expect(await svc.lireHeureEnvoi()).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('sélection — le consentement est une condition de LECTURE', () => {
  test('la requête exige consentement, canal, destinataire et absence de rappel', async () => {
    await svc.envoyerRappelsRdvSalaries();
    const sql = String(mockQuery.mock.calls.find(([s]) => /FROM insertion_milestones m/.test(String(s)))[0]);
    expect(sql).toMatch(/e\.rappel_rdv_consent = true/);
    expect(sql).toMatch(/e\.is_active = true/);
    expect(sql).toMatch(/e\.rappel_rdv_canal IS NOT NULL/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM insertion_rappels_rdv/);
    expect(sql).toMatch(/m\.status = 'planifie'/);
    expect(sql).toMatch(/m\.interview_date IS NOT NULL/);
  });

  test('« demain » est le jour civil de PARIS, calculé par PostgreSQL', async () => {
    await svc.envoyerRappelsRdvSalaries();
    const sql = String(mockQuery.mock.calls.find(([s]) => /FROM insertion_milestones m/.test(String(s)))[0]);
    expect(sql).toContain("AT TIME ZONE 'Europe/Paris'");
    expect(sql).toContain("INTERVAL '1 day'");
  });

  test('le TYPE d’entretien n’est même pas sélectionné', async () => {
    await svc.envoyerRappelsRdvSalaries();
    const sql = String(mockQuery.mock.calls.find(([s]) => /FROM insertion_milestones m/.test(String(s)))[0]);
    expect(sql).not.toMatch(/milestone_type/);
    expect(sql).not.toMatch(/\btitre\b/);
    expect(sql).not.toMatch(/conciliation_motifs/);
  });

  test('aucun rendez-vous → aucun envoi, aucun gabarit lu', async () => {
    branche({ rdvs: [] });
    const bilan = await svc.envoyerRappelsRdvSalaries();
    expect(bilan).toEqual({ candidats: 0, envoyes: 0, echecs: 0, dry_run: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('base non migrée → aucun rappel, aucune exception', async () => {
    mockQuery.mockImplementation(() => Promise.reject(Object.assign(new Error('relation absente'), { code: '42P01' })));
    const bilan = await svc.envoyerRappelsRdvSalaries();
    expect(bilan.candidats).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('contenu du message — quatre variables, et rien du parcours', () => {
  test('le SMS part avec prénom, date, heure de Paris et conseillère initialée', async () => {
    await svc.envoyerRappelsRdvSalaries();
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [gabarit, email, phone, variables] = mockSend.mock.calls[0];
    expect(gabarit.type).toBe('sms');
    expect(email).toBeNull();
    expect(phone).toBe('06 12 34 56 78');
    // 12:00 UTC un 15 septembre = 14:00 à Paris.
    expect(variables).toEqual({ prenom: 'Amine', date: '15/09/2026', heure: '14:00', cip: 'Claire M.' });
    // Aucune variable de parcours n'est passée au gabarit.
    expect(Object.keys(variables).sort()).toEqual(['cip', 'date', 'heure', 'prenom']);
  });

  test('un e-mail part sur le canal e-mail, et le téléphone reste vide', async () => {
    branche({ rdvs: [{ ...RDV, canal: 'email', destinataire: 'amine@exemple.fr' }] });
    await svc.envoyerRappelsRdvSalaries();
    const [gabarit, email, phone] = mockSend.mock.calls[0];
    expect(gabarit.type).toBe('email');
    expect(email).toBe('amine@exemple.fr');
    expect(phone).toBeNull();
  });

  test('sans intervieweur désigné, c’est la conseillère référente qui est nommée', async () => {
    branche({ rdvs: [{ ...RDV, int_prenom: null, int_nom: null }] });
    await svc.envoyerRappelsRdvSalaries();
    expect(mockSend.mock.calls[0][3].cip).toBe('Claire M.');
  });

  test('sans aucune conseillère connue, le message reste lisible', async () => {
    branche({ rdvs: [{ ...RDV, int_prenom: null, int_nom: null, cip_prenom: null, cip_nom: null }] });
    await svc.envoyerRappelsRdvSalaries();
    expect(mockSend.mock.calls[0][3].cip).toBe('votre conseillère');
  });

  test('aucun gabarit actif → aucun envoi (et le journal serveur le dit)', async () => {
    branche({ gabarits: [] });
    const bilan = await svc.envoyerRappelsRdvSalaries();
    expect(mockSend).not.toHaveBeenCalled();
    expect(bilan.envoyes).toBe(0);
    expect(traces()).toHaveLength(0);
  });

  test('gabarit du canal manquant → le rappel reste DÛ (aucune trace posée)', async () => {
    branche({ gabarits: [GABARIT_EMAIL] }); // le rendez-vous est en SMS
    await svc.envoyerRappelsRdvSalaries();
    expect(mockSend).not.toHaveBeenCalled();
    // Aucune trace : sans elle, le rappel repartira au prochain passage si le
    // gabarit est rétabli. Une trace posée ici le perdrait définitivement.
    expect(traces()).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('trace — masquée, unique, journalisée', () => {
  test('le destinataire n’est jamais tracé en clair', async () => {
    await svc.envoyerRappelsRdvSalaries();
    const params = traces()[0][1];
    expect(params[3]).toBe('06 ** ** ** 78');
    expect(JSON.stringify(params)).not.toContain('06 12 34 56 78');
    expect(JSON.stringify(journaux())).not.toContain('06 12 34 56 78');
  });

  test('masquage : deux premiers et deux derniers chiffres, initiale pour un e-mail', () => {
    expect(svc.masquerDestinataire('sms', '+33612345678')).toBe('33 ** ** ** 78');
    expect(svc.masquerDestinataire('email', 'jean.dupont@gmail.com')).toBe('j***@gmail.com');
    expect(svc.masquerDestinataire('sms', '')).toBe('—');
    expect(svc.masquerDestinataire('email', 'pas-une-adresse')).toBe('***');
  });

  test('le journal RGPD porte le code attendu et jamais le contact', async () => {
    await svc.envoyerRappelsRdvSalaries();
    expect(journaux()).toHaveLength(1);
    const [sql, params] = journaux()[0];
    // Le code d'action est écrit dans le TEXTE de la requête (le job n'a aucun
    // utilisateur à qui l'attribuer) : c'est cette forme que lit la garde
    // anti-dérive des libellés du journal RGPD.
    expect(String(sql)).toContain("'INSERTION_RAPPEL_ENVOI'");
    expect(String(sql)).toContain('VALUES (NULL,');
    const details = JSON.parse(params[1]);
    expect(details).toEqual({ milestone_id: 12, canal: 'sms', destinataire_masque: '06 ** ** ** 78', statut: 'envoye' });
  });

  test('un doublon (23505) se lit « déjà envoyé » et ne compte pas comme un envoi', async () => {
    branche({ traceErreur: Object.assign(new Error('duplicate key'), { code: '23505' }) });
    const bilan = await svc.envoyerRappelsRdvSalaries();
    expect(bilan.envoyes).toBe(0);
    expect(bilan.echecs).toBe(0);
  });

  test('un envoi en échec est TRACÉ comme tel, avec son motif tronqué', async () => {
    mockSend.mockRejectedValue(new Error('X'.repeat(400)));
    const bilan = await svc.envoyerRappelsRdvSalaries();
    expect(bilan.echecs).toBe(1);
    const params = traces()[0][1];
    expect(params[4]).toBe('echec');
    expect(params[5].length).toBe(200);
  });

  test('sans clé Brevo, l’envoi est marqué « simulé » et non « envoyé »', async () => {
    mockSend.mockResolvedValue({ dryRun: true });
    const bilan = await svc.envoyerRappelsRdvSalaries();
    expect(bilan.dry_run).toBe(1);
    expect(bilan.envoyes).toBe(0);
    expect(traces()[0][1][4]).toBe('dry_run');
  });
});
