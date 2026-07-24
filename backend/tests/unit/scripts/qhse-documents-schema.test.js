/**
 * QHSE — RSEI-06 (documents de prévention) + RSEI-07 (REX SST) — socle schéma
 * (analyse statique d'init-db.js, même approche que achats-schema.test.js :
 * aucune base requise).
 *
 * Vérifie :
 * - la table qhse_documents créée en CREATE TABLE IF NOT EXISTS + CHECK type +
 *   colonnes de trace IRP/CSE et de pièce jointe (pattern Refashion) ;
 * - les 4 colonnes REX ajoutées à qhse_events en ALTER ... ADD COLUMN IF NOT EXISTS
 *   (migration idempotente sur base existante) ;
 * - le rattachement de qhse_documents au resync des séquences SERIAL ;
 * - la migration placée dans le bloc QHSE (après la table qhse_events).
 */
const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..', '..', '..'); // → backend/
const src = fs.readFileSync(path.join(BACKEND_ROOT, 'src', 'scripts', 'init-db.js'), 'utf8');

describe('schéma QHSE RSEI-06 — documents de prévention', () => {
  test('qhse_documents est créée en CREATE TABLE IF NOT EXISTS', () => {
    expect(src).toMatch(/CREATE TABLE IF NOT EXISTS qhse_documents\b/);
  });

  test('CHECK type (6 types de documents socles)', () => {
    const start = src.indexOf('CREATE TABLE IF NOT EXISTS qhse_documents');
    const tbl = src.slice(start, src.indexOf(');', start));
    expect(tbl).toMatch(/CHECK \(type IN \('duerp','plan_prevention','rps','protocole_securite','consignes','autre'\)\)/);
    expect(tbl).toContain('titre VARCHAR(200) NOT NULL');
  });

  test('colonnes de trace de consultation IRP/CSE + révision', () => {
    const start = src.indexOf('CREATE TABLE IF NOT EXISTS qhse_documents');
    const tbl = src.slice(start, src.indexOf(');', start));
    expect(tbl).toContain('date_document DATE');
    expect(tbl).toContain('date_maj DATE');
    expect(tbl).toContain('date_revision_prevue DATE');
    expect(tbl).toContain('irp_consultation_date DATE');
    expect(tbl).toContain('irp_consultation_avis TEXT');
  });

  test('colonnes de pièce jointe (pattern Refashion)', () => {
    const start = src.indexOf('CREATE TABLE IF NOT EXISTS qhse_documents');
    const tbl = src.slice(start, src.indexOf(');', start));
    expect(tbl).toContain('fichier_path TEXT');
    expect(tbl).toContain('fichier_original_name VARCHAR(255)');
    expect(tbl).toContain('fichier_mime VARCHAR(120)');
    expect(tbl).toContain('created_by INTEGER REFERENCES users(id)');
  });

  test('index sur type et date de révision', () => {
    expect(src).toContain('idx_qhse_documents_type');
    expect(src).toContain('idx_qhse_documents_revision');
  });

  test('qhse_documents ajoutée au resync des séquences SERIAL', () => {
    const arr = src.slice(src.indexOf('const tablesAResyncer = ['), src.indexOf('const tablesAResyncer = [') + 2900);
    expect(arr).toContain("'qhse_documents'");
  });
});

describe('schéma QHSE RSEI-07 — colonnes REX sur qhse_events (migration idempotente)', () => {
  const REX_COLS = ['analyse_causes', 'action_corrective', 'efficacite_verifiee_le', 'efficacite_constat'];

  test('les 4 colonnes REX sont ajoutées en ADD COLUMN IF NOT EXISTS', () => {
    for (const col of REX_COLS) {
      expect(src).toMatch(new RegExp(`ALTER TABLE qhse_events ADD COLUMN IF NOT EXISTS ${col}\\b`));
    }
  });

  test('la migration REX est placée après la création de qhse_events', () => {
    const tableIdx = src.indexOf('CREATE TABLE IF NOT EXISTS qhse_events');
    const migIdx = src.indexOf('ALTER TABLE qhse_events ADD COLUMN IF NOT EXISTS analyse_causes');
    expect(tableIdx).toBeGreaterThan(-1);
    expect(migIdx).toBeGreaterThan(tableIdx);
  });
});
