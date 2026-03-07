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
const pool = require('../config/database');

const DEFAULT_FILE = path.join(__dirname, '..', '..', '..', 'tonnages.xlsx');

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

// Map route/category names from tonnages to CAV names
// Some names in tonnages are abbreviated tour names, not exact CAV names
// We'll try to match by finding a CAV whose name contains the tour keyword
async function buildCavLookup(client) {
  const result = await client.query('SELECT id, name FROM cav');
  return result.rows;
}

function findCavForCategory(category, cavList) {
  if (!category) return null;
  const cat = category.toLowerCase().trim();

  // Direct keyword matching from tour names to CAV
  for (const cav of cavList) {
    const cavName = cav.name.toLowerCase();
    // Check if the category appears in the CAV name or vice versa
    if (cavName.includes(cat) || cat.includes(cavName.split(' - ')[0]?.toLowerCase())) {
      return cav.id;
    }
  }
  return null;
}

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

    const cavList = await buildCavLookup(client);
    console.log(`[SEED-DATA] ${cavList.length} CAV en base`);

    // Group records by category+date for tonnage_history
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

    // Insert aggregated tonnage_history per CAV per day
    let tonnageInserted = 0;
    let tonnageNoMatch = 0;

    for (const entry of Object.values(dailyByCategory)) {
      const cavId = findCavForCategory(entry.categorie, cavList);
      if (!cavId) {
        tonnageNoMatch++;
        continue;
      }

      // Upsert: if same cav+date exists, add weight
      await client.query(
        `INSERT INTO tonnage_history (date, cav_id, weight_kg, source)
         VALUES ($1, $2, $3, 'import')
         ON CONFLICT DO NOTHING`,
        [entry.date, cavId, entry.total_kg]
      );
      tonnageInserted++;
    }

    await client.query('COMMIT');
    console.log(`[SEED-DATA] Tonnages: ${tonnageInserted} insérés, ${tonnageNoMatch} sans correspondance CAV`);
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
