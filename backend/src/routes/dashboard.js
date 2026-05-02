const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { cacheMiddleware } = require('../middleware/cache');

router.use(authenticate);

// Cache 120s par tranche de minute — invalidation naturelle quand le bucket change
const dashboardKey = (suffix) => (req) => {
  const minute = new Date().toISOString().slice(0, 16);
  return `dashboard:${suffix}:${minute}`;
};

// GET /api/dashboard/kpis — KPIs agrégés pour la page d'accueil
router.get('/kpis', cacheMiddleware(dashboardKey('kpis'), 120), async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const monthStart = today.substring(0, 7) + '-01';

    // ══════════════════════════════════════════
    // Requêtes parallèles pour toutes les métriques
    // ══════════════════════════════════════════
    const [
      tonnageMois,
      toursAujourdhui,
      toursEnCours,
      cavActifs,
      kgTrieMois,
      kgTrieAujourdhui,
      totalTrieMois,
      totalEntreeMois,
      employesActifs,
      candidatsEnCours,
      parcoursInsertionActifs,
      contratsFin30j,
      stockTotal,
      mouvementsAujourdhui,
      commandesEnCours,
      preparationsActives,
      facturesImpayees,
      maintenanceAlerts,
      toursCompletedToday,
      candidateChanges,
      stockMovementsRecent
    ] = await Promise.all([
      // === COLLECTE ===
      // Tonnage collecté ce mois
      pool.query(
        `SELECT COALESCE(SUM(total_weight_kg), 0) as total
         FROM tours WHERE date >= $1 AND status = 'completed'`,
        [monthStart]
      ),
      // Tournées aujourd'hui (toutes)
      pool.query(
        `SELECT COUNT(*)::int as count FROM tours WHERE date = $1`,
        [today]
      ),
      // Tournées en cours
      pool.query(
        `SELECT COUNT(*)::int as count FROM tours WHERE status = 'in_progress'`
      ),
      // CAV actifs
      pool.query(
        `SELECT COUNT(*)::int as count FROM cav WHERE status = 'active'`
      ),

      // === PRODUCTION ===
      // Fix bug O1 : la colonne `kg_entree` n'existe pas dans
      // production_daily. Le schéma réel est :
      //   - entree_ligne_kg  (kg bruts entrés sur la ligne de tri)
      //   - total_jour_t     (tonnes triées — sortie valorisée)
      // Les KPIs "triés" doivent utiliser total_jour_t × 1000 (conversion).
      // Kg triés ce mois (sorties tri)
      pool.query(
        `SELECT COALESCE(SUM(total_jour_t) * 1000, 0) as total
         FROM production_daily WHERE date >= $1`,
        [monthStart]
      ),
      // Kg triés aujourd'hui
      pool.query(
        `SELECT COALESCE(SUM(total_jour_t) * 1000, 0) as total
         FROM production_daily WHERE date = $1`,
        [today]
      ),
      // Total trié ce mois (pour taux valorisation — sorties valorisées, tonnes)
      pool.query(
        `SELECT COALESCE(SUM(total_jour_t), 0) as total
         FROM production_daily WHERE date >= $1`,
        [monthStart]
      ),
      // Total entré ce mois (pour taux valorisation — entrées brutes en kg)
      pool.query(
        `SELECT COALESCE(SUM(entree_ligne_kg), 0) as total
         FROM production_daily WHERE date >= $1`,
        [monthStart]
      ),

      // === RH ===
      // Employés actifs
      pool.query(
        `SELECT COUNT(*)::int as count FROM employees WHERE is_active = true`
      ),
      // Candidats en cours (reçus + entretien)
      pool.query(
        `SELECT COUNT(*)::int as count FROM candidates
         WHERE status IN ('received', 'interview')`
      ),
      // Parcours insertion actifs
      pool.query(
        `SELECT COUNT(*)::int as count FROM insertion_diagnostics
         WHERE status = 'active' OR status IS NULL`
      ),
      // Contrats arrivant à échéance dans 30 jours
      pool.query(
        `SELECT COUNT(*)::int as count FROM employee_contracts
         WHERE is_current = true AND end_date IS NOT NULL
         AND end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`
      ),

      // === STOCK ===
      // Stock total (entrées - sorties) en kg
      pool.query(
        `SELECT COALESCE(SUM(
           CASE WHEN type = 'entree' THEN quantity ELSE -quantity END
         ), 0) as total FROM stock_movements`
      ),
      // Mouvements de stock aujourd'hui
      pool.query(
        `SELECT COUNT(*)::int as count FROM stock_movements
         WHERE created_at::date = $1`,
        [today]
      ),

      // === EXUTOIRES ===
      // Commandes en cours (ni fermées ni annulées ni brouillon)
      pool.query(
        `SELECT COUNT(*)::int as count FROM commandes_exutoires
         WHERE status NOT IN ('closed', 'cancelled', 'draft')`
      ),
      // Préparations actives (non terminées)
      pool.query(
        `SELECT COUNT(*)::int as count FROM preparations_expedition
         WHERE status NOT IN ('completed', 'cancelled')`
      ),
      // Factures impayées exutoires
      pool.query(
        `SELECT COUNT(*)::int as count FROM invoices
         WHERE status = 'overdue'`
      ),

      // === ALERTES (données brutes) ===
      // Alertes maintenance non résolues
      pool.query(
        `SELECT v.registration_number, vma.alert_type, vma.message
         FROM vehicle_maintenance_alerts vma
         JOIN vehicles v ON v.id = vma.vehicle_id
         WHERE vma.resolved = false OR vma.resolved IS NULL
         ORDER BY vma.created_at DESC LIMIT 5`
      ),

      // === ACTIVITE RECENTE ===
      // Tournées terminées récemment
      pool.query(
        `SELECT t.id, t.date, t.total_weight_kg, t.updated_at
         FROM tours t
         WHERE t.status = 'completed'
         ORDER BY t.updated_at DESC LIMIT 5`
      ),
      // Changements de statut candidats récents
      pool.query(
        `SELECT ch.to_status, ch.created_at,
           CONCAT(c.first_name, ' ', c.last_name) as nom
         FROM candidate_history ch
         JOIN candidates c ON c.id = ch.candidate_id
         ORDER BY ch.created_at DESC LIMIT 5`
      ),
      // Mouvements stock récents
      pool.query(
        `SELECT sm.type, sm.poids_kg as quantity, sm.notes as reference, sm.created_at
         FROM stock_movements sm
         ORDER BY sm.created_at DESC LIMIT 5`
      ),
    ]);

    // ══════════════════════════════════════════
    // Calcul du taux de valorisation (audit Direction D3)
    //
    // Formule : sorties valorisées / entrées brutes — bornée à 100% car
    // physiquement impossible de "valoriser" plus que ce qui est entré (sauf
    // saisie incohérente). On capait avant à NaN → désormais on cap à 100
    // et on logge un avertissement si > 100% pour traçabilité audit.
    // ══════════════════════════════════════════
    const totalTrieT = parseFloat(totalTrieMois.rows[0].total) || 0;
    const totalEntreeKg = parseFloat(totalEntreeMois.rows[0].total) || 0;
    let tauxValorisation = 0;
    if (totalEntreeKg > 0) {
      const raw = (totalTrieT * 1000 / totalEntreeKg) * 100;
      if (raw > 100) {
        console.warn('[DASHBOARD] taux_valorisation > 100% (raw=' + raw.toFixed(1) +
          ') — entrées/sorties incohérentes', { totalTrieT, totalEntreeKg });
      }
      tauxValorisation = Math.min(100, Math.round(raw * 10) / 10);
    }

    // ══════════════════════════════════════════
    // Construction des alertes
    // ══════════════════════════════════════════
    const alertes = [];

    const nbContratsFin = parseInt(contratsFin30j.rows[0].count);
    if (nbContratsFin > 0) {
      alertes.push({
        type: 'warning',
        module: 'rh',
        message: `${nbContratsFin} contrat${nbContratsFin > 1 ? 's' : ''} arriv${nbContratsFin > 1 ? 'ent' : 'e'} à échéance dans 30 jours`,
      });
    }

    const nbToursEnCours = parseInt(toursEnCours.rows[0].count);
    if (nbToursEnCours > 0) {
      alertes.push({
        type: 'info',
        module: 'collecte',
        message: `${nbToursEnCours} tournée${nbToursEnCours > 1 ? 's' : ''} en cours`,
      });
    }

    const nbMaintenanceAlerts = maintenanceAlerts.rows.length;
    if (nbMaintenanceAlerts > 0) {
      alertes.push({
        type: 'warning',
        module: 'maintenance',
        message: `${nbMaintenanceAlerts} alerte${nbMaintenanceAlerts > 1 ? 's' : ''} maintenance véhicule non résolue${nbMaintenanceAlerts > 1 ? 's' : ''}`,
      });
    }

    const nbFacturesImpayees = parseInt(facturesImpayees.rows[0].count);
    if (nbFacturesImpayees > 0) {
      alertes.push({
        type: 'warning',
        module: 'facturation',
        message: `${nbFacturesImpayees} facture${nbFacturesImpayees > 1 ? 's' : ''} impayée${nbFacturesImpayees > 1 ? 's' : ''}`,
      });
    }

    // ══════════════════════════════════════════
    // Construction de l'activité récente
    // ══════════════════════════════════════════
    const activiteRecente = [];

    // Tournées terminées
    for (const row of toursCompletedToday.rows) {
      const poids = row.total_weight_kg ? `${Math.round(row.total_weight_kg)} kg` : '';
      activiteRecente.push({
        type: 'collecte',
        message: `Tournée T-${row.id} terminée${poids ? ` (${poids})` : ''}`,
        date: row.updated_at,
      });
    }

    // Changements candidats
    const statusLabels = {
      received: 'reçu',
      interview: 'en entretien',
      recruited: 'recruté',
      rejected: 'refusé',
    };
    for (const row of candidateChanges.rows) {
      const statusLabel = statusLabels[row.to_status] || row.to_status;
      activiteRecente.push({
        type: 'rh',
        message: `Candidat ${row.nom} ${statusLabel}`,
        date: row.created_at,
      });
    }

    // Mouvements stock
    for (const row of stockMovementsRecent.rows) {
      const typeLabel = row.type === 'entree' ? '+' : '-';
      const ref = row.reference ? ` (${row.reference})` : '';
      activiteRecente.push({
        type: 'stock',
        message: `Stock mis à jour (${typeLabel}${row.quantity} kg)${ref}`,
        date: row.created_at,
      });
    }

    // Trier par date décroissante et limiter à 10
    activiteRecente.sort((a, b) => new Date(b.date) - new Date(a.date));
    const activiteLimitee = activiteRecente.slice(0, 10);

    // ══════════════════════════════════════════
    // Tendances 7 jours (sparklines)
    // ══════════════════════════════════════════
    let trendCollecte = [], trendProduction = [];
    try {
      const trendC = await pool.query(
        `SELECT date, COALESCE(SUM(total_weight_kg), 0)::int as val
         FROM tours WHERE date >= CURRENT_DATE - INTERVAL '7 days' AND status = 'completed'
         GROUP BY date ORDER BY date`
      );
      trendCollecte = trendC.rows.map(r => r.val);

      // Fix bug O5 : la sparkline "production" doit refléter les kg
      // réellement triés (production_daily.total_jour_t), pas les mouvements
      // de stock (qui incluent expéditions, retours, etc.).
      const trendP = await pool.query(
        `SELECT date, COALESCE(total_jour_t * 1000, 0)::int as val
         FROM production_daily WHERE date >= CURRENT_DATE - INTERVAL '7 days'
         ORDER BY date`
      );
      trendProduction = trendP.rows.map(r => r.val);
    } catch (e) { /* trends optionnels */ }

    // ══════════════════════════════════════════
    // Réponse JSON
    // ══════════════════════════════════════════
    const stockTotalKg = parseFloat(stockTotal.rows[0].total) || 0;

    res.json({
      collecte: {
        tonnage_mois: Math.round(parseFloat(tonnageMois.rows[0].total) || 0),
        tours_aujourdhui: parseInt(toursAujourdhui.rows[0].count),
        tours_en_cours: nbToursEnCours,
        cav_actifs: parseInt(cavActifs.rows[0].count),
        trend_7j: trendCollecte.length >= 2 ? trendCollecte : null,
      },
      production: {
        kg_trie_mois: Math.round(parseFloat(kgTrieMois.rows[0].total) || 0),
        kg_trie_aujourdhui: Math.round(parseFloat(kgTrieAujourdhui.rows[0].total) || 0),
        taux_valorisation: tauxValorisation,
        trend_7j: trendProduction.length >= 2 ? trendProduction : null,
      },
      rh: {
        employes_actifs: parseInt(employesActifs.rows[0].count),
        candidats_en_cours: parseInt(candidatsEnCours.rows[0].count),
        parcours_insertion_actifs: parseInt(parcoursInsertionActifs.rows[0].count),
        contrats_fin_proche: nbContratsFin,
      },
      stock: {
        total_tonnes: Math.round(stockTotalKg / 100) / 10,
        mouvements_aujourdhui: parseInt(mouvementsAujourdhui.rows[0].count),
      },
      exutoires: {
        commandes_en_cours: parseInt(commandesEnCours.rows[0].count),
        preparations_actives: parseInt(preparationsActives.rows[0].count),
        factures_impayees: nbFacturesImpayees,
      },
      alertes,
      activite_recente: activiteLimitee,
    });
  } catch (err) {
    console.error('[DASHBOARD] Erreur KPIs :', err);
    res.status(500).json({ error: 'Erreur lors du chargement des KPIs' });
  }
});

// GET /api/dashboard/objectifs — Objectifs vs réalisé (jauges)
// Retourne les objectifs du mois/trimestre/année en cours avec le réalisé calculé
router.get('/objectifs', cacheMiddleware(dashboardKey('objectifs'), 120), async (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const trimestre = Math.ceil(month / 3);
    const today = now.toISOString().split('T')[0];
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const trimestreStart = `${year}-${String((trimestre - 1) * 3 + 1).padStart(2, '0')}-01`;
    const yearStart = `${year}-01-01`;

    // Récupérer les objectifs pertinents (mois en cours, trimestre en cours, année)
    const objResult = await pool.query(`
      SELECT * FROM periodic_objectives
      WHERE annee = $1
        AND (
          (periode = 'mensuel' AND mois = $2)
          OR (periode = 'trimestriel' AND trimestre = $3)
          OR (periode = 'annuel')
        )
      ORDER BY domaine, indicateur
    `, [year, month, trimestre]);

    if (objResult.rows.length === 0) return res.json([]);

    // Perf : pré-agrégation en 3 requêtes parallèles (vs N+1 par objectif).
    // On agrège par les 3 dates de début (mensuel/trimestriel/annuel) en une seule passe.
    const periodes = { mensuel: monthStart, trimestriel: trimestreStart, annuel: yearStart };
    const [collecteRows, productionRows, postesRows] = await Promise.all([
      pool.query(`
        SELECT
          CASE WHEN date >= $1 THEN 'mensuel'
               WHEN date >= $2 THEN 'trimestriel'
               ELSE 'annuel' END AS periode,
          COALESCE(SUM(total_weight_kg), 0)::float AS total
        FROM tours
        WHERE date >= $3 AND status = 'completed'
        GROUP BY 1
      `, [monthStart, trimestreStart, yearStart]),
      pool.query(`
        SELECT
          CASE WHEN date >= $1 THEN 'mensuel'
               WHEN date >= $2 THEN 'trimestriel'
               ELSE 'annuel' END AS periode,
          COALESCE(SUM(kg_entree), 0)::float AS total
        FROM production_daily
        WHERE date >= $3
        GROUP BY 1
      `, [monthStart, trimestreStart, yearStart]),
      pool.query(`
        SELECT
          CASE WHEN oe.date >= $1 THEN 'mensuel'
               WHEN oe.date >= $2 THEN 'trimestriel'
               ELSE 'annuel' END AS periode,
          LOWER(ot.name) AS poste,
          COALESCE(SUM(oe.quantity_kg), 0)::float AS total
        FROM operation_executions oe
        JOIN operations_tri ot ON ot.id = oe.operation_id
        WHERE oe.date >= $3
        GROUP BY 1, 2
      `, [monthStart, trimestreStart, yearStart]).catch(() => ({ rows: [] })),
    ]);

    // Indexation pour lookup O(1) lors du mapping
    const totalCollecte = Object.fromEntries(collecteRows.rows.map(r => [r.periode, r.total]));
    const totalProduction = Object.fromEntries(productionRows.rows.map(r => [r.periode, r.total]));
    const totalParPoste = postesRows.rows.reduce((acc, r) => {
      acc[r.periode] = acc[r.periode] || [];
      acc[r.periode].push({ poste: r.poste, total: r.total });
      return acc;
    }, {});

    const objectifs = objResult.rows.map((obj) => {
      let realise = 0;
      const indicLower = (obj.indicateur || '').toLowerCase();

      if (obj.domaine === 'collecte' && indicLower.includes('tonnage')) {
        realise = totalCollecte[obj.periode] || 0;
      } else if (obj.domaine === 'tri' || obj.domaine === 'production') {
        const posteKeywords = ['crack', 'tri fin', 'catégor', 'condition'];
        const matchedPoste = posteKeywords.find(k => indicLower.includes(k));
        if (matchedPoste) {
          const found = (totalParPoste[obj.periode] || []).find(p => p.poste.includes(matchedPoste));
          realise = found ? found.total : 0;
        } else {
          realise = totalProduction[obj.periode] || 0;
        }
      }

      const pct = obj.valeur_cible > 0 ? Math.min(Math.round((realise / obj.valeur_cible) * 100), 100) : 0;
      return {
        id: obj.id,
        domaine: obj.domaine,
        indicateur: obj.indicateur,
        unite: obj.unite,
        periode: obj.periode,
        mois: obj.mois,
        trimestre: obj.trimestre,
        valeur_cible: obj.valeur_cible,
        realise: Math.round(realise),
        pourcentage: pct,
        commentaire: obj.commentaire,
      };
    });

    res.json(objectifs);
  } catch (err) {
    console.error('[DASHBOARD] Erreur objectifs :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// V3 — Dashboard exécutif (8 KPI essentiels)
//
// Audit Direction (action 11 du plan d'action) — vue stratégique 1 page
// avec comparaison N/N-1 lissée et seuils d'alerte configurables.
//
// 8 KPI confirmés par la Direction :
//   1. Tonnage mois (collecte brute, kg)
//   2. Taux valorisation (sortie tri / entrée tri, %)
//   3. Productivité tri (kg/pers/jour)
//   4. CA boutique mois (HT, €)
//   5. Sorties positives M12 (% des sorties insertion)
//   6. CO2 évité (tonnes équivalent CO2)
//   7. Subvention Refashion trimestre (€)
//   8. Trésorerie (placeholder Pennylane si sync absente)
// ══════════════════════════════════════════

// Helper : pourcentage de variation entre deux valeurs (null-safe)
function pctVariation(current, previous) {
  if (previous == null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

router.get('/executive', cacheMiddleware(dashboardKey('executive'), 300), async (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const monthStart = now.toISOString().slice(0, 7) + '-01';
    const today = now.toISOString().split('T')[0];
    const dayOfMonth = now.getDate();
    const trimestre = Math.ceil((now.getMonth() + 1) / 3);

    // N-1 même période (jour exact pour comparaison lissée)
    const n1MonthStart = `${year - 1}-${(now.getMonth() + 1).toString().padStart(2, '0')}-01`;
    const n1Today = `${year - 1}-${today.slice(5)}`;

    const [
      collecteN, collecteN1,
      triEntreeN, triEntreeN1,
      triSortieN, triSortieN1,
      productiviteN, productiviteN1,
      boutiqueCAN, boutiqueCAN1,
      sortiesInsertion12m,
      refashionTrimestre,
      seuils,
    ] = await Promise.all([
      // 1. Collecte brute mois (kg)
      pool.query(
        `SELECT COALESCE(SUM(total_weight_kg), 0) AS total
         FROM tours WHERE status = 'completed' AND date >= $1 AND date <= $2`,
        [monthStart, today]
      ),
      pool.query(
        `SELECT COALESCE(SUM(total_weight_kg), 0) AS total
         FROM tours WHERE status = 'completed' AND date >= $1 AND date <= $2`,
        [n1MonthStart, n1Today]
      ),
      // 2 + 3. Tri (entrée + productivité)
      pool.query(
        `SELECT COALESCE(SUM(entree_ligne_kg), 0) AS entree,
                COALESCE(AVG(productivite_kg_per), 0) AS prod
         FROM production_daily WHERE date >= $1 AND date <= $2`,
        [monthStart, today]
      ),
      pool.query(
        `SELECT COALESCE(SUM(entree_ligne_kg), 0) AS entree,
                COALESCE(AVG(productivite_kg_per), 0) AS prod
         FROM production_daily WHERE date >= $1 AND date <= $2`,
        [n1MonthStart, n1Today]
      ),
      // tri sortie (tonnes valorisées)
      pool.query(
        `SELECT COALESCE(SUM(total_jour_t), 0) AS total
         FROM production_daily WHERE date >= $1 AND date <= $2`,
        [monthStart, today]
      ),
      pool.query(
        `SELECT COALESCE(SUM(total_jour_t), 0) AS total
         FROM production_daily WHERE date >= $1 AND date <= $2`,
        [n1MonthStart, n1Today]
      ),
      // 3. productivité (déjà retournée par triEntreeN)
      pool.query(`SELECT 1 AS placeholder`),
      pool.query(`SELECT 1 AS placeholder`),
      // 4. CA boutiques mois
      pool.query(
        `SELECT COALESCE(SUM(total_ht), 0) AS total
         FROM boutique_ventes WHERE date_vente >= $1 AND date_vente <= $2`,
        [monthStart, today]
      ).catch(() => ({ rows: [{ total: 0 }] })),
      pool.query(
        `SELECT COALESCE(SUM(total_ht), 0) AS total
         FROM boutique_ventes WHERE date_vente >= $1 AND date_vente <= $2`,
        [n1MonthStart, n1Today]
      ).catch(() => ({ rows: [{ total: 0 }] })),
      // 5. Sorties insertion 12 derniers mois
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE sortie_classification = 'positive')::int AS positives,
          COUNT(*) FILTER (WHERE sortie_classification IS NOT NULL)::int AS total
        FROM insertion_milestones
        WHERE milestone_type = 'Bilan Sortie'
          AND completed_date >= NOW() - INTERVAL '12 months'
      `).catch(() => ({ rows: [{ positives: 0, total: 0 }] })),
      // 7. Subvention Refashion trimestre (en cours)
      pool.query(`
        SELECT COALESCE(montant_total, 0)::float AS total
        FROM refashion_subventions
        WHERE annee = $1 AND trimestre = $2
        LIMIT 1
      `, [year, trimestre]).catch(() => ({ rows: [{ total: 0 }] })),
      // Seuils configurés
      pool.query(`
        SELECT indicateur, seuil_min, seuil_max, severite
        FROM alert_thresholds WHERE actif = true
      `).catch(() => ({ rows: [] })),
    ]);

    // Calcul des KPI
    const collecte = parseFloat(collecteN.rows[0].total);
    const collecteN1Val = parseFloat(collecteN1.rows[0].total);

    const triEntree = parseFloat(triEntreeN.rows[0].entree);
    const triEntreeN1Val = parseFloat(triEntreeN1.rows[0].entree);
    const productivite = Math.round(parseFloat(triEntreeN.rows[0].prod));
    const productiviteN1Val = Math.round(parseFloat(triEntreeN1.rows[0].prod));

    const triSortie = parseFloat(triSortieN.rows[0].total) * 1000;
    const triSortieN1Val = parseFloat(triSortieN1.rows[0].total) * 1000;
    const tauxValorisation = triEntree > 0 ? Math.min(100, Math.round((triSortie / triEntree) * 1000) / 10) : 0;
    const tauxValorisationN1 = triEntreeN1Val > 0 ? Math.min(100, Math.round((triSortieN1Val / triEntreeN1Val) * 1000) / 10) : 0;

    const boutiqueCA = parseFloat(boutiqueCAN.rows[0].total);
    const boutiqueCAN1Val = parseFloat(boutiqueCAN1.rows[0].total);

    const sorties = sortiesInsertion12m.rows[0];
    const tauxSortiesPositives = sorties.total > 0
      ? Math.round((sorties.positives / sorties.total) * 1000) / 10
      : null;

    // CO2 évité : facteur ADEME mix textile = 1.567 t CO2 évitées par t collectée
    // (devra être enrichi par exutoire_type quand disponible — runbook).
    const co2EvitedT = Math.round((collecte / 1000) * 1.567 * 10) / 10;
    const co2EvitedN1T = Math.round((collecteN1Val / 1000) * 1.567 * 10) / 10;

    const refashionEur = parseFloat(refashionTrimestre.rows[0].total);

    // Trésorerie : placeholder (à brancher sur Pennylane si sync OK)
    const tresorerie = null; // null = "à connecter"

    // Évaluer les seuils
    const seuilsMap = Object.fromEntries(
      seuils.rows.map((s) => [s.indicateur, { min: s.seuil_min, max: s.seuil_max, severite: s.severite }])
    );
    function evaluerSeuil(indicateur, valeur) {
      const seuil = seuilsMap[indicateur];
      if (!seuil || valeur == null) return null;
      if (seuil.min != null && valeur < seuil.min) return seuil.severite || 'warning';
      if (seuil.max != null && valeur > seuil.max) return seuil.severite || 'warning';
      return 'ok';
    }

    res.json({
      asOf: new Date().toISOString(),
      periode: { mois: monthStart, jour: today, trimestre, jourMois: dayOfMonth },
      kpis: [
        {
          id: 'tonnage_collecte_mois',
          label: 'Tonnage collecté ce mois',
          value: Math.round(collecte),
          unite: 'kg',
          variation_pct: pctVariation(collecte, collecteN1Val),
          previous: Math.round(collecteN1Val),
          alerte: evaluerSeuil('tonnage_collecte_mois', collecte),
        },
        {
          id: 'taux_valorisation',
          label: 'Taux de valorisation',
          value: tauxValorisation,
          unite: '%',
          variation_pct: pctVariation(tauxValorisation, tauxValorisationN1),
          previous: tauxValorisationN1,
          alerte: evaluerSeuil('taux_valorisation', tauxValorisation),
        },
        {
          id: 'productivite_tri',
          label: 'Productivité tri',
          value: productivite,
          unite: 'kg/pers/j',
          variation_pct: pctVariation(productivite, productiviteN1Val),
          previous: productiviteN1Val,
          alerte: evaluerSeuil('productivite_tri', productivite),
        },
        {
          id: 'ca_boutique_mois',
          label: 'CA boutiques ce mois (HT)',
          value: Math.round(boutiqueCA),
          unite: '€',
          variation_pct: pctVariation(boutiqueCA, boutiqueCAN1Val),
          previous: Math.round(boutiqueCAN1Val),
          alerte: evaluerSeuil('ca_boutique_mois', boutiqueCA),
        },
        {
          id: 'sorties_positives_12m',
          label: 'Sorties positives insertion (12 mois glissants)',
          value: tauxSortiesPositives,
          unite: '%',
          variation_pct: null,
          previous: null,
          context: { positives: sorties.positives, total: sorties.total },
          alerte: evaluerSeuil('sorties_positives_12m', tauxSortiesPositives),
        },
        {
          id: 'co2_evited_t',
          label: 'CO2 évité ce mois',
          value: co2EvitedT,
          unite: 't éq.CO2',
          variation_pct: pctVariation(co2EvitedT, co2EvitedN1T),
          previous: co2EvitedN1T,
          alerte: null,
          context: { facteur_ademe: 1.567, source: 'mix textile générique — à raffiner par exutoire_type' },
        },
        {
          id: 'subvention_refashion_trimestre',
          label: `Subvention Refashion ${year} T${trimestre}`,
          value: Math.round(refashionEur),
          unite: '€',
          variation_pct: null,
          previous: null,
          alerte: refashionEur === 0 ? 'info' : null,
        },
        {
          id: 'tresorerie',
          label: 'Trésorerie (instant)',
          value: tresorerie,
          unite: '€',
          variation_pct: null,
          previous: null,
          alerte: 'unavailable',
          context: { reason: 'Sync Pennylane à brancher (cf RUNBOOK_INFRA_ROADMAP §8)' },
        },
      ],
    });
  } catch (err) {
    console.error('[DASHBOARD] Erreur executive :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
