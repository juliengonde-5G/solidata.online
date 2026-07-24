/**
 * Module Enquêtes (RSEI-13) — socle schéma (analyse statique d'init-db.js, même
 * approche que rse-schema.test.js / energie-schema.test.js : aucune base requise).
 *
 * Vérifie :
 * - les 4 tables du module créées en CREATE TABLE IF NOT EXISTS ;
 * - les CHECK d'enums (catégorie modèle, type question, statut campagne) ;
 * - le token de campagne UNIQUE avec DEFAULT gen_random_bytes (hex) + pgcrypto ;
 * - l'ANONYMAT RÉEL : enquete_reponses ne porte AUCUNE FK vers users/employees ;
 * - l'index partiel d'unicité sur jeton_unicite (anti-doublon sans identité) ;
 * - l'ordre des FK (questions.modele_id après enquete_modeles ; reponses.campagne_id
 *   après enquete_campagnes) et le CASCADE des questions/réponses ;
 * - la protection du modèle par ses campagnes (modele_id SANS ON DELETE CASCADE) ;
 * - le seed de l'entrée registre RGPD « Enquêtes internes » (WHERE NOT EXISTS) ;
 * - le rattachement des 4 tables au resync des séquences SERIAL.
 */
const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..', '..', '..'); // → backend/
const src = fs.readFileSync(path.join(BACKEND_ROOT, 'src', 'scripts', 'init-db.js'), 'utf8');

const ENQUETE_TABLES = [
  'enquete_modeles', 'enquete_questions', 'enquete_campagnes', 'enquete_reponses',
];

describe('schéma Enquêtes — les 4 tables du module', () => {
  test('chaque table est créée en CREATE TABLE IF NOT EXISTS', () => {
    for (const t of ENQUETE_TABLES) {
      expect(src).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
    }
  });

  test('enquete_modeles : catégorie contrainte + anonyme BOOLEAN DEFAULT true', () => {
    const tbl = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS enquete_modeles'));
    expect(tbl.slice(0, 900)).toMatch(/CHECK \(categorie IN \('qvct', 'satisfaction', 'integration', 'sensibilisation', 'parties_prenantes', 'autre'\)\)/);
    expect(tbl.slice(0, 900)).toContain('anonyme BOOLEAN NOT NULL DEFAULT true');
    expect(tbl.slice(0, 900)).toContain('actif BOOLEAN NOT NULL DEFAULT true');
  });

  test('enquete_questions : 6 types contraints + options JSONB + FK modèle CASCADE', () => {
    const tbl = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS enquete_questions'));
    expect(tbl.slice(0, 900)).toContain('modele_id INTEGER NOT NULL REFERENCES enquete_modeles(id) ON DELETE CASCADE');
    expect(tbl.slice(0, 900)).toMatch(/CHECK \(type IN \('echelle', 'choix_unique', 'choix_multiple', 'texte', 'oui_non', 'note_10'\)\)/);
    expect(tbl.slice(0, 900)).toContain("options JSONB NOT NULL DEFAULT '[]'::jsonb");
    expect(tbl.slice(0, 900)).toContain('obligatoire BOOLEAN NOT NULL DEFAULT false');
  });

  test('enquete_campagnes : token UNIQUE + DEFAULT gen_random_bytes + statut contraint + modèle protégé', () => {
    const tbl = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS enquete_campagnes'));
    const head = tbl.slice(0, 1000);
    expect(head).toContain("token VARCHAR(64) NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex')");
    expect(head).toMatch(/CHECK \(statut IN \('brouillon', 'ouverte', 'close'\)\)/);
    // modele_id référencé SANS ON DELETE CASCADE (une campagne archivée = preuve
    // datée qui protège son modèle de la suppression).
    expect(head).toContain('modele_id INTEGER NOT NULL REFERENCES enquete_modeles(id)');
    expect(head).not.toMatch(/modele_id INTEGER NOT NULL REFERENCES enquete_modeles\(id\) ON DELETE CASCADE/);
  });

  test('enquete_reponses : ANONYMAT RÉEL — aucune FK users/employees + reponses JSONB', () => {
    const start = src.indexOf('CREATE TABLE IF NOT EXISTS enquete_reponses');
    const tbl = src.slice(start, src.indexOf(');', start));
    expect(tbl).toContain('campagne_id INTEGER NOT NULL REFERENCES enquete_campagnes(id) ON DELETE CASCADE');
    expect(tbl).toContain("reponses JSONB NOT NULL DEFAULT '{}'::jsonb");
    expect(tbl).toContain('jeton_unicite VARCHAR(80)');
    // Invariant central : la table des réponses ne rattache RIEN à une identité.
    expect(tbl).not.toMatch(/REFERENCES users/);
    expect(tbl).not.toMatch(/REFERENCES employees/);
    expect(tbl).not.toMatch(/\buser_id\b/);
    expect(tbl).not.toMatch(/\bemployee_id\b/);
  });

  test('index partiel d\'unicité du jeton (anti-doublon sans identité)', () => {
    expect(src).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_enquete_reponses_jeton[\s\S]*ON enquete_reponses\(campagne_id, jeton_unicite\) WHERE jeton_unicite IS NOT NULL/);
  });

  test('pgcrypto (gen_random_bytes) garanti avant la table campagnes', () => {
    const modIdx = src.indexOf('Module Enquêtes (RSEI-13)');
    const seg = src.slice(modIdx, src.indexOf('CREATE TABLE IF NOT EXISTS enquete_campagnes'));
    expect(seg).toContain("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  });

  test('ordre des FK : questions/réponses APRÈS leurs tables parentes', () => {
    const modelesIdx = src.indexOf('CREATE TABLE IF NOT EXISTS enquete_modeles');
    const questionsFkIdx = src.indexOf('modele_id INTEGER NOT NULL REFERENCES enquete_modeles(id) ON DELETE CASCADE');
    const campagnesIdx = src.indexOf('CREATE TABLE IF NOT EXISTS enquete_campagnes');
    const reponsesFkIdx = src.indexOf('campagne_id INTEGER NOT NULL REFERENCES enquete_campagnes(id) ON DELETE CASCADE');
    expect(questionsFkIdx).toBeGreaterThan(modelesIdx);
    expect(reponsesFkIdx).toBeGreaterThan(campagnesIdx);
  });
});

describe('schéma Enquêtes — registre RGPD + resync séquences', () => {
  test("entrée registre RGPD « Enquêtes internes » (WHERE NOT EXISTS, anonymat documenté)", () => {
    const idx = src.indexOf("'Enquêtes internes (anonymes, agrégats seuil n≥5)'");
    expect(idx).toBeGreaterThan(-1);
    const seg = src.slice(idx - 200, idx + 2600);
    expect(seg).toContain('INSERT INTO rgpd_registre');
    expect(seg).toContain('WHERE NOT EXISTS');
    // Apostrophes échappées en littéral SQL (d''identité, n''est).
    expect(seg).toMatch(/AUCUNE donnée d''identité n''est collectée/);
    expect(seg).toMatch(/seuil d''anonymat n≥5|SEUIL D''ANONYMAT/i);
  });

  test('les 4 tables Enquêtes sont ajoutées au resync des séquences SERIAL', () => {
    const arr = src.slice(src.indexOf('const tablesAResyncer = ['), src.indexOf('const tablesAResyncer = [') + 2600);
    for (const t of ENQUETE_TABLES) {
      expect(arr).toContain(`'${t}'`);
    }
  });
});
