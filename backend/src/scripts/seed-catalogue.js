#!/usr/bin/env node
require('dotenv').config();
const path = require('path');
const pool = require('../config/database');
const XLSX = require('../utils/xlsx-compat');

const ARGS = process.argv.slice(2);
const COMMIT = ARGS.includes('--commit');
const FILE_ARG = ARGS.find(a => !a.startsWith('--'));
const XLSX_PATH = FILE_ARG || path.join(__dirname, '..', '..', '..', 'SAISIE PRODUIT.xlsm');

(async () => {
  console.log(`[SEED-CATALOGUE] Mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);
  console.log(`[SEED-CATALOGUE] Fichier: ${XLSX_PATH}`);

  const wb = await XLSX.readFile(XLSX_PATH);
  if (!wb.SheetNames.includes('Catégories')) {
    throw new Error('Feuille "Catégories" introuvable');
  }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Catégories'], { header: 1 });
  const headerIdx = rows.findIndex(r => Array.isArray(r) && r.includes('Produit') && r.includes('Catégorie Eco-Organisme'));
  if (headerIdx < 0) throw new Error('Ligne d\'en-tête introuvable dans Catégories');

  const dataRows = rows.slice(headerIdx + 1).filter(r => r && r[1]);
  console.log(`[SEED-CATALOGUE] Lignes lues: ${dataRows.length}`);

  const produits = new Set();
  const genres = new Set();
  const saisons = new Set();
  const gammes = new Set();
  const catEcoByProduit = new Map();

  for (const r of dataRows) {
    const produit = r[1]?.toString().trim();
    const catEco = r[2]?.toString().trim();
    const genre = r[3]?.toString().trim();
    const saison = r[4]?.toString().trim();
    const gamme = r[5]?.toString().trim();
    if (produit && catEco) {
      produits.add(produit);
      catEcoByProduit.set(produit, catEco);
    }
    if (genre) genres.add(genre);
    if (saison) saisons.add(saison);
    if (gamme) gammes.add(gamme);
  }

  console.log(`[SEED-CATALOGUE] Produits uniques: ${produits.size}, Genres: ${genres.size}, Saisons: ${saisons.size}, Gammes: ${gammes.size}`);

  const combos = [];
  for (const produit of produits) {
    const catEco = catEcoByProduit.get(produit);
    for (const genre of genres) {
      for (const saison of saisons) {
        for (const gamme of gammes) {
          combos.push({ nom: produit, categorie_eco_org: catEco, genre, saison, gamme });
        }
      }
    }
  }
  console.log(`[SEED-CATALOGUE] Combinaisons totales: ${combos.length}`);

  const client = await pool.connect();
  const stats = { inserted: 0, existing: 0, skipped: 0 };
  try {
    if (COMMIT) await client.query('BEGIN');
    for (const c of combos) {
      if (!c.nom || !c.categorie_eco_org || !c.gamme) { stats.skipped++; continue; }
      const found = await client.query(
        `SELECT id FROM produits_catalogue
         WHERE nom=$1 AND categorie_eco_org=$2 AND COALESCE(genre,'')=COALESCE($3,'')
           AND COALESCE(saison,'')=COALESCE($4,'') AND COALESCE(gamme,'')=COALESCE($5,'')
         LIMIT 1`,
        [c.nom, c.categorie_eco_org, c.genre, c.saison, c.gamme]
      );
      if (found.rowCount > 0) { stats.existing++; continue; }
      if (!COMMIT) { stats.inserted++; continue; }
      try {
        await client.query(
          `INSERT INTO produits_catalogue (nom, categorie_eco_org, genre, saison, gamme, is_active)
           VALUES ($1,$2,$3,$4,$5,true)`,
          [c.nom, c.categorie_eco_org, c.genre, c.saison, c.gamme]
        );
        stats.inserted++;
        if (stats.inserted % 500 === 0) console.log(`[SEED-CATALOGUE] ${stats.inserted}…`);
      } catch (e) {
        if (e.code === '23505') stats.existing++;
        else throw e;
      }
    }
    if (COMMIT) await client.query('COMMIT');
    console.log('[SEED-CATALOGUE] Stats:', stats);
    if (!COMMIT) console.log('[SEED-CATALOGUE] Dry-run terminé. Relancer avec --commit pour appliquer.');
  } catch (e) {
    if (COMMIT) await client.query('ROLLBACK');
    console.error('[SEED-CATALOGUE] ERREUR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
