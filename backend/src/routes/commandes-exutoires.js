const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));
router.use(autoLogActivity('commande_exutoire'));

// ══════════════════════════════════════════
// Facteurs CO2 evite par type d'exutoire (t CO2eq / tonne textile)
// Source: Refashion / ADEME — Analyse de Cycle de Vie textile 2023
// ══════════════════════════════════════════
const FACTEURS_CO2 = {
  original:       3.169,  // Reemploi direct — evite production textile neuf
  csr:            0.121,  // Combustible Solide de Recuperation — substitution energetique fossile
  effilo_blanc:   0.500,  // Effilochage blanc — recyclage fibre (isolant, rembourrage)
  effilo_couleur: 0.500,  // Effilochage couleur — recyclage fibre
  jean:           0.500,  // Recyclage denim — effilochage fibre
  coton_blanc:    0.750,  // Chiffons essuyage industriel — substitution produit neuf
  coton_couleur:  0.750,  // Chiffons essuyage industriel — substitution produit neuf
};

// Helper: generate order reference
async function generateReference() {
  const year = new Date().getFullYear();
  const result = await pool.query(
    "SELECT MAX(reference) as last FROM commandes_exutoires WHERE reference LIKE $1",
    [`CMD-${year}-%`]
  );
  const last = result.rows[0].last;
  if (!last) return `CMD-${year}-0001`;
  const num = parseInt(last.split('-')[2]) + 1;
  return `CMD-${year}-${String(num).padStart(4, '0')}`;
}

// Fix bug L2 : ajout du statut `chargee` (accent retiré pour cohérence DB)
// utilisé par frontend/src/pages/ExutoiresCommandes.jsx dans le workflow
// en_preparation → chargee → expediee. Sans ça, le workflow est bloqué.
const STATUTS_VALIDES = [
  'en_attente',
  'confirmee',
  'en_preparation',
  'chargee',
  'expediee',
  'pesee_recue',
  'facturee',
  'cloturee',
  'annulee'
];

// GET /api/commandes-exutoires
router.get('/', async (req, res) => {
  try {
    const { statut, client_id, type_produit, date_from, date_to } = req.query;
    let query = `
      SELECT c.*, cl.raison_sociale
      FROM commandes_exutoires c
      JOIN clients_exutoires cl ON c.client_id = cl.id
      WHERE 1=1
    `;
    const params = [];

    if (statut) {
      params.push(statut);
      query += ` AND c.statut = $${params.length}`;
    }
    if (client_id) {
      params.push(client_id);
      query += ` AND c.client_id = $${params.length}`;
    }
    if (type_produit) {
      params.push(type_produit);
      query += ` AND $${params.length} = ANY(c.type_produit)`;
    }
    if (date_from) {
      params.push(date_from);
      query += ` AND c.date_commande >= $${params.length}`;
    }
    if (date_to) {
      params.push(date_to);
      query += ` AND c.date_commande <= $${params.length}`;
    }

    query += ' ORDER BY c.date_commande DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[COMMANDES-EXUTOIRES] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/commandes-exutoires/stats
router.get('/stats', async (req, res) => {
  try {
    const countByStatut = await pool.query(
      'SELECT statut, COUNT(*)::int as count FROM commandes_exutoires GROUP BY statut'
    );

    const totaux = await pool.query(
      'SELECT COALESCE(SUM(tonnage_prevu), 0) as total_tonnage_prevu, COALESCE(SUM(tonnage_prevu * prix_tonne), 0) as total_ca_prevu FROM commandes_exutoires'
    );

    res.json({
      count_by_statut: countByStatut.rows,
      total_tonnage_prevu: parseFloat(totaux.rows[0].total_tonnage_prevu),
      total_ca_prevu: parseFloat(totaux.rows[0].total_ca_prevu)
    });
  } catch (err) {
    console.error('[COMMANDES-EXUTOIRES] Erreur stats :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/commandes-exutoires/co2 — Emissions CO2 evitees par type d'exutoire
router.get('/co2', async (req, res) => {
  try {
    const { year, month } = req.query;
    const y = parseInt(year) || new Date().getFullYear();

    let dateFrom, dateTo;
    if (month) {
      const m = parseInt(month);
      dateFrom = `${y}-${String(m).padStart(2, '0')}-01`;
      dateTo = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    } else {
      dateFrom = `${y}-01-01`;
      dateTo = `${y + 1}-01-01`;
    }

    // Recuperer les commandes cloturees/facturees avec pesee_client (ou pesee_interne en fallback)
    const result = await pool.query(`
      SELECT c.id, c.reference, c.type_produit, c.tonnage_prevu,
             COALESCE(cp.pesee_client, pe.pesee_interne, c.tonnage_prevu) as tonnage_reel,
             cl.raison_sociale as client_nom
      FROM commandes_exutoires c
      JOIN clients_exutoires cl ON c.client_id = cl.id
      LEFT JOIN controles_pesee cp ON cp.commande_id = c.id
      LEFT JOIN preparations_expedition pe ON pe.commande_id = c.id
      WHERE c.statut IN ('pesee_recue', 'facturee', 'cloturee')
        AND c.date_commande >= $1 AND c.date_commande < $2
    `, [dateFrom, dateTo]);

    // Calculer CO2 par type
    const parType = {};
    let co2Total = 0;
    let tonnageTotal = 0;

    for (const cmd of result.rows) {
      const tonnage = parseFloat(cmd.tonnage_reel) || 0;
      const types = Array.isArray(cmd.type_produit) ? cmd.type_produit : [cmd.type_produit];
      // Repartir le tonnage equitablement entre les types
      const tonnageParType = tonnage / types.length;

      for (const type of types) {
        const facteur = FACTEURS_CO2[type] || 0;
        const co2 = tonnageParType * facteur;

        if (!parType[type]) {
          parType[type] = { type, tonnage: 0, co2_evite: 0, facteur, nb_commandes: 0 };
        }
        parType[type].tonnage += tonnageParType;
        parType[type].co2_evite += co2;
        parType[type].nb_commandes += 1;

        co2Total += co2;
        tonnageTotal += tonnageParType;
      }
    }

    // Arrondir
    const detail = Object.values(parType).map(d => ({
      ...d,
      tonnage: Math.round(d.tonnage * 1000) / 1000,
      co2_evite: Math.round(d.co2_evite * 1000) / 1000,
    })).sort((a, b) => b.co2_evite - a.co2_evite);

    // Facteur moyen pondere
    const facteurMoyen = tonnageTotal > 0 ? co2Total / tonnageTotal : 0;

    res.json({
      periode: month ? `${y}-${String(parseInt(month)).padStart(2, '0')}` : `${y}`,
      tonnage_total: Math.round(tonnageTotal * 1000) / 1000,
      co2_total_evite: Math.round(co2Total * 1000) / 1000,
      facteur_moyen: Math.round(facteurMoyen * 1000) / 1000,
      nb_commandes: result.rows.length,
      detail_par_type: detail,
      facteurs_reference: FACTEURS_CO2,
      source: 'Refashion / ADEME — ACV textile 2023',
    });
  } catch (err) {
    console.error('[COMMANDES-EXUTOIRES] Erreur CO2 :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/commandes-exutoires/:id
router.get('/:id', async (req, res) => {
  try {
    const orderResult = await pool.query(
      `SELECT c.*, cl.raison_sociale
       FROM commandes_exutoires c
       JOIN clients_exutoires cl ON c.client_id = cl.id
       WHERE c.id = $1`,
      [req.params.id]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Commande exutoire non trouvee' });
    }

    const order = orderResult.rows[0];

    const preparationResult = await pool.query(
      'SELECT * FROM preparations_expedition WHERE commande_id = $1',
      [req.params.id]
    );

    const controlePeseeResult = await pool.query(
      'SELECT * FROM controles_pesee WHERE commande_id = $1',
      [req.params.id]
    );

    const factureResult = await pool.query(
      'SELECT * FROM factures_exutoires WHERE commande_id = $1',
      [req.params.id]
    );

    res.json({
      ...order,
      preparation: preparationResult.rows[0] || null,
      controle_pesee: controlePeseeResult.rows[0] || null,
      facture: factureResult.rows[0] || null
    });
  } catch (err) {
    console.error('[COMMANDES-EXUTOIRES] Erreur detail :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/commandes-exutoires
router.post('/', [
  body('client_id').isInt().withMessage('ID client requis'),
  body('type_produit').notEmpty().withMessage('Type de produit requis'),
  body('date_commande').notEmpty().withMessage('Date de commande requise'),
  body('prix_tonne').isFloat({ min: 0 }).withMessage('Prix par tonne requis (valeur numérique)'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const { client_id, type_produit, date_commande, prix_tonne, tonnage_prevu, frequence, date_fin_recurrence, notes } = req.body;

    // Normalize type_produit to array
    const types = Array.isArray(type_produit) ? type_produit : [type_produit];

    await client.query('BEGIN');

    const reference = await generateReference();

    const result = await client.query(
      `INSERT INTO commandes_exutoires (reference, client_id, type_produit, date_commande, prix_tonne, tonnage_prevu, frequence, date_fin_recurrence, notes, statut)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'en_attente') RETURNING *`,
      [reference, client_id, types, date_commande, prix_tonne, tonnage_prevu || null, frequence || 'unique', date_fin_recurrence || null, notes || null]
    );

    await client.query(
      `INSERT INTO historique_commandes_exutoires (commande_id, ancien_statut, nouveau_statut, utilisateur_id)
       VALUES ($1, $2, $3, $4)`,
      [result.rows[0].id, null, 'en_attente', req.user.id]
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[COMMANDES-EXUTOIRES] Erreur creation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// PUT /api/commandes-exutoires/:id
router.put('/:id', async (req, res) => {
  try {
    const { client_id, type_produit, date_commande, prix_tonne, tonnage_prevu, frequence, date_fin_recurrence, notes } = req.body;

    // Normalize type_produit to array if provided
    const types = type_produit ? (Array.isArray(type_produit) ? type_produit : [type_produit]) : null;

    const result = await pool.query(
      `UPDATE commandes_exutoires SET
       client_id = COALESCE($1, client_id),
       type_produit = COALESCE($2, type_produit),
       date_commande = COALESCE($3, date_commande),
       prix_tonne = COALESCE($4, prix_tonne),
       tonnage_prevu = COALESCE($5, tonnage_prevu),
       frequence = COALESCE($6, frequence),
       date_fin_recurrence = COALESCE($7, date_fin_recurrence),
       notes = COALESCE($8, notes),
       updated_at = NOW()
       WHERE id = $9 RETURNING *`,
      [client_id, types, date_commande, prix_tonne, tonnage_prevu, frequence, date_fin_recurrence, notes, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Commande exutoire non trouvee' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[COMMANDES-EXUTOIRES] Erreur mise a jour :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/commandes-exutoires/:id/statut
router.patch('/:id/statut', [
  body('statut').isIn(['en_attente', 'confirmee', 'en_preparation', 'expediee', 'pesee_recue', 'facturee', 'cloturee', 'annulee']).withMessage('Statut invalide'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const { statut, commentaire } = req.body;

    if (!statut || !STATUTS_VALIDES.includes(statut)) {
      client.release();
      return res.status(400).json({ error: `Statut invalide. Valeurs acceptees : ${STATUTS_VALIDES.join(', ')}` });
    }

    await client.query('BEGIN');

    const current = await client.query('SELECT statut FROM commandes_exutoires WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: 'Commande exutoire non trouvee' });
    }

    const ancienStatut = current.rows[0].statut;

    const result = await client.query(
      'UPDATE commandes_exutoires SET statut = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [statut, req.params.id]
    );

    await client.query(
      `INSERT INTO historique_commandes_exutoires (commande_id, ancien_statut, nouveau_statut, commentaire, utilisateur_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, ancienStatut, statut, commentaire || null, req.user.id]
    );

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[COMMANDES-EXUTOIRES] Erreur changement statut :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// PATCH /api/commandes-exutoires/:id/annuler
router.patch('/:id/annuler', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query('SELECT statut FROM commandes_exutoires WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: 'Commande exutoire non trouvee' });
    }

    const ancienStatut = current.rows[0].statut;
    const statutsNonAnnulables = ['expediee', 'pesee_recue', 'facturee', 'cloturee'];

    if (statutsNonAnnulables.includes(ancienStatut)) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({ error: `Impossible d'annuler une commande au statut "${ancienStatut}"` });
    }

    const result = await client.query(
      'UPDATE commandes_exutoires SET statut = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      ['annulee', req.params.id]
    );

    await client.query(
      `INSERT INTO historique_commandes_exutoires (commande_id, ancien_statut, nouveau_statut, commentaire, utilisateur_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, ancienStatut, 'annulee', 'Annulation de la commande', req.user.id]
    );

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[COMMANDES-EXUTOIRES] Erreur annulation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

module.exports = router;
