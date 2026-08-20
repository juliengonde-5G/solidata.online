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
    // cohorte/stats) — NOUVELLE NOMENCLATURE 2026-07 (D8/EXG-06) : une sortie
    // est « dynamique » si sortie_classification IN ('emploi_durable',
    // 'emploi_transition', 'sortie_positive') ; 'autre' = non dynamique.
    // Le jalon de sortie est 'bilan_sortie' (status = 'realise'), daté par
    // completed_date (repli updated_at). La ventilation par type de sortie utilise
    // les valeurs réelles du formulaire de bilan (CDI / CDD / CDD_court / formation /
    // creation_activite).
    const { rows } = await pool.query(`
      WITH sorties AS (
        SELECT im.sortie_type, im.sortie_classification
        FROM insertion_milestones im
        WHERE im.milestone_type = 'bilan_sortie'
          AND im.status = 'realise'
          AND im.sortie_classification IS NOT NULL
          AND EXTRACT(YEAR FROM COALESCE(im.completed_date, im.updated_at::date)) = $1
      )
      SELECT
        COUNT(*)::int AS total_sorties,
        COUNT(*) FILTER (WHERE sortie_classification IN ('emploi_durable', 'emploi_transition', 'sortie_positive'))::int AS dynamiques,
        COUNT(*) FILTER (WHERE sortie_type = 'CDI')::int AS cdi,
        COUNT(*) FILTER (WHERE sortie_type IN ('CDD','CDD_court'))::int AS cdd,
        COUNT(*) FILTER (WHERE sortie_type = 'formation')::int AS formation,
        COUNT(*) FILTER (WHERE sortie_type = 'creation_activite')::int AS creation,
        COUNT(*) FILTER (WHERE sortie_classification = 'autre')::int AS non_dynamiques,
        COUNT(*) FILTER (WHERE sortie_classification = 'emploi_durable')::int AS emploi_durable,
        COUNT(*) FILTER (WHERE sortie_classification = 'emploi_transition')::int AS emploi_transition,
        COUNT(*) FILTER (WHERE sortie_classification = 'sortie_positive')::int AS sortie_positive,
        ROUND(100.0 * COUNT(*) FILTER (WHERE sortie_classification IN ('emploi_durable', 'emploi_transition', 'sortie_positive'))::numeric
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
//
// Correctif audit 07/2026 (item 33) : l'ancienne requête joignait
// tours × tour_weights × tour_cav dans le même GROUP BY. Comme tour_weights
// (n pesées) et tour_cav (m CAV collectés) n'ont pas d'autre clé commune que
// tour_id, le produit cartésien comptait CHAQUE pesée m fois et l'attribuait
// en totalité à chaque commune → tonnage et kg/hab gonflés d'un facteur ≈ nb_cav.
// On répartit désormais le poids net de chaque tournée AU PRORATA du nombre de
// CAV collectés par commune (poids_net × nb_cav_commune / nb_cav_total), via des
// CTE séparées (poids_tour + cav_par_tour), comme la vue vw_dpav_communes.
//
// Exemple chiffré (une tournée de 300 kg, 15 CAV collectés : 10 à ROUEN,
// 3 à SOTTEVILLE, 2 à BOIS) :
//   - AVANT (cartésien) : ROUEN 3000 kg, SOTTEVILLE 900, BOIS 600 → total 4500 (×15)
//   - APRÈS (prorata)   : ROUEN  200 kg, SOTTEVILLE  60, BOIS  40 → total  300 (exact)
// La spécification exécutable de ce calcul est distributeTonnageProrata()
// ci-dessous, verrouillée par backend/tests/unit/routes/metropole.test.js.
router.get('/captation-par-commune', async (req, res) => {
  try {
    const annee = parseInt(req.query.annee) || new Date().getFullYear();
    const { rows } = await pool.query(`
      WITH poids_tour AS (
        SELECT tour_id, SUM(weight_kg) AS poids_total_kg
        FROM tour_weights GROUP BY tour_id
      ), cav_par_tour AS (
        SELECT tour_id, COUNT(*) AS nb_cav_collectes
        FROM tour_cav WHERE status = 'collected' GROUP BY tour_id
      )
      SELECT
        COALESCE(rc.nom, c.commune, '(non rattaché)') AS commune,
        rc.code_insee,
        rc.epci_code,
        rc.epci_nom,
        COALESCE(rc.population_insee, c.population_commune) AS population,
        COALESCE(ROUND(SUM(pt.poids_total_kg::numeric / NULLIF(cpt.nb_cav_collectes, 0))), 0)::int AS poids_kg,
        COUNT(DISTINCT t.id)::int AS nb_tournees,
        COUNT(DISTINCT c.id)::int AS nb_cav,
        CASE
          WHEN COALESCE(rc.population_insee, c.population_commune) > 0
          THEN ROUND(
            (SUM(pt.poids_total_kg::numeric / NULLIF(cpt.nb_cav_collectes, 0)))
            / NULLIF(COALESCE(rc.population_insee, c.population_commune), 0), 3)
          ELSE NULL
        END AS kg_par_hab
      FROM tours t
      JOIN tour_cav tc ON tc.tour_id = t.id AND tc.status = 'collected'
      JOIN cav c ON tc.cav_id = c.id
      JOIN poids_tour pt ON pt.tour_id = t.id
      JOIN cav_par_tour cpt ON cpt.tour_id = t.id
      LEFT JOIN referentiel_communes rc ON c.code_insee_commune = rc.code_insee
      WHERE t.status = 'completed' AND EXTRACT(YEAR FROM t.date) = $1
        -- Lot 10 (2026-08) : le référentiel communes couvre désormais des EPCI
        -- limitrophes (Eure/Seine-Maritime). Ce KPI est un reporting MÉTROPOLE
        -- DE ROUEN : on ne garde que les CAV rattachés à une commune de la
        -- Métropole (epci_code 200023414) OU non rattachés / sans EPCI (legacy,
        -- comportement historique conservé). Les CAV rattachés à un AUTRE EPCI
        -- sont exclus — leur part de tonnage n'est PAS réattribuée (le prorata
        -- par CAV reste exact pour les communes affichées).
        AND (rc.code_insee IS NULL OR rc.epci_code IS NULL OR rc.epci_code = '200023414')
      GROUP BY COALESCE(rc.nom, c.commune, '(non rattaché)'), rc.code_insee, rc.epci_code, rc.epci_nom,
               COALESCE(rc.population_insee, c.population_commune)
      ORDER BY poids_kg DESC
    `, [annee]);
    res.json(rows);
  } catch (err) {
    console.error('[METROPOLE] Erreur captation-par-commune :', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════ Vague 2 — indicateurs agrégés pour l'auditeur Métropole (AUTORITE) ══════
// Ces deux endpoints sont volontairement NON NOMINATIFS : le rôle AUTORITE ne
// doit voir que des agrégats (persona auditeur Métropole 2.4). Ils vivent ici
// (et non dans incidents.js / employees.js, réservés ADMIN/MANAGER/RH) pour
// éviter d'ouvrir à AUTORITE les listes nominatives sous-jacentes.

// GET /api/metropole/delai-intervention-incidents?months=12
// Délai moyen d'intervention (création → résolution, en jours) sur les incidents
// CAV, ventilé par type et par mois + synthèse globale. Aucune donnée nominative.
router.get('/delai-intervention-incidents', async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 12;
    let parTypeMois = [];
    let global = { total: 0, resolus: 0, ouverts: 0, delai_moyen_jours: null };
    try {
      const r = await pool.query(`
        SELECT DATE_TRUNC('month', created_at) AS mois,
               type,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolus,
               ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 86400.0)
                     FILTER (WHERE resolved_at IS NOT NULL)::numeric, 1) AS delai_moyen_jours
        FROM incidents
        WHERE created_at >= DATE_TRUNC('month', NOW()) - make_interval(months => $1)
        GROUP BY 1, 2
        ORDER BY mois DESC, type
      `, [months]);
      parTypeMois = r.rows;

      const g = await pool.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolus,
               COUNT(*) FILTER (WHERE status IN ('open','in_progress'))::int AS ouverts,
               ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 86400.0)
                     FILTER (WHERE resolved_at IS NOT NULL)::numeric, 1) AS delai_moyen_jours
        FROM incidents
        WHERE created_at >= DATE_TRUNC('month', NOW()) - make_interval(months => $1)
      `, [months]);
      global = {
        ...g.rows[0],
        delai_moyen_jours: g.rows[0]?.delai_moyen_jours != null ? Number(g.rows[0].delai_moyen_jours) : null,
      };
    } catch (e) {
      // Table incidents absente d'une base ancienne : agrégats vides plutôt que 500.
      console.error('[METROPOLE] delai-intervention-incidents (dégradé) :', e.code || e.message);
    }
    res.json({ months, global, par_type_mois: parTypeMois });
  } catch (err) {
    console.error('[METROPOLE] Erreur delai-intervention-incidents :', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/metropole/kpi-insertion?annee=2026
// Contrepartie sociale de la convention : ETP réalisés, absentéisme, formation,
// effectifs en parcours d'insertion — TOUT AGRÉGÉ (par équipe / global), jamais
// nominatif. Reprend les mêmes formules que les KPI RH (employees.js) mais sans
// exposer le détail par personne, pour le rôle AUTORITE.
router.get('/kpi-insertion', async (req, res) => {
  try {
    const annee = parseInt(req.query.annee) || new Date().getFullYear();
    const heuresPleinTemps = 1607; // base ETP annuelle IAE

    const out = {
      annee,
      etp_reference_heures: heuresPleinTemps,
      total_etp: null,
      total_salaries_actifs: null,
      etp_par_equipe: [],
      formation_total_heures: null,
      absenteisme_taux_pct: null,
      absenteisme_par_equipe: [],
      insertion: { actifs: null, en_parcours: null },
    };

    // ETP par équipe (nom d'équipe = non nominatif)
    try {
      const etpR = await pool.query(`
        SELECT t.name AS equipe,
               COALESCE(SUM(wh.hours_worked) FILTER (WHERE wh.type IN ('normal','training')), 0)::numeric(10,2) AS heures_travaillees,
               COUNT(DISTINCT e.id)::int AS nb_salaries
        FROM employees e
        LEFT JOIN teams t ON e.team_id = t.id
        LEFT JOIN work_hours wh ON wh.employee_id = e.id AND EXTRACT(YEAR FROM wh.date) = $1
        WHERE e.is_active = true
        GROUP BY t.name
        ORDER BY heures_travaillees DESC
      `, [annee]);
      out.etp_par_equipe = etpR.rows.map((r) => ({
        equipe: r.equipe,
        heures_travaillees: Number(r.heures_travaillees),
        nb_salaries: r.nb_salaries,
        etp: Math.round((Number(r.heures_travaillees) / heuresPleinTemps) * 100) / 100,
      }));
      out.total_etp = Math.round(out.etp_par_equipe.reduce((s, r) => s + r.etp, 0) * 100) / 100;
      out.total_salaries_actifs = etpR.rows.reduce((s, r) => s + Number(r.nb_salaries), 0);
    } catch (e) { console.error('[METROPOLE] kpi-insertion ETP (dégradé) :', e.code || e.message); }

    // Formation — heures totales (pas de détail par personne)
    try {
      const f = await pool.query(`
        SELECT COALESCE(SUM(hours_worked) FILTER (WHERE type = 'training'), 0)::numeric(10,2) AS total
        FROM work_hours WHERE EXTRACT(YEAR FROM date) = $1
      `, [annee]);
      out.formation_total_heures = Number(f.rows[0]?.total || 0);
    } catch (e) { console.error('[METROPOLE] kpi-insertion formation (dégradé) :', e.code || e.message); }

    // Absentéisme — taux global + par équipe
    try {
      const globalAbs = await pool.query(`
        SELECT ROUND(
                 100.0 * SUM(hours_worked) FILTER (WHERE type IN ('absence','sick'))::numeric
                 / NULLIF(SUM(hours_worked) FILTER (WHERE type IN ('normal','training','absence','sick'))::numeric, 0), 2) AS taux_pct
        FROM work_hours WHERE EXTRACT(YEAR FROM date) = $1
      `, [annee]);
      out.absenteisme_taux_pct = globalAbs.rows[0]?.taux_pct != null ? Number(globalAbs.rows[0].taux_pct) : null;

      const byTeam = await pool.query(`
        SELECT t.name AS equipe,
               ROUND(
                 100.0 * SUM(wh.hours_worked) FILTER (WHERE wh.type IN ('absence','sick'))::numeric
                 / NULLIF(SUM(wh.hours_worked) FILTER (WHERE wh.type IN ('normal','training','absence','sick'))::numeric, 0), 2) AS taux_pct
        FROM employees e
        LEFT JOIN teams t ON e.team_id = t.id
        LEFT JOIN work_hours wh ON wh.employee_id = e.id AND EXTRACT(YEAR FROM wh.date) = $1
        WHERE e.is_active = true
        GROUP BY t.name
        ORDER BY taux_pct DESC NULLS LAST
      `, [annee]);
      out.absenteisme_par_equipe = byTeam.rows;
    } catch (e) { console.error('[METROPOLE] kpi-insertion absenteisme (dégradé) :', e.code || e.message); }

    // Effectifs en parcours d'insertion (compteur, non nominatif)
    try {
      const ins = await pool.query(`
        SELECT COUNT(*) FILTER (WHERE is_active = true)::int AS actifs,
               COUNT(*) FILTER (WHERE is_active = true AND insertion_status = 'en_parcours')::int AS en_parcours
        FROM employees
      `);
      out.insertion = { actifs: ins.rows[0]?.actifs ?? null, en_parcours: ins.rows[0]?.en_parcours ?? null };
    } catch (e) { console.error('[METROPOLE] kpi-insertion effectifs (dégradé) :', e.code || e.message); }

    res.json(out);
  } catch (err) {
    console.error('[METROPOLE] Erreur kpi-insertion :', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Oracle de calcul (spécification exécutable, verrouillée par metropole.test.js).
 *
 * Répartit le poids net de CHAQUE tournée au prorata du nombre de CAV collectés
 * par commune : part_commune = poids_net × (nb_cav_commune / nb_cav_total).
 * La route /captation-par-commune calcule EXACTEMENT ceci en SQL (CTE poids_tour
 * + cav_par_tour) ; cette fonction n'est pas appelée en production (le SQL est
 * plus efficace) mais fige la formule pour empêcher toute régression vers
 * l'ancien produit cartésien (tonnage ≈ ×nb_cav).
 *
 * @param {Array<{poids_net:number, communes:string[]}>} tournees
 *   communes = liste des communes des CAV COLLECTÉS (un élément par CAV collecté,
 *   doublons attendus quand plusieurs CAV appartiennent à la même commune).
 * @returns {Object<string, number>} tonnage réparti par commune (Σ = Σ poids_net
 *   des tournées ayant au moins un CAV collecté).
 */
function distributeTonnageProrata(tournees) {
  const parCommune = {};
  for (const t of tournees || []) {
    const communes = Array.isArray(t.communes) ? t.communes : [];
    const nbTotal = communes.length;
    if (nbTotal === 0) continue; // tournée sans CAV collecté : poids non attribuable
    const part = (Number(t.poids_net) || 0) / nbTotal;
    for (const commune of communes) {
      const key = commune || '(non rattaché)';
      parCommune[key] = (parCommune[key] || 0) + part;
    }
  }
  return parCommune;
}

router.distributeTonnageProrata = distributeTonnageProrata;

module.exports = router;
