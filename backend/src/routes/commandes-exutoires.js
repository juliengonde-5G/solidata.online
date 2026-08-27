const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');
const stateMachine = require('../services/state-machine');
const recurrence = require('../services/commandes-recurrence');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));
router.use(autoLogActivity('commande_exutoire'));

// ══════════════════════════════════════════
// Facteurs CO2 evite par type d'exutoire (t CO2eq / tonne textile)
// Source: Refashion / ADEME — Analyse de Cycle de Vie textile 2023
// ══════════════════════════════════════════
const FACTEURS_CO2 = {
  original:       3.169,  // Reemploi direct — evite production textile neuf
  csr:            0.121,  // Combustible Solide de Recuperation — substitution energetique fossile
  // Types courants (refonte gammes P1 : essuyage/tricot/merinos)
  essuyage:       0.750,  // Chiffons essuyage industriel — substitution produit neuf
  tricot:         0.500,  // Recyclage fibre tricot — effilochage
  merinos:        0.500,  // Recyclage fibre laine merinos — effilochage
  jean:           0.500,  // Recyclage denim — effilochage fibre
  coton_blanc:    0.750,  // Chiffons essuyage industriel — substitution produit neuf
  coton_couleur:  0.750,  // Chiffons essuyage industriel — substitution produit neuf
  // Types historiques (commandes anterieures a la refonte P1)
  effilo_blanc:   0.500,  // Effilochage blanc — recyclage fibre (isolant, rembourrage)
  effilo_couleur: 0.500,  // Effilochage couleur — recyclage fibre
};

// Helper: generate order reference
// `executor` permet d'appeler le générateur DANS une transaction (client pg) :
// sans cela, deux commandes créées dans la même transaction — cas de la
// génération des occurrences récurrentes — liraient toutes deux le MAX
// d'AVANT la transaction et produiraient la même référence (violation UNIQUE).
async function generateReference(executor = pool) {
  const year = new Date().getFullYear();
  const result = await executor.query(
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

// ══════════════════════════════════════════
// Item 38b — Garde stock sur le passage à « expediee ».
// Seule la préparation d'expédition (preparations.js, passage de la préparation
// à « expediee ») décrémente réellement le stock (INSERT stock_movements type
// 'sortie', code_barre = 'EXU-'+reference). Le raccourci de statut de la fiche
// commande (chargee → expediee) contournait ce chemin : la commande « avançait »
// sans jamais sortir la marchandise du stock → dérive silencieuse de l'inventaire.
// Ces deux helpers purs (testables sans DB) décident si une preuve de décrément
// est requise pour l'état cible, et si cette preuve est satisfaite.
function stockProofRequired(toState) {
  return toState === 'expediee';
}
function hasStockProof({ prepExpediee, stockSortie }) {
  return Boolean(prepExpediee) || Boolean(stockSortie);
}

// GET /api/commandes-exutoires
router.get('/', async (req, res) => {
  try {
    const { statut, client_id, type_produit, date_from, date_to } = req.query;
    // `reference_parent` / `nb_occurrences` : la récurrence n'a pas de colonne
    // « est_modèle » (statut DÉRIVÉ, contrat §12.7). L'écran a donc besoin de
    // savoir, pour chaque ligne, si elle EST un modèle (occurrences filles) ou
    // si elle a ÉTÉ générée par un modèle (référence du parent).
    // `creneau_a_poser` (correctif du 27/08) : une occurrence générée
    // automatiquement dont la préparation N'A PAS PU être posée (aucun gabarit,
    // créneau occupé) reste en `en_attente` — au kanban, elle est alors
    // indiscernable d'une commande en attente ordinaire, et le motif ne vivait
    // que dans le journal du job. Le drapeau est DÉRIVÉ (fille + aucune
    // préparation + pas encore engagée) : rien à stocker, donc rien qui puisse
    // se désynchroniser. Poser le créneau à la main l'éteint tout seul.
    let query = `
      SELECT c.*, cl.raison_sociale,
             parent.reference AS reference_parent,
             (SELECT COUNT(*)::int FROM commandes_exutoires f WHERE f.commande_parent_id = c.id) AS nb_occurrences,
             (c.commande_parent_id IS NOT NULL
              AND c.statut IN ('en_attente', 'confirmee')
              AND NOT EXISTS (SELECT 1 FROM preparations_expedition p WHERE p.commande_id = c.id)
             ) AS creneau_a_poser
      FROM commandes_exutoires c
      JOIN clients_exutoires cl ON c.client_id = cl.id
      LEFT JOIN commandes_exutoires parent ON parent.id = c.commande_parent_id
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

// ══════════════════════════════════════════
// RÉCURRENCE (lot L7, contrat §8.2)
// ──────────────────────────────────────────
// Constat à l'origine : `commandes_exutoires.frequence` était saisie à l'écran
// depuis la création de la table et RIEN ne la lisait — une commande déclarée
// « hebdomadaire » se comportait exactement comme une commande unique. Le
// moteur vit dans services/commandes-recurrence.js (fonctions pures testées
// sans base) ; ces routes ne font que l'exposer.
// ══════════════════════════════════════════

// POST /api/commandes-exutoires/recurrence/generer[?simulation=1]
// Déclenchement manuel de la génération (le job planifié appelle le MÊME
// service). `simulation=1` n'écrit rien : c'est l'aperçu avant application.
router.post('/recurrence/generer', async (req, res) => {
  try {
    const simulation = req.query.simulation === '1' || req.body?.simulation === true;
    const horizonBrut = req.query.horizon_jours ?? req.body?.horizon_jours;
    const horizonJours = horizonBrut != null && String(horizonBrut).trim() !== ''
      ? parseInt(String(horizonBrut), 10)
      : null;
    if (horizonBrut != null && String(horizonBrut).trim() !== '' && (!Number.isFinite(horizonJours) || horizonJours <= 0)) {
      return res.status(400).json({ error: 'Horizon invalide (nombre de jours > 0 attendu)', code: 'HORIZON_INVALIDE' });
    }

    const bilan = await recurrence.genererCommandesRecurrentes({ simulation, horizonJours });
    if (!bilan.ok) {
      // Le moteur ne jette pas : il rend son motif. On le transmet tel quel
      // plutôt que de le masquer derrière un « Erreur serveur ».
      return res.status(500).json({ error: bilan.motif || 'Génération impossible', code: 'RECURRENCE_ECHEC', ...bilan });
    }
    res.json(bilan);
  } catch (err) {
    console.error('[COMMANDES-EXUTOIRES] Erreur génération récurrence :', err);
    res.status(500).json({ error: 'Erreur serveur', code: 'ERREUR_SERVEUR' });
  }
});

// PATCH /api/commandes-exutoires/:id/recurrence — suspendre / reprendre.
// Seuls les MODÈLES sont concernés : suspendre une occurrence déjà générée
// n'aurait aucun effet (elle existe), et laisser croire le contraire serait
// pire que le refus.
router.patch('/:id/recurrence', [
  body('recurrence_suspendue').isBoolean().withMessage('recurrence_suspendue doit être un booléen'),
], validate, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Identifiant de commande invalide', code: 'ID_INVALIDE' });
    }
    const suspendue = req.body.recurrence_suspendue === true;

    const current = await pool.query(
      'SELECT id, reference, frequence, commande_parent_id, statut FROM commandes_exutoires WHERE id = $1',
      [id]
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Commande exutoire non trouvee', code: 'COMMANDE_INTROUVABLE' });
    }
    const cmd = current.rows[0];
    if (!recurrence.estModeleRecurrent(cmd)) {
      return res.status(409).json({
        error: cmd.commande_parent_id != null
          ? "Cette commande est une occurrence générée : la récurrence se pilote sur la commande d'origine."
          : "Cette commande n'est pas récurrente (fréquence « unique ») — il n'y a pas de récurrence à suspendre.",
        code: 'PAS_UN_MODELE_RECURRENT',
      });
    }

    const result = await pool.query(
      'UPDATE commandes_exutoires SET recurrence_suspendue = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [suspendue, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err && err.code === '42703') {
      // Colonne absente : base non migrée. Le dire, plutôt qu'un 500 opaque.
      return res.status(503).json({
        error: 'Récurrence indisponible : la base de données n\'est pas à jour (colonne recurrence_suspendue absente).',
        code: 'BASE_NON_MIGREE',
      });
    }
    console.error('[COMMANDES-EXUTOIRES] Erreur suspension récurrence :', err);
    res.status(500).json({ error: 'Erreur serveur', code: 'ERREUR_SERVEUR' });
  }
});

// GET /api/commandes-exutoires/:id/occurrences — filles matérialisées + état
// de la récurrence du modèle.
router.get('/:id/occurrences', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Identifiant de commande invalide', code: 'ID_INVALIDE' });
    }
    const current = await pool.query(
      `SELECT id, reference, frequence, commande_parent_id, date_commande, date_fin_recurrence, statut
         FROM commandes_exutoires WHERE id = $1`,
      [id]
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Commande exutoire non trouvee', code: 'COMMANDE_INTROUVABLE' });
    }
    const cmd = current.rows[0];

    const filles = await pool.query(
      `SELECT c.id, c.reference, c.date_commande, c.statut, c.tonnage_prevu,
              p.id AS preparation_id, p.date_expedition, p.statut_preparation
         FROM commandes_exutoires c
         LEFT JOIN preparations_expedition p ON p.commande_id = c.id
        WHERE c.commande_parent_id = $1
        ORDER BY c.date_commande`,
      [id]
    );

    // `prochaine_echeance` / `recurrence_suspendue` peuvent manquer sur une base
    // non migrée : on renvoie null + le motif plutôt qu'un faux « jamais ».
    let prochaine_echeance = null;
    let recurrence_suspendue = null;
    let motif_indisponible = null;
    try {
      const etat = await pool.query(
        'SELECT prochaine_echeance, recurrence_suspendue FROM commandes_exutoires WHERE id = $1',
        [id]
      );
      prochaine_echeance = etat.rows[0]?.prochaine_echeance ?? null;
      recurrence_suspendue = etat.rows[0]?.recurrence_suspendue ?? false;
    } catch (err) {
      if (err && err.code === '42703') motif_indisponible = 'base non à jour (colonnes de récurrence absentes)';
      else throw err;
    }

    res.json({
      commande_id: cmd.id,
      reference: cmd.reference,
      est_modele_recurrent: recurrence.estModeleRecurrent(cmd),
      frequence: cmd.frequence,
      frequence_libelle: recurrence.libelleFrequence(cmd.frequence),
      date_fin_recurrence: cmd.date_fin_recurrence,
      prochaine_echeance,
      recurrence_suspendue,
      motif_indisponible,
      occurrences: filles.rows,
    });
  } catch (err) {
    console.error('[COMMANDES-EXUTOIRES] Erreur occurrences :', err);
    res.status(500).json({ error: 'Erreur serveur', code: 'ERREUR_SERVEUR' });
  }
});

// GET /api/commandes-exutoires/:id
router.get('/:id', async (req, res) => {
  try {
    const orderResult = await pool.query(
      `SELECT c.*, cl.raison_sociale,
              parent.reference AS reference_parent,
              (SELECT COUNT(*)::int FROM commandes_exutoires f WHERE f.commande_parent_id = c.id) AS nb_occurrences
       FROM commandes_exutoires c
       JOIN clients_exutoires cl ON c.client_id = cl.id
       LEFT JOIN commandes_exutoires parent ON parent.id = c.commande_parent_id
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

    // Générateur appelé SUR la connexion de la transaction : lu depuis le pool,
    // le MAX ignorerait les lignes non encore commitées.
    const reference = await generateReference(client);

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
  body('statut').isIn(['en_attente', 'confirmee', 'en_preparation', 'chargee', 'expediee', 'pesee_recue', 'facturee', 'cloturee', 'annulee']).withMessage('Statut invalide'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const { statut, commentaire } = req.body;

    if (!statut || !STATUTS_VALIDES.includes(statut)) {
      // Release géré par le finally (pas de release manuel → évite le double release).
      return res.status(400).json({ error: `Statut invalide. Valeurs acceptees : ${STATUTS_VALIDES.join(', ')}` });
    }

    await client.query('BEGIN');

    const current = await client.query('SELECT statut, reference FROM commandes_exutoires WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      // Release géré par le finally (pas de release manuel → évite le double release).
      return res.status(404).json({ error: 'Commande exutoire non trouvee' });
    }

    const ancienStatut = current.rows[0].statut;

    // V6.1 — Validation transition via le moteur centralisé.
    // Avant : tout statut accepté tant qu'il était dans STATUTS_VALIDES,
    // ce qui permettait des sauts illégaux (ex: en_attente → expediee
    // direct, sautant confirmation/préparation/chargement).
    const check = stateMachine.canTransition({
      machine: 'commande_exutoire',
      fromState: ancienStatut,
      toState: statut,
      userRole: req.user?.role,
    });
    if (!check.ok) {
      await client.query('ROLLBACK');
      // Release géré par le finally (pas de release manuel → évite le double release).
      return res.status(409).json({ error: check.reason, code: check.code });
    }

    // Item 38b — Garde stock : marquer « expediee » exige une preuve que la
    // marchandise est réellement sortie du stock. La transition chargee→expediee
    // est légale au niveau de la machine à états, mais le raccourci de la fiche
    // commande ne crée aucun mouvement de stock. On n'accepte donc « expediee »
    // que si une préparation liée est déjà « expediee » OU si un mouvement de
    // stock de sortie lié existe. Sinon 409 : l'utilisateur doit passer par la
    // préparation d'expédition (seul chemin qui décrémente le stock).
    if (stockProofRequired(statut)) {
      const preuve = await client.query(
        `SELECT
           EXISTS (SELECT 1 FROM preparations_expedition
                   WHERE commande_id = $1 AND statut_preparation = 'expediee') AS prep_expediee,
           EXISTS (SELECT 1 FROM stock_movements
                   WHERE type = 'sortie' AND code_barre = $2) AS stock_sortie`,
        [req.params.id, 'EXU-' + current.rows[0].reference]
      );
      const preuveRow = preuve.rows[0] || {};
      if (!hasStockProof({ prepExpediee: preuveRow.prep_expediee, stockSortie: preuveRow.stock_sortie })) {
        await client.query('ROLLBACK');
        // Release géré par le finally (pas de release manuel → évite le double release).
        return res.status(409).json({
          error: "Passez par la préparation d'expédition — le stock n'a pas été décrémenté.",
          code: 'STOCK_NON_DECREMENTE',
        });
      }
    }

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

    // Audit centralisé state machine (post-commit, best effort).
    stateMachine.transition({
      machine: 'commande_exutoire',
      entityType: 'commandes_exutoires',
      entityId: parseInt(req.params.id, 10),
      fromState: ancienStatut,
      toState: statut,
      userId: req.user.id,
      userRole: req.user?.role,
      reason: commentaire || null,
    }).catch(() => { /* déjà loggé en métier */ });

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
      // Release géré par le finally (pas de release manuel → évite le double release).
      return res.status(404).json({ error: 'Commande exutoire non trouvee' });
    }

    const ancienStatut = current.rows[0].statut;
    const statutsNonAnnulables = ['expediee', 'pesee_recue', 'facturee', 'cloturee'];

    if (statutsNonAnnulables.includes(ancienStatut)) {
      await client.query('ROLLBACK');
      // Release géré par le finally (pas de release manuel → évite le double release).
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
// Helpers purs exposés pour les tests unitaires (item 38b — garde stock « expediee »)
module.exports.stockProofRequired = stockProofRequired;
module.exports.hasStockProof = hasStockProof;
// Générateur de référence partagé : services/commandes-recurrence.js le RÉUTILISE
// (contrat §8.1 « réutilisé, pas recopié ») pour que les occurrences générées
// portent la même numérotation CMD-AAAA-NNNN que les commandes saisies à la main.
module.exports.generateReference = generateReference;
