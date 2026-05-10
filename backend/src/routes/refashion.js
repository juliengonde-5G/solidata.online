const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

// ══════ DPAV Trimestriel ══════

async function getTauxAt(date) {
  const r = await pool.query(
    `SELECT taux_euro_par_tonne FROM refashion_taux_subvention
     WHERE valid_from <= $1 AND (valid_to IS NULL OR valid_to >= $1)
     ORDER BY valid_from DESC LIMIT 1`,
    [date]
  );
  return r.rowCount > 0 ? Number(r.rows[0].taux_euro_par_tonne) : null;
}

// GET /api/refashion/dpav — Synthèse DPAV pour un trimestre
router.get('/dpav', async (req, res) => {
  try {
    const year = req.query.year || req.query.annee || new Date().getFullYear();
    const quarter = req.query.quarter || req.query.trimestre || Math.ceil((new Date().getMonth() + 1) / 3);

    const dpavRes = await pool.query(
      `SELECT d.*, u1.username AS created_by_username, u2.username AS updated_by_username
       FROM refashion_dpav d
       LEFT JOIN users u1 ON d.created_by = u1.id
       LEFT JOIN users u2 ON d.updated_by = u2.id
       WHERE d.annee = $1 AND d.trimestre = $2`,
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
    const tri = dpav.tri_t || 0;

    // Tarif unique €/t entrant à la chaîne de tri, paramétré dans refashion_taux_subvention
    const refDate = `${year}-${String(quarter * 3).padStart(2, '0')}-15`;
    const tauxEntree = await getTauxAt(refDate);
    const total_subvention = tauxEntree != null ? tri * tauxEntree : null;

    const historyRes = await pool.query(
      `SELECT h.action, h.changed_at, u.username AS changed_by_username
       FROM refashion_dpav_history h
       LEFT JOIN users u ON h.changed_by = u.id
       WHERE h.annee = $1 AND h.trimestre = $2
       ORDER BY h.changed_at DESC LIMIT 20`,
      [year, quarter]
    );

    res.json({
      reemploi_t: reemploi,
      recyclage_t: recyclage,
      csr_t: csr,
      energie_t: energie,
      entree_t: entree,
      tri_t: tri,
      taux_entree_euro_par_tonne: tauxEntree,
      total_subvention,
      nb_communes: communesRes.rows[0]?.nb || 0,
      raw: dpav,
      history: historyRes.rows,
    });
  } catch (err) {
    console.error('[REFASHION] Erreur DPAV :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/refashion/dpav — avec audit-trail
router.post('/dpav', [
  body('annee').isInt().withMessage('Année requise (valeur numérique)'),
  body('trimestre').isInt({ min: 1, max: 4 }).withMessage('Trimestre requis (1-4)'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { annee, trimestre, stock_debut_t, stock_fin_t, achats_t,
      ventes_reemploi_t, ventes_recyclage_t, csr_t, energie_t, tri_t, conformite_cdc, notes } = req.body;

    const existing = await client.query(
      'SELECT id FROM refashion_dpav WHERE annee=$1 AND trimestre=$2',
      [annee, trimestre]
    );
    const action = existing.rowCount > 0 ? 'UPDATE' : 'INSERT';

    const result = await client.query(
      `INSERT INTO refashion_dpav (annee, trimestre, stock_debut_t, stock_fin_t, achats_t,
        ventes_reemploi_t, ventes_recyclage_t, csr_t, energie_t, tri_t, conformite_cdc, notes,
        created_by, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,NOW())
       ON CONFLICT (annee, trimestre) DO UPDATE SET
         stock_debut_t=$3, stock_fin_t=$4, achats_t=$5, ventes_reemploi_t=$6,
         ventes_recyclage_t=$7, csr_t=$8, energie_t=$9, tri_t=$10,
         conformite_cdc=$11, notes=$12, updated_by=$13, updated_at=NOW()
       RETURNING *`,
      [annee, trimestre, stock_debut_t, stock_fin_t, achats_t,
       ventes_reemploi_t, ventes_recyclage_t, csr_t, energie_t, tri_t, conformite_cdc, notes, req.user.id]
    );

    await client.query(
      `INSERT INTO refashion_dpav_history (dpav_id, annee, trimestre, action, snapshot, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [result.rows[0].id, annee, trimestre, action, JSON.stringify(result.rows[0]), req.user.id]
    );

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[REFASHION] Erreur saisie DPAV :', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ══════ Paramétrage taux subvention Refashion (P0-C) ══════

// GET /api/refashion/taux — historique des taux conventionnés
router.get('/taux', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*, u.username AS created_by_username
       FROM refashion_taux_subvention t
       LEFT JOIN users u ON t.created_by = u.id
       ORDER BY t.valid_from DESC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/refashion/taux/current
router.get('/taux/current', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const t = await getTauxAt(today);
    res.json({ taux_euro_par_tonne: t, valid_at: today });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/refashion/taux — ajout d'une convention/avenant
router.post('/taux', authorize('ADMIN'), [
  body('taux_euro_par_tonne').isFloat({ min: 0 }).withMessage('Taux requis (>= 0)'),
  body('valid_from').isISO8601().withMessage('valid_from requis (YYYY-MM-DD)'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { taux_euro_par_tonne, valid_from, valid_to, source_document, notes } = req.body;
    // Clôture automatique du précédent taux : si pas de valid_to, on l'aligne sur valid_from - 1
    await client.query(
      `UPDATE refashion_taux_subvention
       SET valid_to = ($1::date - INTERVAL '1 day')::date
       WHERE valid_to IS NULL AND valid_from < $1::date`,
      [valid_from]
    );
    const r = await client.query(
      `INSERT INTO refashion_taux_subvention
         (taux_euro_par_tonne, valid_from, valid_to, source_document, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [taux_euro_par_tonne, valid_from, valid_to || null, source_document || null, notes || null, req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json(r.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.patch('/taux/:id', authorize('ADMIN'), async (req, res) => {
  const { taux_euro_par_tonne, valid_from, valid_to, source_document, notes } = req.body || {};
  const sets = []; const vals = [];
  for (const [k, v] of [['taux_euro_par_tonne', taux_euro_par_tonne], ['valid_from', valid_from],
    ['valid_to', valid_to], ['source_document', source_document], ['notes', notes]]) {
    if (v !== undefined) { sets.push(`${k} = $${sets.length + 1}`); vals.push(v); }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Rien à modifier' });
  vals.push(req.params.id);
  try {
    const r = await pool.query(
      `UPDATE refashion_taux_subvention SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Introuvable' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Note : les endpoints d'agrément Refashion sur exutoires ont été retirés
// (P0-A abandonné, pas d'utilité métier). Les colonnes agrement_* sur
// exutoires sont conservées en DB pour ne pas perdre d'éventuelles
// données saisies mais ne sont plus exposées.

// ══════ Exports Dashboard 2026 (P1-C : QHSE permanent) ══════

function toCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(';'), ...rows.map(r => cols.map(c => escape(r[c])).join(';'))].join('\n');
}

const EXPORT_VIEWS = {
  'tonnage-annuel-tournee': 'vw_tonnage_annuel_tournee',
  'dpav-sortants': 'vw_dpav_sortants',
  'dpav-communes': 'vw_dpav_communes',
  'subvention-mensuelle': 'vw_subvention_refashion_mensuelle',
  'coherence-tri-filiere': 'vw_coherence_tri_filiere',
};

router.get('/exports/:slug', async (req, res) => {
  const view = EXPORT_VIEWS[req.params.slug];
  if (!view) return res.status(404).json({ error: 'Export inconnu' });
  try {
    const { annee, trimestre, format } = req.query;
    let sql = `SELECT * FROM ${view}`;
    const params = []; const filters = [];
    if (annee) { params.push(parseInt(annee)); filters.push(`annee = $${params.length}`); }
    if (trimestre && /^[1-4]$/.test(trimestre)) {
      params.push(parseInt(trimestre)); filters.push(`trimestre = $${params.length}`);
    }
    if (filters.length) sql += ' WHERE ' + filters.join(' AND ');
    const { rows } = await pool.query(sql, params);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.slug}.csv"`);
      return res.send(toCsv(rows));
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/exports', async (req, res) => {
  res.json(Object.keys(EXPORT_VIEWS).map(slug => ({
    slug,
    view: EXPORT_VIEWS[slug],
    csv_url: `/api/refashion/exports/${slug}?format=csv`,
    json_url: `/api/refashion/exports/${slug}`,
  })));
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

// ══════════════════════════════════════════
// V2 — Auto-sourcing DPAV depuis ERP
//
// Audit Direction (D2 + D7) + Enterprise Architect (Rupture #1).
// La déclaration trimestrielle Refashion s'appuie désormais sur les vues
// SQL `vw_tonnage_reconciliation_jour` et `vw_refashion_dpav_source` qui
// agrègent automatiquement (a) la collecte brute (tours.total_weight_kg)
// et (b) le tri brut entré (production_daily.entree_ligne_kg).
// La déclaration manuelle reste possible (cf. POST /dpav) mais peut être
// pré-remplie depuis cet endpoint puis validée par la Direction.
// ══════════════════════════════════════════

// GET /api/refashion/dpav-source?annee=2026&trimestre=1
// Retourne les valeurs ERP brutes pour pré-remplir le formulaire DPAV.
// Si annee/trimestre absents, retourne tous les trimestres disponibles.
router.get('/dpav-source', async (req, res) => {
  try {
    const { annee, trimestre } = req.query;
    let query = 'SELECT * FROM vw_refashion_dpav_source WHERE 1=1';
    const params = [];
    if (annee) { params.push(parseInt(annee)); query += ` AND annee = $${params.length}`; }
    if (trimestre) { params.push(parseInt(trimestre)); query += ` AND trimestre = $${params.length}`; }
    const result = await pool.query(query, params);

    // Détecter les écarts importants (>2 % ou >5 %) pour signaler à la Direction
    const decorated = result.rows.map((r) => ({
      ...r,
      ecart_severite:
        r.ecart_pct === null ? 'inconnu'
        : Math.abs(r.ecart_pct) <= 2 ? 'ok'
        : Math.abs(r.ecart_pct) <= 5 ? 'attention'
        : 'critique',
    }));

    res.json(decorated);
  } catch (err) {
    console.error('[REFASHION] Erreur dpav-source :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/refashion/reconciliation-jour?date_from=&date_to=
// Diagnostic fin : écart collecte ↔ tri jour par jour
router.get('/reconciliation-jour', async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    let query = 'SELECT * FROM vw_tonnage_reconciliation_jour WHERE 1=1';
    const params = [];
    if (date_from) { params.push(date_from); query += ` AND date >= $${params.length}`; }
    if (date_to)   { params.push(date_to);   query += ` AND date <= $${params.length}`; }
    query += ' ORDER BY date DESC LIMIT 365';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[REFASHION] Erreur reconciliation-jour :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
