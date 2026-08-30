/**
 * PURGE DES RÉPONSES DÉTAILLÉES AU QUESTIONNAIRE PCM (2.45.0).
 *
 * Contrepartie, demandée par le client, du maintien de la passation dans le
 * parcours de recrutement : les 20 réponses item par item n'ont plus aucun
 * usage une fois le profil calculé (minimisation, art. 5-1-c ; recherche
 * versée au dossier, §6.3 c). Elles partent bien avant le test lui-même.
 *
 * Ce que ce fichier verrouille, et pourquoi chaque point compte :
 *   - le CRITÈRE : la date de PASSATION, la même que la purge voisine — deux
 *     délais comptés depuis deux dates différentes seraient inexplicables à une
 *     personne concernée ;
 *   - le PÉRIMÈTRE : toutes les personnes, RECRUTÉES COMPRISES. C'est le point
 *     qui distingue cette purge de sa voisine, et celui qu'un « correctif »
 *     bien intentionné supprimerait en premier en croyant aligner les deux ;
 *   - la TABLE : `pcm_answers` seule — le rapport et les types restent ;
 *   - la JOURNALISATION : silencieuse à zéro en automatique, TOUJOURS écrite en
 *     manuel (c'est elle qui prouve qu'un humain a vérifié).
 */
jest.mock('../../../src/config/database');
const pool = require('../../../src/config/database');
const purges = require('../../../src/services/rgpd-purges');

/** Dernier DELETE réellement envoyé à PostgreSQL. */
function dernierDelete() {
  const c = pool.query.mock.calls.filter(([sql]) => /DELETE FROM pcm_answers/i.test(String(sql)));
  return c.length ? { sql: String(c[c.length - 1][0]), params: c[c.length - 1][1] } : null;
}

function ligneJournal() {
  const c = pool.query.mock.calls.find(([sql]) => /INSERT INTO rgpd_audit_log/i.test(String(sql)));
  return c ? { action: c[1][1], entite: c[1][2], userId: c[1][0], details: JSON.parse(c[1][3]) } : null;
}

/** @param {{reglage?:string, supprimes?:number}} opts */
function monterMock({ reglage, supprimes = 0 } = {}) {
  pool.query.mockReset();
  pool.query.mockImplementation((sql) => {
    if (/FROM settings/i.test(sql)) {
      return Promise.resolve({ rows: reglage === undefined ? [] : [{ value: reglage }] });
    }
    if (/DELETE FROM pcm_answers/i.test(sql)) return Promise.resolve({ rowCount: supprimes });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

describe('purgePcmReponses — critère et périmètre', () => {
  test('le délai court depuis la PASSATION (completed_at, repli created_at)', async () => {
    monterMock();
    await purges.purgePcmReponses();
    const d = dernierDelete();
    expect(d.sql).toMatch(/COALESCE\(completed_at, created_at\)\s*<\s*NOW\(\)/);
    expect(d.params).toEqual(['30']); // défaut EN CODE, aucun seed en base
  });

  test('elle s’applique aussi aux personnes RECRUTÉES — aucun filtre de statut', async () => {
    // Le fondement n'est pas l'issue du recrutement mais l'inutilité de la
    // donnée : elle ne redevient pas utile parce que la personne est embauchée.
    // La purge voisine, elle, épargne les recrutés (`status <> 'hired'`).
    monterMock();
    await purges.purgePcmReponses();
    const d = dernierDelete();
    expect(d.sql).not.toMatch(/hired/i);
    expect(d.sql).not.toMatch(/FROM candidates/i);
  });

  test('elle ne touche QUE les réponses — ni la session, ni le rapport, ni les types', async () => {
    monterMock({ supprimes: 40 });
    await purges.purgePcmReponses();
    const sqls = pool.query.mock.calls.map(([s]) => String(s));
    expect(sqls.some((s) => /DELETE FROM pcm_sessions/i.test(s))).toBe(false);
    expect(sqls.some((s) => /DELETE FROM pcm_reports/i.test(s))).toBe(false);
    expect(sqls.some((s) => /UPDATE pcm_reports/i.test(s))).toBe(false);
  });

  test('le seuil est paramétrable sans redéploiement', async () => {
    monterMock({ reglage: '15' });
    const r = await purges.purgePcmReponses();
    expect(dernierDelete().params).toEqual(['15']);
    expect(r.retention_jours).toBe(15);
  });

  test('un réglage absurde retombe sur le défaut du code (jamais 0 jour)', async () => {
    // Un « 0 » lu tel quel purgerait tout, y compris le test passé ce matin.
    monterMock({ reglage: '0' });
    await purges.purgePcmReponses();
    expect(dernierDelete().params).toEqual(['30']);
  });
});

describe('purgePcmReponses — journalisation', () => {
  test('en automatique et sans rien à supprimer : aucune ligne (le journal ne se noie pas)', async () => {
    monterMock({ supprimes: 0 });
    const r = await purges.purgePcmReponses();
    expect(ligneJournal()).toBeNull();
    expect(r.journalise).toBe(false);
  });

  test('en automatique avec suppression : une ligne de synthèse AUTO_', async () => {
    monterMock({ supprimes: 60 });
    const r = await purges.purgePcmReponses();
    const l = ligneJournal();
    expect(l.action).toBe('AUTO_PURGE_PCM_REPONSES');
    expect(l.entite).toBe('pcm_answers');
    expect(l.userId).toBeNull();
    expect(l.details.rows_deleted).toBe(60);
    expect(r.supprimes).toEqual({ pcm_answers: 60 });
  });

  test('en MANUEL : ligne écrite même à zéro, avec l’utilisateur — c’est la preuve de la vérification', async () => {
    monterMock({ supprimes: 0 });
    const r = await purges.purgePcmReponses({ trigger: 'manual', userId: 42 });
    const l = ligneJournal();
    expect(l.action).toBe('PURGE_PCM_REPONSES');
    expect(l.userId).toBe(42);
    expect(l.details.rows_deleted).toBe(0);
    expect(r.journalise).toBe(true);
  });

  test('un échec SQL est rapporté, pas avalé', async () => {
    pool.query.mockReset();
    pool.query.mockImplementation((sql) => {
      if (/DELETE FROM pcm_answers/i.test(sql)) return Promise.reject(new Error('relation « pcm_answers » inexistante'));
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const r = await purges.purgePcmReponses({ trigger: 'manual', userId: 42 });
    expect(r.ok).toBe(false);
    expect(r.motif).toMatch(/pcm_answers/);
    expect(ligneJournal().details.echec).toMatch(/pcm_answers/);
  });
});

describe('purgePcmReponses — inscription au registre partagé', () => {
  const entree = purges.PURGES_RGPD.find((p) => p.cle === 'pcm_reponses');

  test('elle figure au registre : elle hérite donc du bouton manuel et de l’affichage du dernier passage', () => {
    expect(entree).toBeDefined();
    expect(entree.fn).toBe(purges.purgePcmReponses);
    expect(entree.jobName).toBe('purgePcmReponses');
    expect(entree.retentionSetting).toBe('rgpd.pcm_reponses_retention_jours');
    expect(entree.retentionDefaut).toBe(30);
  });

  test('sa description dit le périmètre élargi ET la conséquence sur la réparation des rapports', () => {
    // Deux choses qu'un lecteur de l'écran RGPD ne peut pas deviner : que les
    // recrutés sont concernés, et qu'un rapport illisible cesse d'être
    // reconstructible passé ce délai.
    expect(entree.description).toMatch(/recrut/i);
    expect(entree.description).toMatch(/reconstructible|reparer-rapports-pcm/i);
  });

  test('le seuil effectif exposé à l’écran est celui que le code applique', async () => {
    monterMock({ reglage: '45' });
    const eff = await purges.retentionEffective(entree);
    expect(eff.valeur).toBe(45);
    expect(eff.unite).toBe('jours');
    expect(eff.source).toBe('rgpd.pcm_reponses_retention_jours');
  });

  test('l’en-tête du script de réparation prévient de la fenêtre désormais limitée', () => {
    // La conséquence (a) du lot : reparer-rapports-pcm.js recalcule un rapport
    // À PARTIR des réponses. Le dire ici, c'est empêcher qu'on compte dessus
    // en production six mois après une rotation de clé.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/scripts/reparer-rapports-pcm.js'), 'utf8');
    expect(src).toMatch(/rgpd\.pcm_reponses_retention_jours/);
    expect(src).toMatch(/purgePcmReponses/);
  });
});
