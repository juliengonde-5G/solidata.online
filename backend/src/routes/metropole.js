const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.use(authorize('ADMIN', 'MANAGER', 'RH', 'AUTORITE'));

// ══════════════════════════════════════════
// DASHBOARD COLLECTIVITÉ — Métropole de Rouen
// ══════════════════════════════════════════

// GET /api/metropole/dashboard — KPIs mensuels
router.get('/dashboard', async (req, res) => {
  try {
    const { year, month } = req.query;
    const y = parseInt(year) || new Date().getFullYear();
    const m = parseInt(month) || new Date().getMonth() + 1;

    const dateFrom = `${y}-${String(m).padStart(2, '0')}-01`;
    const dateTo = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    // Volume de collecte global (kg)
    const collecte = await pool.query(`
      SELECT COALESCE(SUM(total_weight_kg), 0) as total_kg,
        COUNT(*) as nb_tours,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as tours_completees
      FROM tours
      WHERE date >= $1 AND date < $2
    `, [dateFrom, dateTo]);

    // Émissions CO2 évitées — facteurs ADEME par filière de valorisation
    // (réutilisation=3.169, recyclage=0.500, chiffons=0.750, csr=0.121 t CO2/t textile)
    // Le mix utilisé est :
    //   1) calculé sur les colisages scellés de la période (mix observé)
    //   2) à défaut, mix moyen fallback 40/35/15/10
    const totalKg = parseFloat(collecte.rows[0].total_kg) || 0;
    const totalTonnes = totalKg / 1000;

    const FACTEURS_CO2 = { reutilisation: 3.169, recyclage: 0.500, chiffons: 0.750, csr: 0.121 };
    let mix = { reutilisation: 0.40, recyclage: 0.35, chiffons: 0.15, csr: 0.10, source: 'fallback' };

    try {
      const mixObs = await pool.query(`
        SELECT
          SUM(CASE WHEN cs.famille_refashion = 'reutilisation' THEN c.poids_kg ELSE 0 END) AS reutilisation_kg,
          SUM(CASE WHEN cs.famille_refashion = 'recyclage' AND cs.nom NOT ILIKE 'Chiffons%' THEN c.poids_kg ELSE 0 END) AS recyclage_kg,
          SUM(CASE WHEN cs.famille_refashion = 'recyclage' AND cs.nom ILIKE 'Chiffons%' THEN c.poids_kg ELSE 0 END) AS chiffons_kg,
          SUM(CASE WHEN cs.famille_refashion = 'csr' THEN c.poids_kg ELSE 0 END) AS csr_kg,
          SUM(c.poids_kg) AS total_kg
        FROM colisages c
        JOIN categories_sortantes cs ON c.categorie_sortante_id = cs.id
        WHERE c.status IN ('scelle','expedie','livre') AND c.scelle_at IS NOT NULL
          AND c.scelle_at >= $1::date AND c.scelle_at < $2::date
      `, [dateFrom, dateTo]);
      const t = parseFloat(mixObs.rows[0]?.total_kg) || 0;
      if (t > 100) {
        mix = {
          reutilisation: parseFloat(mixObs.rows[0].reutilisation_kg) / t,
          recyclage: parseFloat(mixObs.rows[0].recyclage_kg) / t,
          chiffons: parseFloat(mixObs.rows[0].chiffons_kg) / t,
          csr: parseFloat(mixObs.rows[0].csr_kg) / t,
          source: 'observe',
        };
      }
    } catch (_) { /* fallback */ }

    const co2Reemploi = totalTonnes * mix.reutilisation * FACTEURS_CO2.reutilisation;
    const co2Recyclage = totalTonnes * mix.recyclage * FACTEURS_CO2.recyclage;
    const co2Chiffons = totalTonnes * mix.chiffons * FACTEURS_CO2.chiffons;
    const co2CSR = totalTonnes * mix.csr * FACTEURS_CO2.csr;
    const co2Total = Math.round((co2Reemploi + co2Recyclage + co2Chiffons + co2CSR) * 100) / 100;

    // Effectifs
    const effectifs = await pool.query(`
      SELECT COUNT(*) as total,
        COUNT(CASE WHEN contract_type IN ('CDD', 'CDI') THEN 1 END) as cdi_cdd,
        COUNT(CASE WHEN contract_type = 'interim' THEN 1 END) as interimaires,
        COUNT(CASE WHEN contract_type IN ('stage', 'apprentissage') THEN 1 END) as formation
      FROM employees WHERE is_active = true
    `);

    // CAV actifs et indisponibles
    const cavStats = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as actifs,
        COUNT(CASE WHEN status = 'unavailable' THEN 1 END) as indisponibles
      FROM cav
    `);

    // Historique mensuel (12 derniers mois) — d'abord depuis tours, sinon depuis historique_mensuel
    let historique = await pool.query(`
      SELECT
        DATE_TRUNC('month', t.date) as mois,
        COALESCE(SUM(t.total_weight_kg), 0) as total_kg,
        COUNT(t.id) as nb_tours
      FROM tours t
      WHERE t.status = 'completed'
      AND t.date >= (DATE_TRUNC('month', $1::date) - INTERVAL '11 months')
      AND t.date < $2::date
      GROUP BY DATE_TRUNC('month', t.date)
      ORDER BY mois
    `, [dateFrom, dateTo]);

    // Si pas de données tours, charger depuis historique_mensuel (données importées Excel)
    if (historique.rows.length === 0) {
      try {
        const histImported = await pool.query(`
          SELECT
            make_date(annee, mois, 1) as mois,
            SUM(valeur) as total_kg,
            0 as nb_tours
          FROM historique_mensuel
          WHERE section IN ('sous_totaux_tonnages', 'tonnages')
          AND annee * 100 + mois >= ($1::int * 100 + $2::int - 11)
          AND annee * 100 + mois <= $1::int * 100 + $2::int
          GROUP BY annee, mois
          ORDER BY annee, mois
        `, [y, m]);
        if (histImported.rows.length > 0) {
          historique = histImported;
        }
      } catch (_) {}
    }

    // Taux de captation (kg/hab/an)
    let tauxCaptation = null;
    try {
      const popRes = await pool.query('SELECT COALESCE(SUM(population_commune), 0) as total_pop FROM cav WHERE population_commune IS NOT NULL');
      const totalPop = parseInt(popRes.rows[0].total_pop) || 0;
      if (totalPop > 0) {
        // Collecte annuelle (12 derniers mois)
        const annualRes = await pool.query(`
          SELECT COALESCE(SUM(total_weight_kg), 0) as annual_kg FROM tours
          WHERE status = 'completed' AND date >= NOW() - INTERVAL '12 months'
        `);
        const annualKg = parseFloat(annualRes.rows[0].annual_kg) || 0;
        tauxCaptation = {
          kg_par_hab_an: Math.round((annualKg / totalPop) * 100) / 100,
          population_totale: totalPop,
          collecte_annuelle_kg: annualKg,
          objectif_refashion_kg: 3.6, // objectif Refashion : 3.6 kg/hab/an
        };
      }
    } catch (_) {}

    res.json({
      period: { year: y, month: m },
      collecte: {
        total_kg: totalKg,
        total_tonnes: Math.round(totalTonnes * 100) / 100,
        nb_tours: parseInt(collecte.rows[0].nb_tours),
        tours_completees: parseInt(collecte.rows[0].tours_completees),
      },
      emissions_evitees: {
        co2_total_tonnes: co2Total,
        mix_source: mix.source,
        mix: {
          reutilisation_pct: Math.round(mix.reutilisation * 1000) / 10,
          recyclage_pct: Math.round(mix.recyclage * 1000) / 10,
          chiffons_pct: Math.round(mix.chiffons * 1000) / 10,
          csr_pct: Math.round(mix.csr * 1000) / 10,
        },
        detail: {
          reemploi_tonnes: Math.round(co2Reemploi * 100) / 100,
          recyclage_tonnes: Math.round(co2Recyclage * 100) / 100,
          chiffons_tonnes: Math.round(co2Chiffons * 100) / 100,
          csr_tonnes: Math.round(co2CSR * 100) / 100,
        },
      },
      taux_captation: tauxCaptation,
      effectifs: effectifs.rows[0],
      cav: cavStats.rows[0],
      historique_mensuel: historique.rows,
    });
  } catch (err) {
    console.error('[METROPOLE] Erreur dashboard :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/metropole/cav — Liste des CAV avec statut pour la carte
router.get('/cav', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.name, c.address, c.commune, c.latitude, c.longitude,
        c.nb_containers, c.status, c.unavailable_reason, c.unavailable_since,
        c.qr_code_data,
        (SELECT MAX(th.date) FROM tonnage_history th WHERE th.cav_id = c.id) as derniere_collecte,
        (SELECT COUNT(*) FROM tonnage_history th WHERE th.cav_id = c.id
         AND th.date >= NOW() - INTERVAL '12 months') as nb_collectes_12m,
        (SELECT COALESCE(SUM(th.weight_kg), 0) FROM tonnage_history th WHERE th.cav_id = c.id
         AND th.date >= NOW() - INTERVAL '12 months') as total_kg_12m
      FROM cav c
      ORDER BY c.commune, c.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[METROPOLE] Erreur CAV :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/metropole/cav/:id/details — Détail d'un CAV (historique + événements)
router.get('/cav/:id/details', async (req, res) => {
  try {
    const cav = await pool.query('SELECT * FROM cav WHERE id = $1', [req.params.id]);
    if (cav.rows.length === 0) return res.status(404).json({ error: 'CAV non trouvé' });

    // Historique de collecte (12 mois)
    const history = await pool.query(`
      SELECT date, weight_kg, source FROM tonnage_history
      WHERE cav_id = $1 AND date >= NOW() - INTERVAL '12 months'
      ORDER BY date DESC
    `, [req.params.id]);

    // Historique des niveaux de remplissage
    const fillHistory = await pool.query(`
      SELECT t.date, tc.fill_level, tc.status as collection_status
      FROM tour_cav tc
      JOIN tours t ON tc.tour_id = t.id
      WHERE tc.cav_id = $1 AND t.date >= NOW() - INTERVAL '12 months'
      ORDER BY t.date DESC
    `, [req.params.id]);

    // Événements (indisponibilités, changements de statut)
    const events = await pool.query(`
      SELECT date, weight_kg as value, source as type FROM tonnage_history
      WHERE cav_id = $1 AND date >= NOW() - INTERVAL '12 months'
      UNION ALL
      SELECT t.date, tc.fill_level::DOUBLE PRECISION, 'fill_level'
      FROM tour_cav tc JOIN tours t ON tc.tour_id = t.id
      WHERE tc.cav_id = $1 AND tc.fill_level IS NOT NULL AND t.date >= NOW() - INTERVAL '12 months'
      ORDER BY date DESC
    `, [req.params.id]);

    // Scans QR (si table existe)
    let qrScans = [];
    try {
      const scans = await pool.query(`
        SELECT * FROM cav_qr_scans WHERE cav_id = $1
        ORDER BY scanned_at DESC LIMIT 50
      `, [req.params.id]);
      qrScans = scans.rows;
    } catch (_) {}

    // Stats agrégées
    const stats = await pool.query(`
      SELECT
        COUNT(*) as nb_collectes,
        COALESCE(SUM(weight_kg), 0) as total_kg,
        COALESCE(AVG(weight_kg), 0) as avg_kg,
        COALESCE(MIN(weight_kg), 0) as min_kg,
        COALESCE(MAX(weight_kg), 0) as max_kg
      FROM tonnage_history
      WHERE cav_id = $1 AND date >= NOW() - INTERVAL '12 months'
    `, [req.params.id]);

    res.json({
      cav: cav.rows[0],
      stats: stats.rows[0],
      collection_history: history.rows,
      fill_history: fillHistory.rows,
      events,
      qr_scans: qrScans,
    });
  } catch (err) {
    console.error('[METROPOLE] Erreur détail CAV :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/metropole/evolution — Évolution mensuelle sur N mois
router.get('/evolution', async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 12;

    const result = await pool.query(`
      SELECT
        DATE_TRUNC('month', t.date) as mois,
        COALESCE(SUM(t.total_weight_kg), 0) as total_kg,
        COUNT(t.id) as nb_tours,
        COUNT(DISTINCT tc.cav_id) as nb_cav_collectes
      FROM tours t
      LEFT JOIN tour_cav tc ON tc.tour_id = t.id AND tc.status = 'collected'
      WHERE t.status = 'completed'
      AND t.date >= DATE_TRUNC('month', NOW()) - make_interval(months => $1)
      GROUP BY DATE_TRUNC('month', t.date)
      ORDER BY mois
    `, [months]);

    res.json(result.rows);
  } catch (err) {
    console.error('[METROPOLE] Erreur évolution :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════ KPIs P0-E ══════

// Taux de sortie dynamique (CDI/CDD/formation/création) — année
router.get('/sortie-dynamique', async (req, res) => {
  try {
    const annee = parseInt(req.query.annee) || new Date().getFullYear();
    // Définition unifiée avec le module insertion (routes/insertion/routes.js,
    // cohorte/stats) : une sortie est « dynamique » si sortie_classification = 'positive'.
    // Le jalon de sortie est 'Bilan Sortie' (status = 'realise'), daté par
    // completed_date (repli updated_at). La ventilation par type de sortie utilise
    // les valeurs réelles du formulaire de bilan (CDI / CDD / CDD_court / formation /
    // creation_activite).
    const { rows } = await pool.query(`
      WITH sorties AS (
        SELECT im.sortie_type, im.sortie_classification
        FROM insertion_milestones im
        WHERE im.milestone_type = 'Bilan Sortie'
          AND im.status = 'realise'
          AND im.sortie_classification IS NOT NULL
          AND EXTRACT(YEAR FROM COALESCE(im.completed_date, im.updated_at::date)) = $1
      )
      SELECT
        COUNT(*)::int AS total_sorties,
        COUNT(*) FILTER (WHERE sortie_classification = 'positive')::int AS dynamiques,
        COUNT(*) FILTER (WHERE sortie_type = 'CDI')::int AS cdi,
        COUNT(*) FILTER (WHERE sortie_type IN ('CDD','CDD_court'))::int AS cdd,
        COUNT(*) FILTER (WHERE sortie_type = 'formation')::int AS formation,
        COUNT(*) FILTER (WHERE sortie_type = 'creation_activite')::int AS creation,
        COUNT(*) FILTER (WHERE sortie_classification = 'negative')::int AS non_dynamiques,
        ROUND(100.0 * COUNT(*) FILTER (WHERE sortie_classification = 'positive')::numeric
              / NULLIF(COUNT(*), 0), 1) AS taux_dynamique_pct
      FROM sorties
    `, [annee]);
    res.json({ annee, ...(rows[0] || {}) });
  } catch (err) {
    console.error('[METROPOLE] Erreur sortie-dynamique :', err);
    res.status(500).json({ error: err.message });
  }
});

// Taux de service CAV (% CAV collectés vs planifiés) — mois
router.get('/service-cav', async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 12;
    const { rows } = await pool.query(`
      SELECT
        DATE_TRUNC('month', t.date) AS mois,
        COUNT(*) FILTER (WHERE tc.status = 'collected')::int AS collectes,
        COUNT(*) FILTER (WHERE tc.status = 'skipped')::int AS sautes,
        COUNT(*) FILTER (WHERE tc.status IN ('collected','skipped'))::int AS planifies,
        ROUND(100.0 * COUNT(*) FILTER (WHERE tc.status = 'collected')::numeric
              / NULLIF(COUNT(*) FILTER (WHERE tc.status IN ('collected','skipped')), 0), 1) AS taux_service_pct
      FROM tours t
      JOIN tour_cav tc ON tc.tour_id = t.id
      WHERE t.status = 'completed'
        AND t.date >= DATE_TRUNC('month', NOW()) - make_interval(months => $1)
      GROUP BY DATE_TRUNC('month', t.date)
      ORDER BY mois
    `, [months]);
    res.json(rows);
  } catch (err) {
    console.error('[METROPOLE] Erreur service-cav :', err);
    res.status(500).json({ error: err.message });
  }
});

// Tonnage captation par commune kg/hab — année
router.get('/captation-par-commune', async (req, res) => {
  try {
    const annee = parseInt(req.query.annee) || new Date().getFullYear();
    const { rows } = await pool.query(`
      SELECT
        COALESCE(rc.nom, c.commune, '(non rattaché)') AS commune,
        rc.code_insee,
        rc.epci_nom,
        COALESCE(rc.population_insee, c.population_commune) AS population,
        COALESCE(SUM(tw.weight_kg), 0)::int AS poids_kg,
        COUNT(DISTINCT t.id)::int AS nb_tournees,
        CASE
          WHEN COALESCE(rc.population_insee, c.population_commune) > 0
          THEN ROUND(SUM(tw.weight_kg)::numeric / NULLIF(COALESCE(rc.population_insee, c.population_commune), 0), 3)
          ELSE NULL
        END AS kg_par_hab
      FROM tours t
      JOIN tour_weights tw ON tw.tour_id = t.id
      JOIN tour_cav tc ON tc.tour_id = t.id AND tc.status = 'collected'
      JOIN cav c ON tc.cav_id = c.id
      LEFT JOIN referentiel_communes rc ON c.code_insee_commune = rc.code_insee
      WHERE EXTRACT(YEAR FROM t.date) = $1
      GROUP BY COALESCE(rc.nom, c.commune, '(non rattaché)'), rc.code_insee, rc.epci_nom,
               COALESCE(rc.population_insee, c.population_commune)
      ORDER BY poids_kg DESC
    `, [annee]);
    res.json(rows);
  } catch (err) {
    console.error('[METROPOLE] Erreur captation-par-commune :', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
