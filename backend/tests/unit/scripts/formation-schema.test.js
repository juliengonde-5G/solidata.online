/**
 * RH — RSEI-12 (plan de formation) — socle schéma (analyse statique d'init-db.js,
 * même approche que qhse-documents-schema.test.js : aucune base requise).
 *
 * Vérifie : la table formation_actions en CREATE TABLE IF NOT EXISTS, ses CHECK
 * d'enums, l'absence de FK identité (non nominatif — que des compteurs), et son
 * rattachement au resync des séquences SERIAL.
 */
const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..', '..', '..'); // → backend/
const src = fs.readFileSync(path.join(BACKEND_ROOT, 'src', 'scripts', 'init-db.js'), 'utf8');

describe('schéma RH RSEI-12 — plan de formation', () => {
  const start = src.indexOf('CREATE TABLE IF NOT EXISTS formation_actions');
  const tbl = src.slice(start, src.indexOf(');', start));

  test('formation_actions créée en CREATE TABLE IF NOT EXISTS', () => {
    expect(start).toBeGreaterThan(-1);
    expect(tbl).toContain('intitule VARCHAR(200) NOT NULL');
    expect(tbl).toContain('annee INTEGER NOT NULL');
  });

  test('CHECK des 4 enums (type, origine, public, statut)', () => {
    expect(tbl).toMatch(/CHECK \(type_formation IN \('interne','externe','obligatoire_securite','habilitation','tutorat','autre'\)\)/);
    expect(tbl).toMatch(/CHECK \(origine_besoin IN \('entretien','reglementaire','projet_entreprise','souhait_salarie','autre'\)\)/);
    expect(tbl).toMatch(/CHECK \(public_cible IN \('permanents','parcours','tous'\)\)/);
    expect(tbl).toMatch(/CHECK \(statut IN \('identifie','planifie','realise','annule'\)\)/);
  });

  test('NON NOMINATIF : aucun employee_id ni FK identité (que des compteurs)', () => {
    expect(tbl).not.toMatch(/employee_id/);
    expect(tbl).not.toMatch(/REFERENCES employees/);
    expect(tbl).toContain('nb_participants_prevus INTEGER');
    expect(tbl).toContain('nb_participants_realises INTEGER');
    // created_by = auteur (métadonnée), pas une personne concernée.
    expect(tbl).toContain('created_by INTEGER REFERENCES users(id)');
  });

  test('CHECK anti-négatif sur participants / heures / coûts (revue Codex PR#82)', () => {
    expect(tbl).toContain('CONSTRAINT chk_formation_nonneg CHECK');
    expect(tbl).toContain('nb_participants_prevus >= 0');
    expect(tbl).toContain('cout_realise >= 0');
    // migration idempotente pour une table déjà créée sans la contrainte
    expect(src).toContain("WHERE conname = 'chk_formation_nonneg'");
  });

  test('formation_actions ajoutée au resync des séquences SERIAL', () => {
    const arr = src.slice(src.indexOf('const tablesAResyncer = ['), src.indexOf('const tablesAResyncer = [') + 3000);
    expect(arr).toContain("'formation_actions'");
  });
});
