#!/usr/bin/env node
/**
 * SOLIDATA — Import données historiques depuis Dashboard 2025.xlsm et Dashboard 2026.xlsm
 *
 * Importe :
 *  1. Tonnages (SaisiesT) → stock_movements
 *  2. Produits finis (SaisiesP) → produits_finis
 *  3. Résumés annuels (Annuel) → historique_mensuel
 *
 * Usage: node src/scripts/seed-historique.js
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');

const FILES = [
  { name: 'Dashboard 2025.xlsm', year: 2025 },
  { name: 'Dashboard 2026.xlsm', year: 2026 },
];

function findFile(filename) {
  const paths = [
    path.join(__dirname, '..', '..', '..', filename),
    path.join('/opt/solidata.online', filename),
    path.join(process.cwd(), filename),
    path.join('/data', filename),
    path.join('/app', filename),
  ];
  return paths.find(p => fs.existsSync(p));
}

function excelDateToJS(serial) {
  if (!serial || typeof serial !== 'number' || serial < 40000) return null;
  const epoch = new Date(1899, 11, 30);
  return new Date(epoch.getTime() + serial * 86400000);
}

function formatDate(d) {
  if (!d) return null;
  return d.toISOString().split('T')[0];
}

function formatTimestamp(d) {
  if (!d) return null;
  return d.toISOString();
}

// ─── Import SaisiesT (Tonnages) ───
async function importTonnages(client, wb, year) {
  const ws = wb.Sheets['SaisiesT'];
  if (!ws) { console.log(`  [SKIP] Pas de feuille SaisiesT pour ${year}`); return 0; }
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Headers at row 8: ID, Origine, Catégorie, Poids net, Type Tare, Tare, Poids brut, Date fabrication, Date sortie...
  let inserted = 0;
  let skipped = 0;

  for (let i = 9; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[1]) continue;

    const codeBarre = String(row[1]).trim();
    const origine = row[2] ? String(row[2]).trim() : null;
    const categorie = row[3] ? String(row[3]).trim() : null;
    const poidsNet = row[4] != null ? parseFloat(row[4]) : null;
    const tare = row[6] != null ? parseFloat(row[6]) : null;
    const poidsBrut = row[7] != null ? parseFloat(row[7]) : null;
    const dateFab = excelDateToJS(row[8]);
    const dateSortie = excelDateToJS(typeof row[9] === 'number' ? row[9] : null);

    if (!codeBarre || poidsNet == null || isNaN(poidsNet)) continue;

    try {
      await client.query(
        `INSERT INTO stock_movements
          (type, date, poids_kg, code_barre, origine, categorie_collecte, poids_brut_kg, tare_kg, scan_sortie_at)
         VALUES ('entree', $1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING`,
        [
          formatDate(dateFab) || `${year}-01-01`,
          poidsNet / 1000, // g → kg
          codeBarre,
          origine,
          categorie,
          poidsBrut ? poidsBrut / 1000 : null,
          tare ? tare / 1000 : null,
          dateSortie ? formatTimestamp(dateSortie) : null,
        ]
      );
      inserted++;
    } catch (err) {
      skipped++;
    }
  }

  console.log(`  [TONNAGES ${year}] ${inserted} insérés, ${skipped} ignorés`);
  return inserted;
}

// ─── Import SaisiesP (Produits finis) ───
async function importProduits(client, wb, year) {
  const ws = wb.Sheets['SaisiesP'];
  if (!ws) { console.log(`  [SKIP] Pas de feuille SaisiesP pour ${year}`); return 0; }
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Headers at row 8: ID, Produits, Catégorie Eco-org., Genre, Saison, Gamme, Poids, Date fabrication, Date sortie, Inventaire
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (let i = 9; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[1]) continue;

    const codeBarre = String(row[1]).trim();
    const produit = row[2] ? String(row[2]).trim() : null;
    const categorieEcoOrg = row[3] ? String(row[3]).trim() : null;
    const genre = row[4] ? String(row[4]).trim() : null;
    const saison = row[5] ? String(row[5]).trim() : 'Sans Saison';
    const gamme = row[6] ? String(row[6]).trim() : null;
    const poids = row[7] != null ? parseFloat(row[7]) : null;
    const dateFab = excelDateToJS(typeof row[8] === 'number' ? row[8] : null);
    const dateSortie = excelDateToJS(typeof row[9] === 'number' ? row[9] : null);
    const dateInventaire = excelDateToJS(typeof row[10] === 'number' ? row[10] : null);

    if (!codeBarre || poids == null || isNaN(poids)) continue;

    try {
      const result = await client.query(
        `INSERT INTO produits_finis
          (code_barre, produit, categorie_eco_org, genre, saison, gamme, poids_kg, date_fabrication, date_sortie, date_inventaire)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (code_barre) DO UPDATE SET
           produit = COALESCE(EXCLUDED.produit, produits_finis.produit),
           categorie_eco_org = COALESCE(EXCLUDED.categorie_eco_org, produits_finis.categorie_eco_org),
           genre = COALESCE(EXCLUDED.genre, produits_finis.genre),
           saison = COALESCE(EXCLUDED.saison, produits_finis.saison),
           gamme = COALESCE(EXCLUDED.gamme, produits_finis.gamme),
           poids_kg = COALESCE(EXCLUDED.poids_kg, produits_finis.poids_kg),
           date_fabrication = COALESCE(EXCLUDED.date_fabrication, produits_finis.date_fabrication),
           date_sortie = COALESCE(EXCLUDED.date_sortie, produits_finis.date_sortie),
           date_inventaire = COALESCE(EXCLUDED.date_inventaire, produits_finis.date_inventaire)
         RETURNING (xmax = 0) AS is_insert`,
        [
          codeBarre, produit, categorieEcoOrg, genre, saison, gamme, poids,
          dateFab ? formatTimestamp(dateFab) : `${year}-01-01`,
          dateSortie ? formatTimestamp(dateSortie) : null,
          dateInventaire ? formatTimestamp(dateInventaire) : null,
        ]
      );
      if (result.rows[0].is_insert) inserted++;
      else updated++;
    } catch (err) {
      skipped++;
    }
  }

  console.log(`  [PRODUITS ${year}] ${inserted} insérés, ${updated} mis à jour, ${skipped} ignorés`);
  return inserted + updated;
}

// ─── Import Annuel (Résumés mensuels) ───
async function importAnnuel(client, wb, year) {
  const ws = wb.Sheets['Annuel'];
  if (!ws) { console.log(`  [SKIP] Pas de feuille Annuel pour ${year}`); return 0; }
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

  let inserted = 0;

  // Parse all rows with category + monthly values
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0] || typeof row[0] !== 'string') continue;

    const categorie = row[0].trim();

    // Skip header rows
    if (MOIS.includes(categorie) || categorie === 'Annuel' ||
        categorie.startsWith('Catégories') || categorie.startsWith('Sous-Totaux') ||
        categorie.startsWith('Ratio') || categorie.startsWith('Gamme')) continue;

    // Determine section type based on position in the sheet
    let section = 'tonnages';
    // Find which section header precedes this row
    for (let j = i - 1; j >= 0; j--) {
      if (data[j] && data[j][0]) {
        const h = String(data[j][0]).trim();
        if (h.startsWith('Catégories Tonnages')) { section = 'tonnages'; break; }
        if (h.startsWith('Sous-Totaux Tonnages')) { section = 'sous_totaux_tonnages'; break; }
        if (h.startsWith('Ratio Tonnages')) { section = 'ratios'; break; }
        if (h.startsWith('Catégories Produits Fabriqués')) { section = 'produits_fabriques'; break; }
        if (h.startsWith('Gamme Produits Fabriqués')) { section = 'gamme_fabriques'; break; }
        if (h.startsWith('Catégories Produits Sorties')) { section = 'produits_sorties'; break; }
        if (h.startsWith('Gamme Produits Sorties')) { section = 'gamme_sorties'; break; }
      }
    }

    // Insert monthly values (cols 1-12)
    for (let m = 0; m < 12; m++) {
      const valeur = row[m + 1];
      if (valeur == null || valeur === 0) continue;

      try {
        await client.query(
          `INSERT INTO historique_mensuel
            (annee, mois, section, categorie, valeur)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (annee, mois, section, categorie) DO UPDATE SET
             valeur = EXCLUDED.valeur`,
          [year, m + 1, section, categorie, parseFloat(valeur) || 0]
        );
        inserted++;
      } catch (err) {
        // skip
      }
    }
  }

  console.log(`  [ANNUEL ${year}] ${inserted} enregistrements mensuels`);
  return inserted;
}

// ─── Main ───
async function seedHistorique(externalPool) {
  const db = externalPool || pool;
  console.log('[SEED-HISTORIQUE] Démarrage import données historiques...');

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Create historique_mensuel table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS historique_mensuel (
        id SERIAL PRIMARY KEY,
        annee INTEGER NOT NULL,
        mois INTEGER NOT NULL CHECK (mois BETWEEN 1 AND 12),
        section VARCHAR(50) NOT NULL,
        categorie VARCHAR(255) NOT NULL,
        valeur DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(annee, mois, section, categorie)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_historique_mensuel_annee ON historique_mensuel(annee, mois);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_historique_mensuel_section ON historique_mensuel(section);`);

    for (const file of FILES) {
      const filePath = findFile(file.name);
      if (!filePath) {
        console.log(`[SKIP] Fichier non trouvé: ${file.name}`);
        continue;
      }
      console.log(`\n[IMPORT] ${file.name} (${file.year})...`);
      const wb = XLSX.readFile(filePath);

      await importTonnages(client, wb, file.year);
      await importProduits(client, wb, file.year);
      await importAnnuel(client, wb, file.year);
    }

    await client.query('COMMIT');
    console.log('\n[SEED-HISTORIQUE] Import terminé avec succès !');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[SEED-HISTORIQUE] Erreur:', err.message);
    if (!externalPool) process.exit(1);
    throw err;
  } finally {
    client.release();
    if (!externalPool) await pool.end();
  }
}

// Appel direct (CLI) ou export (module)
if (require.main === module) {
  seedHistorique();
}

module.exports = { seedHistorique };
