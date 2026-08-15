/**
 * Module 33 « Temps & Présence » — jobs planifiés.
 *
 *  - BO-10 `badgeusePurgeRetention` : application EFFECTIVE des durées de
 *    conservation. « Une durée inscrite au registre mais non appliquée
 *    techniquement constitue un manquement caractérisé » (NOTE_JURIDIQUE §3.7)
 *    — ce test vérifie que la purge vise les bonnes tables, avec les bonnes
 *    clauses, et qu'elle lit ses seuils dans les settings (jamais en dur).
 *  - BO-09 `checkBadgeuseDevices` : détection des postes silencieux.
 *
 * DB mockée : le dry-run permet de tout vérifier sans jamais supprimer.
 */
const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} })),
}));

// Service de notification (Brevo) mocké : l'alerte e-mail BO-09 est vérifiée
// sans jamais sortir sur le réseau (QA-04).
const mockNotify = jest.fn(async () => ({ dryRun: true }));
jest.mock('../../../src/services/notification', () => ({
  sendNotification: (...a) => mockNotify(...a),
}));

const { badgeusePurgeRetention, checkBadgeuseDevices } = require('../../../src/services/scheduler');

/** Capture les requêtes émises, indexées par table visée. */
function sqlFor(table) {
  return mockQuery.mock.calls
    .map((c) => ({ sql: String(c[0]), params: c[1] }))
    .filter((c) => c.sql.includes(table));
}

/** Mock : settings + comptages/suppressions. */
function installMocks({ settings = {}, counts = {}, erreurs = [] } = {}) {
  mockQuery.mockImplementation((sql, params) => {
    const s = String(sql);
    if (/SELECT value FROM settings/.test(s)) {
      const key = params && params[0];
      return Promise.resolve({ rows: settings[key] != null ? [{ value: settings[key] }] : [] });
    }
    for (const t of erreurs) {
      if (s.includes(t)) return Promise.reject(new Error(`relation "${t}" does not exist`));
    }
    const table = Object.keys(counts).find((t) => s.includes(t));
    const n = table ? counts[table] : 0;
    if (/^SELECT COUNT/.test(s.trim())) return Promise.resolve({ rows: [{ n }] });
    if (/^DELETE FROM/.test(s.trim())) return Promise.resolve({ rowCount: n, rows: [] });
    if (/INSERT INTO rgpd_audit_log/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

let logSpy;
let warnSpy;
let errSpy;
beforeEach(() => {
  mockQuery.mockReset();
  installMocks();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errSpy.mockRestore();
  delete global.__io;
});

describe('badgeusePurgeRetention — dry-run (BO-10)', () => {
  test('en dry-run, AUCUNE suppression n\'est émise (que des comptages)', async () => {
    installMocks({ counts: { badgeuse_pointages: 12, badgeuse_corrections: 3 } });
    const r = await badgeusePurgeRetention({ dryRun: true });

    const sqls = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /^\s*DELETE FROM/.test(s))).toBe(false);
    expect(sqls.some((s) => /^\s*SELECT COUNT/.test(s))).toBe(true);
    expect(r.dry_run).toBe(true);
    expect(r.pointages).toBe(12);
    expect(r.corrections).toBe(3);
  });

  test('en dry-run, la purge ne se journalise PAS (rien n\'a été supprimé)', async () => {
    installMocks({ counts: { badgeuse_pointages: 12 } });
    await badgeusePurgeRetention({ dryRun: true });
    expect(mockQuery.mock.calls.some((c) => /INSERT INTO rgpd_audit_log/.test(String(c[0])))).toBe(false);
  });

  test('les 7 périmètres de la note juridique sont couverts', async () => {
    const r = await badgeusePurgeRetention({ dryRun: true });
    for (const cle of ['pointages', 'corrections', 'feuilles', 'badges', 'badge_historique', 'contenus', 'journal_acces']) {
      expect(r).toHaveProperty(cle);
    }
    for (const table of [
      'badgeuse_pointages', 'badgeuse_corrections', 'badgeuse_feuilles_temps',
      'badgeuse_badges', 'badgeuse_badge_historique', 'badgeuse_contenus', 'rgpd_audit_log',
    ]) {
      expect(sqlFor(table).length).toBeGreaterThan(0);
    }
  });
});

describe('badgeusePurgeRetention — clauses de sélection', () => {
  test('les pointages sont purgés sur leur horodatage, en MOIS', async () => {
    await badgeusePurgeRetention({ dryRun: true });
    const c = sqlFor('badgeuse_pointages')[0];
    expect(c.sql).toMatch(/horodatage_utc < NOW\(\) - \(\$1 \|\| ' months'\)::interval/);
    expect(c.params).toEqual(['60']); // défaut NOTE_JURIDIQUE §3.7
  });

  test('les corrections suivent la MÊME durée que les pointages', async () => {
    await badgeusePurgeRetention({ dryRun: true });
    const c = sqlFor('badgeuse_corrections')[0];
    expect(c.sql).toMatch(/COALESCE\(horodatage_corrige, created_at\) < NOW\(\) - \(\$1 \|\| ' months'\)::interval/);
    expect(c.params).toEqual(['60']);
  });

  test('les corrections sont purgées AVANT les pointages qu\'elles référencent', async () => {
    await badgeusePurgeRetention({ dryRun: true });
    const ordre = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(ordre.findIndex((s) => s.includes('badgeuse_corrections')))
      .toBeLessThan(ordre.findIndex((s) => s.includes('badgeuse_pointages')));
  });

  test('les feuilles sont purgées sur leur période « YYYY-MM »', async () => {
    await badgeusePurgeRetention({ dryRun: true });
    const c = sqlFor('badgeuse_feuilles_temps')[0];
    expect(c.sql).toMatch(/to_date\(periode \|\| '-01', 'YYYY-MM-DD'\)/);
    expect(c.params).toEqual(['60']);
  });

  test('SEULS les badges rendus/perdus/volés/désactivés sont purgés — jamais un badge ACTIF', async () => {
    await badgeusePurgeRetention({ dryRun: true });
    const c = sqlFor('badgeuse_badges').find((x) => !x.sql.includes('badge_historique'));
    expect(c.sql).toMatch(/statut IN \('restitue','perdu','vole','desactive'\)/);
    expect(c.sql).toMatch(/COALESCE\(restitue_le, attribue_le\) < NOW\(\) - \(\$1 \|\| ' days'\)::interval/);
    expect(c.params).toEqual(['90']);
    expect(c.sql).not.toMatch(/'actif'/);
  });

  test('l\'historique d\'un badge part avec lui, et AVANT lui', async () => {
    await badgeusePurgeRetention({ dryRun: true });
    const ordre = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(ordre.findIndex((s) => s.includes('badgeuse_badge_historique')))
      .toBeLessThan(ordre.findIndex((s) => s.includes('badgeuse_badges') && !s.includes('badge_historique')));
  });

  test('seuls les contenus EXPIRÉS (visible_au dépassé) sont purgés', async () => {
    await badgeusePurgeRetention({ dryRun: true });
    const c = sqlFor('badgeuse_contenus')[0];
    expect(c.sql).toMatch(/visible_au IS NOT NULL AND visible_au < \(NOW\(\) - \(\$1 \|\| ' days'\)::interval\)::date/);
    expect(c.params).toEqual(['365']);
  });

  test('le journal d\'accès purgé est CIBLÉ sur les actions du module', async () => {
    await badgeusePurgeRetention({ dryRun: true });
    const c = sqlFor('rgpd_audit_log').find((x) => /BADGEUSE_%/.test(x.sql));
    expect(c).toBeDefined();
    expect(c.sql).toMatch(/action LIKE 'BADGEUSE_%'/);
    expect(c.params).toEqual(['12']);
  });
});

describe('badgeusePurgeRetention — les durées viennent des SETTINGS, jamais du code', () => {
  test('les seuils paramétrés remplacent les défauts', async () => {
    installMocks({
      settings: {
        'badgeuse.retention_pointages_mois': '36',
        'badgeuse.retention_feuilles_mois': '48',
        'badgeuse.retention_badges_apres_restitution_jours': '30',
        'badgeuse.retention_contenus_apres_expiration_jours': '180',
        'badgeuse.retention_journal_acces_mois': '6',
      },
    });
    await badgeusePurgeRetention({ dryRun: true });
    expect(sqlFor('badgeuse_pointages')[0].params).toEqual(['36']);
    expect(sqlFor('badgeuse_corrections')[0].params).toEqual(['36']);
    expect(sqlFor('badgeuse_feuilles_temps')[0].params).toEqual(['48']);
    expect(sqlFor('badgeuse_badge_historique')[0].params).toEqual(['30']);
    expect(sqlFor('badgeuse_contenus')[0].params).toEqual(['180']);
    expect(sqlFor('rgpd_audit_log').find((x) => /BADGEUSE_%/.test(x.sql)).params).toEqual(['6']);
  });

  test('un seuil illisible retombe sur le défaut documenté (jamais sur 0)', async () => {
    installMocks({ settings: { 'badgeuse.retention_pointages_mois': 'n\'importe quoi' } });
    await badgeusePurgeRetention({ dryRun: true });
    expect(sqlFor('badgeuse_pointages')[0].params).toEqual(['60']);
  });
});

describe('badgeusePurgeRetention — exécution réelle', () => {
  test('hors dry-run, la purge SUPPRIME et se journalise avec son bilan', async () => {
    installMocks({ counts: { badgeuse_pointages: 5 } });
    const r = await badgeusePurgeRetention();

    expect(mockQuery.mock.calls.some((c) => /^\s*DELETE FROM badgeuse_pointages/.test(String(c[0])))).toBe(true);
    expect(r.dry_run).toBe(false);
    expect(r.pointages).toBe(5);

    const audit = mockQuery.mock.calls.find((c) => /INSERT INTO rgpd_audit_log/.test(String(c[0])));
    expect(audit).toBeDefined();
    const details = JSON.parse(audit[1][0]);
    expect(details).toMatchObject({ pointages: 5, retention_pointages_mois: 60 });
  });

  test("l'entrée de purge n'est pas une action BADGEUSE_% (elle ne s'auto-purgerait pas)", async () => {
    installMocks({ counts: { badgeuse_pointages: 5 } });
    await badgeusePurgeRetention();
    const audit = mockQuery.mock.calls.find((c) => /INSERT INTO rgpd_audit_log/.test(String(c[0])));
    expect(String(audit[0])).toContain("'AUTO_PURGE_BADGEUSE'");
    expect(String(audit[0])).not.toMatch(/'BADGEUSE_/);
  });

  test('une purge sans effet ne journalise rien (pas de bruit)', async () => {
    installMocks({ counts: {} });
    const r = await badgeusePurgeRetention();
    expect(r.items).toBe(0);
    expect(mockQuery.mock.calls.some((c) => /INSERT INTO rgpd_audit_log/.test(String(c[0])))).toBe(false);
  });

  test('RÉSILIENCE : une table absente n\'interrompt pas les autres périmètres', async () => {
    installMocks({ counts: { badgeuse_pointages: 4 }, erreurs: ['badgeuse_contenus'] });
    const r = await badgeusePurgeRetention({ dryRun: true });
    expect(r.pointages).toBe(4);   // les autres périmètres ont bien tourné
    expect(r.contenus).toBe(0);    // celui en échec est neutre
    expect(errSpy).toHaveBeenCalled();
  });

  test('le job renvoie un « items » agrégé pour l\'instrumentation job_runs', async () => {
    installMocks({ counts: { badgeuse_pointages: 4, badgeuse_corrections: 2 } });
    const r = await badgeusePurgeRetention({ dryRun: true });
    expect(r.items).toBe(6);
  });
});

describe('checkBadgeuseDevices — supervision des postes (BO-09)', () => {
  /**
   * Mock ROUTÉ PAR REQUÊTE : le job lit maintenant ses seuils dans `settings`,
   * consulte les destinataires et écrit son anti-spam — un `mockResolvedValue`
   * global rendrait les assertions trompeuses.
   */
  function mockSupervision({ postes = [], settings = {}, admins = [], erreur = null } = {}) {
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (erreur && /FROM badgeuse_devices/.test(s)) return Promise.reject(new Error(erreur));
      if (/SELECT value FROM settings/.test(s)) {
        const key = params && params[0];
        return Promise.resolve({ rows: settings[key] != null ? [{ value: settings[key] }] : [] });
      }
      if (/FROM badgeuse_devices/.test(s)) return Promise.resolve({ rows: postes });
      if (/FROM users/.test(s)) return Promise.resolve({ rows: admins.map((email) => ({ email })) });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  }

  const POSTE_MUET = { id: 1, code: 'LH-P1', libelle: 'Atelier', dernier_heartbeat: null };

  test('un poste silencieux depuis > seuil est signalé', async () => {
    mockSupervision({ postes: [POSTE_MUET] });
    const r = await checkBadgeuseDevices();
    expect(r).toMatchObject({ items: 1, silence_minutes: 15 });
    expect(warnSpy.mock.calls.flat().join(' ')).toContain('LH-P1');
  });

  test('la requête ne vise que les postes ACTIFS et applique le seuil PARAMÉTRÉ', async () => {
    mockSupervision({ postes: [] });
    await checkBadgeuseDevices();
    const c = sqlFor('badgeuse_devices')[0];
    expect(c.sql).toMatch(/actif = true/);
    expect(c.sql).toMatch(/dernier_heartbeat IS NULL OR dernier_heartbeat < NOW\(\) - \(\$1 \|\| ' minutes'\)::interval/);
    expect(c.params).toEqual(['15']); // défaut documenté
  });

  test('QA-11 : le seuil n\'est plus codé en dur — il vient de settings', async () => {
    mockSupervision({ postes: [], settings: { 'badgeuse.supervision_silence_minutes': '30' } });
    const r = await checkBadgeuseDevices();
    expect(sqlFor('badgeuse_devices')[0].params).toEqual(['30']);
    expect(r.silence_minutes).toBe(30);
    // Le code source ne porte plus la constante littérale du seuil.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'services', 'scheduler.js'), 'utf8');
    expect(src).not.toMatch(/const SILENCE_MINUTES = 15/);
    expect(src).toMatch(/badgeuse\.supervision_silence_minutes/);
  });

  test('aucun poste en retard → rien à signaler, aucun e-mail', async () => {
    mockSupervision({ postes: [] });
    const r = await checkBadgeuseDevices();
    expect(r).toMatchObject({ items: 0, emails: 0 });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('émission Socket.IO « badgeuse:device-offline » sur la salle de supervision', async () => {
    const emit = jest.fn();
    global.__io = { to: jest.fn(() => ({ emit })) };
    mockSupervision({ postes: [POSTE_MUET] });

    await checkBadgeuseDevices();
    expect(global.__io.to).toHaveBeenCalledWith('badgeuse:supervision');
    expect(emit).toHaveBeenCalledWith('badgeuse:device-offline', expect.objectContaining({
      silence_minutes: 15,
      postes: [expect.objectContaining({ code: 'LH-P1' })],
    }));
  });

  test('sans Socket.IO initialisé, le job ne plante pas', async () => {
    mockSupervision({ postes: [POSTE_MUET] });
    await expect(checkBadgeuseDevices()).resolves.toMatchObject({ items: 1 });
  });

  test('RÉSILIENCE : table absente → 0, jamais d\'exception qui casse runAllJobs', async () => {
    mockSupervision({ erreur: 'relation "badgeuse_devices" does not exist' });
    await expect(checkBadgeuseDevices()).resolves.toEqual({ items: 0 });
  });
});

describe('QA-04 — alerte e-mail de silence (BO-09)', () => {
  function mockSupervision({ postes = [], settings = {}, admins = [] } = {}) {
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/SELECT value FROM settings/.test(s)) {
        const key = params && params[0];
        return Promise.resolve({ rows: settings[key] != null ? [{ value: settings[key] }] : [] });
      }
      if (/FROM badgeuse_devices/.test(s)) return Promise.resolve({ rows: postes });
      if (/FROM users/.test(s)) return Promise.resolve({ rows: admins.map((email) => ({ email })) });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  }

  const POSTE_MUET = { id: 1, code: 'LH-P1', libelle: 'Atelier', dernier_heartbeat: null };

  beforeEach(() => { mockNotify.mockClear(); });

  test('un e-mail part vers CHAQUE destinataire paramétré', async () => {
    mockSupervision({
      postes: [POSTE_MUET],
      settings: { 'badgeuse.supervision_alerte_emails': 'rh@solidarite-textiles.fr, direction@solidarite-textiles.fr' },
    });
    const r = await checkBadgeuseDevices();
    expect(r.emails).toBe(2);
    expect(mockNotify).toHaveBeenCalledTimes(2);
    const [template, destinataire] = mockNotify.mock.calls[0];
    expect(template.type).toBe('email');
    expect(template.subject).toContain('poste(s) de pointage');
    expect(template.body).toContain('LH-P1');
    expect(destinataire).toBe('rh@solidarite-textiles.fr');
  });

  test('REPLI documenté : sans paramétrage, l\'alerte part aux ADMIN actifs', async () => {
    mockSupervision({ postes: [POSTE_MUET], admins: ['admin@solidarite-textiles.fr'] });
    const r = await checkBadgeuseDevices();
    expect(r.emails).toBe(1);
    expect(mockNotify.mock.calls[0][1]).toBe('admin@solidarite-textiles.fr');
  });

  test('GARDE : aucun destinataire → le job réussit quand même (jamais d\'échec)', async () => {
    mockSupervision({ postes: [POSTE_MUET], admins: [] });
    const r = await checkBadgeuseDevices();
    expect(r).toMatchObject({ items: 1, emails: 0, email_statut: 'aucun_destinataire' });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.flat().join(' ')).toContain('aucun destinataire');
  });

  test('GARDE : un envoi en échec ne fait pas échouer la détection', async () => {
    mockNotify.mockRejectedValueOnce(new Error('Brevo indisponible'));
    mockSupervision({ postes: [POSTE_MUET], settings: { 'badgeuse.supervision_alerte_emails': 'rh@x.fr' } });
    const r = await checkBadgeuseDevices();
    expect(r.items).toBe(1);     // la détection reste rendue
    expect(r.emails).toBe(0);
    expect(errSpy).toHaveBeenCalled();
  });

  test('ANTI-SPAM : un poste déjà alerté il y a moins de 6 h ne redéclenche pas d\'e-mail', async () => {
    mockSupervision({
      postes: [POSTE_MUET],
      settings: {
        'badgeuse.supervision_alerte_emails': 'rh@x.fr',
        'badgeuse.supervision_derniere_alerte': JSON.stringify({ 'LH-P1': new Date(Date.now() - 3600 * 1000).toISOString() }),
      },
    });
    const r = await checkBadgeuseDevices();
    expect(r).toMatchObject({ items: 1, emails: 0, email_statut: 'anti_spam' });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test('ANTI-SPAM : au-delà de la fenêtre, l\'alerte repart', async () => {
    mockSupervision({
      postes: [POSTE_MUET],
      settings: {
        'badgeuse.supervision_alerte_emails': 'rh@x.fr',
        'badgeuse.supervision_derniere_alerte': JSON.stringify({ 'LH-P1': new Date(Date.now() - 12 * 3600 * 1000).toISOString() }),
      },
    });
    expect((await checkBadgeuseDevices()).emails).toBe(1);
  });

  test('l\'envoi réussi mémorise la date d\'alerte pour l\'anti-spam', async () => {
    mockSupervision({ postes: [POSTE_MUET], settings: { 'badgeuse.supervision_alerte_emails': 'rh@x.fr' } });
    await checkBadgeuseDevices();
    const ecriture = mockQuery.mock.calls
      .map((c) => ({ sql: String(c[0]), params: c[1] }))
      .find((c) => /INSERT INTO settings/.test(c.sql) && c.params[0] === 'badgeuse.supervision_derniere_alerte');
    expect(ecriture).toBeDefined();
    expect(JSON.parse(ecriture.params[1])['LH-P1']).toBeTruthy();
  });

  test('l\'e-mail rassure explicitement : aucune heure n\'est perdue', async () => {
    mockSupervision({ postes: [POSTE_MUET], settings: { 'badgeuse.supervision_alerte_emails': 'rh@x.fr' } });
    await checkBadgeuseDevices();
    expect(mockNotify.mock.calls[0][0].body).toContain('Aucun pointage n\'est perdu');
  });
});

describe('enregistrement dans la chaîne planifiée et la supervision', () => {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..', '..', '..');

  test('les deux jobs sont appelés par runAllJobs via runInstrumented', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'services', 'scheduler.js'), 'utf8');
    expect(src).toMatch(/runInstrumented\('checkBadgeuseDevices', checkBadgeuseDevices\)/);
    expect(src).toMatch(/runInstrumented\('badgeusePurgeRetention', badgeusePurgeRetention\)/);
  });

  test('les deux jobs figurent au JOB_SCHEDULE de la supervision', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'monitoring.js'), 'utf8');
    const bloc = src.slice(src.indexOf('const JOB_SCHEDULE'), src.indexOf('// Seuils de fraîcheur'));
    expect(bloc).toMatch(/checkBadgeuseDevices:\s*\{/);
    expect(bloc).toMatch(/badgeusePurgeRetention:\s*\{/);
  });
});
