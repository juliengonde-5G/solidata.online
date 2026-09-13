// ═══════════════════════════════════════════════════════════════════════════
// UNITAIRE — migration « Dossier administratif d'insertion » (PR A, lot 1)
// ───────────────────────────────────────────────────────────────────────────
// Deux familles de vérifications, aucune base requise :
//
//   A. ANALYSE TEXTUELLE — chaque CREATE / ALTER porte sa clause de
//      rejouabilité (IF NOT EXISTS), chaque seed son ON CONFLICT DO NOTHING,
//      chaque CHECK ajouté passe par un DO-scan de `pg_constraint`, et l'entrée
//      de registre RGPD est gardée par un NOT EXISTS. C'est la garde
//      anti-dérive : une instruction ajoutée demain sans garde fait tomber la
//      suite (init-db.js rejoue cette migration à CHAQUE démarrage).
//
//   B. EXÉCUTION SIMULÉE — `run(client)` est appelé avec un faux client qui
//      enregistre les requêtes : on vérifie qu'il n'ouvre AUCUNE transaction
//      (init-db.js l'appelle dans la sienne — un COMMIT interne casserait la
//      sienne) et que les 14 critères sont bien seedés en requêtes PARAMÉTRÉES.
// ═══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const FICHIER = path.join(__dirname, '..', '..', '..', 'src', 'scripts', 'migrations', 'insertion-cadre.js');
const src = fs.readFileSync(FICHIER, 'utf8');
const migration = require('../../../src/scripts/migrations/insertion-cadre');

// Toutes les instructions SQL du fichier, aplaties (les requêtes sont écrites
// sur plusieurs lignes ; on raisonne sur du SQL normalisé).
const sql = src.replace(/\s+/g, ' ');

describe('contrat de module', () => {
  test('exporte `run`', () => {
    expect(typeof migration.run).toBe('function');
  });

  test('n’ouvre AUCUNE transaction (init-db.js l’appelle dans la sienne)', () => {
    // NB : les `DO $$ BEGIN … END $$` des DO-scan ne sont PAS des transactions —
    // on ne cherche donc que des instructions de transaction envoyées telles
    // quelles à `query` (un COMMIT interne casserait celle d'init-db.js).
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
    expect(creates.length).toBeGreaterThan(0);
    for (const c of creates) expect(c).toMatch(/CREATE TABLE IF NOT EXISTS/);
  });

  test('chaque CREATE INDEX porte IF NOT EXISTS', () => {
    const idx = sql.match(/CREATE INDEX[^(]*/g) || [];
    expect(idx.length).toBeGreaterThan(0);
    for (const c of idx) expect(c).toMatch(/CREATE INDEX IF NOT EXISTS/);
  });

  test('chaque ALTER TABLE ... ADD COLUMN porte IF NOT EXISTS', () => {
    const alters = sql.match(/ALTER TABLE \w+ ADD COLUMN[^;]*/g) || [];
    expect(alters.length).toBeGreaterThan(0);
    for (const a of alters) expect(a).toMatch(/ADD COLUMN IF NOT EXISTS/);
  });

  test('les CHECK ajoutés après coup passent par un DO-scan de pg_constraint', () => {
    // `ALTER TABLE ... ADD CONSTRAINT` n'accepte pas IF NOT EXISTS : la seule
    // façon de le rejouer est de tester `pg_constraint` d'abord.
    const adds = sql.match(/ALTER TABLE \w+ ADD CONSTRAINT/g) || [];
    expect(adds.length).toBeGreaterThan(0);
    expect(sql).toMatch(/FROM pg_constraint/);
    // Autant de gardes que d'ajouts non couverts par la reconstruction du CHECK
    // de cip_action_plans (qui a sa propre garde `pg_get_constraintdef`).
    expect(sql).toMatch(/pg_get_constraintdef/);
  });

  test('les seeds sont en ON CONFLICT DO NOTHING ou WHERE NOT EXISTS', () => {
    // Découpe sur les INSERT eux-mêmes (les textes seedés contiennent des « ; »,
    // on ne peut pas se fier au point-virgule pour borner l'instruction).
    const morceaux = sql.split(/INSERT INTO /).slice(1);
    expect(morceaux.length).toBeGreaterThan(0);
    for (const m of morceaux) {
      expect(m).toMatch(/ON CONFLICT[\s\S]*?DO NOTHING|WHERE NOT EXISTS/);
    }
  });

  test('l’entrée du registre RGPD est gardée (rejouable sans doublon)', () => {
    expect(sql).toMatch(/INSERT INTO rgpd_registre[\s\S]*WHERE NOT EXISTS/);
    expect(sql).toMatch(/nom_traitement ILIKE 'Dossier administratif d''insertion%'/);
  });
});

describe('B. schéma posé — contrat § 3', () => {
  test('les 4 tables du lot', () => {
    for (const t of ['insertion_eligibilite_criteres', 'employee_eligibilite',
      'insertion_pass_iae_evenements', 'insertion_pieces']) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${t} (`);
    }
  });

  test('employee_eligibilite : UNIQUE(employee_id, critere_code) + cascade salarié', () => {
    expect(sql).toMatch(/employee_id INTEGER NOT NULL REFERENCES employees\(id\) ON DELETE CASCADE, critere_code VARCHAR\(30\) NOT NULL REFERENCES insertion_eligibilite_criteres\(code\)/);
    expect(sql).toContain('UNIQUE(employee_id, critere_code)');
  });

  test('insertion_pieces : AUCUN justificatif d’éligibilité dans la liste fermée', () => {
    expect(sql).toContain("CHECK (type IN ('entretien_signe','convention_pmsmp','accuse_remise','autre'))");
    expect(sql).not.toMatch(/justificatif_eligibilite|eligibilite_justificatif/);
  });

  test('insertion_pieces : contenu en BYTEA, taille bornée, MIME en liste fermée', () => {
    expect(sql).toContain('contenu BYTEA NOT NULL');
    expect(sql).toContain('sha256 CHAR(64) NOT NULL');
    expect(sql).toContain('CHECK (taille > 0 AND taille <= 5242880)');
    expect(sql).toContain("CHECK (mime IN ('application/pdf','image/jpeg','image/png'))");
  });

  test('les 15 colonnes du cadre 2026 sur employees', () => {
    for (const c of ['brsa BOOLEAN', 'brsa_date_constat DATE', 'ft_categorie VARCHAR(1)',
      'ft_categorie_date DATE', 'orienteur_type VARCHAR(20)', 'orienteur_nom VARCHAR(150)',
      'referent_unique_type VARCHAR(20) NOT NULL DEFAULT \'non_determine\'',
      'referent_unique_nom VARCHAR(150)', 'referent_unique_contact VARCHAR(200)',
      'actualisation_ft_requise BOOLEAN NOT NULL DEFAULT false',
      'actualisation_ft_derniere_date DATE',
      'actualisation_ft_rappels_non_honores SMALLINT NOT NULL DEFAULT 0',
      'pass_iae_statut VARCHAR(12) NOT NULL DEFAULT \'inconnu\'',
      'eligibilite_verifiee_le DATE', 'eligibilite_source VARCHAR(30)']) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${c}`);
    }
  });

  test('`brsa` est NULLABLE sans défaut — « non renseigné » ≠ « non »', () => {
    // Un défaut `false` ferait disparaître des personnes du compte déclaré au
    // Département : la colonne doit garder ses trois états.
    expect(sql).not.toMatch(/brsa BOOLEAN[^,;]*DEFAULT/);
  });

  test('le CHECK de cip_action_plans est RECONSTRUIT en gardant les 4 valeurs historiques', () => {
    expect(sql).toContain("CHECK (category IN ('competence','insertion','socialisation','frein','job_dating','formation'))");
    // reconstruction conditionnelle : on ne DROP que si la contrainte ne
    // couvre pas déjà la nouvelle valeur.
    expect(sql).toMatch(/def IS NULL OR def NOT LIKE '%job_dating%'/);
  });

  test('etp_asp_mensuel.nb_brsa', () => {
    expect(sql).toContain('ALTER TABLE etp_asp_mensuel ADD COLUMN IF NOT EXISTS nb_brsa INTEGER');
  });

  test('le partenaire CMS du Département est seedé', () => {
    expect(sql).toContain("Centre médico-social (CMS) — Département 76");
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

  test('les 14 critères sont seedés, en requêtes PARAMÉTRÉES', () => {
    const seeds = appels.filter(([t]) => t.includes('INSERT INTO insertion_eligibilite_criteres'));
    expect(seeds).toHaveLength(14);
    for (const [texte, params] of seeds) {
      expect(texte).toContain('ON CONFLICT (code) DO NOTHING');
      expect(Array.isArray(params)).toBe(true);
      expect(params).toHaveLength(3);
      // Le libellé ne doit JAMAIS être interpolé dans le SQL.
      expect(texte).not.toContain(params[1]);
    }
    const codes = seeds.map(([, p]) => p[0]);
    expect(codes).toEqual(['brsa', 'ass', 'aah', 'deld', 'detld', 'jeune_26', 'senior_50',
      'rqth', 'qpv', 'zrr', 'refugie_bpi', 'sortant_detention', 'parent_isole', 'sans_domicile']);
  });

  test('les 5 CHECK du cadre sont posés par DO-scan', () => {
    const scans = appels.filter(([t]) => t.includes('IF NOT EXISTS (') && t.includes('FROM pg_constraint'));
    expect(scans).toHaveLength(5);
    for (const [t] of scans) expect(t).toMatch(/ALTER TABLE employees ADD CONSTRAINT employees_\w+_check/);
    // Le 6e DO-block est la RECONSTRUCTION du CHECK de cip_action_plans : il a
    // sa propre garde (relecture de `pg_get_constraintdef`), pas un IF NOT EXISTS.
    const reconstruction = appels.filter(([t]) => t.includes('pg_get_constraintdef'));
    expect(reconstruction).toHaveLength(1);
  });

  test('aucune interpolation de valeur d’entrée dans le SQL généré', () => {
    // Les seules interpolations `${}` du fichier sont des noms de contrainte et
    // d'expression, tous écrits en dur dans le module.
    const interpolations = src.match(/\$\{[^}]+\}/g) || [];
    for (const i of interpolations) expect(i).toMatch(/^\$\{(table|nom|expr)\}$/);
  });
});
