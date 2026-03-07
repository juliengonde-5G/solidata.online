const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

// ══════ DPAV Trimestriel ══════

// GET /api/refashion/dpav
router.get('/dpav', async (req, res) => {
  try {
    const { annee } = req.query;
    let query = 'SELECT * FROM refashion_dpav';
    const params = [];
    if (annee) { params.push(annee); query += ' WHERE annee = $1'; }
    query += ' ORDER BY annee DESC, trimestre DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[REFASHION] Erreur DPAV :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/refashion/dpav
router.post('/dpav', async (req, res) => {
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
    const { annee, trimestre } = req.query;
    let query = 'SELECT * FROM refashion_communes WHERE 1=1';
    const params = [];
    if (annee) { params.push(annee); query += ` AND annee = $${params.length}`; }
    if (trimestre) { params.push(trimestre); query += ` AND trimestre = $${params.length}`; }
    query += ' ORDER BY commune';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[REFASHION] Erreur communes :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/refashion/communes
router.post('/communes', async (req, res) => {
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
    const { annee } = req.query;
    let query = 'SELECT * FROM refashion_subventions';
    const params = [];
    if (annee) { params.push(annee); query += ' WHERE annee = $1'; }
    query += ' ORDER BY annee DESC, trimestre DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[REFASHION] Erreur subventions :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/refashion/subventions — Calcul automatique
router.post('/subventions', async (req, res) => {
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
