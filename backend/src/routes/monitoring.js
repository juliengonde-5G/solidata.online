/**
 * MONITORING — Observabilité des chaînes temps réel & jobs (Vague 3 — item 3.D-1)
 *
 * Réponse au constat d'audit (rapports/audit-2026-07-11/structurel/flux-temps-reel-jobs.md,
 * §7-8) : « aucune supervision des chaînes silencieusement cassées ». Ce routeur
 * expose, en lecture ADMIN :
 *  - GET /api/monitoring/jobs      → dernier run de chaque job du scheduler + drapeau
 *    « en retard » si un job périodique n'a pas réussi dans sa fenêtre attendue ;
 *  - GET /api/monitoring/realtime  → fraîcheur des chaînes temps réel (dernière
 *    position GPS, dernière lecture capteur, dernier sync SumUp), statut MQTT et files ;
 *  - GET /api/monitoring/          → synthèse compacte des deux.
 *
 * On expose ces indicateurs ici (authentifié) plutôt que sur /api/health (sonde
 * publique de liveness/readiness) : ils sont opérationnels et ne doivent ni
 * ralentir la sonde du load-balancer ni fuiter d'informations sans authentification.
 *
 * RÉSILIENCE : chaque source est interrogée isolément ; une table absente (base
 * neuve non migrée) ou une source non installée (aucun capteur, MQTT désactivé)
 * donne un statut « unknown » — jamais une erreur 500.
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// ══════════════════════════════════════════
// FONCTIONS PURES (testables en isolation — cf. tests/unit/routes/monitoring.test.js)
// ══════════════════════════════════════════

/**
 * Heures ouvrées de la structure (collecte/tri) : lundi→samedi, 7h→19h.
 * Sert à ne pas signaler « stale » une chaîne temps réel la nuit / le dimanche,
 * où l'absence de données est normale.
 */
function isBusinessHours(now = new Date()) {
  const day = now.getDay(); // 0 = dimanche … 6 = samedi
  const hour = now.getHours();
  return day >= 1 && day <= 6 && hour >= 7 && hour < 19;
}

/**
 * Un job périodique est « en retard » si son dernier SUCCÈS est plus vieux que sa
 * fenêtre attendue.
 *  - cadence inconnue (job hors registre)   → null (indéterminé, non signalé)
 *  - jamais réussi (fresh deploy, jamais tourné) → null (évite une fausse alerte)
 *  - sinon true/false selon l'âge du dernier succès.
 */
function isJobLate(lastSuccessAt, maxAgeMs, now = new Date()) {
  if (!maxAgeMs) return null;
  if (lastSuccessAt == null) return null;
  const age = now.getTime() - new Date(lastSuccessAt).getTime();
  return age > maxAgeMs;
}

/**
 * Fraîcheur d'une chaîne temps réel à partir de l'horodatage de sa dernière donnée.
 *  - lastAt null                          → 'unknown' (source absente / jamais alimentée)
 *  - active=false (ex. hors période VAK)  → 'idle' (pas d'attente de données)
 *  - businessOnly=true hors heures ouvrées→ 'off_hours' (non signalé stale)
 *  - sinon 'fresh' / 'stale' selon le seuil.
 * `stale` (bool) n'est vrai que quand une alerte est réellement pertinente.
 */
function computeFreshness(lastAt, opts = {}) {
  const { thresholdMs, now = new Date(), businessOnly = false, active = true } = opts;
  if (lastAt == null) {
    return { status: 'unknown', last_at: null, age_ms: null, age_minutes: null, stale: false };
  }
  const age = now.getTime() - new Date(lastAt).getTime();
  const ageMinutes = Math.round(age / 60000);
  if (!active) {
    return { status: 'idle', last_at: lastAt, age_ms: age, age_minutes: ageMinutes, stale: false };
  }
  const relevant = !businessOnly || isBusinessHours(now);
  const overdue = thresholdMs != null && age > thresholdMs;
  const status = !relevant ? 'off_hours' : overdue ? 'stale' : 'fresh';
  return { status, last_at: lastAt, age_ms: age, age_minutes: ageMinutes, stale: relevant && overdue };
}

// ══════════════════════════════════════════
// REGISTRE DES JOBS — cadence attendue (source de vérité du drapeau « en retard »)
// maxAgeHours = âge max toléré du dernier succès avant de signaler un retard.
// Doit rester cohérent avec services/scheduler.js (noms de job = 1er argument de
// runInstrumented). Un job absent de ce registre apparaît quand même (late = null).
// ══════════════════════════════════════════
const H = 3600 * 1000;
const DAILY = 26;      // jobs quotidiens ou 3×/j : au moins une fois toutes les 26 h
const WEEKLY = 24 * 8; // 8 jours
const MONTHLY = 24 * 32;
const YEARLY = 24 * 370;

const JOB_SCHEDULE = {
  // ── runAllJobs : 3×/jour (7h/12h/18h) ──
  checkAppointmentReminders:      { label: 'Rappels entretiens J-1',            cadence: '3×/jour (7/12/18h)', maxAgeHours: DAILY },
  checkContractEndings:           { label: 'Fins de contrat J-30/J-15',         cadence: '3×/jour',            maxAgeHours: DAILY },
  checkInsertionMilestones:       { label: 'Jalons insertion',                  cadence: '3×/jour',            maxAgeHours: DAILY },
  checkInsertionInterviewAlerts:  { label: 'Alertes entretiens insertion',      cadence: '3×/jour',            maxAgeHours: DAILY },
  checkPassIaeExpiring:           { label: 'Pass IAE à échéance (J-7/J-2 mois)', cadence: '3×/jour',           maxAgeHours: DAILY },
  checkRenouvellementsAPreparer:  { label: 'Renouvellements CDDI à préparer',   cadence: '3×/jour',            maxAgeHours: DAILY },
  createPostSortieFollowups:      { label: 'Suivis post-sortie (+3 mois)',      cadence: '3×/jour',            maxAgeHours: DAILY },
  purgeInsertionDossiers:         { label: 'Purge RGPD dossiers insertion',     cadence: '3×/jour',            maxAgeHours: DAILY },
  checkRseEcheances:              { label: 'Échéances plan RSE (actions/preuves)', cadence: '3×/jour',          maxAgeHours: DAILY },
  checkEnergieSaisie:             { label: 'Relevés énergie mensuels manquants', cadence: '3×/jour',           maxAgeHours: DAILY },
  checkQhseDocuments:             { label: 'Documents QHSE à réviser (DUERP…)',  cadence: '3×/jour',           maxAgeHours: DAILY },
  checkVehicleMaintenance:        { label: 'Maintenance préventive véhicules',  cadence: '3×/jour',            maxAgeHours: DAILY },
  autoFeedNews:                   { label: 'Veille sectorielle (fil actu)',     cadence: '3×/jour',            maxAgeHours: DAILY },
  purgeExpiredCandidates:         { label: 'Purge RGPD candidats > 24 mois',    cadence: '3×/jour',            maxAgeHours: DAILY },
  purgeOldGpsPositions:           { label: 'Purge RGPD GPS > 90 jours',         cadence: '3×/jour',            maxAgeHours: DAILY },
  purgeExpiredRefreshTokens:      { label: 'Purge refresh tokens expirés',      cadence: '3×/jour',            maxAgeHours: DAILY },
  refreshMaterializedViews:       { label: 'Refresh vues matérialisées',        cadence: '3×/jour',            maxAgeHours: DAILY },
  scanBoutiqueCSVFolders:         { label: 'Scan CSV caisse boutiques',         cadence: '3×/jour + 20h',      maxAgeHours: DAILY },
  collectBoutiqueWeather:         { label: 'Collecte météo boutiques',          cadence: '3×/jour',            maxAgeHours: DAILY },
  syncVakSumUp:                   { label: 'Sync SumUp (VAK)',                  cadence: '3×/jour + horaire en VAK', maxAgeHours: DAILY },
  captureVakWeather:              { label: 'Météo VAK',                         cadence: '3×/jour',            maxAgeHours: DAILY },
  purgeOldJobRuns:                { label: 'Purge journal des jobs > 30 j',     cadence: '3×/jour',            maxAgeHours: DAILY },
  // ── quotidiens ciblés ──
  syncPennylaneDaily:             { label: 'Sync Pennylane (GL + transactions)', cadence: 'quotidien 2h',      maxAgeHours: DAILY },
  syncPennylaneInvoicesDaily:     { label: 'Sync factures clients Pennylane',    cadence: 'quotidien 4h',      maxAgeHours: DAILY },
  generateDailyPredictions:       { label: 'Prédictions remplissage J..J+7',     cadence: 'quotidien 5h',      maxAgeHours: DAILY },
  generateNextDayDispatchProposals:{ label: 'Dispatch auto J-1',                 cadence: 'quotidien 18h',     maxAgeHours: DAILY },
  // ── hebdo / mensuel / annuel ──
  // Sauvegarde auto BDD (Lot 11) : mardi & vendredi 4h → plus grand intervalle
  // entre deux succès = 4 jours (ven→mar) ; tolérance 5 jours avant « en retard ».
  autoDatabaseBackup:             { label: 'Sauvegarde auto BDD (pg_dump)',      cadence: 'mardi & vendredi 4h', maxAgeHours: 24 * 5 },
  checkQhseHabilitationExpiries:  { label: 'Habilitations QHSE à échéance',      cadence: 'hebdo (lundi 8h)',  maxAgeHours: WEEKLY },
  discoverEvents:                 { label: 'Découverte événements locaux',       cadence: 'mensuel (1er 4h)',  maxAgeHours: MONTHLY },
  recalcSeasonalFactors:          { label: 'Recalcul facteurs saisonniers',      cadence: 'mensuel (1er 4h)',  maxAgeHours: MONTHLY },
  syncAllHolidays:                { label: 'Sync jours fériés / vacances',       cadence: 'annuel (1er janv.)', maxAgeHours: YEARLY },
};

// Seuils de fraîcheur temps réel (surchargeable par env).
const GPS_STALE_MS    = (Number(process.env.MONITOR_GPS_STALE_HOURS)    || 12) * H; // heures ouvrées
const SENSOR_STALE_MS = (Number(process.env.MONITOR_SENSOR_STALE_HOURS) || 6)  * H; // 24/7 (capteurs)
const SUMUP_STALE_MS  = (Number(process.env.MONITOR_SUMUP_STALE_HOURS)  || 2)  * H; // pendant une VAK

// ══════════════════════════════════════════
// COLLECTE (résiliente)
// ══════════════════════════════════════════

async function safeScalar(sql, params = []) {
  try {
    const r = await pool.query(sql, params);
    return { ok: true, row: r.rows[0] || {} };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Dernier run + dernier succès de chaque job → liste enrichie du drapeau « en retard ». */
async function computeJobsReport(now = new Date()) {
  let lastRuns = [];
  let successes = [];
  let tableAvailable = true;
  try {
    const r = await pool.query(
      `SELECT DISTINCT ON (job_name) job_name, started_at, finished_at, status,
              error_message, items_processed, duration_ms
       FROM job_runs ORDER BY job_name, started_at DESC`
    );
    lastRuns = r.rows;
    const s = await pool.query(
      `SELECT DISTINCT ON (job_name) job_name, started_at AS last_success_at
       FROM job_runs WHERE status = 'success' ORDER BY job_name, started_at DESC`
    );
    successes = s.rows;
  } catch (err) {
    tableAvailable = false; // job_runs pas encore créée (base neuve) → dégradation douce
  }

  const lastRunMap = Object.fromEntries(lastRuns.map((r) => [r.job_name, r]));
  const successMap = Object.fromEntries(successes.map((r) => [r.job_name, r.last_success_at]));
  const names = [...new Set([...Object.keys(JOB_SCHEDULE), ...lastRuns.map((r) => r.job_name)])].sort();

  const jobs = names.map((name) => {
    const sched = JOB_SCHEDULE[name] || null;
    const last = lastRunMap[name] || null;
    const lastSuccess = successMap[name] || null;
    const maxAgeMs = sched ? sched.maxAgeHours * H : null;
    return {
      job_name: name,
      label: sched ? sched.label : null,
      cadence: sched ? sched.cadence : null,
      registered: !!sched,
      never_ran: !last,
      last_run: last
        ? {
            started_at: last.started_at,
            finished_at: last.finished_at,
            status: last.status,
            error_message: last.error_message,
            items_processed: last.items_processed,
            duration_ms: last.duration_ms,
          }
        : null,
      last_success_at: lastSuccess,
      late: isJobLate(lastSuccess, maxAgeMs, now),
    };
  });

  return {
    table_available: tableAvailable,
    count: jobs.length,
    late_count: jobs.filter((j) => j.late === true).length,
    error_count: jobs.filter((j) => j.last_run && j.last_run.status && j.last_run.status !== 'success').length,
    jobs,
  };
}

/** Fraîcheur des chaînes temps réel + statut MQTT + files BullMQ. */
async function computeRealtimeReport(now = new Date()) {
  const out = { generated_at: now.toISOString(), business_hours: isBusinessHours(now) };

  // GPS (positions chauffeurs) — pertinent en heures ouvrées seulement.
  const gps = await safeScalar('SELECT MAX(recorded_at) AS last FROM gps_positions');
  out.gps_positions = gps.ok
    ? { ...computeFreshness(gps.row.last, { thresholdMs: GPS_STALE_MS, now, businessOnly: true }),
        threshold_minutes: Math.round(GPS_STALE_MS / 60000),
        note: 'Aucune position en heures ouvrées peut aussi signifier « pas de tournée » (informatif).' }
    : { status: 'unknown', error: gps.error };

  // Capteurs CAV (LoRaWAN) — remontent 24/7 ; « unknown » si aucun capteur installé.
  const sensor = await safeScalar('SELECT MAX(reading_at) AS last FROM cav_sensor_readings');
  out.sensor_readings = sensor.ok
    ? { ...computeFreshness(sensor.row.last, { thresholdMs: SENSOR_STALE_MS, now, businessOnly: false }),
        threshold_minutes: Math.round(SENSOR_STALE_MS / 60000) }
    : { status: 'unknown', error: sensor.error };

  // SumUp (VAK) — pertinent uniquement pendant une VAK active.
  const vak = await safeScalar(
    "SELECT EXISTS(SELECT 1 FROM vaks WHERE CURRENT_DATE BETWEEN date_debut AND date_fin) AS active"
  );
  const vakActive = vak.ok ? !!vak.row.active : false;
  const sumup = await safeScalar(
    `SELECT MAX(started_at) AS last,
            MAX(started_at) FILTER (WHERE status = 'success') AS last_success
     FROM vak_sumup_sync_log`
  );
  out.sumup_sync = sumup.ok
    ? { ...computeFreshness(sumup.row.last, { thresholdMs: SUMUP_STALE_MS, now, active: vakActive }),
        vak_active: vakActive,
        last_success_at: sumup.row.last_success || null,
        threshold_minutes: Math.round(SUMUP_STALE_MS / 60000),
        note: vakActive ? 'VAK en cours : une absence de sync est anormale.' : 'Hors période VAK : aucune transaction attendue.' }
    : { status: 'unknown', error: sumup.error };

  // MQTT (Orange Live Objects) — ingestion capteurs.
  try {
    const { getMqttStatus } = require('../services/liveobjects-mqtt');
    const s = getMqttStatus();
    out.mqtt = {
      status: !s.enabled ? 'disabled' : s.connected ? 'connected' : 'disconnected',
      ...s,
    };
  } catch (err) {
    out.mqtt = { status: 'unknown', error: err.message };
  }

  // Files BullMQ (OCR / PDF) — best-effort.
  try {
    const { getQueueStatus } = require('../services/job-queue');
    out.queues = typeof getQueueStatus === 'function' ? await getQueueStatus() : { status: 'unknown' };
  } catch (err) {
    out.queues = { status: 'unknown', error: err.message };
  }

  return out;
}

// ══════════════════════════════════════════
// ROUTES (ADMIN)
// ══════════════════════════════════════════
router.use(authenticate);
router.use(authorize('ADMIN'));

// GET /api/monitoring/jobs — dernier run par job + drapeau « en retard »
router.get('/jobs', async (req, res) => {
  try {
    const report = await computeJobsReport(new Date());
    res.json({ generated_at: new Date().toISOString(), ...report });
  } catch (err) {
    console.error('[MONITORING] jobs error:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/monitoring/realtime — fraîcheur des chaînes temps réel
router.get('/realtime', async (req, res) => {
  try {
    res.json(await computeRealtimeReport(new Date()));
  } catch (err) {
    console.error('[MONITORING] realtime error:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/monitoring — synthèse compacte (jobs + temps réel)
router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const [jobs, realtime] = await Promise.all([computeJobsReport(now), computeRealtimeReport(now)]);
    const staleChains = ['gps_positions', 'sensor_readings', 'sumup_sync']
      .filter((k) => realtime[k] && realtime[k].stale === true);
    res.json({
      generated_at: now.toISOString(),
      jobs: {
        table_available: jobs.table_available,
        count: jobs.count,
        late_count: jobs.late_count,
        error_count: jobs.error_count,
        late_jobs: jobs.jobs.filter((j) => j.late === true).map((j) => j.job_name),
      },
      realtime: {
        business_hours: realtime.business_hours,
        stale_chains: staleChains,
        mqtt: realtime.mqtt ? realtime.mqtt.status : 'unknown',
      },
      healthy: jobs.late_count === 0 && staleChains.length === 0,
    });
  } catch (err) {
    console.error('[MONITORING] summary error:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
// Exposés pour les tests unitaires de la logique pure (retard / staleness).
module.exports.isBusinessHours = isBusinessHours;
module.exports.isJobLate = isJobLate;
module.exports.computeFreshness = computeFreshness;
module.exports.JOB_SCHEDULE = JOB_SCHEDULE;
