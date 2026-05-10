#!/usr/bin/env node
require('dotenv').config();
const path = require('path');
const pool = require('../config/database');
const XLSX = require('../utils/xlsx-compat');
const { decodeBase24, parseId } = require('../utils/base24');

const ARGS = process.argv.slice(2);
const COMMIT = ARGS.includes('--commit');
const FILE_ARG = ARGS.find(a => !a.startsWith('--'));
const XLSX_PATH = FILE_ARG || path.join(__dirname, '..', '..', '..', 'SAISIE PRODUIT.xlsm');

function excelSerialToDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(Math.round((n - 25569) * 86400 * 1000));
  return isNaN(d.getTime()) ? null : d;
}

async function ensureCatalogue(client, fields, cache) {
  const key = JSON.stringify(fields);
  if (cache.has(key)) return cache.get(key);
  const found = await client.query(
    `SELECT id FROM produits_catalogue
     WHERE nom = $1 AND COALESCE(categorie_eco_org,'') = COALESCE($2,'')
       AND COALESCE(genre,'') = COALESCE($3,'') AND COALESCE(saison,'') = COALESCE($4,'')
       AND COALESCE(gamme,'') = COALESCE($5,'')
     LIMIT 1`,
    [fields.nom, fields.categorie_eco_org, fields.genre, fields.saison, fields.gamme]
  );
  if (found.rowCount > 0) {
    cache.set(key, found.rows[0].id);
    return found.rows[0].id;
  }
  if (!COMMIT) {
    cache.set(key, -1);
    return -1;
  }
  const ins = await client.query(
    `INSERT INTO produits_catalogue (nom, categorie_eco_org, genre, saison, gamme, is_active)
     VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
    [fields.nom, fields.categorie_eco_org, fields.genre, fields.saison, fields.gamme]
  );
  cache.set(key, ins.rows[0].id);
  return ins.rows[0].id;
}

async function getOrCreateMigrationUser(client) {
  const r = await client.query(`SELECT id FROM users WHERE username = 'migration_saisie' LIMIT 1`);
  if (r.rowCount > 0) return r.rows[0].id;
  if (!COMMIT) return 1;
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(require('crypto').randomBytes(32).toString('hex'), 10);
  const ins = await client.query(
    `INSERT INTO users (username, password_hash, email, role, first_name, last_name)
     VALUES ('migration_saisie', $1, 'migration@solidata.local', 'ADMIN', 'Migration', 'Saisie Produit')
     RETURNING id`,
    [hash]
  );
  return ins.rows[0].id;
}

(async () => {
  console.log(`[IMPORT] Mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);
  console.log(`[IMPORT] Fichier: ${XLSX_PATH}`);

  const wb = await XLSX.readFile(XLSX_PATH);
  if (!wb.SheetNames.includes('Enregistrements')) {
    throw new Error('Feuille "Enregistrements" introuvable');
  }
  const rowsRaw = XLSX.utils.sheet_to_json(wb.Sheets['Enregistrements'], { header: 1 });
  console.log(`[IMPORT] Lignes lues: ${rowsRaw.length}`);

  let headerIdx = rowsRaw.findIndex(r => Array.isArray(r) && r.includes('ID'));
  if (headerIdx < 0) headerIdx = 2;
  const dataRows = rowsRaw.slice(headerIdx + 1).filter(r => r && r[1]);
  console.log(`[IMPORT] Lignes de données (après header ${headerIdx}): ${dataRows.length}`);

  const stats = { total: dataRows.length, inserted: 0, skipped_dup: 0, skipped_invalid: 0, catalogue_created: 0, catalogue_existing: 0, max_counter: 0 };
  const catCache = new Map();
  const seenCodes = new Set();

  const client = await pool.connect();
  try {
    if (COMMIT) await client.query('BEGIN');
    const userId = await getOrCreateMigrationUser(client);
    const cntBefore = catCache.size;

    const posteRow = await client.query(`SELECT id FROM postes_etiquetage WHERE numero_poste = 1`);
    let posteId = posteRow.rows[0]?.id;
    if (!posteId) {
      if (COMMIT) {
        const r = await client.query(`INSERT INTO postes_etiquetage (numero_poste, nom) VALUES (1, 'Poste 1') RETURNING id`);
        posteId = r.rows[0].id;
      } else {
        posteId = 1;
      }
    }

    for (const row of dataRows) {
      const code = row[1];
      if (!code || typeof code !== 'string') { stats.skipped_invalid++; continue; }
      if (seenCodes.has(code)) { stats.skipped_dup++; continue; }
      seenCodes.add(code);

      const parsed = parseId(code);
      if (parsed && parsed.counter > stats.max_counter) stats.max_counter = parsed.counter;

      const fields = {
        nom: row[2] || '',
        categorie_eco_org: row[3] || null,
        genre: row[4] || null,
        saison: row[5] || null,
        gamme: row[6] || null,
      };
      if (!fields.nom) { stats.skipped_invalid++; continue; }

      const poids = Number(row[7]);
      const dateFab = excelSerialToDate(row[8]) || new Date('2020-01-01');

      const existed = await client.query(`SELECT 1 FROM produits_finis WHERE code_barre = $1 LIMIT 1`, [code]);
      if (existed.rowCount > 0) { stats.skipped_dup++; continue; }

      const catalogue_id = await ensureCatalogue(client, fields, catCache);

      if (!COMMIT) { stats.inserted++; continue; }
      if (catalogue_id < 0) { stats.skipped_invalid++; continue; }

      await client.query(
        `INSERT INTO produits_finis
           (code_barre, catalogue_id, produit, categorie_eco_org, genre, saison, gamme,
            poids_kg, date_fabrication, poste_etiquetage_id, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'en_stock', $11)
         ON CONFLICT (code_barre) DO NOTHING`,
        [code, catalogue_id, fields.nom, fields.categorie_eco_org, fields.genre, fields.saison, fields.gamme,
          isFinite(poids) ? poids : 0, dateFab, posteId, userId]
      );
      stats.inserted++;
      if (stats.inserted % 1000 === 0) console.log(`[IMPORT] ${stats.inserted}/${dataRows.length}…`);
    }

    stats.catalogue_created = catCache.size - cntBefore;
    if (COMMIT && stats.max_counter > 0) {
      await client.query(
        `UPDATE postes_etiquetage SET compteur_actuel = GREATEST(compteur_actuel, $1) WHERE id = $2`,
        [stats.max_counter, posteId]
      );
    }

    if (COMMIT) await client.query('COMMIT');
    console.log('[IMPORT] Stats:', stats);
    if (!COMMIT) console.log('[IMPORT] Dry-run terminé. Relancer avec --commit pour appliquer.');
  } catch (e) {
    if (COMMIT) await client.query('ROLLBACK');
    console.error('[IMPORT] ERREUR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
