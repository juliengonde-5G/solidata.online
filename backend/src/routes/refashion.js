const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

// ══════ DPAV Trimestriel ══════

// GET /api/refashion/dpav — Synthèse DPAV pour un trimestre
router.get('/dpav', async (req, res) => {
  try {
    const year = req.query.year || req.query.annee || new Date().getFullYear();
    const quarter = req.query.quarter || req.query.trimestre || Math.ceil((new Date().getMonth() + 1) / 3);

    const dpavRes = await pool.query(
      'SELECT * FROM refashion_dpav WHERE annee = $1 AND trimestre = $2',
      [year, quarter]
    );

    const communesRes = await pool.query(
      'SELECT COUNT(DISTINCT commune)::int as nb FROM refashion_communes WHERE annee = $1 AND trimestre = $2',
      [year, quarter]
    );

    const dpav = dpavRes.rows[0] || {};
    const reemploi = dpav.ventes_reemploi_t || 0;
    const recyclage = dpav.ventes_recyclage_t || 0;
    const csr = dpav.csr_t || 0;
    const energie = dpav.energie_t || 0;
    const entree = dpav.achats_t || 0;

    const taux = { reemploi: 80, recyclage: 295, csr: 210, energie: 20, entree: 193 };

    const details = [
      { categorie: 'Réemploi', tonnage: reemploi, taux: taux.reemploi, subvention: reemploi * taux.reemploi },
      { categorie: 'Recyclage', tonnage: recyclage, taux: taux.recyclage, subvention: recyclage * taux.recyclage },
      { categorie: 'CSR', tonnage: csr, taux: taux.csr, subvention: csr * taux.csr },
      { categorie: 'Énergie', tonnage: energie, taux: taux.energie, subvention: energie * taux.energie },
      { categorie: 'Entrée', tonnage: entree, taux: taux.entree, subvention: entree * taux.entree },
    ];

    const total_t = reemploi + recyclage + csr + energie + entree;
    const total_subvention = details.reduce((s, d) => s + d.subvention, 0);

    res.json({
      reemploi_t: reemploi,
      recyclage_t: recyclage,
      csr_t: csr,
      energie_t: energie,
      entree_t: entree,
      total_t,
      total_subvention,
      nb_communes: communesRes.rows[0]?.nb || 0,
      details,
      raw: dpav,
    });
  } catch (err) {
    console.error('[REFASHION] Erreur DPAV :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/refashion/dpav
router.post('/dpav', [
  body('annee').isInt().withMessage('Année requise (valeur numérique)'),
  body('trimestre').isInt({ min: 1, max: 4 }).withMessage('Trimestre requis (1-4)'),
], validate, async (req, res) => {
  try {
    const { annee, trimestre, stock_debut_t, stock_fin_t, achats_t,
      ventes_reemploi_t, ventes_recyclage_t, csr_t, energie_t, tri_t, conformite_cdc, notes } = req.body;

    const result = await pool.query(
      `INSERT INTO refashion_dpav (annee, trimestre, stock_debut_t, stock_fin_t, achats_t,
       ventes_reemploi_t, ventes_recyclage_t, csr_t, energie_t, tri_t, conformite_cdc, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (annee, trimestre) DO UPDATE SET
       stock_debut_t = $3, stock_fin_t = $4, achats_t = $5, ventes_reemploi_t = $6,
       ventes_recyclage_t = $7, csr_t = $8, energie_t = $9, tri_t = $10,
       conformite_cdc = $11, notes = $12 RETURNING *`,
      [annee, trimestre, stock_debut_t, stock_fin_t, achats_t,
       ventes_reemploi_t, ventes_recyclage_t, csr_t, energie_t, tri_t, conformite_cdc, notes]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[REFASHION] Erreur saisie DPAV :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════ Communes ══════

// GET /api/refashion/communes
router.get('/communes', async (req, res) => {
  try {
    // Retourner les communes distinctes avec nb de CAV associés
    const result = await pool.query(`
      SELECT DISTINCT ON (rc.commune)
        rc.id, rc.commune as nom, rc.code_postal as code_insee,
        rc.poids_kg,
        (SELECT COUNT(*)::int FROM cav WHERE commune ILIKE rc.commune) as nb_cav,
        true as has_convention
      FROM refashion_communes rc
      ORDER BY rc.commune, rc.annee DESC, rc.trimestre DESC
    `);
    res.json(result.rows);
  } catch (err) {
    // Si la table cav n'existe pas, fallback simple
    try {
      const result = await pool.query(
        'SELECT DISTINCT commune as nom, code_postal as code_insee FROM refashion_communes ORDER BY commune'
      );
      res.json(result.rows.map(r => ({ ...r, nb_cav: 0, has_convention: true })));
    } catch {
      console.error('[REFASHION] Erreur communes :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
});

// POST /api/refashion/communes
router.post('/communes', [
  body('annee').isInt().withMessage('Année requise'),
  body('trimestre').isInt({ min: 1, max: 4 }).withMessage('Trimestre requis (1-4)'),
  body('commune').notEmpty().withMessage('Commune requise'),
], validate, async (req, res) => {
  try {
    const { annee, trimestre, commune, code_postal, poids_kg } = req.body;
    const result = await pool.query(
      `INSERT INTO refashion_communes (annee, trimestre, commune, code_postal, poids_kg)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (annee, trimestre, commune) DO UPDATE SET poids_kg = $5, code_postal = $4
       RETURNING *`,
      [annee, trimestre, commune, code_postal, poids_kg]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[REFASHION] Erreur commune :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════ Subventions ══════

// GET /api/refashion/subventions
router.get('/subventions', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT *, annee as year, trimestre as quarter, montant_total as montant FROM refashion_subventions ORDER BY annee DESC, trimestre DESC'
    );
    // Add status field if missing
    const rows = result.rows.map(r => ({
      ...r,
      status: r.status || (r.montant_total > 0 ? 'pending' : 'draft'),
      date_versement: r.date_versement || null,
    }));
    res.json(rows);
  } catch (err) {
    console.error('[REFASHION] Erreur subventions :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/refashion/subventions — Calcul automatique
router.post('/subventions', [
  body('annee').isInt().withMessage('Année requise'),
  body('trimestre').isInt({ min: 1, max: 4 }).withMessage('Trimestre requis (1-4)'),
], validate, async (req, res) => {
  try {
    const { annee, trimestre, tonnage_reemploi, tonnage_recyclage, tonnage_csr,
      tonnage_energie, tonnage_entree, part_non_tlc,
      taux_reemploi_euro_t, taux_recyclage_euro_t, taux_csr_euro_t,
      taux_energie_euro_t, taux_entree_euro_t } = req.body;

    const tr = taux_reemploi_euro_t || 80;
    const trec = taux_recyclage_euro_t || 295;
    const tcsr = taux_csr_euro_t || 210;
    const te = taux_energie_euro_t || 20;
    const tent = taux_entree_euro_t || 193;

    const montant_reemploi = (tonnage_reemploi || 0) * tr;
    const montant_recyclage = (tonnage_recyclage || 0) * trec;
    const montant_csr = (tonnage_csr || 0) * tcsr;
    const montant_energie = (tonnage_energie || 0) * te;
    const montant_entree = (tonnage_entree || 0) * tent;
    const montant_total = montant_reemploi + montant_recyclage + montant_csr + montant_energie + montant_entree;

    const result = await pool.query(
      `INSERT INTO refashion_subventions (annee, trimestre,
       taux_reemploi_euro_t, taux_recyclage_euro_t, taux_csr_euro_t, taux_energie_euro_t, taux_entree_euro_t,
       tonnage_reemploi, tonnage_recyclage, tonnage_csr, tonnage_energie, tonnage_entree, part_non_tlc,
       montant_reemploi, montant_recyclage, montant_csr, montant_energie, montant_entree, montant_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (annee, trimestre) DO UPDATE SET
       taux_reemploi_euro_t=$3, taux_recyclage_euro_t=$4, taux_csr_euro_t=$5,
       taux_energie_euro_t=$6, taux_entree_euro_t=$7,
       tonnage_reemploi=$8, tonnage_recyclage=$9, tonnage_csr=$10,
       tonnage_energie=$11, tonnage_entree=$12, part_non_tlc=$13,
       montant_reemploi=$14, montant_recyclage=$15, montant_csr=$16,
       montant_energie=$17, montant_entree=$18, montant_total=$19
       RETURNING *`,
      [annee, trimestre, tr, trec, tcsr, te, tent,
       tonnage_reemploi || 0, tonnage_recyclage || 0, tonnage_csr || 0,
       tonnage_energie || 0, tonnage_entree || 0, part_non_tlc || 0,
       Math.round(montant_reemploi * 100) / 100, Math.round(montant_recyclage * 100) / 100,
       Math.round(montant_csr * 100) / 100, Math.round(montant_energie * 100) / 100,
       Math.round(montant_entree * 100) / 100, Math.round(montant_total * 100) / 100]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[REFASHION] Erreur subventions calc :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
