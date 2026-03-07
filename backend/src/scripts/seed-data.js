#!/usr/bin/env node
/**
 * SOLIDATA — Import tonnages/collectes depuis tonnages.xlsx
 * Usage: node src/scripts/seed-data.js [path/to/tonnages.xlsx]
 *
 * Importe les pesées dans stock_movements (entrées collecte)
 * et met à jour tonnage_history par CAV avec agrégation journalière.
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');

const FILENAME = 'tonnages.xlsx';
const SEARCH_PATHS = [
  path.join(__dirname, '..', '..', '..', FILENAME),
  path.join('/data', FILENAME),
  path.join('/app', FILENAME),
];
const DEFAULT_FILE = SEARCH_PATHS.find(p => fs.existsSync(p)) || SEARCH_PATHS[0];

// Convert Excel serial date to JS Date
function excelDateToJS(serial) {
  if (!serial || typeof serial !== 'number' || serial < 40000) return null;
  const epoch = new Date(1899, 11, 30);
  return new Date(epoch.getTime() + serial * 86400000);
}

function formatDate(d) {
  if (!d) return null;
  return d.toISOString().split('T')[0];
}

// Note: tonnage categories are ROUTE names (e.g., "Barentin 1", "Rive Gauche Est 2"),
// not individual CAV names. Each route passes through multiple CAV points.
// We store route_name directly in tonnage_history.

async function seedData() {
  const filePath = process.argv[2] || DEFAULT_FILE;
  console.log(`[SEED-DATA] Lecture de ${filePath}...`);

  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets['SaisiesT'];
  if (!ws) {
    console.error('[SEED-DATA] Feuille "SaisiesT" introuvable');
    process.exit(1);
  }

  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Row 8 = headers: ID, Origine, Catégorie, Poids net, Type Tare, Tare, Poids brut, Date fabrication, Date sortie, ...
  // Data starts at row 9
  const records = [];
  for (let i = 9; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[1]) continue;

    const id = String(row[1]).trim();
    const origine = row[2] ? String(row[2]).trim() : '';
    const categorie = row[3] ? String(row[3]).trim() : '';
    const poidsNet = row[4] != null ? parseFloat(row[4]) : null;
    const tare = row[6] != null ? parseFloat(row[6]) : null;
    const poidsBrut = row[7] != null ? parseFloat(row[7]) : null;
    const dateFab = excelDateToJS(row[8]);
    const dateSortie = excelDateToJS(row[9]);

    if (!poidsNet || poidsNet <= 0) continue;

    records.push({
      external_id: id,
      origine,
      categorie,
      poids_net: poidsNet,
      tare: tare || null,
      poids_brut: poidsBrut || null,
      date: dateFab,
      date_sortie: dateSortie,
    });
  }

  console.log(`[SEED-DATA] ${records.length} pesées trouvées dans le fichier`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Group records by route+date for tonnage_history
    const dailyByCategory = {};
    let stockInserted = 0;
    let stockSkipped = 0;

    for (const r of records) {
      // Insert into stock_movements as 'entree' type
      const dateStr = formatDate(r.date);
      if (!dateStr) continue;

      // Check duplicate by external reference
      const exists = await client.query(
        `SELECT id FROM stock_movements WHERE code_barre = $1`,
        [r.external_id]
      );
      if (exists.rows.length > 0) {
        stockSkipped++;
        continue;
      }

      const categorieCollecte = r.origine === 'Collecte de CAV' ? r.categorie : r.origine;

      await client.query(
        `INSERT INTO stock_movements
          (type, date, poids_kg, origine, categorie_collecte, poids_brut_kg, tare_kg, code_barre, created_at)
         VALUES ('entree', $1, $2, $3, $4, $5, $6, $7, NOW())`,
        [dateStr, r.poids_net, r.origine, categorieCollecte, r.poids_brut, r.tare, r.external_id]
      );
      stockInserted++;

      // Aggregate for tonnage_history (only CAV collections)
      if (r.origine === 'Collecte de CAV') {
        const key = `${r.categorie}|${dateStr}`;
        if (!dailyByCategory[key]) {
          dailyByCategory[key] = { categorie: r.categorie, date: dateStr, total_kg: 0 };
        }
        dailyByCategory[key].total_kg += r.poids_net;
      }
    }

    console.log(`[SEED-DATA] Stock: ${stockInserted} insérés, ${stockSkipped} doublons ignorés`);

    // Insert aggregated tonnage_history per route per day
    let tonnageInserted = 0;

    for (const entry of Object.values(dailyByCategory)) {
      await client.query(
        `INSERT INTO tonnage_history (date, route_name, weight_kg, source)
         VALUES ($1, $2, $3, 'import')
         ON CONFLICT DO NOTHING`,
        [entry.date, entry.categorie, entry.total_kg]
      );
      tonnageInserted++;
    }

    await client.query('COMMIT');
    console.log(`[SEED-DATA] Tonnages: ${tonnageInserted} entrées par route/jour`);
    console.log(`[SEED-DATA] Import terminé`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[SEED-DATA] Erreur:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedData();
