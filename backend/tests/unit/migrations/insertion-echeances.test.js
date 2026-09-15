// ═══════════════════════════════════════════════════════════════════════════
// UNITAIRE — migration « Section CIP » (PR C, lot 5)
// ───────────────────────────────────────────────────────────────────────────
// Deux familles de vérifications, aucune base requise :
//
//   A. ANALYSE TEXTUELLE — chaque CREATE / ALTER porte sa clause de
//      rejouabilité, le CHECK ajouté après coup passe par un DO-scan de
//      `pg_constraint`. `init-db.js` rejoue cette migration à CHAQUE démarrage :
//      une instruction non rejouable ferait échouer tous les déploiements
//      suivants, pas seulement le premier.
//
//   B. EXÉCUTION SIMULÉE — `run(client)` est appelé DEUX FOIS avec un faux
//      client : on vérifie qu'il n'ouvre aucune transaction (init-db l'appelle
//      dans la sienne) et que la seconde passe envoie exactement les mêmes
//      instructions que la première — c'est cela, l'idempotence, et non « ça
//      n'a pas planté ».
// ═══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const FICHIER = path.join(__dirname, '..', '..', '..', 'src', 'scripts', 'migrations', 'insertion-echeances.js');
const src = fs.readFileSync(FICHIER, 'utf8');
const migration = require('../../../src/scripts/migrations/insertion-echeances');

const sql = src.replace(/\s+/g, ' ');

describe('contrat de module', () => {
  test('exporte `run` et la liste fermée des motifs', () => {
    expect(typeof migration.run).toBe('function');
    expect(migration.MOTIFS_REPORT).toEqual([
      'attente_piece', 'attente_referent', 'personne_absente', 'rdv_planifie', 'autre',
    ]);
  });

  test('n’ouvre AUCUNE transaction (init-db.js l’appelle dans la sienne)', () => {
    expect(src).not.toMatch(/query\(\s*['`"](BEGIN|COMMIT|ROLLBACK|SAVEPOINT)/i);
  });

  test('n’utilise que `client.query` (jamais le pool global)', () => {
    expect(src).not.toMatch(/require\(.*config\/database/);
    expect(src).toMatch(/client\.query\(/);
  });
});

describe('A. idempotence — analyse textuelle', () => {
  test('chaque ALTER TABLE ... ADD COLUMN porte IF NOT EXISTS', () => {
    const alters = sql.match(/ALTER TABLE \w+ ADD COLUMN[^;']*/g) || [];
    expect(alters.length).toBe(3); // eti_token, eti_token_expires_at, eti_token_generated_by
    for (const a of alters) expect(a).toMatch(/ADD COLUMN IF NOT EXISTS/);
  });

  test('chaque CREATE TABLE / CREATE INDEX porte IF NOT EXISTS', () => {
    const creates = sql.match(/CREATE TABLE[^(]*/g) || [];
    expect(creates.length).toBe(1);
    for (const c of creates) expect(c).toMatch(/CREATE TABLE IF NOT EXISTS/);
    const idx = sql.match(/CREATE (UNIQUE )?INDEX[^(]*/g) || [];
    expect(idx.length).toBe(2);
    for (const c of idx) expect(c).toMatch(/INDEX IF NOT EXISTS/);
  });

  test('l’index du jeton est PARTIEL (WHERE eti_token IS NOT NULL)', () => {
    // Sans la clause partielle, les dizaines de milliers d'entretiens SANS
    // jeton entreraient dans l'index pour rien — et l'unicité doit porter sur
    // les jetons, jamais sur leur absence.
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_insertion_milestones_eti_token ON insertion_milestones\(eti_token\) WHERE eti_token IS NOT NULL/);
  });

  test('le CHECK du motif passe par un DO-scan de pg_constraint', () => {
    // `ALTER TABLE ... ADD CONSTRAINT` n'accepte pas IF NOT EXISTS : la seule
    // façon de le rejouer est d'interroger `pg_constraint` d'abord.
    // Le scan porte sur la TABLE et le nom (correctif m-03) : `conname` seul,
    // un homonyme sur une autre table ferait croire la contrainte posée.
    expect(sql).toMatch(/SELECT 1 FROM pg_constraint/);
    expect(sql).toMatch(/conrelid = 'insertion_echeance_reports'::regclass/);
    expect(sql).toMatch(/conname = 'chk_insertion_echeance_reports_motif'/);
    expect(sql).toMatch(/ADD CONSTRAINT chk_insertion_echeance_reports_motif/);
  });

  test('`motif` reste NULLABLE et sans défaut (le 1er report n’en exige pas)', () => {
    // Un défaut 'autre' rendrait le compteur de motifs muet sur la différence
    // entre « pas demandé » et « pas su » — c'est précisément la distinction
    // que le 2e report oblige à faire.
    expect(sql).toMatch(/motif VARCHAR\(30\),/);
    expect(sql).not.toMatch(/motif VARCHAR\(30\)[^,]*DEFAULT/);
    expect(sql).not.toMatch(/motif VARCHAR\(30\) NOT NULL/);
    // La liste est interpolée depuis la constante du module : on vérifie donc
    // le SQL RÉELLEMENT ENVOYÉ (section B), pas le gabarit.
    expect(sql).toMatch(/CHECK \(motif IS NULL OR motif IN \(\$\{MOTIFS_REPORT/);
  });

  test('une ligne PAR report (aucune contrainte d’unicité salarié+type)', () => {
    // C'est le NOMBRE de reports qui dit qu'un dossier tourne en rond. Un
    // UNIQUE(employee_id, echeance_type) écraserait cette information.
    expect(sql).not.toMatch(/UNIQUE\(employee_id, echeance_type\)/);
    expect(sql).toMatch(/employee_id INTEGER NOT NULL REFERENCES employees\(id\) ON DELETE CASCADE/);
  });

  test('aucune entrée de registre art. 30 (le lien ETI est un mode d’accès)', () => {
    expect(sql).not.toMatch(/INSERT INTO rgpd_registre/);
  });
});

describe('B. exécution simulée — rejouée DEUX fois', () => {
  const passes = [];
  const client = (bac) => ({
    query: (text, params) => { bac.push([String(text).replace(/\s+/g, ' ').trim(), params]); return Promise.resolve({ rows: [] }); },
  });

  beforeAll(async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    for (let i = 0; i < 2; i++) {
      const bac = [];
      await migration.run(client(bac));
      passes.push(bac);
    }
    log.mockRestore();
  });

  test('la seconde passe envoie EXACTEMENT les mêmes instructions', () => {
    expect(passes[1].map(([t]) => t)).toEqual(passes[0].map(([t]) => t));
  });

  test('les trois colonnes et la table sont bien demandées', () => {
    const tout = passes[0].map(([t]) => t).join('\n');
    for (const c of ['eti_token', 'eti_token_expires_at', 'eti_token_generated_by']) {
      expect(tout).toContain(`ADD COLUMN IF NOT EXISTS ${c}`);
    }
    expect(tout).toContain('CREATE TABLE IF NOT EXISTS insertion_echeance_reports');
  });

  test('le CHECK envoyé porte les CINQ motifs, et eux seuls', () => {
    const check = passes[0].map(([t]) => t).find((t) => t.includes('chk_insertion_echeance_reports_motif'));
    expect(check).toContain("CHECK (motif IS NULL OR motif IN ('attente_piece', 'attente_referent', 'personne_absente', 'rdv_planifie', 'autre'))");
  });

  test('aucune valeur variable n’est concaténée dans une requête', () => {
    // La seule interpolation du fichier est la LISTE FIXE des motifs, qui est
    // une constante du module et non une entrée.
    const interpolations = src.match(/\$\{[^}]+\}/g) || [];
    expect(interpolations.length).toBeGreaterThan(0);
    for (const i of interpolations) expect(i).toMatch(/MOTIFS_REPORT|^\$\{m\}$/);
  });
});
