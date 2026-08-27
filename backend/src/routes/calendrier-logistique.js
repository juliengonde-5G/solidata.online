const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
// Source UNIQUE du pas de récurrence : réécrire une variante ici est
// exactement ce qui a produit le défaut corrigé plus bas (valeurs fantômes).
const { avancerEcheance, normaliserDate, jourDuMois, PAS_RECURRENCE } = require('../services/commandes-recurrence');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

// Helper: get ISO week string (e.g. "2026-W12")
function getISOWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// Helper: get Monday of ISO week for a given date
function getWeekMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// Helper: get Sunday of the week
function getWeekSunday(monday) {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday;
}

// Helper: format date as YYYY-MM-DD
function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

// Helper: generate all weeks between two dates
function generateWeeks(dateFrom, dateTo) {
  const weeks = [];
  let current = getWeekMonday(new Date(dateFrom));
  const end = new Date(dateTo);

  while (current <= end) {
    const sunday = getWeekSunday(current);
    weeks.push({
      semaine: getISOWeek(current),
      date_debut: formatDate(current),
      date_fin: formatDate(sunday)
    });
    current = new Date(current);
    current.setDate(current.getDate() + 7);
  }
  return weeks;
}

// Helper: calculate hours between two dates
function hoursBetween(start, end) {
  return Math.abs(new Date(end) - new Date(start)) / (1000 * 60 * 60);
}

// GET /api/calendrier-logistique — Forecast calendar
router.get('/', async (req, res) => {
  try {
    const today = new Date();
    const defaultTo = new Date(today);
    defaultTo.setMonth(defaultTo.getMonth() + 3);

    const date_from = req.query.date_from || formatDate(today);
    const date_to = req.query.date_to || formatDate(defaultTo);

    // 1. Get all preparations in the date range with commande info
    const preparationsResult = await pool.query(
      `SELECT p.id as preparation_id, p.lieu_chargement, p.date_livraison_remorque,
              p.date_expedition, p.statut_preparation,
              c.id as commande_id, c.reference, c.type_produit, c.tonnage_prevu, c.prix_tonne,
              cl.raison_sociale
       FROM preparations_expedition p
       JOIN commandes_exutoires c ON p.commande_id = c.id
       JOIN clients_exutoires cl ON c.client_id = cl.id
       WHERE p.date_expedition >= $1 AND p.date_livraison_remorque <= $2
       ORDER BY p.date_expedition`,
      [date_from, date_to]
    );

    // 2. Modèles récurrents ACTIFS, pour projeter les échéances à venir.
    //
    // DEUX DÉFAUTS CORRIGÉS ICI (lot L7, contrat §8.2) :
    //  (a) Les fréquences testées — « bimensuelle », « mensuelle »,
    //      « trimestrielle » — N'EXISTENT PAS dans le CHECK SQL de
    //      `commandes_exutoires.frequence`, dont les seules valeurs sont
    //      `unique | hebdomadaire | bi_mensuel | mensuel`. Seul l'hebdomadaire
    //      était donc projeté : un contrat mensuel n'apparaissait NULLE PART au
    //      calendrier prévisionnel, sans le moindre message.
    //  (b) L'anti-double-compte comparait `preparation.commande_id` à l'id du
    //      MODÈLE. Or une occurrence matérialisée est une commande FILLE : sa
    //      préparation porte l'id de la fille, jamais celui du modèle. La clé ne
    //      pouvait donc jamais correspondre — une occurrence réellement créée
    //      était comptée DEUX FOIS (une fois réelle, une fois projetée).
    //      On saute désormais toute date déjà matérialisée par une fille.
    //
    // `recurrence_suspendue` est une colonne récente : sur une base non encore
    // migrée la requête est rejouée sans elle plutôt que de rendre tout le
    // calendrier indisponible.
    const SQL_MODELES = (avecSuspension) => `
      SELECT c.id, c.reference, c.type_produit, c.tonnage_prevu, c.prix_tonne,
             c.frequence, c.date_commande, c.date_fin_recurrence,
             cl.raison_sociale
      FROM commandes_exutoires c
      JOIN clients_exutoires cl ON c.client_id = cl.id
      WHERE c.frequence != 'unique'
        AND c.commande_parent_id IS NULL
        AND c.statut NOT IN ('annulee', 'cloturee')
        ${avecSuspension ? 'AND COALESCE(c.recurrence_suspendue, false) = false' : ''}`;

    let recurringResult;
    try {
      recurringResult = await pool.query(SQL_MODELES(true));
    } catch (err) {
      if (err && err.code === '42703') {
        console.warn('[CALENDRIER-LOGISTIQUE] Colonne recurrence_suspendue absente (base non migrée) — projection sans filtre de suspension.');
        recurringResult = await pool.query(SQL_MODELES(false));
      } else {
        throw err;
      }
    }

    // Occurrences DÉJÀ matérialisées (commandes filles) : elles apparaissent
    // comme de vraies commandes, il ne faut pas les reprojeter par-dessus.
    const modeleIds = recurringResult.rows.map((c) => c.id);
    const datesMaterialisees = new Set();
    if (modeleIds.length > 0) {
      const filles = await pool.query(
        `SELECT commande_parent_id, date_commande
           FROM commandes_exutoires
          WHERE commande_parent_id = ANY($1::int[])`,
        [modeleIds]
      );
      for (const f of filles.rows) {
        const d = normaliserDate(f.date_commande);
        if (d) datesMaterialisees.add(`${f.commande_parent_id}-${d}`);
      }
    }
    // Une préparation déjà planifiée sur le modèle lui-même vaut aussi
    // matérialisation pour cette date (cas d'avant la récurrence automatique).
    for (const p of preparationsResult.rows) {
      const d = normaliserDate(p.date_expedition);
      if (d) datesMaterialisees.add(`${p.commande_id}-${d}`);
    }

    // Project recurring commande dates into the range
    const projectedExpeditions = [];
    for (const cmd of recurringResult.rows) {
      if (!PAS_RECURRENCE[cmd.frequence]) continue; // fréquence inconnue : rien d'inventé

      const rangeStart = normaliserDate(date_from);
      const rangeEnd = normaliserDate(date_to);
      const debut = normaliserDate(cmd.date_commande);
      if (!rangeStart || !rangeEnd || !debut) continue;

      const finRecurrence = normaliserDate(cmd.date_fin_recurrence);
      const effectiveEnd = finRecurrence && finRecurrence < rangeEnd ? finRecurrence : rangeEnd;

      // Quantième de référence pour le pas mensuel (cf. ajouterMois) : sans lui
      // un mensuel du 31 se figerait au 28 après le premier février projeté.
      const jourAncre = jourDuMois(debut);

      // Avancer jusqu'au début de la fenêtre. La date de la commande d'origine
      // EST la première occurrence : on part d'elle, puis on avance d'un pas.
      let nextDate = debut;
      let garde = 0;
      while (nextDate && nextDate < rangeStart && garde++ < 2000) {
        nextDate = avancerEcheance(nextDate, cmd.frequence, jourAncre);
      }

      while (nextDate && nextDate <= effectiveEnd && garde++ < 2000) {
        if (!datesMaterialisees.has(`${cmd.id}-${nextDate}`)) {
          projectedExpeditions.push({
            commande_id: cmd.id,
            reference: cmd.reference,
            type_produit: cmd.type_produit,
            tonnage_prevu: cmd.tonnage_prevu,
            prix_tonne: cmd.prix_tonne,
            raison_sociale: cmd.raison_sociale,
            date_expedition: nextDate,
            is_projected: true
          });
        }
        nextDate = avancerEcheance(nextDate, cmd.frequence, jourAncre);
      }
    }

    // 3. Generate weeks and group data
    const weeks = generateWeeks(date_from, date_to);
    const WEEKLY_CAPACITY_HOURS = 5 * 8; // 5 working days * 8 hours

    let totalExpeditions = 0;
    let totalTonnage = 0;
    let totalCA = 0;

    for (const week of weeks) {
      const weekStart = new Date(week.date_debut);
      const weekEnd = new Date(week.date_fin);
      weekEnd.setHours(23, 59, 59, 999);

      // Filter preparations for this week
      const weekPreps = preparationsResult.rows.filter(p => {
        const expDate = new Date(p.date_expedition);
        return expDate >= weekStart && expDate <= weekEnd;
      });

      // Filter projected expeditions for this week
      const weekProjected = projectedExpeditions.filter(p => {
        const expDate = new Date(p.date_expedition);
        return expDate >= weekStart && expDate <= weekEnd;
      });

      // Build expeditions list
      const expeditions = [];
      for (const p of weekPreps) {
        expeditions.push({
          commande_ref: p.reference,
          client: p.raison_sociale,
          type_produit: p.type_produit,
          date_expedition: formatDate(new Date(p.date_expedition)),
          tonnage: parseFloat(p.tonnage_prevu) || 0
        });
      }
      for (const p of weekProjected) {
        expeditions.push({
          commande_ref: p.reference,
          client: p.raison_sociale,
          type_produit: p.type_produit,
          date_expedition: p.date_expedition,
          tonnage: parseFloat(p.tonnage_prevu) || 0,
          projete: true
        });
      }

      // Calculate occupation per lieu
      const occupationHours = {
        quai_chargement: 0,
        garage_remorque: 0,
        cours: 0
      };

      for (const p of weekPreps) {
        const lieu = p.lieu_chargement;
        if (occupationHours[lieu] !== undefined) {
          const hours = hoursBetween(p.date_livraison_remorque, p.date_expedition);
          occupationHours[lieu] += hours;
        }
      }

      const occupation_lieux = {
        quai_chargement: Math.round((occupationHours.quai_chargement / WEEKLY_CAPACITY_HOURS) * 100),
        garage_remorque: Math.round((occupationHours.garage_remorque / WEEKLY_CAPACITY_HOURS) * 100),
        cours: Math.round((occupationHours.cours / WEEKLY_CAPACITY_HOURS) * 100)
      };

      const weekTonnage = expeditions.reduce((sum, e) => sum + e.tonnage, 0);
      const weekCA = weekPreps.reduce((sum, p) => {
        return sum + (parseFloat(p.tonnage_prevu) || 0) * (parseFloat(p.prix_tonne) || 0);
      }, 0) + weekProjected.reduce((sum, p) => {
        return sum + (parseFloat(p.tonnage_prevu) || 0) * (parseFloat(p.prix_tonne) || 0);
      }, 0);

      week.nb_expeditions = expeditions.length;
      week.tonnage_prevu = parseFloat(weekTonnage.toFixed(2));
      week.ca_previsionnel = parseFloat(weekCA.toFixed(2));
      week.occupation_lieux = occupation_lieux;
      week.expeditions = expeditions;

      totalExpeditions += expeditions.length;
      totalTonnage += weekTonnage;
      totalCA += weekCA;
    }

    res.json({
      semaines: weeks,
      resume: {
        total_expeditions: totalExpeditions,
        total_tonnage: parseFloat(totalTonnage.toFixed(2)),
        total_ca: parseFloat(totalCA.toFixed(2))
      }
    });
  } catch (err) {
    console.error('[CALENDRIER-LOGISTIQUE] Erreur calendrier previsionnel :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/calendrier-logistique/alertes — Generate alerts
router.get('/alertes', async (req, res) => {
  try {
    const alertes = [];
    const today = new Date();
    const in30Days = new Date(today);
    in30Days.setDate(in30Days.getDate() + 30);
    const in7Days = new Date(today);
    in7Days.setDate(in7Days.getDate() + 7);

    const todayStr = formatDate(today);
    const in30Str = formatDate(in30Days);
    const in7Str = formatDate(in7Days);

    // 1. Surcharge lieu — check occupation > 80% for upcoming weeks
    const preparationsResult = await pool.query(
      `SELECT p.lieu_chargement, p.date_livraison_remorque, p.date_expedition
       FROM preparations_expedition p
       WHERE p.date_expedition >= $1 AND p.date_livraison_remorque <= $2`,
      [todayStr, in30Str]
    );

    const weeks = generateWeeks(todayStr, in30Str);
    const WEEKLY_CAPACITY_HOURS = 5 * 8;

    for (const week of weeks) {
      const weekStart = new Date(week.date_debut);
      const weekEnd = new Date(week.date_fin);
      weekEnd.setHours(23, 59, 59, 999);

      const occupationHours = { quai_chargement: 0, garage_remorque: 0, cours: 0 };

      for (const p of preparationsResult.rows) {
        const expDate = new Date(p.date_expedition);
        if (expDate >= weekStart && expDate <= weekEnd) {
          const lieu = p.lieu_chargement;
          if (occupationHours[lieu] !== undefined) {
            occupationHours[lieu] += hoursBetween(p.date_livraison_remorque, p.date_expedition);
          }
        }
      }

      for (const [lieu, hours] of Object.entries(occupationHours)) {
        const pct = Math.round((hours / WEEKLY_CAPACITY_HOURS) * 100);
        if (pct > 80) {
          alertes.push({
            type: 'surcharge_lieu',
            severity: 'warning',
            message: `Surcharge du lieu "${lieu}" la semaine ${week.semaine} : ${pct}% d'occupation`,
            data: { semaine: week.semaine, lieu, occupation_pct: pct }
          });
        }
      }

      // 2. Semaine vide — check for weeks with 0 expeditions
      const weekPreps = preparationsResult.rows.filter(p => {
        const expDate = new Date(p.date_expedition);
        return expDate >= weekStart && expDate <= weekEnd;
      });

      if (weekPreps.length === 0) {
        alertes.push({
          type: 'semaine_vide',
          severity: 'warning',
          message: `Aucune expedition prevue pour la semaine ${week.semaine}`,
          data: { semaine: week.semaine, date_debut: week.date_debut, date_fin: week.date_fin }
        });
      }
    }

    // 3. Stock insuffisant — compare stock vs upcoming tonnage
    const upcomingTonnageResult = await pool.query(
      `SELECT COALESCE(SUM(c.tonnage_prevu), 0) as total_tonnage_prevu
       FROM commandes_exutoires c
       WHERE c.statut NOT IN ('annulee', 'cloturee', 'expediee', 'facturee')
         AND c.date_commande <= $1`,
      [in30Str]
    );
    const totalTonnagePrevu = parseFloat(upcomingTonnageResult.rows[0].total_tonnage_prevu) || 0;

    const stockResult = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'entree' THEN poids_kg ELSE 0 END), 0) as total_entrees,
         COALESCE(SUM(CASE WHEN type = 'sortie' THEN poids_kg ELSE 0 END), 0) as total_sorties
       FROM stock_movements`
    );
    const currentStockKg = parseFloat(stockResult.rows[0].total_entrees) - parseFloat(stockResult.rows[0].total_sorties);
    const currentStockTonnes = currentStockKg / 1000;

    if (currentStockTonnes < totalTonnagePrevu) {
      alertes.push({
        type: 'stock_insuffisant',
        severity: 'danger',
        message: `Stock insuffisant : ${currentStockTonnes.toFixed(2)}t disponible pour ${totalTonnagePrevu.toFixed(2)}t prevues dans les 30 prochains jours`,
        data: {
          stock_disponible_tonnes: parseFloat(currentStockTonnes.toFixed(2)),
          tonnage_prevu: parseFloat(totalTonnagePrevu.toFixed(2)),
          deficit_tonnes: parseFloat((totalTonnagePrevu - currentStockTonnes).toFixed(2))
        }
      });
    }

    // 4. Commande sans preparation — confirmee + date < today+7 but no preparation
    const sansPrepResult = await pool.query(
      `SELECT c.id, c.reference, c.type_produit, c.date_commande, cl.raison_sociale
       FROM commandes_exutoires c
       JOIN clients_exutoires cl ON c.client_id = cl.id
       WHERE c.statut = 'confirmee'
         AND c.date_commande <= $1
         AND NOT EXISTS (
           SELECT 1 FROM preparations_expedition p WHERE p.commande_id = c.id
         )`,
      [in7Str]
    );

    for (const cmd of sansPrepResult.rows) {
      alertes.push({
        type: 'preparation_manquante',
        severity: 'danger',
        message: `Commande ${cmd.reference} (${cmd.raison_sociale}) confirmee sans preparation, expedition prevue avant le ${in7Str}`,
        data: {
          commande_id: cmd.id,
          reference: cmd.reference,
          client: cmd.raison_sociale,
          type_produit: cmd.type_produit,
          date_commande: formatDate(new Date(cmd.date_commande))
        }
      });
    }

    res.json({ alertes });
  } catch (err) {
    console.error('[CALENDRIER-LOGISTIQUE] Erreur alertes :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/calendrier-logistique/planning-collaborateurs — Staff planning
router.get('/planning-collaborateurs', async (req, res) => {
  try {
    const today = new Date();
    const defaultTo = new Date(today);
    defaultTo.setMonth(defaultTo.getMonth() + 1);

    const date_from = req.query.date_from || formatDate(today);
    const date_to = req.query.date_to || formatDate(defaultTo);

    const result = await pool.query(
      `SELECT s.employee_id, s.date, s.notes,
              e.first_name, e.last_name,
              p.lieu_chargement, p.date_livraison_remorque, p.date_expedition,
              c.reference as commande_ref
       FROM schedule s
       JOIN employees e ON s.employee_id = e.id
       LEFT JOIN preparation_collaborateurs pc ON pc.employee_id = s.employee_id
       LEFT JOIN preparations_expedition p ON pc.preparation_id = p.id
         AND DATE(p.date_expedition) = s.date
       LEFT JOIN commandes_exutoires c ON p.commande_id = c.id
       WHERE s.shift_type = 'chargement_exutoire'
         AND s.date >= $1
         AND s.date <= $2
       ORDER BY e.last_name, e.first_name, s.date`,
      [date_from, date_to]
    );

    // Group by employee
    const employeeMap = new Map();
    for (const row of result.rows) {
      const key = row.employee_id;
      if (!employeeMap.has(key)) {
        employeeMap.set(key, {
          employee_id: row.employee_id,
          nom: `${row.last_name} ${row.first_name}`,
          plannings: []
        });
      }

      employeeMap.get(key).plannings.push({
        date: formatDate(new Date(row.date)),
        commande_ref: row.commande_ref || null,
        lieu: row.lieu_chargement || null,
        horaire: '08:00-16:00'
      });
    }

    res.json({ collaborateurs: Array.from(employeeMap.values()) });
  } catch (err) {
    console.error('[CALENDRIER-LOGISTIQUE] Erreur planning collaborateurs :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
