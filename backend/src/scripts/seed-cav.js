#!/usr/bin/env node
/**
 * SOLIDATA — Import des CAV depuis KML (GPS) + tournee.xlsx (metadata)
 * Usage: node src/scripts/seed-cav.js
 *
 * Primary source: KML file with precise GPS coordinates for all CAV
 * Secondary source: tournee.xlsx for additional metadata (postal code, etc.)
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');

function findFile(filename) {
  const paths = [
    path.join(__dirname, '..', '..', '..', filename),
    path.join('/data', filename),
    path.join('/app', filename),
  ];
  return paths.find(p => fs.existsSync(p)) || null;
}

/**
 * Parse KML file to extract CAV placemarks
 * Format: COMMUNE - Address (Detail)\n\nN CAV\n\nTournées info\n\nFill rate
 */
function parseKML(filePath) {
  const xml = fs.readFileSync(filePath, 'utf-8');
  const cavs = [];

  // Match each Placemark block
  const placemarkRegex = /<Placemark>\s*<description><!\[CDATA\[(.*?)\]\]><\/description>.*?<Point><coordinates>([\d.,\-]+)<\/coordinates><\/Point>\s*<\/Placemark>/gs;

  let match;
  while ((match = placemarkRegex.exec(xml)) !== null) {
    const desc = match[1].replace(/<br>/g, '\n').replace(/<[^>]+>/g, '').trim();
    const coords = match[2].split(',');
    const lng = parseFloat(coords[0]);
    const lat = parseFloat(coords[1]);

    // Parse description: "COMMUNE - Address (Detail)\n\nN CAV\n\n..."
    const lines = desc.split('\n').filter(l => l.trim());

    // First line: "COMMUNE - Address (Detail)"
    const firstLine = lines[0] || '';
    const dashIdx = firstLine.indexOf(' - ');
    let commune = '';
    let address = firstLine;
    if (dashIdx > 0) {
      commune = firstLine.substring(0, dashIdx).trim();
      address = firstLine.substring(dashIdx + 3).trim();
    }

    // Name = "COMMUNE - Address" (the full first line)
    const name = firstLine;

    // Extract nb_containers from "N CAV" line
    let nbContainers = 1;
    const cavLine = lines.find(l => /^\d+\s+CAV$/i.test(l.trim()));
    if (cavLine) {
      nbContainers = parseInt(cavLine.trim()) || 1;
    }

    // Extract fill rate from "Taux de remplissage moyen XX%"
    let fillRate = null;
    const fillLine = lines.find(l => /taux de remplissage/i.test(l));
    if (fillLine) {
      const pct = fillLine.match(/(\d+)%/);
      if (pct) fillRate = parseInt(pct[1]);
    }

    // Extract tour count from "Présent sur N tournée(s)"
    let tourCount = null;
    const tourLine = lines.find(l => /pr.sent sur/i.test(l));
    if (tourLine) {
      const n = tourLine.match(/(\d+)\s+tourn/);
      if (n) tourCount = parseInt(n[1]);
    }

    if (!isNaN(lat) && !isNaN(lng)) {
      cavs.push({
        name,
        address,
        commune,
        latitude: lat,
        longitude: lng,
        nb_containers: nbContainers,
        fill_rate: fillRate,
        tour_count: tourCount,
      });
    }
  }

  return cavs;
}

/**
 * Parse Excel file for additional CAV data (postal codes, etc.)
 */
function parseExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets['TournéesCAV'];
  if (!ws) return [];

  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const cavs = [];
  for (let i = 5; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[1]) continue;

    const name = String(row[1]).trim();
    const nbContainers = parseInt(row[10]) || 1;
    const address = row[12] ? String(row[12]).trim() : '';
    const complement = row[13] ? String(row[13]).trim() : '';
    const postalCode = row[14] ? String(row[14]).trim() : '';
    const commune = row[15] ? String(row[15]).trim() : '';
    const lat = parseFloat(row[16]);
    const lng = parseFloat(row[17]);

    const fullAddress = [address, complement, postalCode, commune]
      .filter(Boolean)
      .join(', ');

    cavs.push({
      name,
      address: fullAddress,
      commune,
      postalCode,
      latitude: isNaN(lat) ? null : lat,
      longitude: isNaN(lng) ? null : lng,
      nb_containers: nbContainers,
    });
  }
  return cavs;
}

async function seedCAV(externalPool) {
  const db = externalPool || pool;

  // Load KML (primary source with GPS)
  const kmlPath = findFile('Carte des PAV au 28-02-2026.kml');
  const xlsPath = findFile('tournee.xlsx');

  let cavs = [];

  if (kmlPath) {
    console.log(`[SEED-CAV] Lecture KML: ${kmlPath}`);
    cavs = parseKML(kmlPath);
    console.log(`[SEED-CAV] ${cavs.length} CAV trouvés dans le KML (avec GPS)`);
  }

  // Merge with Excel data if available (for postal codes and extra CAV)
  if (xlsPath) {
    console.log(`[SEED-CAV] Lecture Excel: ${xlsPath}`);
    const xlsCavs = parseExcel(xlsPath);
    console.log(`[SEED-CAV] ${xlsCavs.length} CAV trouvés dans l'Excel`);

    // Add Excel-only CAVs that aren't in the KML
    const kmlNames = new Set(cavs.map(c => c.name.toLowerCase()));
    let added = 0;
    for (const xc of xlsCavs) {
      // Try matching by commune + partial address
      const exists = cavs.find(kc =>
        kc.commune.toLowerCase() === xc.commune.toLowerCase() &&
        (kc.address.toLowerCase().includes(xc.address.split(',')[0]?.toLowerCase() || '___') ||
         xc.name.toLowerCase().includes(kc.commune.toLowerCase()))
      );
      if (!exists && !kmlNames.has(xc.name.toLowerCase())) {
        cavs.push(xc);
        added++;
      }
    }
    if (added > 0) console.log(`[SEED-CAV] ${added} CAV supplémentaires depuis l'Excel`);
  }

  if (cavs.length === 0) {
    console.log('[SEED-CAV] Aucun fichier source trouvé (KML ou Excel), skip');
    return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Clear existing CAV for clean import
    const existing = await client.query('SELECT COUNT(*) FROM cav');
    if (parseInt(existing.rows[0].count) > 0) {
      // Check if tonnage_history references exist
      const hasHistory = await client.query('SELECT COUNT(*) FROM tonnage_history');
      if (parseInt(hasHistory.rows[0].count) === 0) {
        await client.query('DELETE FROM cav');
        console.log('[SEED-CAV] Table CAV vidée pour réimport propre');
      } else {
        console.log('[SEED-CAV] Données existantes conservées (tonnage_history non vide), mode upsert');
      }
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const cav of cavs) {
      // Check if exists by name
      const exists = await client.query(
        'SELECT id FROM cav WHERE name = $1',
        [cav.name]
      );

      const geomExpr = cav.latitude != null && cav.longitude != null
        ? `ST_SetSRID(ST_MakePoint($5, $4), 4326)`
        : 'NULL';

      if (exists.rows.length > 0) {
        // Update with GPS coordinates if we have them and the existing record doesn't
        if (cav.latitude != null && cav.longitude != null) {
          await client.query(
            `UPDATE cav SET latitude = $1, longitude = $2,
             geom = ST_SetSRID(ST_MakePoint($2, $1), 4326),
             address = COALESCE(NULLIF($3, ''), address),
             commune = COALESCE(NULLIF($4, ''), commune)
             WHERE id = $5`,
            [cav.latitude, cav.longitude, cav.address, cav.commune, exists.rows[0].id]
          );
          updated++;
        } else {
          skipped++;
        }
        continue;
      }

      await client.query(
        `INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
         VALUES ($1, $2, $3, $4, $5, ${geomExpr}, $6, 'active')`,
        [
          cav.name,
          cav.address,
          cav.commune,
          cav.latitude,
          cav.longitude,
          cav.nb_containers,
        ]
      );
      inserted++;
    }

    await client.query('COMMIT');
    console.log(`[SEED-CAV] Terminé: ${inserted} insérés, ${updated} mis à jour, ${skipped} ignorés`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[SEED-CAV] Erreur:', err.message);
    if (!externalPool) process.exit(1);
    throw err;
  } finally {
    client.release();
    if (!externalPool) await pool.end();
  }
}

// Appel direct (CLI) ou export (module)
if (require.main === module) {
  seedCAV();
}

module.exports = { seedCAV };
