const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');

// ══════════════════════════════════════════
// TARES DES CONTENANTS (référentiel serveur)
// ══════════════════════════════════════════
const CONTENANTS_TARES = {
  bac_metal: 80,
  bac_metal_jaune: 145,
  geobox_rouge: 38,
  geobox_noir: 44,
  chariot_grillagee: 98,
  chariot_curon_petit: 55,
  chariot_curon_grand: 90,
  palette_eur: 22,
  demi_palette: 7,
  poubelle_4roues: 39,
  chariot_pal: 120,
  petite_poubelle: 6,
  sans_contenant: 0,
  tare_manuelle: null
};

// ══════════════════════════════════════════
// ENDPOINTS PUBLICS BALANCE (sans authentification)
// Définis AVANT router.use(authenticate) pour bypasser l'auth
// ══════════════════════════════════════════

// POST /api/stock-original/balance-entree — Entrée balance publique
router.post('/balance-entree', async (req, res) => {
  try {
    const { date, origine, poids_brut_kg, contenant, tare_kg, operateur } = req.body;

    if (!date || !origine || poids_brut_kg == null || !contenant) {
      return res.status(400).json({ error: 'Champs requis : date, origine, poids_brut_kg, contenant' });
    }
    if (!['apport_volontaire', 'retour'].includes(origine)) {
      return res.status(400).json({ error: 'Origine invalide (apport_volontaire ou retour)' });
    }
    if (!Object.keys(CONTENANTS_TARES).includes(contenant)) {
      return res.status(400).json({ error: 'Contenant invalide' });
    }

    let tare;
    if (contenant === 'tare_manuelle') {
      tare = parseFloat(tare_kg);
      if (isNaN(tare)) return res.status(400).json({ error: 'Tare manuelle requise et doit etre un nombre' });
    } else {
      tare = CONTENANTS_TARES[contenant];
    }

    const poidsBrut = parseFloat(poids_brut_kg);
    const poidsNet = poidsBrut - tare;

    if (poidsNet <= 0) {
      return res.status(400).json({ error: `Poids net invalide (${poidsBrut} - ${tare} = ${poidsNet}). Verifier la saisie.` });
    }

    const result = await pool.query(
      `INSERT INTO stock_original_movements
         (type, date, poids_kg, poids_brut_kg, tare_kg, origine, contenant, source, notes)
       VALUES ('entree', $1, $2, $3, $4, $5, $6, 'balance', $7) RETURNING *`,
      [date, poidsNet, poidsBrut, tare, origine, contenant, operateur || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[STOCK-ORIGINAL] Erreur balance-entree :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/stock-original/balance-sortie — Sortie balance publique
router.post('/balance-sortie', async (req, res) => {
  try {
    const { date, destination, poids_brut_kg, contenant, tare_kg, operateur } = req.body;

    const DESTINATIONS_VALIDES = ['atelier_tri', 'tri_preclasse', 'original_conditionne'];

    if (!date || !destination || poids_brut_kg == null || !contenant) {
      return res.status(400).json({ error: 'Champs requis : date, destination, poids_brut_kg, contenant' });
    }
    if (!DESTINATIONS_VALIDES.includes(destination)) {
      return res.status(400).json({ error: 'Destination invalide' });
    }
    if (!Object.keys(CONTENANTS_TARES).includes(contenant)) {
      return res.status(400).json({ error: 'Contenant invalide' });
    }

    let tare;
    if (contenant === 'tare_manuelle') {
      tare = parseFloat(tare_kg);
      if (isNaN(tare)) return res.status(400).json({ error: 'Tare manuelle requise et doit etre un nombre' });
    } else {
      tare = CONTENANTS_TARES[contenant];
    }

    const poidsBrut = parseFloat(poids_brut_kg);
    const poidsNet = poidsBrut - tare;

    if (poidsNet <= 0) {
      return res.status(400).json({ error: `Poids net invalide (${poidsBrut} - ${tare} = ${poidsNet}). Verifier la saisie.` });
    }

    const mvt = await pool.query(
      `INSERT INTO stock_original_movements
         (type, date, poids_kg, poids_brut_kg, tare_kg, destination, contenant, source, notes)
       VALUES ('sortie', $1, $2, $3, $4, $5, $6, 'balance', $7) RETURNING *`,
      [date, poidsNet, poidsBrut, tare, destination, contenant, operateur || null]
    );

    let produitFini = null;
    if (destination === 'tri_preclasse' || destination === 'original_conditionne') {
      const labels = { tri_preclasse: 'Tri pré-classé', original_conditionne: 'Original Conditionné' };
      const codeBarre = `PF-${Date.now()}`;
      const pfResult = await pool.query(
        `INSERT INTO produits_finis (code_barre, produit, poids_kg, date_fabrication)
         VALUES ($1, $2, $3, NOW()) RETURNING *`,
        [codeBarre, labels[destination], poidsNet]
      );
      produitFini = pfResult.rows[0];
    }

    res.status(201).json({ mouvement: mvt.rows[0], produit_fini: produitFini });
  } catch (err) {
    console.error('[STOCK-ORIGINAL] Erreur balance-sortie :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/stock-original/balance-historique — Historique balance du jour (public)
router.get('/balance-historique', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const result = await pool.query(`
      SELECT id, type, date, poids_kg, poids_brut_kg, tare_kg,
             origine, destination, contenant, source, notes, created_at
      FROM stock_original_movements
      WHERE source = 'balance'
        AND date = $1
      ORDER BY created_at DESC
    `, [date]);

    res.json(result.rows);
  } catch (err) {
    console.error('[STOCK-ORIGINAL] Erreur balance-historique :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// ROUTES AUTHENTIFIÉES (ADMIN / MANAGER)
// ══════════════════════════════════════════
router.use(authenticate, authorize('ADMIN', 'MANAGER'));
router.use(autoLogActivity('stock_original'));

// Helper : vérifier si un trimestre est verrouillé
async function isQuarterLocked(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const quarter = Math.ceil((d.getMonth() + 1) / 3);
  const result = await pool.query(
    'SELECT id FROM stock_period_locks WHERE year = $1 AND quarter = $2',
    [year, quarter]
  );
  return result.rows.length > 0;
}

function quarterLabel(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const quarter = Math.ceil((d.getMonth() + 1) / 3);
  return `Q${quarter} ${year}`;
}

// ══════════════════════════════════════════
// MOUVEMENTS
// ══════════════════════════════════════════

// GET /api/stock-original — Liste des mouvements avec filtres
router.get('/', async (req, res) => {
  try {
    const { type, date_from, date_to, origine, limit: lim } = req.query;
    let query = `SELECT som.*, u.first_name || ' ' || u.last_name as created_by_name
       FROM stock_original_movements som
       LEFT JOIN users u ON som.created_by = u.id WHERE 1=1`;
    const params = [];

    if (type) { params.push(type); query += ` AND som.type = $${params.length}`; }
    if (date_from) { params.push(date_from); query += ` AND som.date >= $${params.length}`; }
    if (date_to) { params.push(date_to); query += ` AND som.date <= $${params.length}`; }
    if (origine) { params.push(origine); query += ` AND som.origine = $${params.length}`; }

    query += ' ORDER BY som.date DESC, som.created_at DESC';
    if (lim) { params.push(parseInt(lim)); query += ` LIMIT $${params.length}`; }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[STOCK-ORIGINAL] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/stock-original/summary — Stock actuel + totaux
router.get('/summary', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'entree' THEN poids_kg ELSE 0 END), 0) as total_entrees_kg,
        COALESCE(SUM(CASE WHEN type = 'sortie' THEN poids_kg ELSE 0 END), 0) as total_sorties_kg,
        COALESCE(SUM(CASE WHEN type = 'regularisation' THEN poids_kg ELSE 0 END), 0) as total_regularisation_kg,
        COALESCE(SUM(
          CASE
            WHEN type = 'entree' THEN poids_kg
            WHEN type = 'sortie' THEN -poids_kg
            WHEN type = 'regularisation' THEN poids_kg
          END
        ), 0) as stock_actuel_kg
      FROM stock_original_movements
    `);

    const byOrigine = await pool.query(`
      SELECT origine, type,
        COUNT(*) as nb_mouvements,
        COALESCE(SUM(poids_kg), 0) as total_kg
      FROM stock_original_movements
      GROUP BY origine, type
      ORDER BY origine
    `);

    res.json({ ...result.rows[0], by_origine: byOrigine.rows });
  } catch (err) {
    console.error('[STOCK-ORIGINAL] Erreur summary :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/stock-original/evolution — Série temporelle pour graphique
router.get('/evolution', async (req, res) => {
  try {
    const { date_from, date_to, granularity } = req.query;
    const gran = ['day', 'week', 'month'].includes(granularity) ? granularity : 'day';

    let dateFilter = '';
    const params = [gran];

    if (date_from) { params.push(date_from); dateFilter += ` AND date >= $${params.length}`; }
    if (date_to) { params.push(date_to); dateFilter += ` AND date <= $${params.length}`; }

    const result = await pool.query(`
      WITH daily AS (
        SELECT date_trunc($1, date) as period,
          COALESCE(SUM(CASE WHEN type='entree' THEN poids_kg ELSE 0 END), 0) as entrees_kg,
          COALESCE(SUM(CASE WHEN type='sortie' THEN poids_kg ELSE 0 END), 0) as sorties_kg,
          COALESCE(SUM(CASE WHEN type='regularisation' THEN poids_kg ELSE 0 END), 0) as regularisations_kg
        FROM stock_original_movements
        WHERE 1=1 ${dateFilter}
        GROUP BY period ORDER BY period
      )
      SELECT period, entrees_kg, sorties_kg, regularisations_kg,
        SUM(entrees_kg - sorties_kg + regularisations_kg) OVER (ORDER BY period) as stock_cumule_kg
      FROM daily
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('[STOCK-ORIGINAL] Erreur evolution :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/stock-original/ledger — Grand livre ligne par ligne avec solde cumulé
router.get('/ledger', async (req, res) => {
  try {
    const { date_from, date_to, limit: lim } = req.query;
    const params = [];
    let dateFilter = '';

    if (date_from) { params.push(date_from); dateFilter += ` AND som.date >= $${params.length}`; }
    if (date_to) { params.push(date_to); dateFilter += ` AND som.date <= $${params.length}`; }

    const result = await pool.query(`
      SELECT som.id, som.type, som.date, som.poids_kg, som.origine, som.destination,
        som.notes, som.motif, som.tour_id, som.batch_id, som.expedition_id, som.created_at,
        u.first_name || ' ' || u.last_name as created_by_name,
        CASE
          WHEN som.type = 'entree' THEN som.poids_kg
          ELSE 0
        END as entree_kg,
        CASE
          WHEN som.type = 'sortie' THEN som.poids_kg
          ELSE 0
        END as sortie_kg,
        CASE
          WHEN som.type = 'regularisation' AND som.poids_kg >= 0 THEN som.poids_kg
          WHEN som.type = 'regularisation' AND som.poids_kg < 0 THEN 0
          ELSE 0
        END as regul_plus_kg,
        CASE
          WHEN som.type = 'regularisation' AND som.poids_kg < 0 THEN ABS(som.poids_kg)
          ELSE 0
        END as regul_moins_kg,
        SUM(
          CASE
            WHEN som.type = 'entree' THEN som.poids_kg
            WHEN som.type = 'sortie' THEN -som.poids_kg
            WHEN som.type = 'regularisation' THEN som.poids_kg
          END
        ) OVER (ORDER BY som.date ASC, som.id ASC) as solde_cumule_kg
      FROM stock_original_movements som
      LEFT JOIN users u ON som.created_by = u.id
      WHERE 1=1 ${dateFilter}
      ORDER BY som.date ASC, som.id ASC
      ${lim ? `LIMIT $${params.push(parseInt(lim)) && params.length}` : ''}
    `, params);

    // Totaux
    const totals = result.rows.length > 0 ? {
      total_entrees_kg: result.rows.reduce((s, r) => s + parseFloat(r.entree_kg), 0),
      total_sorties_kg: result.rows.reduce((s, r) => s + parseFloat(r.sortie_kg), 0),
      total_regul_plus_kg: result.rows.reduce((s, r) => s + parseFloat(r.regul_plus_kg), 0),
      total_regul_moins_kg: result.rows.reduce((s, r) => s + parseFloat(r.regul_moins_kg), 0),
      solde_final_kg: parseFloat(result.rows[result.rows.length - 1].solde_cumule_kg),
      nb_lignes: result.rows.length,
    } : {
      total_entrees_kg: 0, total_sorties_kg: 0, total_regul_plus_kg: 0,
      total_regul_moins_kg: 0, solde_final_kg: 0, nb_lignes: 0,
    };

    res.json({ lignes: result.rows, totaux: totals });
  } catch (err) {
    console.error('[STOCK-ORIGINAL] Erreur ledger :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/stock-original/pesee — Pesée manuelle (entrée)
router.post('/pesee', [
  body('date').notEmpty().withMessage('Date requise'),
  body('origine').isIn(['retour_vak', 'retour_magasin', 'apport_volontaire']).withMessage('Origine invalide'),
], validate, async (req, res) => {
  try {
    const { date, poids_kg, poids_brut_kg, tare_kg, origine, notes } = req.body;

    // Calcul poids net si brut/tare fournis
    let poidsNet = parseFloat(poids_kg);
    let poidsBrut = poids_brut_kg ? parseFloat(poids_brut_kg) : null;
    let tare = tare_kg ? parseFloat(tare_kg) : null;
    if (poidsBrut && tare) {
      poidsNet = poidsBrut - tare;
    }

    if (!poidsNet || poidsNet <= 0) {
      return res.status(400).json({ error: 'Poids net doit etre superieur a 0' });
    }

    // Vérifier verrouillage
    if (await isQuarterLocked(date)) {
      return res.status(403).json({
        error: 'Trimestre verrouille',
        details: `Le trimestre ${quarterLabel(date)} est verrouille et ne peut plus etre modifie.`
      });
    }

    const result = await pool.query(
      `INSERT INTO stock_original_movements (type, date, poids_kg, poids_brut_kg, tare_kg, origine, notes, created_by)
       VALUES ('entree', $1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [date, poidsNet, poidsBrut, tare, origine, notes, req.user.id]
    );

    // Audit
    await pool.query(
      `INSERT INTO stock_original_audit (movement_id, action, user_id) VALUES ($1, 'create', $2)`,
      [result.rows[0].id, req.user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[STOCK-ORIGINAL] Erreur pesee :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/stock-original/regularisation — Mouvement correctif (ADMIN only)
router.post('/regularisation', authorize('ADMIN'), [
  body('date').notEmpty().withMessage('Date requise'),
  body('poids_kg').isFloat().withMessage('Poids requis (peut etre negatif)'),
  body('motif').notEmpty().withMessage('Motif obligatoire'),
], validate, async (req, res) => {
  try {
    const { date, poids_kg, motif, notes } = req.body;

    if (await isQuarterLocked(date)) {
      return res.status(403).json({
        error: 'Trimestre verrouille',
        details: `Le trimestre ${quarterLabel(date)} est verrouille et ne peut plus etre modifie.`
      });
    }

    const result = await pool.query(
      `INSERT INTO stock_original_movements (type, date, poids_kg, origine, motif, notes, created_by)
       VALUES ('regularisation', $1, $2, 'regularisation', $3, $4, $5) RETURNING *`,
      [date, parseFloat(poids_kg), motif, notes, req.user.id]
    );

    await pool.query(
      `INSERT INTO stock_original_audit (movement_id, action, user_id) VALUES ($1, 'create', $2)`,
      [result.rows[0].id, req.user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[STOCK-ORIGINAL] Erreur regularisation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/stock-original/:id — Modifier un mouvement (ADMIN only)
router.put('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const { date, poids_kg, poids_brut_kg, tare_kg, notes, origine, destination } = req.body;

    // Récupérer le mouvement existant
    const existing = await pool.query('SELECT * FROM stock_original_movements WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Mouvement non trouve' });
    }
    const old = existing.rows[0];

    // Vérifier verrouillage de la date existante
    if (await isQuarterLocked(old.date)) {
      return res.status(403).json({
        error: 'Trimestre verrouille',
        details: `Le mouvement est dans le trimestre ${quarterLabel(old.date)} qui est verrouille.`
      });
    }

    // Si la date change, vérifier aussi le nouveau trimestre
    if (date && date !== old.date.toISOString().slice(0, 10)) {
      if (await isQuarterLocked(date)) {
        return res.status(403).json({
          error: 'Trimestre verrouille',
          details: `Le trimestre cible ${quarterLabel(date)} est verrouille.`
        });
      }
    }

    // Construire les champs à modifier et créer l'audit trail
    const fields = { date, poids_kg, poids_brut_kg, tare_kg, notes, origine, destination };
    const updates = [];
    const params = [];

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        const oldVal = old[key];
        const newVal = key === 'poids_kg' || key === 'poids_brut_kg' || key === 'tare_kg'
          ? parseFloat(value) : value;

        if (String(oldVal) !== String(newVal)) {
          params.push(newVal);
          updates.push(`${key} = $${params.length}`);

          // Audit trail pour chaque champ modifié
          await pool.query(
            `INSERT INTO stock_original_audit (movement_id, action, field_name, old_value, new_value, user_id)
             VALUES ($1, 'update', $2, $3, $4, $5)`,
            [req.params.id, key, String(oldVal), String(newVal), req.user.id]
          );
        }
      }
    }

    if (updates.length === 0) {
      return res.json(old);
    }

    updates.push('updated_at = NOW()');
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE stock_original_movements SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[STOCK-ORIGINAL] Erreur modification :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// VERROUILLAGE TRIMESTRIEL
// ══════════════════════════════════════════

// GET /api/stock-original/locks — Liste des verrous
router.get('/locks', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT spl.*, u.first_name || ' ' || u.last_name as locked_by_name
      FROM stock_period_locks spl
      LEFT JOIN users u ON spl.locked_by = u.id
      ORDER BY spl.year DESC, spl.quarter DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[STOCK-ORIGINAL] Erreur locks :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/stock-original/locks — Verrouiller un trimestre
router.post('/locks', authorize('ADMIN'), [
  body('year').isInt({ min: 2020, max: 2100 }).withMessage('Annee invalide'),
  body('quarter').isInt({ min: 1, max: 4 }).withMessage('Trimestre invalide (1-4)'),
], validate, async (req, res) => {
  try {
    const { year, quarter, notes } = req.body;

    const existing = await pool.query(
      'SELECT id FROM stock_period_locks WHERE year = $1 AND quarter = $2',
      [year, quarter]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: `Le trimestre Q${quarter} ${year} est deja verrouille` });
    }

    const result = await pool.query(
      `INSERT INTO stock_period_locks (year, quarter, locked_by, notes)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [year, quarter, req.user.id, notes]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[STOCK-ORIGINAL] Erreur verrouillage :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/stock-original/locks/:id — Deverrouiller (urgence)
router.delete('/locks/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM stock_period_locks WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Verrou non trouve' });
    }
    res.json({ message: `Trimestre Q${result.rows[0].quarter} ${result.rows[0].year} deverrouille`, ...result.rows[0] });
  } catch (err) {
    console.error('[STOCK-ORIGINAL] Erreur deverrouillage :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// AUDIT
// ══════════════════════════════════════════

// GET /api/stock-original/audit/:movementId — Historique audit d'un mouvement
router.get('/audit/:movementId', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT soa.*, u.first_name || ' ' || u.last_name as user_name
      FROM stock_original_audit soa
      LEFT JOIN users u ON soa.user_id = u.id
      WHERE soa.movement_id = $1
      ORDER BY soa.created_at DESC
    `, [req.params.movementId]);
    res.json(result.rows);
  } catch (err) {
    console.error('[STOCK-ORIGINAL] Erreur audit :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
