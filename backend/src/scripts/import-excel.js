#!/usr/bin/env node
/**
 * SOLIDATA — Import des données Excel en base PostgreSQL
 *
 * Usage:
 *   node src/scripts/import-excel.js [--all] [--cav] [--tonnages] [--production] [--stock]
 *
 * Fichiers sources (racine du projet) :
 *   - CAV 2025.xlsx / CAV 2026.xlsx  → table cav + tonnage_history (mensuel)
 *   - Collect 2026.xlsx              → table tonnage_history (détail pesées)
 *   - tonnages.xlsx                  → table tonnage_history (pesées 2025)
 *   - KPI_Production 2026.xlsx       → table production_daily
 *   - Mvmt Invent 2025.xlsx          → table stock_movements (entrées 2025)
 *   - Mvmt Invent 2026.xlsx          → table produits_finis (produits fabriqués)
 *   - tournee.xlsx                   → table cav (metadata : adresse, GPS, tournée, fréquence)
 */
require('dotenv').config();
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');

const ROOT = path.join(__dirname, '..', '..', '..');

function findFile(name) {
  const p = path.join(ROOT, name);
  return fs.existsSync(p) ? p : null;
}

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.split('T')[0].split(' ')[0];
  return null;
}

function parseDateTime(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  return null;
}

function safeFloat(val) {
  if (val == null) return null;
  const n = parseFloat(String(val).replace(',', '.'));
  return isNaN(n) ? null : n;
}

const args = new Set(process.argv.slice(2).map(a => a.replace('--', '')));
const doAll = args.has('all') || args.size === 0;

// ══════════════════════════════════════════════════════════════
// IMPORT CAV (depuis CAV 2025.xlsx / CAV 2026.xlsx)
// ══════════════════════════════════════════════════════════════
async function importCAV() {
  console.log('\n[IMPORT] ══════ CAV ══════');

  for (const year of [2025, 2026]) {
    const file = findFile(`CAV ${year}.xlsx`);
    if (!file) { console.log(`  [SKIP] CAV ${year}.xlsx non trouvé`); continue; }

    const wb = XLSX.readFile(file);
    const ws = wb.Sheets['M1'];
    if (!ws) { console.log(`  [SKIP] Feuille M1 non trouvée dans CAV ${year}.xlsx`); continue; }

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    // Header row 3 : PAV, Nb CAV, N° CAV, Tournée, Jours de collecte, Freq. Pass., Adresse, Adresse2, CP, Ville, Lat, Lng
    // Data starts row 4

    let imported = 0, skipped = 0;
    for (let i = 4; i < rows.length; i++) {
      const row = rows[i];
      const name = row[0] ? String(row[0]).trim() : null;
      if (!name) continue;

      const nbCav = parseInt(row[1]) || 0;
      const tournee = row[3] ? String(row[3]).trim() : null;
      const joursCollecte = row[4] ? String(row[4]).trim() : null;
      const freqPassage = parseInt(row[5]) || 0;
      const adresse = row[6] ? String(row[6]).trim() : null;
      const adresse2 = row[7] ? String(row[7]).trim() : null;
      const cp = row[8] ? String(row[8]).trim() : null;
      const ville = row[9] ? String(row[9]).trim() : null;
      const lat = safeFloat(row[10]);
      const lng = safeFloat(row[11]);

      if (!lat || !lng) { skipped++; continue; }

      const fullAddress = [adresse, adresse2].filter(Boolean).join(', ');

      // Upsert CAV par nom
      try {
        await pool.query(`
          INSERT INTO cav (name, address, commune, latitude, longitude, nb_containers, status, geom)
          VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($5, $4), 4326))
          ON CONFLICT (name) DO UPDATE SET
            address = COALESCE(EXCLUDED.address, cav.address),
            commune = COALESCE(EXCLUDED.commune, cav.commune),
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            nb_containers = GREATEST(EXCLUDED.nb_containers, cav.nb_containers),
            geom = ST_SetSRID(ST_MakePoint(EXCLUDED.longitude, EXCLUDED.latitude), 4326),
            updated_at = NOW()
        `, [name, fullAddress, ville, lat, lng, nbCav || 1, nbCav > 0 ? 'active' : 'unavailable']);
        imported++;
      } catch (err) {
        // name might not be unique, try with commune prefix
        skipped++;
      }

      // Import tonnages mensuels (cols 29-64 : Jan Est, %, Pesées, Fev Est, %, Pesées, ...)
      const cavRow = await pool.query('SELECT id FROM cav WHERE name = $1', [name]);
      if (cavRow.rows.length === 0) continue;
      const cavId = cavRow.rows[0].id;

      for (let m = 0; m < 12; m++) {
        const peseeCol = 31 + m * 3; // Pesées column
        const pesee = safeFloat(row[peseeCol]);
        if (!pesee || pesee <= 0) continue;

        const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-15`; // Milieu du mois
        try {
          await pool.query(`
            INSERT INTO tonnage_history (date, cav_id, weight_kg, source, route_name)
            VALUES ($1, $2, $3, 'import', $4)
            ON CONFLICT DO NOTHING
          `, [dateStr, cavId, pesee, tournee]);
        } catch (_) {}
      }
    }
    console.log(`  [CAV ${year}] ${imported} CAV importés, ${skipped} ignorés`);
  }

  // Aussi importer depuis tournee.xlsx pour les métadonnées manquantes
  const tourneeFile = findFile('tournee.xlsx');
  if (tourneeFile) {
    const wb = XLSX.readFile(tourneeFile);
    const ws = wb.Sheets['TournéesCAV'];
    if (ws) {
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
      let updated = 0;
      for (let i = 5; i < rows.length; i++) {
        const row = rows[i];
        const name = row[1] ? String(row[1]).trim() : null;
        if (!name) continue;
        const nbCav = parseInt(row[10]) || 0;
        const freq = parseInt(row[11]) || 0;
        const adresse = row[12] ? String(row[12]).trim() : null;
        const ville = row[15] ? String(row[15]).trim() : null;
        const lat = safeFloat(row[16]);
        const lng = safeFloat(row[17]);

        if (!lat || !lng) continue;

        try {
          const res = await pool.query(`
            UPDATE cav SET
              nb_containers = GREATEST(nb_containers, $2),
              route_count = $3,
              updated_at = NOW()
            WHERE name ILIKE '%' || $1 || '%'
            RETURNING id
          `, [name.substring(0, 30), nbCav, freq]);
          if (res.rowCount > 0) updated++;
        } catch (_) {}
      }
      console.log(`  [Tournée] ${updated} CAV mis à jour avec fréquence de passage`);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// IMPORT TONNAGES (depuis Collect 2026.xlsx + tonnages.xlsx)
// ══════════════════════════════════════════════════════════════
async function importTonnages() {
  console.log('\n[IMPORT] ══════ TONNAGES (pesées détaillées) ══════');

  for (const fileName of ['tonnages.xlsx', 'Collect 2026.xlsx']) {
    const file = findFile(fileName);
    if (!file) { console.log(`  [SKIP] ${fileName} non trouvé`); continue; }

    const wb = XLSX.readFile(file);
    const ws = wb.Sheets['SaisiesT'];
    if (!ws) { console.log(`  [SKIP] Feuille SaisiesT absente`); continue; }

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    // Find header row (contains "ID")
    let headerIdx = -1;
    for (let i = 0; i < Math.min(15, rows.length); i++) {
      if (rows[i] && rows[i].some(v => String(v) === 'ID')) { headerIdx = i; break; }
    }
    if (headerIdx < 0) { console.log(`  [SKIP] Header 'ID' non trouvé`); continue; }

    let imported = 0, skipped = 0;
    const cavCache = {};

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const origine = row[2] ? String(row[2]).trim() : '';
      if (origine !== 'Collecte de CAV') { skipped++; continue; }

      const categorie = row[3] ? String(row[3]).trim() : null;
      const poids = safeFloat(row[4]);
      const dateFab = parseDate(row[8]);

      if (!poids || poids <= 0 || !dateFab) { skipped++; continue; }

      // Résoudre le cav_id par catégorie (nom de tournée)
      let cavId = null;
      if (categorie) {
        if (!(categorie in cavCache)) {
          const res = await pool.query(
            "SELECT id FROM cav WHERE name ILIKE '%' || $1 || '%' LIMIT 1",
            [categorie]
          );
          cavCache[categorie] = res.rows.length > 0 ? res.rows[0].id : null;
        }
        cavId = cavCache[categorie];
      }

      try {
        await pool.query(`
          INSERT INTO tonnage_history (date, cav_id, weight_kg, source, route_name)
          VALUES ($1, $2, $3, 'import', $4)
        `, [dateFab, cavId, poids, categorie]);
        imported++;
      } catch (err) {
        skipped++;
      }
    }
    console.log(`  [${fileName}] ${imported} pesées importées, ${skipped} ignorées`);
  }
}

// ══════════════════════════════════════════════════════════════
// IMPORT PRODUCTION (depuis KPI_Production 2026.xlsx)
// ══════════════════════════════════════════════════════════════
async function importProduction() {
  console.log('\n[IMPORT] ══════ PRODUCTION (KPI journalier) ══════');

  const file = findFile('KPI_Production 2026.xlsx');
  if (!file) { console.log('  [SKIP] KPI_Production 2026.xlsx non trouvé'); return; }

  const wb = XLSX.readFile(file);

  // Créer la table si elle n'existe pas
  await pool.query(`
    CREATE TABLE IF NOT EXISTS production_daily (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL UNIQUE,
      effectif_theorique INTEGER,
      effectif_reel INTEGER,
      entree_ligne_kg DOUBLE PRECISION,
      objectif_entree_ligne_kg DOUBLE PRECISION DEFAULT 1300,
      entree_recyclage_r3_kg DOUBLE PRECISION,
      objectif_entree_r3_kg DOUBLE PRECISION DEFAULT 1300,
      total_jour_t DOUBLE PRECISION,
      productivite_kg_per DOUBLE PRECISION,
      encadrant VARCHAR(100),
      commentaire TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  let totalImported = 0;
  const monthSheets = wb.SheetNames.filter(s => /\d{4}/.test(s) && s !== 'Feuil1' && !s.includes('Annuel'));

  for (const sheetName of monthSheets) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    let imported = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      // Cols: 21=Date, 22=Effectif Théorique, 23=Effectif réel, 24=Entrée ligne, 25=Obj ligne,
      //       26=Entrée recyclage, 27=Obj recyclage, 28=Total jour, 29=Productivité, 30=Commentaire
      const d = parseDate(row[21]);
      if (!d) continue;

      const effTheo = parseInt(row[22]) || null;
      const effReel = parseInt(row[23]) || null;
      const entreeLigne = safeFloat(row[24]);
      const objLigne = safeFloat(row[25]);
      const entreeR3 = safeFloat(row[26]);
      const objR3 = safeFloat(row[27]);
      const totalT = safeFloat(row[28]);
      const productivite = safeFloat(row[29]);
      const commentaire = row[30] ? String(row[30]).trim() : null;

      try {
        await pool.query(`
          INSERT INTO production_daily (date, effectif_theorique, effectif_reel, entree_ligne_kg,
            objectif_entree_ligne_kg, entree_recyclage_r3_kg, objectif_entree_r3_kg,
            total_jour_t, productivite_kg_per, commentaire)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (date) DO UPDATE SET
            effectif_theorique = COALESCE(EXCLUDED.effectif_theorique, production_daily.effectif_theorique),
            effectif_reel = COALESCE(EXCLUDED.effectif_reel, production_daily.effectif_reel),
            entree_ligne_kg = COALESCE(EXCLUDED.entree_ligne_kg, production_daily.entree_ligne_kg),
            entree_recyclage_r3_kg = COALESCE(EXCLUDED.entree_recyclage_r3_kg, production_daily.entree_recyclage_r3_kg),
            total_jour_t = COALESCE(EXCLUDED.total_jour_t, production_daily.total_jour_t),
            productivite_kg_per = COALESCE(EXCLUDED.productivite_kg_per, production_daily.productivite_kg_per),
            commentaire = COALESCE(EXCLUDED.commentaire, production_daily.commentaire)
        `, [d, effTheo, effReel, entreeLigne, objLigne, entreeR3, objR3, totalT, productivite, commentaire]);
        imported++;
      } catch (err) { /* ignore duplicate */ }
    }
    console.log(`  [${sheetName}] ${imported} jours importés`);
    totalImported += imported;
  }
  console.log(`  Total : ${totalImported} jours de production`);
}

// ══════════════════════════════════════════════════════════════
// IMPORT STOCK MOVEMENTS (depuis Mvmt Invent 2025.xlsx)
// ══════════════════════════════════════════════════════════════
async function importStock() {
  console.log('\n[IMPORT] ══════ STOCK (mouvements + produits finis) ══════');

  // Mvmt Invent 2025 → stock_movements (même structure que tonnages)
  const mvmt2025 = findFile('Mvmt Invent 2025.xlsx');
  if (mvmt2025) {
    const wb = XLSX.readFile(mvmt2025);
    const ws = wb.Sheets['SaisiesT'];
    if (ws) {
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
      let headerIdx = -1;
      for (let i = 0; i < 15; i++) {
        if (rows[i]?.some(v => String(v) === 'ID')) { headerIdx = i; break; }
      }
      if (headerIdx >= 0) {
        let imported = 0;
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const row = rows[i];
          const origine = row[2] ? String(row[2]).trim() : '';
          const categorie = row[3] ? String(row[3]).trim() : null;
          const poids = safeFloat(row[4]);
          const dateFab = parseDate(row[8]);
          const dateSortie = parseDate(row[9]);

          if (!poids || poids <= 0) continue;

          try {
            await pool.query(`
              INSERT INTO stock_movements (type, date, poids_kg, origine, categorie_collecte)
              VALUES ($1, $2, $3, $4, $5)
            `, [dateSortie ? 'sortie' : 'entree', dateFab || dateSortie || '2025-01-01', poids, origine, categorie]);
            imported++;
          } catch (_) {}
        }
        console.log(`  [Mvmt 2025] ${imported} mouvements importés`);
      }
    }
  }

  // Mvmt Invent 2026 → produits_finis
  const mvmt2026 = findFile('Mvmt Invent 2026.xlsx');
  if (mvmt2026) {
    const wb = XLSX.readFile(mvmt2026);
    const ws = wb.Sheets['SaisiesP'];
    if (ws) {
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
      // Header row 8: ID, Produits, Catégorie Eco-org, Genre, Saison, Gamme, Poids,
      //               Date fabrication, Date sortie, Inventaire, Mois fab, Trimestre fab
      let headerIdx = -1;
      for (let i = 0; i < 15; i++) {
        if (rows[i]?.some(v => String(v) === 'ID')) { headerIdx = i; break; }
      }
      if (headerIdx >= 0) {
        let imported = 0;
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const row = rows[i];
          const codeBarre = row[1] ? String(row[1]).trim() : null;
          const produit = row[2] ? String(row[2]).trim() : null;
          const categorie = row[3] ? String(row[3]).trim() : null;
          const genre = row[4] ? String(row[4]).trim() : null;
          const saison = row[5] ? String(row[5]).trim() : null;
          const gamme = row[6] ? String(row[6]).trim() : null;
          const poids = safeFloat(row[7]);
          const dateFab = parseDateTime(row[8]);
          const dateSortie = parseDateTime(row[9]);

          if (!codeBarre || !poids) continue;

          try {
            await pool.query(`
              INSERT INTO produits_finis (code_barre, produit, categorie_eco_org, genre, saison, gamme, poids_kg, date_fabrication, date_sortie)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              ON CONFLICT (code_barre) DO UPDATE SET
                date_sortie = COALESCE(EXCLUDED.date_sortie, produits_finis.date_sortie)
            `, [codeBarre, produit, categorie, genre, saison, gamme, poids, dateFab || '2020-01-01', dateSortie]);
            imported++;
          } catch (_) {}
        }
        console.log(`  [Mvmt 2026 Produits] ${imported} produits importés`);
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════
async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   SOLIDATA — Import Excel → PostgreSQL          ║');
  console.log('╚══════════════════════════════════════════════════╝');

  try {
    if (doAll || args.has('cav')) await importCAV();
    if (doAll || args.has('tonnages')) await importTonnages();
    if (doAll || args.has('production')) await importProduction();
    if (doAll || args.has('stock')) await importStock();

    console.log('\n[IMPORT] Terminé avec succès');
  } catch (err) {
    console.error('[IMPORT] Erreur fatale :', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
