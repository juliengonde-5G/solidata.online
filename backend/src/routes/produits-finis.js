const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
// Générateur partagé avec la voie « étiquette » (item 32) — même code-barres v2
// généré, même validation de combinaison, created_by + source systématiques.
const { generateProduitFini, validerCorpsGeneration, repondreErreurGeneration } = require('./etiquettes');
const { formeLisible } = require('../utils/codification-etiquettes');

router.use(authenticate, authorize('ADMIN'));

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
    // Forme lisible du code (« 3-1-2A-02-2-00001F » ; un ancien code reste tel quel).
    res.json(result.rows.map((r) => ({ ...r, code_lisible: formeLisible(r.code_barre) })));
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

// POST /api/produits-finis — Voie manuelle (item 32, codification v2 en 2.57.0)
// Même corps et même générateur que la voie étiquette (POST /etiquettes/generer) :
// { poste_id, gamme, categorie_eco_org, produit_id, genre, saison, poids_kg, batch_id? }.
// La combinaison est validée CÔTÉ SERVEUR par le générateur partagé, code-barres
// v2 généré (jamais saisi), created_by + source='manuel'.
router.post('/', async (req, res) => {
  const v = validerCorpsGeneration(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error, code: 'PARAMETRES' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { carton } = await generateProduitFini(client, {
      ...v.valeurs, created_by: req.user.id ?? null, source: 'manuel',
    });
    await client.query('COMMIT');
    res.status(201).json(carton);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    repondreErreurGeneration(res, err);
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
