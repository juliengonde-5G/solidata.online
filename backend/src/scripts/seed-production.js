#!/usr/bin/env node
/**
 * SOLIDATA — Import KPI Production depuis KPI_Production 2026.xlsx
 * Usage: node src/scripts/seed-production.js [path/to/file.xlsx]
 */
const XLSX = require('xlsx');
const path = require('path');
const pool = require('../config/database');

const DEFAULT_FILE = path.join(__dirname, '..', '..', '..', 'KPI_Production 2026.xlsx');

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

async function seedProduction() {
  const filePath = process.argv[2] || DEFAULT_FILE;
  console.log(`[SEED-PROD] Lecture de ${filePath}...`);

  const wb = XLSX.readFile(filePath);
  const monthSheets = wb.SheetNames.filter(n => /\d{4}$/.test(n) && n !== 'Production Annuel 2026' && n !== 'Feuil1');

  console.log(`[SEED-PROD] Feuilles mensuelles: ${monthSheets.join(', ')}`);

  const records = [];

  for (const sheetName of monthSheets) {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

    // Row 0 = headers (at col index 21+), data starts at row 1
    // Col 21=Date, 22=Effectif théorique, 23=Effectif réel,
    // 24=Entrée ligne (kg), 26=Entrée recyclage R3 (kg),
    // 28=Total jour (t), 29=Productivité, 30=Commentaire
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row) continue;

      const dateVal = row[21];
      if (!dateVal || typeof dateVal !== 'number') continue;

      const date = excelDateToJS(dateVal);
      if (!date) continue;

      const effectifTheorique = row[22] != null ? parseInt(row[22]) : null;
      const effectifReel = row[23] != null ? parseInt(row[23]) : null;
      const entreeLigne = row[24] != null ? parseFloat(row[24]) : null;
      const entreeRecyclage = row[26] != null ? parseFloat(row[26]) : null;
      const totalJour = row[28] != null ? parseFloat(row[28]) : null;
      const productivite = row[29] != null ? parseFloat(row[29]) : null;
      const commentaire = row[30] ? String(row[30]).trim() : null;

      records.push({
        date: formatDate(date),
        effectif_theorique: effectifTheorique,
        effectif_reel: effectifReel,
        entree_ligne_kg: entreeLigne,
        entree_recyclage_r3_kg: entreeRecyclage,
        total_jour_t: totalJour,
        productivite_kg_per: productivite,
        commentaire,
      });
    }
  }

  console.log(`[SEED-PROD] ${records.length} enregistrements de production trouvés`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let inserted = 0;
    let updated = 0;

    for (const r of records) {
      const result = await client.query(
        `INSERT INTO production_daily
          (date, effectif_theorique, effectif_reel, entree_ligne_kg, entree_recyclage_r3_kg, total_jour_t, productivite_kg_per, commentaire)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (date) DO UPDATE SET
           effectif_theorique = COALESCE(EXCLUDED.effectif_theorique, production_daily.effectif_theorique),
           effectif_reel = COALESCE(EXCLUDED.effectif_reel, production_daily.effectif_reel),
           entree_ligne_kg = COALESCE(EXCLUDED.entree_ligne_kg, production_daily.entree_ligne_kg),
           entree_recyclage_r3_kg = COALESCE(EXCLUDED.entree_recyclage_r3_kg, production_daily.entree_recyclage_r3_kg),
           total_jour_t = COALESCE(EXCLUDED.total_jour_t, production_daily.total_jour_t),
           productivite_kg_per = COALESCE(EXCLUDED.productivite_kg_per, production_daily.productivite_kg_per),
           commentaire = COALESCE(EXCLUDED.commentaire, production_daily.commentaire),
           updated_at = NOW()
         RETURNING (xmax = 0) AS is_insert`,
        [r.date, r.effectif_theorique, r.effectif_reel, r.entree_ligne_kg,
         r.entree_recyclage_r3_kg, r.total_jour_t, r.productivite_kg_per, r.commentaire]
      );

      if (result.rows[0].is_insert) inserted++;
      else updated++;
    }

    await client.query('COMMIT');
    console.log(`[SEED-PROD] Terminé: ${inserted} insérés, ${updated} mis à jour`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[SEED-PROD] Erreur:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedProduction();
