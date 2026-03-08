const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('ADMIN', 'MANAGER', 'AUTORITE'));

// GET /api/historique/tonnages — Résumé tonnages par mois/année
router.get('/tonnages', async (req, res) => {
  try {
    const { annee, section } = req.query;
    let query = `
      SELECT annee, mois, section, categorie, valeur
      FROM historique_mensuel
      WHERE 1=1
    `;
    const params = [];
    if (annee) { params.push(parseInt(annee)); query += ` AND annee = $${params.length}`; }
    if (section) { params.push(section); query += ` AND section = $${params.length}`; }
    query += ' ORDER BY annee, mois, categorie';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[HISTORIQUE] Erreur tonnages :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/historique/tonnages/summary — Synthèse annuelle avec totaux par catégorie
router.get('/tonnages/summary', async (req, res) => {
  try {
    const { annee } = req.query;
    let query = `
      SELECT annee, section, categorie,
        SUM(valeur) as total_annuel,
        jsonb_object_agg(
          CASE mois
            WHEN 1 THEN 'jan' WHEN 2 THEN 'fev' WHEN 3 THEN 'mar'
            WHEN 4 THEN 'avr' WHEN 5 THEN 'mai' WHEN 6 THEN 'jun'
            WHEN 7 THEN 'jul' WHEN 8 THEN 'aou' WHEN 9 THEN 'sep'
            WHEN 10 THEN 'oct' WHEN 11 THEN 'nov' WHEN 12 THEN 'dec'
          END,
          valeur
        ) as mensuel
      FROM historique_mensuel
      WHERE section IN ('tonnages', 'sous_totaux_tonnages')
    `;
    const params = [];
    if (annee) { params.push(parseInt(annee)); query += ` AND annee = $${params.length}`; }
    query += ' GROUP BY annee, section, categorie ORDER BY annee, section, categorie';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[HISTORIQUE] Erreur summary :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/historique/produits — Synthèse produits fabriqués par mois/année
router.get('/produits', async (req, res) => {
  try {
    const { annee } = req.query;
    let query = `
      SELECT annee, section, categorie,
        SUM(valeur) as total_annuel,
        jsonb_object_agg(
          CASE mois
            WHEN 1 THEN 'jan' WHEN 2 THEN 'fev' WHEN 3 THEN 'mar'
            WHEN 4 THEN 'avr' WHEN 5 THEN 'mai' WHEN 6 THEN 'jun'
            WHEN 7 THEN 'jul' WHEN 8 THEN 'aou' WHEN 9 THEN 'sep'
            WHEN 10 THEN 'oct' WHEN 11 THEN 'nov' WHEN 12 THEN 'dec'
          END,
          valeur
        ) as mensuel
      FROM historique_mensuel
      WHERE section IN ('produits_fabriques', 'produits_sorties', 'gamme_fabriques', 'gamme_sorties')
    `;
    const params = [];
    if (annee) { params.push(parseInt(annee)); query += ` AND annee = $${params.length}`; }
    query += ' GROUP BY annee, section, categorie ORDER BY annee, section, categorie';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[HISTORIQUE] Erreur produits :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/historique/produits-finis/stats — Stats produits finis importés (SaisiesP)
router.get('/produits-finis/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        EXTRACT(YEAR FROM date_fabrication)::int as annee,
        EXTRACT(MONTH FROM date_fabrication)::int as mois,
        gamme,
        categorie_eco_org,
        COUNT(*) as nb_produits,
        ROUND(SUM(poids_kg)::numeric, 1) as poids_total_kg,
        COUNT(CASE WHEN date_sortie IS NOT NULL THEN 1 END) as nb_sortis,
        COUNT(CASE WHEN date_sortie IS NULL THEN 1 END) as nb_en_stock
      FROM produits_finis
      GROUP BY annee, mois, gamme, categorie_eco_org
      ORDER BY annee, mois, gamme
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[HISTORIQUE] Erreur stats produits-finis :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/historique/kpi — KPIs globaux historiques pour le dashboard
router.get('/kpi', async (req, res) => {
  try {
    // Tonnage collecté par année
    const collecte = await pool.query(`
      SELECT annee, SUM(valeur) as total_kg
      FROM historique_mensuel
      WHERE section = 'sous_totaux_tonnages'
        AND categorie = 'Collecte de CAV'
      GROUP BY annee ORDER BY annee
    `);

    // Tonnage trié par année
    const trie = await pool.query(`
      SELECT annee, SUM(valeur) as total_kg
      FROM historique_mensuel
      WHERE section = 'sous_totaux_tonnages'
        AND categorie LIKE 'Total Trié%'
      GROUP BY annee ORDER BY annee
    `);

    // Produits fabriqués par année (top-level categories only)
    const produits = await pool.query(`
      SELECT annee, SUM(valeur) as total
      FROM historique_mensuel
      WHERE section = 'produits_fabriques'
        AND categorie IN ('Textiles', 'Linge', 'Chaussures', 'Maroquinerie',
                          'Couettes et coussins', 'Rideaux', 'Textiles Professionnels', 'Jouets', 'Chiffons')
      GROUP BY annee ORDER BY annee
    `);

    // Produits sortis par année
    const sorties = await pool.query(`
      SELECT annee, SUM(valeur) as total
      FROM historique_mensuel
      WHERE section = 'produits_sorties'
        AND categorie IN ('Textiles', 'Linge', 'Chaussures', 'Maroquinerie',
                          'Couettes et coussins', 'Rideaux', 'Textiles Professionnels', 'Jouets', 'Chiffons')
      GROUP BY annee ORDER BY annee
    `);

    // Inventaire produits finis actuel
    const inventaire = await pool.query(`
      SELECT
        gamme,
        COUNT(*) as nb_produits,
        ROUND(SUM(poids_kg)::numeric, 1) as poids_total_kg,
        COUNT(CASE WHEN date_sortie IS NOT NULL THEN 1 END) as nb_sortis,
        COUNT(CASE WHEN date_sortie IS NULL THEN 1 END) as nb_en_stock
      FROM produits_finis
      GROUP BY gamme ORDER BY gamme
    `);

    // Années disponibles
    const annees = await pool.query(`
      SELECT DISTINCT annee FROM historique_mensuel ORDER BY annee
    `);

    res.json({
      collecte: collecte.rows,
      trie: trie.rows,
      produits_fabriques: produits.rows,
      produits_sorties: sorties.rows,
      inventaire: inventaire.rows,
      annees_disponibles: annees.rows.map(r => r.annee),
    });
  } catch (err) {
    console.error('[HISTORIQUE] Erreur KPI :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
