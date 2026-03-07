#!/usr/bin/env node
/**
 * SOLIDATA — Import des CAV depuis tournee.xlsx
 * Usage: node src/scripts/seed-cav.js [path/to/tournee.xlsx]
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');

const FILENAME = 'tournee.xlsx';
const SEARCH_PATHS = [
  path.join(__dirname, '..', '..', '..', FILENAME),  // repo root (local dev)
  path.join('/data', FILENAME),                        // Docker volume mount
  path.join('/app', FILENAME),                         // Docker app root
];
const DEFAULT_FILE = SEARCH_PATHS.find(p => fs.existsSync(p)) || SEARCH_PATHS[0];

async function seedCAV() {
  const filePath = process.argv[2] || DEFAULT_FILE;
  console.log(`[SEED-CAV] Lecture de ${filePath}...`);

  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets['TournéesCAV'];
  if (!ws) {
    console.error('[SEED-CAV] Feuille "TournéesCAV" introuvable');
    process.exit(1);
  }

  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Row 4 = headers, data starts at row 5
  // Col B(1)=name, C-J(2-9)=N° routes, K(10)=nb_cav, L(11)=freq,
  // M(12)=address, N(13)=complement, O(14)=CP, P(15)=ville,
  // Q(16)=lat, R(17)=lng, S(18)=communaute, T(19)=surface, V(21)=entity
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
      latitude: isNaN(lat) ? null : lat,
      longitude: isNaN(lng) ? null : lng,
      nb_containers: nbContainers,
    });
  }

  console.log(`[SEED-CAV] ${cavs.length} CAV trouvés dans le fichier`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let inserted = 0;
    let skipped = 0;

    for (const cav of cavs) {
      // Skip if already exists (by name)
      const exists = await client.query(
        'SELECT id FROM cav WHERE name = $1',
        [cav.name]
      );
      if (exists.rows.length > 0) {
        skipped++;
        continue;
      }

      const geomExpr = cav.latitude && cav.longitude
        ? `ST_SetSRID(ST_MakePoint($5, $4), 4326)`
        : 'NULL';

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
    console.log(`[SEED-CAV] Terminé: ${inserted} insérés, ${skipped} déjà existants`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[SEED-CAV] Erreur:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedCAV();
