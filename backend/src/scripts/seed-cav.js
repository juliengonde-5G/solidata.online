#!/usr/bin/env node
/**
 * SOLIDATA — Import des CAV depuis Liste PAV.xlsx / CSV / KML / Excel
 * Usage: node src/scripts/seed-cav.js
 *
 * Sources (par priorité) :
 *   1. Liste PAV.xlsx — liste actualisée officielle (209 PAV, toutes métadonnées)
 *   2. CSV (listeCAV290326.csv) — source complète 209 CAV avec métadonnées
 *   3. KML — coordonnées GPS
 *   4. Excel (tournee.xlsx) — métadonnées complémentaires (tournée, jours collecte)
 *
 * Opérations :
 *   - Créer les nouveaux PAV
 *   - Mettre à jour les PAV existants (tous les champs)
 *   - Désactiver les PAV absents de la liste (status = 'unavailable')
 *   - Générer les QR codes manquants
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');

let QRCode;
try {
  QRCode = require('qrcode');
} catch (e) {
  // QRCode optionnel — si absent, les QR ne seront pas générés
  QRCode = null;
}

function findFile(filename) {
  const paths = [
    path.join(__dirname, '..', '..', '..', filename),
    path.join('/data', filename),
    path.join('/app', filename),
  ];
  return paths.find(p => fs.existsSync(p)) || null;
}

/**
 * Parse "Liste PAV.xlsx" — fichier officiel actualisé
 * Colonnes: A=Nom PAV, B=Nb CAV, C=Adresse, D=Complément, E=Code postal,
 *           F=Ville, G=Latitude, H=Longitude, I=Communauté de communes,
 *           J=Surface, K=Reference Refashion, L=Entité détentrice
 */
function parseListePAV(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];

  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const cavs = [];

  // Row 0 is header, data starts at row 1
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;

    const name = String(row[0]).trim();
    const nbContainers = parseInt(row[1]) || 1;
    const address = row[2] ? String(row[2]).trim() : '';
    const complement = row[3] ? String(row[3]).trim() : '';
    const postalCode = row[4] ? String(row[4]).trim() : '';
    const ville = row[5] ? String(row[5]).trim() : '';
    const lat = parseFloat(row[6]);
    const lng = parseFloat(row[7]);
    const communaute = row[8] ? String(row[8]).trim() : '';
    const surface = row[9] ? String(row[9]).trim() : '';
    const refRefashion = row[10] != null ? String(row[10]).trim() : '';
    const entite = row[11] ? String(row[11]).trim() : '';

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
      nb_containers: nbContainers,
      communaute,
      surface,
      refRefashion,
      entite,
    });
  }

  return cavs;
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
    const refRefashion = (fields[9] || '').trim();
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
      refRefashion,
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
 * Parse Excel file for additional CAV data (tournee.xlsx)
 */
function parseTourneeExcel(filePath) {
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

/**
 * Générer un QR code unique pour un CAV
 */
async function generateQRCode(cavId, cavName) {
  if (!QRCode) return { qrData: null, qrPath: null };

  const qrDir = path.join(__dirname, '..', '..', 'uploads', 'qrcodes');
  if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });

  const qrData = `SOLIDATA-CAV-${cavId}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
  const qrFilename = `qr_${qrData}.png`;
  const qrPath = path.join(qrDir, qrFilename);

  await QRCode.toFile(qrPath, qrData, { width: 300, margin: 2 });

  return { qrData, qrImagePath: `/uploads/qrcodes/${qrFilename}` };
}

async function seedCAV(externalPool) {
  const db = externalPool || pool;

  // Source 1: Liste PAV.xlsx (prioritaire — fichier officiel actualisé)
  const listePavPath = findFile('Liste PAV.xlsx');
  // Source 2: CSV (listeCAV290326.csv)
  const csvPath = findFile('listeCAV290326.csv');
  // Source 3: KML
  const kmlPath = findFile('Carte des PAV au 29-03-2026.kml')
    || findFile('Carte des PAV au 28-02-2026.kml');
  // Source 4: Excel (tournee.xlsx — métadonnées complémentaires)
  const xlsPath = findFile('tournee.xlsx');

  let cavs = [];

  // Liste PAV.xlsx est la source prioritaire
  if (listePavPath) {
    console.log(`[SEED-CAV] Lecture Liste PAV.xlsx: ${listePavPath}`);
    cavs = parseListePAV(listePavPath);
    const activePavCount = cavs.filter(c => c.nb_containers > 0).length;
    const inactivePavCount = cavs.filter(c => c.nb_containers === 0).length;
    const totalCavCount = cavs.reduce((sum, c) => sum + c.nb_containers, 0);
    console.log(`[SEED-CAV] ${cavs.length} PAV trouvés (${activePavCount} actives, ${inactivePavCount} inactives, ${totalCavCount} CAV total)`);
  }

  // Fallback CSV si Liste PAV.xlsx non trouvé
  if (cavs.length === 0 && csvPath) {
    console.log(`[SEED-CAV] Lecture CSV: ${csvPath}`);
    cavs = parseCSV(csvPath);
    console.log(`[SEED-CAV] ${cavs.length} CAV trouvés dans le CSV`);
  }

  // Fallback KML
  if (cavs.length === 0 && kmlPath) {
    console.log(`[SEED-CAV] Lecture KML: ${kmlPath}`);
    cavs = parseKML(kmlPath);
    console.log(`[SEED-CAV] ${cavs.length} CAV trouvés dans le KML`);

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

  // Merge avec tournee.xlsx si disponible (données complémentaires : tournée, jours collecte)
  if (xlsPath) {
    console.log(`[SEED-CAV] Lecture Excel complémentaire: ${xlsPath}`);
    const xlsCavs = parseTourneeExcel(xlsPath);
    console.log(`[SEED-CAV] ${xlsCavs.length} CAV trouvés dans tournee.xlsx`);

    const existingNames = new Set(cavs.map(c => c.name.toLowerCase()));
    let added = 0;
    for (const xc of xlsCavs) {
      if (!existingNames.has(xc.name.toLowerCase())) {
        cavs.push(xc);
        existingNames.add(xc.name.toLowerCase());
        added++;
      }
    }
    if (added > 0) console.log(`[SEED-CAV] ${added} CAV supplémentaires depuis tournee.xlsx`);
  }

  if (cavs.length === 0) {
    console.log('[SEED-CAV] Aucun fichier source trouvé, skip');
    return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // ── Nettoyage doublons encodage (KML avec caractères corrompus vs CSV/XLSX corrects) ──
    // Le KML encode mal les accents : "ç" → "�" (U+FFFD), "è" → "�", etc.
    // Cela crée des doublons car "François" ≠ "Fran�ois" en BDD.
    // Stratégie : pour chaque entrée corrompue (contient U+FFFD), chercher un match propre
    // via regex (chaque U+FFFD matche n'importe quel caractère).
    const allCavs = await client.query('SELECT id, name, qr_code_data, status FROM cav ORDER BY id');
    const hasBadChars = (s) => /\uFFFD/.test(s);

    const cleanRows = allCavs.rows.filter(r => !hasBadChars(r.name));
    const badRows = allCavs.rows.filter(r => hasBadChars(r.name));
    let duplicatesRemoved = 0;

    for (const bad of badRows) {
      // Construire un regex depuis le nom corrompu : chaque U+FFFD → . (any char)
      const escaped = bad.name.replace(/[.*+?^${}()|[\]\\]/g, (m) => m === '\uFFFD' ? m : '\\' + m);
      const pattern = escaped.replace(/\uFFFD/g, '.');
      let re;
      try { re = new RegExp('^' + pattern + '$', 'i'); } catch (e) { continue; }

      const match = cleanRows.find(r => re.test(r.name));
      if (match) {
        // Transférer les FK (tour_cav, tonnage_history, cav_qr_scans) vers l'entrée propre
        await client.query('UPDATE tour_cav SET cav_id = $1 WHERE cav_id = $2', [match.id, bad.id]);
        await client.query('UPDATE tonnage_history SET cav_id = $1 WHERE cav_id = $2', [match.id, bad.id]);
        await client.query('UPDATE cav_qr_scans SET cav_id = $1 WHERE cav_id = $2', [match.id, bad.id]);

        // Récupérer le QR code si l'entrée propre n'en a pas
        if (!match.qr_code_data && bad.qr_code_data) {
          await client.query('UPDATE cav SET qr_code_data = $1 WHERE id = $2', [bad.qr_code_data, match.id]);
          match.qr_code_data = bad.qr_code_data;
        }

        // Supprimer le doublon corrompu
        await client.query('DELETE FROM cav WHERE id = $1', [bad.id]);
        duplicatesRemoved++;
        console.log(`[SEED-CAV] Doublon supprimé: "${bad.name}" (id=${bad.id}) → fusionné avec "${match.name}" (id=${match.id})`);
      } else {
        // Pas de match propre — corriger le nom en place en remplaçant U+FFFD par ?
        const fixedName = bad.name.replace(/\uFFFD/g, '?');
        await client.query('UPDATE cav SET name = $1, updated_at = NOW() WHERE id = $2', [fixedName, bad.id]);
        console.log(`[SEED-CAV] Nom corrigé: "${bad.name}" → "${fixedName}" (id=${bad.id})`);
      }
    }
    if (duplicatesRemoved > 0) {
      console.log(`[SEED-CAV] ${duplicatesRemoved} doublons (encodage corrompu) supprimés`);
    }

    // Récupérer tous les CAV existants en base (après nettoyage)
    const existingResult = await client.query('SELECT id, name, qr_code_data FROM cav');
    const existingByName = new Map();
    for (const row of existingResult.rows) {
      existingByName.set(row.name, row);
    }
    console.log(`[SEED-CAV] ${existingByName.size} CAV existants en base`);

    // Set des noms dans le fichier source (pour détecter les suppressions)
    const sourceNames = new Set(cavs.map(c => c.name));

    let inserted = 0;
    let updated = 0;
    let deactivated = 0;
    let qrGenerated = 0;

    for (const cav of cavs) {
      const existing = existingByName.get(cav.name);
      const hasGPS = cav.latitude != null && cav.longitude != null;
      const isActive = cav.nb_containers > 0;
      const cavStatus = isActive ? 'active' : 'unavailable';
      const unavailableReason = isActive ? null : 'PAV inactive (0 CAV dans la liste actualisée)';

      if (existing) {
        // Mise à jour complète du CAV existant
        const geomClause = hasGPS
          ? `geom = ST_SetSRID(ST_MakePoint($3, $2), 4326),`
          : '';

        await client.query(
          `UPDATE cav SET
           address = COALESCE(NULLIF($1, ''), address),
           latitude = ${hasGPS ? '$2' : 'latitude'},
           longitude = ${hasGPS ? '$3' : 'longitude'},
           ${geomClause}
           commune = COALESCE(NULLIF($4, ''), commune),
           nb_containers = $5,
           communaute_communes = COALESCE(NULLIF($6, ''), communaute_communes),
           surface = COALESCE(NULLIF($7, ''), surface),
           ref_refashion = COALESCE(NULLIF($8, ''), ref_refashion),
           entite_detentrice = COALESCE(NULLIF($9, ''), entite_detentrice),
           code_postal = COALESCE(NULLIF($10, ''), code_postal),
           status = $12,
           unavailable_reason = $13,
           unavailable_since = ${isActive ? 'NULL' : 'COALESCE(unavailable_since, CURRENT_DATE)'},
           updated_at = NOW()
           WHERE id = $11`,
          [
            cav.address, cav.latitude, cav.longitude, cav.commune,
            cav.nb_containers, cav.communaute || '', cav.surface || '',
            cav.refRefashion || '', cav.entite || '', cav.postalCode || '',
            existing.id, cavStatus, unavailableReason
          ]
        );
        updated++;
        if (!isActive) deactivated++;

        // Générer QR code si manquant et PAV active
        if (isActive && !existing.qr_code_data) {
          const { qrData, qrImagePath } = await generateQRCode(existing.id, cav.name);
          if (qrData) {
            await client.query(
              'UPDATE cav SET qr_code_data = $1, qr_code_image_path = $2 WHERE id = $3',
              [qrData, qrImagePath, existing.id]
            );
            qrGenerated++;
          }
        }
      } else {
        // Nouveau CAV — insertion
        const geomExpr = hasGPS ? `ST_SetSRID(ST_MakePoint($5, $4), 4326)` : 'NULL';

        const result = await client.query(
          `INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers,
           communaute_communes, surface, ref_refashion, entite_detentrice, code_postal,
           status, unavailable_reason, unavailable_since)
           VALUES ($1, $2, $3, $4, $5, ${geomExpr}, $6, $7, $8, $9, $10, $11,
                   $12, $13, ${isActive ? 'NULL' : 'CURRENT_DATE'})
           RETURNING id`,
          [
            cav.name, cav.address, cav.commune, cav.latitude, cav.longitude,
            cav.nb_containers, cav.communaute || null, cav.surface || null,
            cav.refRefashion || null, cav.entite || null, cav.postalCode || null,
            cavStatus, unavailableReason
          ]
        );
        inserted++;
        if (!isActive) deactivated++;

        // Générer QR code pour le nouveau CAV (uniquement si actif)
        if (isActive) {
          const newId = result.rows[0].id;
          const { qrData, qrImagePath } = await generateQRCode(newId, cav.name);
          if (qrData) {
            await client.query(
              'UPDATE cav SET qr_code_data = $1, qr_code_image_path = $2 WHERE id = $3',
              [qrData, qrImagePath, newId]
            );
            qrGenerated++;
          }
        }
      }
    }

    // Désactiver les CAV absents de la liste source (ne pas supprimer pour préserver les FK)
    for (const [name, row] of existingByName) {
      if (!sourceNames.has(name)) {
        await client.query(
          `UPDATE cav SET status = 'unavailable',
           unavailable_reason = 'Absent de la liste PAV actualisée du ${new Date().toLocaleDateString('fr-FR')}',
           unavailable_since = CURRENT_DATE,
           updated_at = NOW()
           WHERE id = $1 AND status = 'active'`,
          [row.id]
        );
        deactivated++;
      }
    }

    await client.query('COMMIT');
    const activePav = cavs.filter(c => c.nb_containers > 0).length;
    const totalContainers = cavs.reduce((sum, c) => sum + c.nb_containers, 0);
    console.log(`[SEED-CAV] Terminé:`);
    console.log(`  - ${inserted} insérés`);
    console.log(`  - ${updated} mis à jour`);
    console.log(`  - ${deactivated} désactivés (0 CAV ou absents de la liste)`);
    console.log(`  - ${qrGenerated} QR codes générés`);
    console.log(`  - Total PAV: ${cavs.length} (${activePav} actives, ${cavs.length - activePav} inactives)`);
    console.log(`  - Total CAV (conteneurs): ${totalContainers}`);
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
