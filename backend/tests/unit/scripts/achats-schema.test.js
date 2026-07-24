/**
 * Module Achats responsables (RSEI-17) — socle schéma (analyse statique d'init-db.js,
 * même approche que enquetes-schema.test.js / rse-schema.test.js : aucune base requise).
 *
 * Vérifie :
 * - les 3 tables du module créées en CREATE TABLE IF NOT EXISTS ;
 * - achats_fournisseurs : CHECK famille (catégorie) + 4 drapeaux BOOLEAN DEFAULT false ;
 * - achats_criteres : UNIQUE(famille, critere) + seed idempotent ON CONFLICT DO NOTHING ;
 * - achats_fds : fournisseur_id REFERENCES achats_fournisseurs(id) ON DELETE SET NULL,
 *   FK APRÈS la table parente + colonnes de pièce jointe (pattern Refashion) ;
 * - CONFIDENTIALITÉ : aucune table ne référence employees / insertion (non nominatif) ;
 * - le seed de l'entrée registre RGPD « Achats responsables » (WHERE NOT EXISTS) ;
 * - le rattachement des 3 tables au resync des séquences SERIAL.
 */
const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..', '..', '..'); // → backend/
const src = fs.readFileSync(path.join(BACKEND_ROOT, 'src', 'scripts', 'init-db.js'), 'utf8');

const ACHATS_TABLES = ['achats_fournisseurs', 'achats_criteres', 'achats_fds'];

describe('schéma Achats responsables — les 3 tables du module', () => {
  test('chaque table est créée en CREATE TABLE IF NOT EXISTS', () => {
    for (const t of ACHATS_TABLES) {
      expect(src).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
    }
  });

  test('achats_fournisseurs : CHECK catégorie + 4 drapeaux BOOLEAN DEFAULT false + actif DEFAULT true', () => {
    const tbl = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS achats_fournisseurs'), src.indexOf('CREATE TABLE IF NOT EXISTS achats_criteres'));
    expect(tbl).toMatch(/CHECK \(categorie IN \('fournitures', 'epi', 'transport', 'prestations', 'energie', 'alimentaire', 'autre'\)\)/);
    for (const flag of ['local', 'inclusif', 'demarche_rse', 'labellise']) {
      expect(tbl).toContain(`${flag} BOOLEAN NOT NULL DEFAULT false`);
    }
    expect(tbl).toContain('actif BOOLEAN NOT NULL DEFAULT true');
    expect(tbl).toContain('siret VARCHAR(20)');
    // created_by = métadonnée d'auteur (SET NULL), pas une donnée de personne concernée.
    expect(tbl).toContain('created_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
  });

  test('achats_criteres : UNIQUE(famille, critere) + seed ON CONFLICT DO NOTHING', () => {
    const tbl = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS achats_criteres'), src.indexOf('CREATE TABLE IF NOT EXISTS achats_fds'));
    expect(tbl).toContain('UNIQUE (famille, critere)');
    expect(tbl).toContain('critere TEXT NOT NULL');
    // Seed idempotent des critères de départ.
    expect(src).toMatch(/INSERT INTO achats_criteres \(famille, critere\) VALUES[\s\S]*ON CONFLICT \(famille, critere\) DO NOTHING/);
    expect(src).toContain("'Exiger les fiches de données de sécurité (FDS) des produits dangereux'");
  });

  test('achats_fds : FK fournisseur ON DELETE SET NULL + colonnes pièce jointe', () => {
    const start = src.indexOf('CREATE TABLE IF NOT EXISTS achats_fds');
    const tbl = src.slice(start, src.indexOf(');', start));
    expect(tbl).toContain('fournisseur_id INTEGER REFERENCES achats_fournisseurs(id) ON DELETE SET NULL');
    expect(tbl).toContain('produit VARCHAR(200) NOT NULL');
    expect(tbl).toContain('date_fds DATE');
    expect(tbl).toContain('date_revision DATE');
    expect(tbl).toContain('fichier_path TEXT');
    expect(tbl).toContain('fichier_original_name TEXT');
    expect(tbl).toContain('fichier_mime VARCHAR(120)');
    expect(tbl).toContain('dangers VARCHAR(200)');
    expect(tbl).toContain('epi_requis TEXT');
  });

  test('ordre des FK : achats_fds.fournisseur_id APRÈS achats_fournisseurs', () => {
    const parentIdx = src.indexOf('CREATE TABLE IF NOT EXISTS achats_fournisseurs');
    const fkIdx = src.indexOf('fournisseur_id INTEGER REFERENCES achats_fournisseurs(id) ON DELETE SET NULL');
    expect(parentIdx).toBeGreaterThan(-1);
    expect(fkIdx).toBeGreaterThan(parentIdx);
  });

  test('CONFIDENTIALITÉ : aucune table Achats ne référence employees / insertion (non nominatif)', () => {
    const seg = src.slice(src.indexOf('Module Achats responsables (RSEI-17)'), src.indexOf('HOTFIX 2026-05 — Resync'));
    expect(seg).not.toMatch(/REFERENCES employees/);
    expect(seg).not.toMatch(/REFERENCES insertion/);
    expect(seg).not.toMatch(/\bemployee_id\b/);
  });
});

describe('schéma Achats responsables — registre RGPD + resync séquences', () => {
  test('entrée registre RGPD « Achats responsables » (WHERE NOT EXISTS, non nominatif)', () => {
    const idx = src.indexOf("'Achats responsables (données fournisseurs, non nominatives)'");
    expect(idx).toBeGreaterThan(-1);
    const seg = src.slice(idx - 200, idx + 2400);
    expect(seg).toContain('INSERT INTO rgpd_registre');
    expect(seg).toContain('WHERE NOT EXISTS');
    expect(seg).toMatch(/Aucune personne physique concernée/);
  });

  test('les 3 tables Achats sont ajoutées au resync des séquences SERIAL', () => {
    const arr = src.slice(src.indexOf('const tablesAResyncer = ['), src.indexOf('const tablesAResyncer = [') + 2800);
    for (const t of ACHATS_TABLES) {
      expect(arr).toContain(`'${t}'`);
    }
  });
});
