const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// GET /api/dashboard/kpis — KPIs agrégés pour la page d'accueil
router.get('/kpis', async (req, res) => {
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
      // Kg triés ce mois (sorties tri)
      pool.query(
        `SELECT COALESCE(SUM(kg_entree), 0) as total
         FROM production_daily WHERE date >= $1`,
        [monthStart]
      ),
      // Kg triés aujourd'hui
      pool.query(
        `SELECT COALESCE(SUM(kg_entree), 0) as total
         FROM production_daily WHERE date = $1`,
        [today]
      ),
      // Total trié ce mois (pour taux valorisation — sorties valorisées)
      pool.query(
        `SELECT COALESCE(SUM(total_jour_t), 0) as total
         FROM production_daily WHERE date >= $1`,
        [monthStart]
      ),
      // Total entré ce mois (pour taux valorisation — entrées brutes)
      pool.query(
        `SELECT COALESCE(SUM(kg_entree), 0) as total
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
        `SELECT sm.type, sm.quantity, sm.reference, sm.created_at
         FROM stock_movements sm
         ORDER BY sm.created_at DESC LIMIT 5`
      ),
    ]);

    // ══════════════════════════════════════════
    // Calcul du taux de valorisation
    // ══════════════════════════════════════════
    const totalTrieT = parseFloat(totalTrieMois.rows[0].total) || 0;
    const totalEntreeKg = parseFloat(totalEntreeMois.rows[0].total) || 0;
    const tauxValorisation = totalEntreeKg > 0
      ? Math.round((totalTrieT * 1000 / totalEntreeKg) * 1000) / 10
      : 0;

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
    // Réponse JSON
    // ══════════════════════════════════════════
    const stockTotalKg = parseFloat(stockTotal.rows[0].total) || 0;

    res.json({
      collecte: {
        tonnage_mois: Math.round(parseFloat(tonnageMois.rows[0].total) || 0),
        tours_aujourdhui: parseInt(toursAujourdhui.rows[0].count),
        tours_en_cours: nbToursEnCours,
        cav_actifs: parseInt(cavActifs.rows[0].count),
      },
      production: {
        kg_trie_mois: Math.round(parseFloat(kgTrieMois.rows[0].total) || 0),
        kg_trie_aujourdhui: Math.round(parseFloat(kgTrieAujourdhui.rows[0].total) || 0),
        taux_valorisation: tauxValorisation,
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

module.exports = router;
