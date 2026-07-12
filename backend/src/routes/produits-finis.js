const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
// Générateur partagé avec la voie « étiquette » (item 32) — même code-barres
// généré (base24 + compteur poste), mêmes champs, created_by + source systématiques.
const { generateProduitFini } = require('./etiquettes');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

// GET /api/produits-finis
router.get('/', async (req, res) => {
  try {
    const { gamme, categorie, date_from, date_to, limit: lim } = req.query;
    // Fix bug O2 : JOIN sur produits_catalogue pour fournir `produit_nom`
    // et `is_shipped` (fix bug O10, toujours vide auparavant).
    let query = `SELECT pf.*,
         e.nom as exutoire_nom,
         po.nom as poste_nom,
         pc.nom as produit_nom,
         (pf.date_sortie IS NOT NULL) as is_shipped
       FROM produits_finis pf
       LEFT JOIN exutoires e ON pf.exutoire_id = e.id
       LEFT JOIN postes_operation po ON pf.poste_id = po.id
       LEFT JOIN produits_catalogue pc ON pf.catalogue_id = pc.id
       WHERE 1=1`;
    const params = [];

    if (gamme) { params.push(gamme); query += ` AND pf.gamme = $${params.length}`; }
    if (categorie) { params.push(categorie); query += ` AND pf.categorie_eco_org = $${params.length}`; }
    if (date_from) { params.push(date_from); query += ` AND pf.date_fabrication >= $${params.length}`; }
    if (date_to) { params.push(date_to); query += ` AND pf.date_fabrication <= $${params.length}`; }

    query += ' ORDER BY pf.date_fabrication DESC';
    if (lim) { params.push(parseInt(lim)); query += ` LIMIT $${params.length}`; }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[PRODUITS-FINIS] Erreur :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/produits-finis/summary — Résumé par gamme
router.get('/summary', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT gamme, COUNT(*) as nb_produits, ROUND(SUM(poids_kg)::numeric, 1) as poids_total_kg,
       COUNT(CASE WHEN date_sortie IS NOT NULL THEN 1 END) as nb_sortis,
       COUNT(CASE WHEN date_sortie IS NULL THEN 1 END) as nb_en_stock
      FROM produits_finis
      GROUP BY gamme ORDER BY gamme
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[PRODUITS-FINIS] Erreur résumé :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/produits-finis — Voie manuelle (item 32)
// Harmonisée avec la voie étiquette : mêmes champs (poste + catalogue dérivé),
// code-barres GÉNÉRÉ (plus de saisie libre), created_by + source='manuel'.
router.post('/', [
  body('poste_id').notEmpty().withMessage('Poste requis'),
  body('produit').notEmpty().withMessage('Produit requis'),
  body('poids_kg').isFloat({ gt: 0 }).withMessage('Poids requis (> 0)'),
], validate, async (req, res) => {
  const { poste_id, produit, categorie_eco_org, genre, saison, gamme, poids_kg, batch_id } = req.body;
  if (!poste_id || !produit || !categorie_eco_org || !genre || !gamme || !poids_kg || Number(poids_kg) <= 0) {
    return res.status(400).json({ error: 'poste_id, produit, categorie_eco_org, genre, gamme et poids_kg (>0) requis' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { row, poste_label } = await generateProduitFini(client, {
      poste_id, produit, categorie_eco_org, genre, saison: saison || 'Sans Saison', gamme,
      poids_kg, batch_id, created_by: req.user.id, source: 'manuel',
    });
    await client.query('COMMIT');
    res.status(201).json({ ...row, poste_label });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.pfStatus) return res.status(err.pfStatus).json({ error: err.message });
    if (err.code === '23505') return res.status(409).json({ error: 'Code-barres déjà existant' });
    console.error('[PRODUITS-FINIS] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// GET /api/produits-finis/scan/:codeBarre — Scan code-barres
router.get('/scan/:codeBarre', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM produits_finis WHERE code_barre = $1',
      [req.params.codeBarre]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Produit non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PRODUITS-FINIS] Erreur scan :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/produits-finis/:id/sortie — Enregistrer sortie vers exutoire
router.put('/:id/sortie', async (req, res) => {
  try {
    const { exutoire_id } = req.body;
    const result = await pool.query(
      'UPDATE produits_finis SET date_sortie = NOW(), exutoire_id = $1 WHERE id = $2 RETURNING *',
      [exutoire_id, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Produit non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PRODUITS-FINIS] Erreur sortie :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
