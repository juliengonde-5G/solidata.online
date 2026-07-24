/**
 * Module Énergie & GES (RSEI-11) — socle schéma (analyse statique d'init-db.js,
 * même approche que rse-schema.test.js : aucune base requise).
 *
 * Vérifie :
 * - les 5 tables du module créées en CREATE TABLE IF NOT EXISTS ;
 * - le seed idempotent du siège (Le Houlme, WHERE NOT EXISTS) ;
 * - les CHECK d'enums (type compteur, type carburant, mois) et l'UNIQUE des relevés ;
 * - le seed idempotent des 6 facteurs ADEME (ON CONFLICT (poste, annee) DO NOTHING),
 *   valeurs INDICATIVES et UNIQUE(poste, annee) ;
 * - la FK carburant_pleins.vehicle_id → vehicles ON DELETE SET NULL ;
 * - le rattachement des 5 tables au resync des séquences SERIAL.
 */
const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..', '..', '..'); // → backend/
const src = fs.readFileSync(path.join(BACKEND_ROOT, 'src', 'scripts', 'init-db.js'), 'utf8');

const ENERGIE_TABLES = [
  'energie_sites', 'energie_compteurs', 'energie_releves',
  'carburant_pleins', 'ges_facteurs',
];

// Les 6 facteurs ADEME seedés (poste → unité attendue). Valeurs indicatives.
const FACTEURS = {
  electricite: 'kWh',
  gaz: 'kWh',
  eau: 'm3',
  gazole: 'L',
  essence: 'L',
  gnv: 'kg',
};

describe('schéma Énergie & GES — les 5 tables du module', () => {
  test('chaque table est créée en CREATE TABLE IF NOT EXISTS', () => {
    for (const t of ENERGIE_TABLES) {
      expect(src).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
    }
  });

  test('energie_sites : seed idempotent du siège (Le Houlme, WHERE NOT EXISTS)', () => {
    const tbl = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS energie_sites'));
    expect(tbl.slice(0, 500)).toContain('nom VARCHAR(120) NOT NULL');
    expect(tbl.slice(0, 500)).toContain('actif BOOLEAN NOT NULL DEFAULT true');
    // Seed idempotent
    expect(src).toContain("WHERE NOT EXISTS (SELECT 1 FROM energie_sites WHERE nom = 'Siège — Le Houlme')");
  });

  test('energie_compteurs : type contraint + unité par défaut kWh + FK site CASCADE', () => {
    const tbl = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS energie_compteurs'));
    expect(tbl.slice(0, 700)).toContain('site_id INTEGER NOT NULL REFERENCES energie_sites(id) ON DELETE CASCADE');
    expect(tbl.slice(0, 700)).toMatch(/CHECK \(type IN \('electricite', 'gaz', 'eau', 'autre'\)\)/);
    expect(tbl.slice(0, 700)).toContain("unite VARCHAR(10) NOT NULL DEFAULT 'kWh'");
  });

  test('energie_releves : mois 1-12 + UNIQUE(compteur_id, periode_annee, periode_mois)', () => {
    const tbl = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS energie_releves'));
    expect(tbl.slice(0, 800)).toContain('compteur_id INTEGER NOT NULL REFERENCES energie_compteurs(id) ON DELETE CASCADE');
    expect(tbl.slice(0, 800)).toMatch(/periode_mois SMALLINT NOT NULL CHECK \(periode_mois BETWEEN 1 AND 12\)/);
    expect(tbl.slice(0, 800)).toContain('UNIQUE (compteur_id, periode_annee, periode_mois)');
    expect(tbl.slice(0, 800)).toContain('saisi_par INTEGER REFERENCES users(id) ON DELETE SET NULL');
  });

  test('carburant_pleins : FK véhicule SET NULL + type_carburant contraint', () => {
    const tbl = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS carburant_pleins'));
    expect(tbl.slice(0, 900)).toContain('vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL');
    expect(tbl.slice(0, 900)).toMatch(/CHECK \(type_carburant IN \('gazole', 'essence', 'gnv', 'electrique', 'adblue', 'autre'\)\)/);
    expect(tbl.slice(0, 900)).toContain('km_compteur INTEGER');
  });

  test('ges_facteurs : UNIQUE(poste, annee) + facteur_kgco2e NUMERIC', () => {
    const tbl = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS ges_facteurs'));
    expect(tbl.slice(0, 700)).toContain('facteur_kgco2e NUMERIC(12,5) NOT NULL');
    expect(tbl.slice(0, 700)).toContain('UNIQUE (poste, annee)');
    expect(tbl.slice(0, 700)).toContain("source VARCHAR(120) NOT NULL DEFAULT 'ADEME Base Empreinte'");
  });

  test('la FK carburant_pleins.vehicle_id est déclarée APRÈS la création de vehicles', () => {
    const vehiclesIdx = src.indexOf('CREATE TABLE IF NOT EXISTS vehicles');
    const fkIdx = src.indexOf('vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL');
    expect(vehiclesIdx).toBeGreaterThan(-1);
    expect(fkIdx).toBeGreaterThan(vehiclesIdx);
  });
});

describe('schéma Énergie & GES — seed idempotent des facteurs ADEME', () => {
  const seed = src.slice(
    src.indexOf('INSERT INTO ges_facteurs (poste, unite, facteur_kgco2e, source, annee) VALUES'),
    src.indexOf('ON CONFLICT (poste, annee) DO NOTHING;', src.indexOf('INSERT INTO ges_facteurs')) + 60
  );

  test('le seed existe et est idempotent (ON CONFLICT (poste, annee) DO NOTHING)', () => {
    expect(seed).toContain('ON CONFLICT (poste, annee) DO NOTHING');
  });

  test('les 6 postes et unités sont présents', () => {
    const postes = Object.keys(FACTEURS);
    expect(postes).toHaveLength(6);
    for (const [poste, unite] of Object.entries(FACTEURS)) {
      expect(seed).toMatch(new RegExp(`'${poste}',\\s*'${unite}'`));
    }
  });

  test('les valeurs sont documentées comme INDICATIVES / paramétrables (pas d\'exactitude prétendue)', () => {
    // Le libellé de source porte l'avertissement.
    expect(seed).toContain('indicatif');
    // Repères plausibles présents (électricité 0.052, gazole 2.51).
    expect(seed).toContain('0.05200');
    expect(seed).toContain('2.51000');
  });
});

describe('schéma Énergie & GES — resync séquences + registre RGPD', () => {
  test('les 5 tables sont ajoutées au resync des séquences SERIAL', () => {
    const arr = src.slice(src.indexOf('const tablesAResyncer = ['), src.indexOf('const tablesAResyncer = [') + 2200);
    for (const t of ENERGIE_TABLES) {
      expect(arr).toContain(`'${t}'`);
    }
  });

  test('entrée registre RGPD « Énergie & GES » (WHERE NOT EXISTS, minimisation documentée)', () => {
    const idx = src.indexOf("'Énergie & GES (mesure des impacts environnementaux propres)'");
    expect(idx).toBeGreaterThan(-1);
    const seg = src.slice(idx - 200, idx + 2000);
    expect(seg).toContain('INSERT INTO rgpd_registre');
    expect(seg).toContain('WHERE NOT EXISTS');
    expect(seg).toMatch(/AUCUNE donnée de catégorie particulière/);
  });
});
