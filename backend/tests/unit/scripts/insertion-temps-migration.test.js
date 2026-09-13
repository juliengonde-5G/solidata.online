// ═══════════════════════════════════════════════════════════════════════════
// UNITAIRE — migration « Temps d'accompagnement » (PR B, lot 4)
// ───────────────────────────────────────────────────────────────────────────
// Deux familles de vérifications, aucune base requise :
//
//   A. ANALYSE TEXTUELLE — garde anti-dérive. init-db.js rejoue cette migration
//      à CHAQUE démarrage : une instruction ajoutée demain sans clause de
//      rejouabilité fait tomber la suite plutôt que la production.
//
//   B. EXÉCUTION SIMULÉE — `run(client)` avec un faux client : aucune
//      transaction ouverte (init-db.js l'appelle dans la sienne — un COMMIT
//      interne casserait la sienne), et le schéma du contrat § 3 est bien posé.
// ═══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const FICHIER = path.join(__dirname, '..', '..', '..', 'src', 'scripts', 'migrations', 'insertion-temps.js');
const src = fs.readFileSync(FICHIER, 'utf8');
const migration = require('../../../src/scripts/migrations/insertion-temps');

describe('contrat de module', () => {
  test('exporte `run`', () => {
    expect(typeof migration.run).toBe('function');
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
  let sql;
  let appels;
  beforeAll(async () => {
    appels = [];
    const client = { query: (t, p) => { appels.push([String(t), p]); return Promise.resolve({ rows: [] }); } };
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await migration.run(client);
    log.mockRestore();
    // On raisonne sur le SQL RÉELLEMENT ENVOYÉ (la liste des activités et des
    // statuts est interpolée depuis les constantes exportées) : analyser le
    // fichier source seul laisserait passer une contrainte mal composée.
    sql = appels.map(([t]) => t).join('\n').replace(/\s+/g, ' ');
  });

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

  // CORRECTIF m-09 — la migration pose désormais UNE écriture : l'entrée au
  // registre des traitements (art. 30) de la feuille de temps, qui manquait. La
  // règle que ce test protège n'est pas « aucun INSERT » mais « rien qui écrase
  // une donnée au redémarrage » : l'entrée est posée sous `WHERE NOT EXISTS`,
  // comme celle du lot 3 — elle ne s'écrit qu'une fois, et une reformulation
  // faite à la main en base survit à tous les déploiements suivants.
  test('la seule écriture est l’entrée au registre, et elle est conditionnelle', () => {
    const inserts = sql.match(/INSERT INTO \w+/gi) || [];
    expect(inserts).toEqual(['INSERT INTO rgpd_registre']);
    expect(sql).toMatch(/INSERT INTO rgpd_registre[\s\S]*WHERE NOT EXISTS/i);
    // Aucune INSTRUCTION de réécriture : une migration ne touche pas à
    // l'existant. (Les `ON DELETE CASCADE` des clés étrangères et la colonne
    // `updated_at` sont des déclarations de schéma, pas des écritures — d'où
    // l'ancrage sur un début d'instruction.)
    expect(sql).not.toMatch(/(^|;)\s*UPDATE\s/i);
    expect(sql).not.toMatch(/(^|;)\s*DELETE\s+FROM/i);
    expect(sql).not.toMatch(/ON CONFLICT[\s\S]{0,80}DO UPDATE/i);
  });

  test('l’entrée au registre nomme le destinataire EXTERNE et la durée de piste d’audit', () => {
    expect(sql).toMatch(/autorité de gestion/i);
    expect(sql).toMatch(/DDETS/);
    expect(sql).toMatch(/Cinq ans après la clôture/);
    // Et elle dit ce qui N'Y FIGURE PAS — c'est la moitié utile d'une entrée
    // art. 30 sur une pièce transmise.
    expect(sql).toMatch(/AUCUN nom de bénéficiaire/);
    expect(sql).toMatch(/SANS leur motif ni leur catégorie/);
  });

  test('aucune interpolation d’une valeur venue de l’extérieur du module', () => {
    // Les seules interpolations tolérées sont les listes de constantes du
    // module lui-même (activités, statuts) : elles ne viennent d'aucune entrée.
    const interpolations = src.match(/\$\{[^}]+\}/g) || [];
    for (const i of interpolations) {
      expect(i).toMatch(/ACTIVITES_SAISIES|STATUTS_FEUILLE/);
    }
  });
});

describe('B. schéma posé — contrat § 3 (lot 4)', () => {
  let sql;
  beforeAll(async () => {
    const appels = [];
    const client = { query: (t) => { appels.push(String(t)); return Promise.resolve({ rows: [] }); } };
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await migration.run(client);
    log.mockRestore();
    sql = appels.join('\n').replace(/\s+/g, ' ');
  });

  test('les 2 tables du lot', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS insertion_temps_saisies (');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS insertion_feuilles_temps (');
  });

  test('insertion_temps_saisies : durée bornée (> 0 et ≤ 600 min)', () => {
    expect(sql).toContain('duree_minutes SMALLINT NOT NULL CHECK (duree_minutes > 0 AND duree_minutes <= 600)');
  });

  test('insertion_temps_saisies : activités en liste FERMÉE', () => {
    expect(sql).toContain("activite VARCHAR(20) NOT NULL CHECK (activite IN ('atelier_collectif', 'reunion_projet', 'autre'))");
  });

  test('insertion_temps_saisies : AUCUNE colonne salarié (ces activités n’en ont pas)', () => {
    const table = sql.split('CREATE TABLE IF NOT EXISTS insertion_temps_saisies (')[1].split(');')[0];
    expect(table).not.toMatch(/employee_id/);
  });

  test('insertion_temps_saisies : le projet survit à la suppression du projet (SET NULL)', () => {
    // ON DELETE CASCADE effacerait une ligne de temps réellement passé parce
    // qu'une opération a été supprimée : le temps a bien été travaillé.
    expect(sql).toContain('projet_id INTEGER REFERENCES insertion_projets(id) ON DELETE SET NULL');
  });

  test('insertion_feuilles_temps : UNE feuille par intervenant et par mois', () => {
    expect(sql).toContain('UNIQUE(user_id, annee, mois)');
    expect(sql).toContain('mois SMALLINT NOT NULL CHECK (mois BETWEEN 1 AND 12)');
  });

  test('insertion_feuilles_temps : les 3 statuts, brouillon par défaut', () => {
    expect(sql).toContain("statut VARCHAR(22) NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'validee_intervenant', 'validee_rh'))");
  });

  test('insertion_feuilles_temps : le snapshot est NULLABLE (NULL tant que brouillon)', () => {
    expect(sql).toMatch(/lignes JSONB,\s*totaux JSONB,\s*coherence JSONB/);
    expect(sql).not.toMatch(/lignes JSONB NOT NULL/);
  });

  test('insertion_feuilles_temps : aucune colonne nominative de bénéficiaire', () => {
    const table = sql.split('CREATE TABLE IF NOT EXISTS insertion_feuilles_temps (')[1].split(');')[0];
    expect(table).not.toMatch(/employee_id|first_name|last_name|nom /);
  });

  test('les constantes de la migration sont exportées (source unique du routeur)', () => {
    expect(migration.ACTIVITES_SAISIES).toEqual(['atelier_collectif', 'reunion_projet', 'autre']);
    expect(migration.STATUTS_FEUILLE).toEqual(['brouillon', 'validee_intervenant', 'validee_rh']);
  });
});
