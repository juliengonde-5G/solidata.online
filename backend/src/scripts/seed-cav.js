#!/usr/bin/env node
/**
 * SOLIDATA — Import des CAV depuis CSV / KML / Excel
 * Usage: node src/scripts/seed-cav.js
 *
 * Sources (par priorité) :
 *   1. CSV (listeCAV290326.csv) — source complète 209 CAV avec métadonnées
 *   2. KML — coordonnées GPS
 *   3. Excel (tournee.xlsx) — métadonnées complémentaires
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
 * Parse CSV file (semicolon-separated, UTF-8 with BOM)
 * Colonnes: PAV;Adresse;Complément d'adresse;Code postal;Ville;Latitude;Longitude;
 *           Communauté de communes;Surface;Reference Eco TLC;Entité détentrice
 */
function parseCSV(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  // Remove BOM
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const cavs = [];
  for (let i = 1; i < lines.length; i++) {
    // Handle quoted fields with semicolons inside
    const fields = parseCSVLine(lines[i], ';');
    if (fields.length < 5) continue;

    const name = (fields[0] || '').trim();
    const address = (fields[1] || '').trim();
    const complement = (fields[2] || '').trim();
    const postalCode = (fields[3] || '').trim();
    const ville = (fields[4] || '').trim();
    const lat = parseFloat(fields[5]);
    const lng = parseFloat(fields[6]);
    const communaute = (fields[7] || '').trim();
    const surface = (fields[8] || '').trim();
    const refEcoTLC = (fields[9] || '').trim();
    const entite = (fields[10] || '').trim();

    if (!name) continue;

    // Extraire la commune du nom (format: "COMMUNE - Adresse (Détail)")
    const dashIdx = name.indexOf(' - ');
    const commune = dashIdx > 0 ? name.substring(0, dashIdx).trim() : ville;

    // Adresse complète
    const fullAddress = [address, complement].filter(Boolean).join(', ');

    cavs.push({
      name,
      address: fullAddress || address,
      commune: commune || ville,
      postalCode,
      latitude: isNaN(lat) ? null : lat,
      longitude: isNaN(lng) ? null : lng,
      nb_containers: 1,
      communaute,
      surface,
      refEcoTLC,
      entite,
    });
  }

  return cavs;
}

/**
 * Parse a CSV line respecting quoted fields
 */
function parseCSVLine(line, sep) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parse KML file to extract CAV placemarks
 */
function parseKML(filePath) {
  const xml = fs.readFileSync(filePath, 'utf-8');
  const cavs = [];

  const placemarkRegex = /<Placemark>\s*<description><!\[CDATA\[(.*?)\]\]><\/description>.*?<Point><coordinates>([\d.,\-]+)<\/coordinates><\/Point>\s*<\/Placemark>/gs;

  let match;
  while ((match = placemarkRegex.exec(xml)) !== null) {
    const desc = match[1].replace(/<br>/g, '\n').replace(/<[^>]+>/g, '').trim();
    const coords = match[2].split(',');
    const lng = parseFloat(coords[0]);
    const lat = parseFloat(coords[1]);

    const lines = desc.split('\n').filter(l => l.trim());
    const firstLine = lines[0] || '';
    const dashIdx = firstLine.indexOf(' - ');
    let commune = '';
    let address = firstLine;
    if (dashIdx > 0) {
      commune = firstLine.substring(0, dashIdx).trim();
      address = firstLine.substring(dashIdx + 3).trim();
    }

    const name = firstLine;

    let nbContainers = 1;
    const cavLine = lines.find(l => /^\d+\s+CAV$/i.test(l.trim()));
    if (cavLine) nbContainers = parseInt(cavLine.trim()) || 1;

    if (!isNaN(lat) && !isNaN(lng)) {
      cavs.push({ name, address, commune, latitude: lat, longitude: lng, nb_containers: nbContainers });
    }
  }

  return cavs;
}

/**
 * Parse Excel file for additional CAV data
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

    const fullAddress = [address, complement, postalCode, commune].filter(Boolean).join(', ');

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

  // Source 1: CSV (prioritaire — fichier complet 209 CAV)
  const csvPath = findFile('listeCAV290326.csv');
  // Source 2: KML
  const kmlPath = findFile('Carte des PAV au 29-03-2026.kml')
    || findFile('Carte des PAV au 28-02-2026.kml');
  // Source 3: Excel
  const xlsPath = findFile('tournee.xlsx');

  let cavs = [];

  // CSV est la source prioritaire
  if (csvPath) {
    console.log(`[SEED-CAV] Lecture CSV: ${csvPath}`);
    cavs = parseCSV(csvPath);
    console.log(`[SEED-CAV] ${cavs.length} CAV trouvés dans le CSV`);
  }

  // Compléter avec KML si le CSV n'a pas été trouvé ou est vide
  if (cavs.length === 0 && kmlPath) {
    console.log(`[SEED-CAV] Lecture KML: ${kmlPath}`);
    cavs = parseKML(kmlPath);
    console.log(`[SEED-CAV] ${cavs.length} CAV trouvés dans le KML`);

    // Vérifier que le KML est complet
    const kmlContent = fs.readFileSync(kmlPath, 'utf-8');
    if (!kmlContent.includes('</Document>')) {
      console.warn(`[SEED-CAV] ATTENTION: KML tronqué (pas de </Document>), ${cavs.length} CAV seulement`);
      const fallback = findFile('Carte des PAV au 28-02-2026.kml');
      if (fallback && fallback !== kmlPath) {
        const fallbackCavs = parseKML(fallback);
        if (fallbackCavs.length > cavs.length) {
          console.log(`[SEED-CAV] Fallback vers ${fallback}: ${fallbackCavs.length} CAV`);
          cavs = fallbackCavs;
        }
      }
    }
  }

  // Merge avec Excel si disponible
  if (xlsPath) {
    console.log(`[SEED-CAV] Lecture Excel: ${xlsPath}`);
    const xlsCavs = parseExcel(xlsPath);
    console.log(`[SEED-CAV] ${xlsCavs.length} CAV trouvés dans l'Excel`);

    const existingNames = new Set(cavs.map(c => c.name.toLowerCase()));
    let added = 0;
    for (const xc of xlsCavs) {
      if (!existingNames.has(xc.name.toLowerCase())) {
        cavs.push(xc);
        existingNames.add(xc.name.toLowerCase());
        added++;
      }
    }
    if (added > 0) console.log(`[SEED-CAV] ${added} CAV supplémentaires depuis l'Excel`);
  }

  if (cavs.length === 0) {
    console.log('[SEED-CAV] Aucun fichier source trouvé (CSV, KML ou Excel), skip');
    return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Toujours mode upsert — ne jamais supprimer les CAV existants (FK: tour_cav, cav_qr_scans, tonnage_history...)
    const existing = await client.query('SELECT COUNT(*) FROM cav');
    console.log(`[SEED-CAV] ${existing.rows[0].count} CAV existants en base, mode upsert`);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const cav of cavs) {
      // Check if exists by name
      const exists = await client.query('SELECT id FROM cav WHERE name = $1', [cav.name]);

      const hasGPS = cav.latitude != null && cav.longitude != null;
      const geomExpr = hasGPS ? `ST_SetSRID(ST_MakePoint($5, $4), 4326)` : 'NULL';

      if (exists.rows.length > 0) {
        // Update existing record
        if (hasGPS) {
          await client.query(
            `UPDATE cav SET latitude = $1, longitude = $2,
             geom = ST_SetSRID(ST_MakePoint($2, $1), 4326),
             address = COALESCE(NULLIF($3, ''), address),
             commune = COALESCE(NULLIF($4, ''), commune),
             updated_at = NOW()
             WHERE id = $5`,
            [cav.latitude, cav.longitude, cav.address, cav.commune, exists.rows[0].id]
          );
          updated++;
        } else {
          // Update address/commune even without GPS
          await client.query(
            `UPDATE cav SET
             address = COALESCE(NULLIF($1, ''), address),
             commune = COALESCE(NULLIF($2, ''), commune),
             updated_at = NOW()
             WHERE id = $3`,
            [cav.address, cav.commune, exists.rows[0].id]
          );
          updated++;
        }
        continue;
      }

      await client.query(
        `INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
         VALUES ($1, $2, $3, $4, $5, ${geomExpr}, $6, 'active')`,
        [cav.name, cav.address, cav.commune, cav.latitude, cav.longitude, cav.nb_containers]
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
