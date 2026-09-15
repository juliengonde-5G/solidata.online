// ═══════════════════════════════════════════════════════════════════════════
// UNITAIRE — migration « Cadre RSA (structure d'accueil) » (PR B, lot 3)
// ───────────────────────────────────────────────────────────────────────────
// Deux familles de vérifications, aucune base requise :
//
//   A. ANALYSE TEXTUELLE — chaque CREATE / ALTER porte sa clause de
//      rejouabilité, chaque CHECK ajouté après coup passe par un DO-scan de
//      `pg_constraint`, l'entrée de registre RGPD est gardée. C'est la garde
//      anti-dérive : `init-db.js` rejoue cette migration à CHAQUE démarrage, et
//      une instruction non rejouable ferait échouer tous les déploiements
//      suivants — pas seulement le premier.
//
//   B. EXÉCUTION SIMULÉE — `run(client)` est appelé avec un faux client : on
//      vérifie qu'il n'ouvre AUCUNE transaction (init-db.js l'appelle dans la
//      sienne — un COMMIT interne casserait la sienne) et que les textes du
//      registre partent en PARAMÈTRES (ils portent des apostrophes et, surtout,
//      ils ne doivent jamais être interpolés dans du SQL).
// ═══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const FICHIER = path.join(__dirname, '..', '..', '..', 'src', 'scripts', 'migrations', 'insertion-rsa.js');
const src = fs.readFileSync(FICHIER, 'utf8');
const migration = require('../../../src/scripts/migrations/insertion-rsa');

// SQL aplati : les requêtes sont écrites sur plusieurs lignes.
const sql = src.replace(/\s+/g, ' ');

describe('contrat de module', () => {
  test('exporte `run`', () => {
    expect(typeof migration.run).toBe('function');
  });

  test('n’ouvre AUCUNE transaction (init-db.js l’appelle dans la sienne)', () => {
    // Les `DO $$ BEGIN … END $$` des DO-scan ne sont pas des transactions : on
    // ne cherche que des instructions envoyées telles quelles à `query`.
    expect(src).not.toMatch(/query\(\s*['`"](BEGIN|COMMIT|ROLLBACK|SAVEPOINT)/i);
  });

  test('n’utilise que `client.query` (jamais le pool global)', () => {
    expect(src).not.toMatch(/require\(.*config\/database/);
    expect(src).toMatch(/client\.query\(/);
  });
});

describe('A. idempotence — analyse textuelle', () => {
  test('chaque CREATE TABLE porte IF NOT EXISTS', () => {
    const creates = sql.match(/CREATE TABLE[^(]*/g) || [];
    expect(creates.length).toBe(2);
    for (const c of creates) expect(c).toMatch(/CREATE TABLE IF NOT EXISTS/);
  });

  test('chaque CREATE INDEX porte IF NOT EXISTS', () => {
    const idx = sql.match(/CREATE INDEX[^(]*/g) || [];
    expect(idx.length).toBeGreaterThan(0);
    for (const c of idx) expect(c).toMatch(/CREATE INDEX IF NOT EXISTS/);
  });

  test('chaque ALTER TABLE ... ADD COLUMN porte IF NOT EXISTS', () => {
    const alters = sql.match(/ALTER TABLE \w+ ADD COLUMN[^;]*/g) || [];
    expect(alters.length).toBe(4); // 3 colonnes d'entretien + date_realisation
    for (const a of alters) expect(a).toMatch(/ADD COLUMN IF NOT EXISTS/);
  });

  test('les CHECK ajoutés après coup passent tous par un DO-scan de pg_constraint', () => {
    // `ALTER TABLE ... ADD CONSTRAINT` n'accepte pas IF NOT EXISTS : la seule
    // façon de le rejouer est d'interroger `pg_constraint` d'abord.
    const adds = sql.match(/ALTER TABLE \w+ ADD CONSTRAINT/g) || [];
    expect(adds.length).toBe(3); // milestone_type, referent_modalite, conciliation_issue
    const scans = sql.match(/FROM pg_constraint/g) || [];
    expect(scans.length).toBeGreaterThanOrEqual(3);
  });

  test('le CHECK milestone_type est RECONSTRUIT sous marqueur « conciliation »', () => {
    // Marqueur : une seconde exécution ne trouve plus rien à supprimer, donc la
    // table n'est pas verrouillée pour rien à chaque démarrage.
    expect(sql).toMatch(/pg_get_constraintdef\(oid\) NOT ILIKE '%conciliation%'/);
    expect(sql).toMatch(/ALTER TABLE insertion_milestones DROP CONSTRAINT/);
  });

  test('la reprise de `date_realisation` ne s’applique qu’UNE fois par ligne', () => {
    expect(sql).toMatch(/UPDATE cip_action_plans SET date_realisation = updated_at::date WHERE date_realisation IS NULL AND status = 'realise'/);
  });

  test('l’entrée du registre RGPD est gardée (rejouable sans doublon)', () => {
    expect(sql).toMatch(/INSERT INTO rgpd_registre[\s\S]*WHERE NOT EXISTS/);
    expect(sql).toMatch(/nom_traitement ILIKE 'Transmission d''informations au référent unique%'/);
  });
});

describe('B. schéma posé — contrat § 3', () => {
  test('les 8 types d’entretien, dont les deux du cadre RSA', () => {
    expect(migration.MILESTONE_TYPES_RSA).toEqual([
      'diagnostic_accueil', 'bilan_intermediaire', 'renouvellement', 'bilan_sortie',
      'suivi_post_sortie', 'periode_essai', 'point_etape_referent', 'conciliation',
    ]);
    // Les six types HISTORIQUES sont repris tels quels : les perdre
    // invaliderait toutes les lignes déjà enregistrées.
    for (const t of ['diagnostic_accueil', 'periode_essai']) expect(sql).toContain(`'${t}'`);
  });

  test('les 7 motifs légitimes de conciliation sont une liste FERMÉE de codes', () => {
    expect(migration.CONCILIATION_MOTIFS).toEqual([
      'sante', 'garde_enfant', 'transport', 'demarche_administrative',
      'formation_emploi', 'deuil_famille', 'autre',
    ]);
  });

  test('modalité du point référent et issue de conciliation : CHECK tolérant NULL', () => {
    expect(sql).toContain("CHECK (referent_modalite IS NULL OR referent_modalite IN ('tripartite', 'bilaterale'))");
    expect(sql).toContain("CHECK (conciliation_issue IS NULL OR conciliation_issue IN ('maintien', 'reprise', 'orientation', 'sans_suite'))");
  });

  test('insertion_alimentations_referent : snapshot obligatoire, cascade salarié', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS insertion_alimentations_referent (');
    expect(sql).toContain('employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE');
    // `contenu` NOT NULL : une fiche sans snapshot ne prouverait rien de ce qui
    // a été transmis.
    expect(sql).toContain('contenu JSONB NOT NULL');
    expect(sql).toContain("moment VARCHAR(15) NOT NULL CHECK (moment IN ('entree','renouvellement','sortie','demande'))");
    // La remise à la PERSONNE est tracée au même titre que celle au référent
    // (matrice autorité 09 (f) : « un exemplaire remis à la personne »).
    expect(sql).toContain('remis_salarie_le DATE');
    expect(sql).toMatch(/remis_referent_mode[^,]*IN \('mail','courrier','main_propre','plateforme'\)/);
  });

  test('insertion_actualisations_ft : `honoree` NULLABLE et SANS défaut', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS insertion_actualisations_ft (');
    expect(sql).toContain('UNIQUE(employee_id, mois)');
    // C'EST la règle de cette table : un défaut `false` transformerait chaque
    // mois non vérifié en manquement de la personne — et c'est ce constat qui
    // peut fonder une suspension de droits.
    expect(sql).toMatch(/honoree BOOLEAN,/);
    expect(sql).not.toMatch(/honoree BOOLEAN[^,]*DEFAULT/);
    expect(sql).not.toMatch(/honoree BOOLEAN NOT NULL/);
  });

  test('le registre RGPD dit l’exclusion de la santé et du judiciaire', () => {
    expect(sql).toMatch(/AUCUNE donnée de santé \(art\. 9\) et AUCUNE donnée judiciaire \(art\. 10\)/);
    expect(sql).toMatch(/LISTE BLANCHE côté serveur/);
    // … et la doctrine « motif non renseigné, jamais injustifiée » y figure.
    expect(sql).toMatch(/jamais « injustifiée »/);
  });
});

describe('C. exécution simulée de run(client)', () => {
  let appels;
  const client = { query: (text, params) => { appels.push([String(text), params]); return Promise.resolve({ rows: [] }); } };

  beforeAll(async () => {
    appels = [];
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await migration.run(client);
    log.mockRestore();
  });

  test('l’entrée du registre part en PARAMÈTRES, jamais interpolée', () => {
    const reg = appels.find(([t]) => t.includes('INSERT INTO rgpd_registre'));
    expect(reg).toBeDefined();
    const [texte, params] = reg;
    expect(Array.isArray(params)).toBe(true);
    expect(params).toHaveLength(2);
    for (const p of params) {
      expect(typeof p).toBe('string');
      expect(texte).not.toContain(p);
    }
  });

  test('aucune valeur variable n’est concaténée dans une requête', () => {
    // La seule interpolation du fichier est la LISTE FIXE des types
    // d'entretien, qui est une constante du module et non une entrée.
    const interpolations = src.match(/\$\{[^}]+\}/g) || [];
    expect(interpolations.length).toBeGreaterThan(0);
    // Chaque interpolation vient de la liste FIXE des types d'entretien
    // (constante du module) ou de sa variable de boucle : rien qui provienne
    // d'un appelant, donc rien qui puisse porter une entrée utilisateur.
    for (const i of interpolations) expect(i).toMatch(/MILESTONE_TYPES_RSA|^\$\{t\}$/);
  });

  test('les 4 colonnes et les 2 tables sont bien demandées', () => {
    const tout = appels.map(([t]) => t).join('\n');
    for (const c of ['referent_modalite', 'conciliation_motifs', 'conciliation_issue', 'date_realisation']) {
      expect(tout).toContain(`ADD COLUMN IF NOT EXISTS ${c}`);
    }
    expect(tout).toContain('CREATE TABLE IF NOT EXISTS insertion_alimentations_referent');
    expect(tout).toContain('CREATE TABLE IF NOT EXISTS insertion_actualisations_ft');
  });
});
