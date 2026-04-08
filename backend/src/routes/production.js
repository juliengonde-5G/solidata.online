const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));
router.use(autoLogActivity('production'));

// ══════════════════════════════════════════
// PRODUCTION DAILY — KPI journaliers
// ══════════════════════════════════════════

// GET /api/production — Liste KPI journaliers
router.get('/', async (req, res) => {
  try {
    const { month, date_from, date_to } = req.query;
    let query = 'SELECT * FROM production_daily WHERE 1=1';
    const params = [];

    if (month) {
      params.push(month + '-01');
      params.push(month + '-31');
      query += ` AND date BETWEEN $${params.length - 1} AND $${params.length}`;
    }
    if (date_from) { params.push(date_from); query += ` AND date >= $${params.length}`; }
    if (date_to) { params.push(date_to); query += ` AND date <= $${params.length}`; }

    query += ' ORDER BY date DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[PRODUCTION] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/production/dashboard — KPIs du mois
router.get('/dashboard', async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);

    const result = await pool.query(`
      SELECT
        COUNT(*) as jours_travailles,
        ROUND(AVG(effectif_reel)::numeric, 1) as effectif_moyen,
        ROUND(SUM(entree_ligne_kg)::numeric, 0) as total_entree_ligne_kg,
        ROUND(SUM(entree_recyclage_r3_kg)::numeric, 0) as total_entree_r3_kg,
        ROUND(SUM(total_jour_t)::numeric, 2) as total_mois_t,
        ROUND(AVG(productivite_kg_per)::numeric, 0) as productivite_moyenne,
        ROUND(AVG(entree_ligne_kg)::numeric, 0) as moyenne_entree_ligne,
        ROUND(AVG(entree_recyclage_r3_kg)::numeric, 0) as moyenne_entree_r3
      FROM production_daily
      WHERE date BETWEEN $1 AND $2
    `, [month + '-01', month + '-31']);

    const daily = await pool.query(
      'SELECT date, entree_ligne_kg, objectif_entree_ligne_kg, entree_recyclage_r3_kg, objectif_entree_r3_kg, total_jour_t, productivite_kg_per, effectif_reel FROM production_daily WHERE date BETWEEN $1 AND $2 ORDER BY date',
      [month + '-01', month + '-31']
    );

    // Objectif mensuel : 46.8t (22 jours) ou 41.6t (mois court)
    const joursOuvres = parseInt(result.rows[0].jours_travailles) || 0;
    const objectifMensuel = joursOuvres >= 22 ? 46.8 : 41.6;
    const totalMois = parseFloat(result.rows[0].total_mois_t) || 0;

    res.json({
      summary: result.rows[0],
      daily: daily.rows,
      objectif_mensuel_t: objectifMensuel,
      atteinte_pct: objectifMensuel > 0 ? Math.round((totalMois / objectifMensuel) * 100) : 0,
    });
  } catch (err) {
    console.error('[PRODUCTION] Erreur dashboard :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/production — Saisir KPI journalier (avec champs feuille de production)
router.post('/', [
  body('date').notEmpty().withMessage('Date requise'),
], validate, async (req, res) => {
  try {
    const {
      date, effectif_theorique, effectif_reel,
      entree_ligne_kg, objectif_entree_ligne_kg,
      entree_recyclage_r3_kg, objectif_entree_r3_kg,
      entree_recyclage_r4_kg, objectif_entree_r4_kg,
      encadrant, commentaire,
      encadrant_atelier, controleur_tri, consigne,
      effectif_tri, effectif_recuperation, effectif_cp,
      effectif_formation, effectif_abs_injustifiee, effectif_am,
      objectif_recyclage_pct, objectif_reutilisation_pct, objectif_csr_pct,
      resultat_ligne_ok, resultat_r3_ok, resultat_r4_ok, resultat_general_ok,
      signature_encadrant, signature_direction,
    } = req.body;

    if (!date) return res.status(400).json({ error: 'Date requise' });

    const ligneKg = parseFloat(entree_ligne_kg) || 0;
    const r3Kg = parseFloat(entree_recyclage_r3_kg) || 0;
    const r4Kg = parseFloat(entree_recyclage_r4_kg) || 0;
    const totalJour = (ligneKg + r3Kg + r4Kg) / 1000;
    const eff = parseInt(effectif_reel) || 0;
    const productivite = eff > 0 ? (ligneKg + r3Kg + r4Kg) / eff : 0;

    const result = await pool.query(
      `INSERT INTO production_daily (
        date, effectif_theorique, effectif_reel,
        entree_ligne_kg, objectif_entree_ligne_kg,
        entree_recyclage_r3_kg, objectif_entree_r3_kg,
        entree_recyclage_r4_kg, objectif_entree_r4_kg,
        total_jour_t, productivite_kg_per,
        encadrant, commentaire,
        encadrant_atelier, controleur_tri, consigne,
        effectif_tri, effectif_recuperation, effectif_cp,
        effectif_formation, effectif_abs_injustifiee, effectif_am,
        objectif_recyclage_pct, objectif_reutilisation_pct, objectif_csr_pct,
        resultat_ligne_ok, resultat_r3_ok, resultat_r4_ok, resultat_general_ok,
        signature_encadrant, signature_direction,
        created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
      ON CONFLICT (date) DO UPDATE SET
        effectif_theorique=$2, effectif_reel=$3,
        entree_ligne_kg=$4, objectif_entree_ligne_kg=$5,
        entree_recyclage_r3_kg=$6, objectif_entree_r3_kg=$7,
        entree_recyclage_r4_kg=$8, objectif_entree_r4_kg=$9,
        total_jour_t=$10, productivite_kg_per=$11,
        encadrant=$12, commentaire=$13,
        encadrant_atelier=$14, controleur_tri=$15, consigne=$16,
        effectif_tri=$17, effectif_recuperation=$18, effectif_cp=$19,
        effectif_formation=$20, effectif_abs_injustifiee=$21, effectif_am=$22,
        objectif_recyclage_pct=$23, objectif_reutilisation_pct=$24, objectif_csr_pct=$25,
        resultat_ligne_ok=$26, resultat_r3_ok=$27, resultat_r4_ok=$28, resultat_general_ok=$29,
        signature_encadrant=$30, signature_direction=$31,
        updated_at=NOW()
      RETURNING *`,
      [
        date, effectif_theorique, effectif_reel,
        ligneKg, objectif_entree_ligne_kg || 900,
        r3Kg, objectif_entree_r3_kg || 900,
        r4Kg, objectif_entree_r4_kg || 900,
        totalJour, Math.round(productivite),
        encadrant, commentaire,
        encadrant_atelier, controleur_tri, consigne,
        effectif_tri, effectif_recuperation, effectif_cp,
        effectif_formation, effectif_abs_injustifiee, effectif_am,
        objectif_recyclage_pct || 70, objectif_reutilisation_pct || 30, objectif_csr_pct || '<10%',
        resultat_ligne_ok, resultat_r3_ok, resultat_r4_ok, resultat_general_ok,
        signature_encadrant, signature_direction,
        req.user.id,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PRODUCTION] Erreur saisie :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// FEUILLE DE PRODUCTION — Vue complète d'une journée
// ══════════════════════════════════════════

// GET /api/production/feuille/:date — Récupérer la feuille complète d'une journée
// Les affectations opérateurs viennent du planning hebdo (table schedule)
router.get('/feuille/:date', async (req, res) => {
  try {
    const { date } = req.params;

    const [dailyRes, planningRes, chariotsRes, commentairesRes] = await Promise.all([
      pool.query('SELECT * FROM production_daily WHERE date = $1', [date]),
      // Affectations depuis le planning (filière tri = poste_code lié à postes_operation)
      pool.query(`
        SELECT s.id, s.employee_id, s.date, s.status, s.poste_code, s.is_provisional,
               COALESCE(s.periode, 'journee') as periode,
               e.first_name, e.last_name,
               po.nom as poste_nom, po.code as poste_operation_code,
               op.nom as operation_nom, op.code as operation_code,
               ch.nom as chaine_nom
        FROM schedule s
        JOIN employees e ON s.employee_id = e.id
        LEFT JOIN postes_operation po ON po.code = s.poste_code
        LEFT JOIN operations_tri op ON po.operation_id = op.id
        LEFT JOIN chaines_tri ch ON op.chaine_id = ch.id
        WHERE s.date = $1 AND s.status = 'work'
        ORDER BY op.numero, po.nom, e.last_name
      `, [date]),
      pool.query('SELECT * FROM production_chariots WHERE production_date = $1 ORDER BY ligne, numero', [date]),
      pool.query(`
        SELECT pc.*, u.nom as auteur_nom, u.prenom as auteur_prenom
        FROM production_commentaires pc
        LEFT JOIN users u ON u.id = pc.created_by
        WHERE pc.production_date = $1
        ORDER BY pc.created_at DESC
      `, [date]),
    ]);

    // Regrouper les affectations par opération/poste
    const planningByPoste = {};
    for (const s of planningRes.rows) {
      const key = s.poste_code || 'non_affecte';
      if (!planningByPoste[key]) {
        planningByPoste[key] = {
          poste_code: s.poste_code,
          poste_nom: s.poste_nom,
          operation_nom: s.operation_nom,
          operation_code: s.operation_code,
          chaine_nom: s.chaine_nom,
          employes: [],
        };
      }
      planningByPoste[key].employes.push({
        employee_id: s.employee_id,
        first_name: s.first_name,
        last_name: s.last_name,
        is_provisional: s.is_provisional,
      });
    }

    res.json({
      daily: dailyRes.rows[0] || null,
      planning: planningByPoste,
      planning_list: planningRes.rows,
      chariots: chariotsRes.rows,
      commentaires: commentairesRes.rows,
    });
  } catch (err) {
    console.error('[PRODUCTION] Erreur feuille :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// CHARIOTS / PESÉES
// ══════════════════════════════════════════

// POST /api/production/chariots — Sauvegarder les pesées de chariots pour un jour
router.post('/chariots', async (req, res) => {
  try {
    const { date, chariots } = req.body;
    if (!date || !Array.isArray(chariots)) {
      return res.status(400).json({ error: 'Date et chariots requis' });
    }

    // Supprimer les anciens chariots pour ce jour et réinsérer
    await pool.query('DELETE FROM production_chariots WHERE production_date = $1', [date]);

    for (const c of chariots) {
      if (!c.ligne || !c.poids_kg) continue;
      await pool.query(
        `INSERT INTO production_chariots (production_date, ligne, numero, poids_kg, heure)
         VALUES ($1, $2, $3, $4, $5)`,
        [date, c.ligne, c.numero || 1, c.poids_kg, c.heure || null]
      );
    }

    const result = await pool.query(
      'SELECT * FROM production_chariots WHERE production_date = $1 ORDER BY ligne, numero',
      [date]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[PRODUCTION] Erreur chariots :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// COMMENTAIRES PRODUCTION
// ══════════════════════════════════════════

// GET /api/production/commentaires/:date — Historique commentaires d'un jour
router.get('/commentaires/:date', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT pc.*, u.nom as auteur_nom, u.prenom as auteur_prenom
      FROM production_commentaires pc
      LEFT JOIN users u ON u.id = pc.created_by
      WHERE pc.production_date = $1
      ORDER BY pc.created_at DESC
    `, [req.params.date]);
    res.json(result.rows);
  } catch (err) {
    console.error('[PRODUCTION] Erreur commentaires :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/production/commentaires — Ajouter un commentaire
router.post('/commentaires', [
  body('date').notEmpty(),
  body('commentaire').notEmpty(),
], validate, async (req, res) => {
  try {
    const { date, commentaire, type } = req.body;
    const result = await pool.query(
      `INSERT INTO production_commentaires (production_date, commentaire, type, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [date, commentaire, type || 'general', req.user.id]
    );

    // Récupérer avec infos auteur
    const full = await pool.query(`
      SELECT pc.*, u.nom as auteur_nom, u.prenom as auteur_prenom
      FROM production_commentaires pc
      LEFT JOIN users u ON u.id = pc.created_by
      WHERE pc.id = $1
    `, [result.rows[0].id]);

    res.json(full.rows[0]);
  } catch (err) {
    console.error('[PRODUCTION] Erreur ajout commentaire :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/production/commentaires/:id — Supprimer un commentaire
router.delete('/commentaires/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM production_commentaires WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[PRODUCTION] Erreur suppression commentaire :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
