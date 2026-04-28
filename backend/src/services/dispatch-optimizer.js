// ══════════════════════════════════════════════════════════════
// Dispatch automatique J-1 (Niveau 3.1)
// ══════════════════════════════════════════════════════════════
//
// Pour chaque véhicule « available », crée (si absente) une tournée
// intelligente brouillon (status='planned') pour le lendemain. Elle est
// marquée `mode='intelligent'` et sera validée/modifiée manuellement par
// le manager le matin. Idempotent : ne recrée pas si une tournée
// existe déjà pour (véhicule, date).

const pool = require('../config/database');
const { generateIntelligentTour } = require('../routes/tours/smart-tour');

function nextDayISO(baseDate = new Date()) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function generateNextDayDispatchProposals() {
  const date = nextDayISO();
  const started = Date.now();
  const results = { date, created: 0, skipped_existing: 0, errors: 0, details: [] };

  try {
    // 1) Véhicules disponibles
    const vehiclesRes = await pool.query(
      `SELECT id, registration, name FROM vehicles
        WHERE status = 'available'
        ORDER BY name, registration`
    );
    const vehicles = vehiclesRes.rows;
    if (vehicles.length === 0) {
      console.log(`[DISPATCH] Aucun véhicule disponible pour ${date}`);
      return results;
    }

    // 2) Pour chacun : créer la tournée brouillon si pas déjà existante
    for (const v of vehicles) {
      try {
        const existing = await pool.query(
          `SELECT id FROM tours WHERE vehicle_id = $1 AND date = $2 AND status NOT IN ('completed', 'cancelled')`,
          [v.id, date]
        );
        if (existing.rows.length > 0) {
          results.skipped_existing++;
          results.details.push({ vehicle: v.registration, skipped: 'tour_already_exists', tour_id: existing.rows[0].id });
          continue;
        }

        const plan = await generateIntelligentTour(v.id, date);
        if (!plan?.cavList?.length) {
          results.details.push({ vehicle: v.registration, skipped: 'empty_plan' });
          continue;
        }

        const tourRes = await pool.query(
          `INSERT INTO tours (date, vehicle_id, mode, status, ai_explanation,
                              estimated_distance_km, estimated_duration_min, nb_cav)
           VALUES ($1, $2, 'intelligent', 'planned', $3, $4, $5, $6)
           RETURNING id`,
          [
            date, v.id,
            `[Auto J-1] ${plan.explanation || ''}`.slice(0, 900),
            plan.stats?.totalDistance || null,
            plan.stats?.estimatedDuration || null,
            plan.stats?.totalCavs || plan.cavList.length,
          ]
        );
        const tourId = tourRes.rows[0].id;

        for (const c of plan.cavList) {
          await pool.query(
            `INSERT INTO tour_cav (tour_id, cav_id, position, predicted_fill_rate)
             VALUES ($1, $2, $3, $4)`,
            [tourId, c.cav_id, c.position, c.predicted_fill ?? null]
          );
        }

        results.created++;
        results.details.push({
          vehicle: v.registration,
          tour_id: tourId,
          nb_cav: plan.cavList.length,
          distance_km: plan.stats?.totalDistance,
        });
      } catch (err) {
        results.errors++;
        results.details.push({ vehicle: v.registration, error: err.message });
        console.warn(`[DISPATCH] Véhicule ${v.registration} : ${err.message}`);
      }
    }

    console.log(`[DISPATCH] ${date} — ${results.created} créées · ${results.skipped_existing} existantes · ${results.errors} erreurs (${Math.round((Date.now() - started) / 1000)}s)`);
    return results;
  } catch (err) {
    console.error('[DISPATCH] Erreur globale :', err.message);
    return { ...results, global_error: err.message };
  }
}

module.exports = { generateNextDayDispatchProposals };
