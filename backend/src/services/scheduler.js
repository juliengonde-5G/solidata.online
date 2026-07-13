/**
 * Scheduler CRON — Execute les triggers automatiques
 * - Rappel entretien J-1
 * - Fin de contrat J-30 et J-15
 * - Jalons insertion (Diagnostic M+1, M+3, M+6, M+10)
 * - Alertes planification entretiens insertion
 * - Maintenance preventive vehicules
 * - Veille sectorielle auto-feed news
 */
const pool = require('../config/database');

const BREVO_API_KEY = process.env.BREVO_API_KEY;

// ══════════════════════════════════════════
// INSTRUMENTATION DES JOBS (Vague 3 — item 3.D-1 a/b)
// Wrapper générique qui OBSERVE un job sans changer son comportement :
//  - journalise chaque run dans job_runs (début/fin/statut/erreur/volume) ;
//  - borne la durée par un timeout (Promise.race ~5 min) pour qu'un job bloqué
//    (fetch Brevo/Open-Meteo/SumUp/Pennylane sans timeout) ne gèle plus la
//    chaîne séquentielle ni ne retienne le verrou indéfiniment.
// Le timeout ne peut pas annuler le job sous-jacent (pas d'AbortController
// propagé jusqu'aux appels externes), mais il débloque la séquence : le job
// suivant s'exécute et runAllJobs se termine → le verrou est libéré.
// ══════════════════════════════════════════

// Délai max par job avant de considérer qu'il est bloqué et de rendre la main.
const JOB_TIMEOUT_MS = Number(process.env.SCHEDULER_JOB_TIMEOUT_MS) || 5 * 60 * 1000;

// Déduit un volume traité (items_processed) de la valeur de retour du job, sans
// imposer de contrat aux jobs existants (la plupart renvoient undefined → null).
function extractItemsProcessed(result) {
  if (typeof result === 'number' && Number.isFinite(result)) return Math.trunc(result);
  if (result && typeof result === 'object') {
    for (const k of ['items', 'inserted', 'generated', 'synced', 'imported', 'processed', 'count', 'rowCount']) {
      const v = result[k];
      if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
    }
  }
  return null;
}

// Écrit une ligne de journal. RÉSILIENT : un échec d'écriture (table absente sur
// une base non encore migrée, DB indisponible) ne doit JAMAIS casser le job.
async function recordJobRun(jobName, startedAt, finishedAt, status, errorMessage, itemsProcessed, durationMs) {
  try {
    await pool.query(
      `INSERT INTO job_runs (job_name, started_at, finished_at, status, error_message, items_processed, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [jobName, startedAt, finishedAt, status, errorMessage ? String(errorMessage).slice(0, 2000) : null,
       itemsProcessed, durationMs]
    );
  } catch (err) {
    console.error(`[SCHEDULER] Journalisation job_runs impossible pour ${jobName} :`, err.message);
  }
}

/**
 * Exécute `fn` en l'observant : timeout + journal job_runs.
 * N'altère pas le comportement du job (retour de fn transmis). N'ARRÊTE PAS la
 * chaîne en cas d'erreur/timeout (isolation par job) — cohérent avec le fait que
 * les jobs existants absorbent déjà leurs propres erreurs en interne.
 */
async function runInstrumented(jobName, fn, timeoutMs = JOB_TIMEOUT_MS) {
  const startedAt = new Date();
  const t0 = Date.now();
  let status = 'success';
  let errorMessage = null;
  let itemsProcessed = null;
  let timer = null;
  try {
    const work = Promise.resolve().then(() => fn());
    // Évite un unhandledRejection si le job rejette APRÈS le timeout.
    work.catch(() => {});
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`__job_timeout__ ${timeoutMs}ms`)), timeoutMs);
      if (timer && timer.unref) timer.unref();
    });
    const result = await Promise.race([work, timeout]);
    itemsProcessed = extractItemsProcessed(result);
  } catch (err) {
    if (err && typeof err.message === 'string' && err.message.startsWith('__job_timeout__')) {
      status = 'timeout';
      errorMessage = `Dépassement du délai (${timeoutMs} ms) — le job continue en arrière-plan, la chaîne reprend et le verrou est libéré`;
      console.error(`[SCHEDULER] ⏱ Job ${jobName} : ${errorMessage}`);
    } else {
      status = 'error';
      errorMessage = err && err.message ? err.message : String(err);
      console.error(`[SCHEDULER] Job ${jobName} en erreur :`, errorMessage);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
  await recordJobRun(jobName, startedAt, new Date(), status, errorMessage, itemsProcessed, Date.now() - t0);
  return { status, itemsProcessed };
}

/**
 * Purge du journal des jobs (rétention 30 j) — évite une croissance non bornée
 * de job_runs. Instrumenté comme les autres jobs (via runAllJobs).
 */
async function purgeOldJobRuns() {
  const days = Number(process.env.JOB_RUNS_RETENTION_DAYS) || 30;
  const result = await pool.query(
    `DELETE FROM job_runs WHERE started_at < NOW() - make_interval(days => $1)`,
    [days]
  );
  if (result.rowCount > 0) {
    console.log(`[SCHEDULER] job_runs : ${result.rowCount} ligne(s) purgée(s) (> ${days} j)`);
  }
  return { items: result.rowCount || 0 };
}

// ══════════════════════════════════════════
// ENVOI via Brevo (email + SMS)
// ══════════════════════════════════════════
async function sendNotification(template, recipientEmail, recipientPhone, variables) {
  let body = template.body;
  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      body = body.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
    }
  }

  if (!BREVO_API_KEY) {
    console.log(`[SCHEDULER] [DRY-RUN] ${template.type} → ${recipientEmail || recipientPhone}: ${body.substring(0, 80)}...`);
    return { dryRun: true };
  }

  if (template.type === 'email' && recipientEmail) {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Solidarite Textiles', email: 'noreply@solidata.online' },
        to: [{ email: recipientEmail }],
        subject: template.subject || 'Solidarite Textiles',
        htmlContent: `<html><body><p>${body.replace(/\n/g, '<br>')}</p></body></html>`,
      }),
    });
    return await response.json();
  }

  if (template.type === 'sms' && recipientPhone) {
    const phone = recipientPhone.startsWith('+') ? recipientPhone : `+33${recipientPhone.substring(1)}`;
    const response = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ sender: 'SolTextiles', recipient: phone, content: body }),
    });
    return await response.json();
  }

  return { skipped: true, reason: 'no_recipient' };
}

// ══════════════════════════════════════════
// JOBS
// ══════════════════════════════════════════

/**
 * Rappel entretien J-1
 */
async function checkAppointmentReminders() {
  try {
    const triggers = await pool.query(
      `SELECT nt.*, mt.* FROM notification_triggers nt
       JOIN message_templates mt ON nt.template_id = mt.id
       WHERE nt.event = 'candidate_appointment_reminder' AND nt.is_active = true`
    );
    if (triggers.rows.length === 0) return;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const candidates = await pool.query(
      `SELECT * FROM candidates
       WHERE appointment_date::date = $1
       AND status IN ('received', 'interview')
       AND (phone IS NOT NULL OR email IS NOT NULL)`,
      [tomorrowStr]
    );

    for (const c of candidates.rows) {
      for (const trigger of triggers.rows) {
        const appointmentDate = new Date(c.appointment_date);
        const vars = {
          prenom: c.first_name || '',
          nom: c.last_name || '',
          date: appointmentDate.toLocaleDateString('fr-FR'),
          heure: appointmentDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
          lieu: c.appointment_location || 'nos locaux',
        };
        try {
          await sendNotification(trigger, c.email, c.phone, vars);
          console.log(`[SCHEDULER] Rappel J-1 envoye a ${c.first_name} ${c.last_name}`);
        } catch (err) {
          console.error(`[SCHEDULER] Erreur rappel J-1 candidat #${c.id}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('[SCHEDULER] Erreur checkAppointmentReminders:', err.message);
  }
}

/**
 * Fin de contrat J-30 et J-15
 */
async function checkContractEndings() {
  try {
    const events = [
      { event: 'employee_contract_ending', days: 30 },
      { event: 'employee_contract_ending_15', days: 15 },
    ];

    for (const { event, days } of events) {
      const triggers = await pool.query(
        `SELECT nt.*, mt.* FROM notification_triggers nt
         JOIN message_templates mt ON nt.template_id = mt.id
         WHERE nt.event = $1 AND nt.is_active = true`,
        [event]
      );
      if (triggers.rows.length === 0) continue;

      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + days);
      const targetStr = targetDate.toISOString().split('T')[0];

      const employees = await pool.query(
        `SELECT e.*, ec.end_date, ec.contract_type
         FROM employees e
         JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.is_current = true
         WHERE ec.end_date = $1 AND e.is_active = true`,
        [targetStr]
      );

      for (const emp of employees.rows) {
        for (const trigger of triggers.rows) {
          const vars = {
            prenom: emp.first_name,
            nom: emp.last_name,
            date_fin: new Date(emp.end_date).toLocaleDateString('fr-FR'),
            type_contrat: emp.contract_type,
            jours_restants: String(days),
          };
          try {
            await sendNotification(trigger, emp.email, emp.phone, vars);
            console.log(`[SCHEDULER] Alerte contrat J-${days} pour ${emp.first_name} ${emp.last_name}`);
          } catch (err) {
            console.error(`[SCHEDULER] Erreur contrat employe #${emp.id}:`, err.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('[SCHEDULER] Erreur checkContractEndings:', err.message);
  }
}

/**
 * Jalons insertion (Diagnostic M+1, Bilan M+3, M+6, M+10)
 * Cree automatiquement les jalons quand les echeances arrivent
 */
async function checkInsertionMilestones() {
  try {
    // Échéancier calé sur le contrat réel (même logique que les routes) — évite
    // de créer un M+10 pour un contrat de 6 mois.
    const { computeMilestoneSchedule } = require('../routes/insertion/engine');
    const today = new Date().toISOString().split('T')[0];

    const employees = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.insertion_start_date, e.contract_end,
              ec.start_date AS c_start, ec.end_date AS c_end
       FROM employees e
       LEFT JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.is_current = true
       WHERE e.insertion_status = 'en_parcours'
       AND e.insertion_start_date IS NOT NULL
       AND e.is_active = true`
    );

    for (const emp of employees.rows) {
      const schedule = computeMilestoneSchedule(
        emp.insertion_start_date || emp.c_start,
        emp.c_end || emp.contract_end
      );
      for (const ms of schedule) {
        if (ms.due === today) {
          const existing = await pool.query(
            `SELECT id FROM insertion_milestones WHERE employee_id = $1 AND milestone_type = $2`,
            [emp.id, ms.type]
          );
          if (existing.rows.length === 0) {
            await pool.query(
              `INSERT INTO insertion_milestones (employee_id, milestone_type, due_date, status)
               VALUES ($1, $2, $3, 'a_planifier')`,
              [emp.id, ms.type, today]
            );
            console.log(`[SCHEDULER] Jalon ${ms.type} cree pour ${emp.first_name} ${emp.last_name}`);
          }
        }
      }
    }
  } catch (err) {
    console.error('[SCHEDULER] Erreur checkInsertionMilestones:', err.message);
  }
}

/**
 * Alertes entretiens insertion — rappels automatiques
 * - Jalon a_planifier avec echeance dans 14 jours -> alerte planification
 * - Entretien planifie dans 7 jours -> rappel J-7
 * - Entretien planifie demain -> rappel J-1
 * - Jalon en retard -> alerte retard
 */
async function checkInsertionInterviewAlerts() {
  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Jalons a planifier bientot ou en retard
    const milestones = await pool.query(
      `SELECT im.*, e.first_name, e.last_name, e.email, e.phone
       FROM insertion_milestones im
       JOIN employees e ON im.employee_id = e.id
       WHERE im.status IN ('a_planifier', 'planifie')
       AND e.is_active = true`
    );

    for (const ms of milestones.rows) {
      const dueDate = new Date(ms.due_date);
      const daysUntilDue = Math.round((dueDate - today) / 86400000);

      // Jalon en retard (pas encore planifie et echeance depassee)
      if (ms.status === 'a_planifier' && daysUntilDue < 0) {
        await createInsertionAlert(ms, 'retard', todayStr);
      }
      // Planification requise dans 14 jours
      else if (ms.status === 'a_planifier' && daysUntilDue <= 14 && daysUntilDue > 0) {
        await createInsertionAlert(ms, 'planification', todayStr);
      }

      // Rappels pour entretiens planifies
      if (ms.status === 'planifie' && ms.interview_date) {
        const interviewDate = new Date(ms.interview_date);
        const daysUntilInterview = Math.round((interviewDate - today) / 86400000);

        if (daysUntilInterview === 7) {
          await createInsertionAlert(ms, 'rappel_j7', todayStr);
        } else if (daysUntilInterview === 1) {
          await createInsertionAlert(ms, 'rappel_j1', todayStr);
          // Envoyer notification Brevo si possible
          if (ms.email || ms.phone) {
            try {
              await sendNotification(
                { type: 'email', body: `Bonjour {prenom},\n\nRappel : votre entretien ${ms.milestone_type} est prevu demain.\n\nCordialement,\nSolidarite Textile`, subject: `Rappel entretien ${ms.milestone_type}` },
                ms.email, ms.phone,
                { prenom: ms.first_name, nom: ms.last_name }
              );
            } catch (err) {
              console.error(`[SCHEDULER] Erreur envoi rappel insertion #${ms.id}:`, err.message);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[SCHEDULER] Erreur checkInsertionInterviewAlerts:', err.message);
  }
}

async function createInsertionAlert(milestone, alertType, targetDate) {
  try {
    // Eviter les doublons
    const existing = await pool.query(
      `SELECT id FROM insertion_interview_alerts
       WHERE employee_id = $1 AND milestone_type = $2 AND alert_type = $3 AND target_date = $4`,
      [milestone.employee_id, milestone.milestone_type, alertType, targetDate]
    );
    if (existing.rows.length > 0) return;

    await pool.query(
      `INSERT INTO insertion_interview_alerts (employee_id, milestone_type, alert_type, target_date)
       VALUES ($1, $2, $3, $4)`,
      [milestone.employee_id, milestone.milestone_type, alertType, targetDate]
    );
    console.log(`[SCHEDULER] Alerte ${alertType} pour ${milestone.first_name} ${milestone.last_name} — ${milestone.milestone_type}`);
  } catch (err) {
    console.error('[SCHEDULER] Erreur createInsertionAlert:', err.message);
  }
}

/**
 * Maintenance preventive vehicules
 */
async function checkVehicleMaintenance() {
  try {
    const vehicles = await pool.query(
      `SELECT v.*, vm.last_maintenance_date, vm.last_maintenance_km,
              vm.maintenance_interval_km, vm.maintenance_interval_months,
              vm.controle_technique_date
       FROM vehicles v
       LEFT JOIN vehicle_maintenance vm ON vm.vehicle_id = v.id
       WHERE v.status != 'out_of_service'`
    );

    const today = new Date();
    for (const v of vehicles.rows) {
      const alerts = [];

      if (v.maintenance_interval_km && v.last_maintenance_km) {
        const kmSince = (v.current_km || 0) - v.last_maintenance_km;
        if (kmSince >= v.maintenance_interval_km * 0.9) {
          alerts.push(`Revision km: ${kmSince}/${v.maintenance_interval_km} km`);
        }
      }

      if (v.maintenance_interval_months && v.last_maintenance_date) {
        const lastDate = new Date(v.last_maintenance_date);
        const nextDate = new Date(lastDate);
        nextDate.setMonth(nextDate.getMonth() + v.maintenance_interval_months);
        const daysUntil = Math.round((nextDate - today) / (1000 * 60 * 60 * 24));
        if (daysUntil <= 30) {
          alerts.push(`Revision date: dans ${daysUntil} jours`);
        }
      }

      if (v.controle_technique_date) {
        const ctDate = new Date(v.controle_technique_date);
        const daysUntil = Math.round((ctDate - today) / (1000 * 60 * 60 * 24));
        if (daysUntil <= 60) {
          alerts.push(`Controle technique: dans ${daysUntil} jours`);
        }
      }

      if (alerts.length > 0) {
        await pool.query(
          `INSERT INTO vehicle_maintenance_alerts (vehicle_id, alert_date, alerts, is_resolved)
           VALUES ($1, CURRENT_DATE, $2, false)
           ON CONFLICT (vehicle_id, alert_date) DO UPDATE SET alerts = $2`,
          [v.id, JSON.stringify(alerts)]
        );
      }
    }
  } catch (err) {
    console.error('[SCHEDULER] Erreur checkVehicleMaintenance:', err.message);
  }
}

/**
 * QHSE — Alerte hebdomadaire des habilitations à échéance (item 58).
 * (1) Recalcule employees.has_caces / has_permis_b pour les salariés suivis en
 *     QHSE : une expiration purement temporelle ne déclenche aucun write, donc
 *     ce recalcul périodique fait basculer le booléen qui pilote le planning.
 * (2) Recense les habilitations expirées ou expirant sous 60 jours et alerte les
 *     ADMIN/QHSE (log + compteur exposé côté page par /qhse/habilitations/echeances ;
 *     digest email best-effort si Brevo est configuré).
 */
async function checkQhseHabilitationExpiries() {
  try {
    // (1) Resynchro des booléens de compétence pour les salariés suivis en QHSE.
    let syncEmployeeCertBooleans;
    try {
      ({ syncEmployeeCertBooleans } = require('../routes/qhse'));
    } catch (_) { syncEmployeeCertBooleans = null; }
    if (syncEmployeeCertBooleans) {
      const suivis = await pool.query(
        `SELECT DISTINCT employee_id FROM qhse_habilitations
         WHERE type IN ('caces_1','caces_3','caces_5','permis')`
      );
      for (const row of suivis.rows) {
        try { await syncEmployeeCertBooleans(pool, row.employee_id); }
        catch (e) { console.error(`[SCHEDULER] QHSE synchro booléen employé #${row.employee_id} :`, e.message); }
      }
    }

    // (2) Habilitations expirées ou expirant sous 60 jours.
    const exp = await pool.query(`
      SELECT h.id, h.type, h.libelle, h.date_expiration,
             CONCAT(e.first_name, ' ', e.last_name) AS employe,
             (h.date_expiration - CURRENT_DATE) AS jours_restants
      FROM qhse_habilitations h
      JOIN employees e ON e.id = h.employee_id
      WHERE h.date_expiration IS NOT NULL
        AND h.date_expiration <= CURRENT_DATE + INTERVAL '60 days'
      ORDER BY h.date_expiration ASC
    `);
    if (exp.rows.length === 0) {
      console.log('[SCHEDULER] QHSE : aucune habilitation à échéance sous 60 jours');
      return;
    }
    console.log(`[SCHEDULER] QHSE : ${exp.rows.length} habilitation(s) à échéance sous 60 jours`);

    // Digest email best-effort vers ADMIN/QHSE (si Brevo configuré).
    if (BREVO_API_KEY) {
      const dests = await pool.query(
        `SELECT email FROM users
         WHERE role IN ('ADMIN','QHSE') AND is_active = true AND email IS NOT NULL AND email <> ''`
      );
      if (dests.rows.length > 0) {
        const lignes = exp.rows.map((r) => {
          const j = Number(r.jours_restants);
          const etat = j < 0 ? `expirée depuis ${-j} j` : `expire dans ${j} j`;
          return `- ${r.employe} : ${r.libelle || r.type} (${etat})`;
        }).join('\n');
        const bodyText = `Habilitations QHSE à échéance (sous 60 jours) :\n\n${lignes}\n\nAccédez au module QHSE pour planifier les renouvellements.`;
        for (const d of dests.rows) {
          await sendNotification(
            { type: 'email', subject: `QHSE — ${exp.rows.length} habilitation(s) à renouveler`, body: bodyText },
            d.email, null, {}
          ).catch((e) => console.error('[SCHEDULER] QHSE email :', e.message));
        }
      }
    }
  } catch (err) {
    console.error('[SCHEDULER] Erreur checkQhseHabilitationExpiries :', err.message);
  }
}

/**
 * Veille sectorielle — Auto-alimentation du fil d'actualite
 * Genere automatiquement des articles de veille pertinents pour le secteur
 */
async function autoFeedNews() {
  try {
    // Verifier si on a deja publie aujourd'hui (max 2 articles auto par jour)
    const todayStr = new Date().toISOString().split('T')[0];
    const existing = await pool.query(
      `SELECT COUNT(*)::int as count FROM news_articles
       WHERE created_at::date = $1 AND source_name = 'Veille automatique'`,
      [todayStr]
    );
    if (existing.rows[0].count >= 2) return;

    // Sources de veille thematiques pour le secteur textile/ESS/insertion
    const veilleSources = [
      // Filiere textile
      {
        category: 'metier',
        themes: [
          { title: 'Evolution de la collecte textile en France', tags: ['collecte', 'textile', 'statistiques'], summary: 'La filiere textile en France continue sa progression avec une augmentation des tonnages collectes. Les objectifs Refashion pour 2025 visent 3.6 kg/hab/an.' },
          { title: 'Nouvelles normes de tri textile europeennes', tags: ['tri', 'reglementation', 'europe'], summary: 'L\'Union Europeenne renforce ses exigences en matiere de tri et valorisation des textiles usages. Impact sur les centres de tri.' },
          { title: 'Innovation dans le recyclage des fibres textiles', tags: ['recyclage', 'innovation', 'R&D'], summary: 'Les nouvelles technologies de defibrage et refilature permettent de recycler davantage de matieres. Impact sur les taux de valorisation.' },
          { title: 'Marche du reemploi textile en croissance', tags: ['reemploi', 'seconde-main', 'economie'], summary: 'Le marche de la seconde main textile continue sa croissance portee par la sensibilisation environnementale et le pouvoir d\'achat.' },
          { title: 'REP textiles : bilan et perspectives', tags: ['REP', 'Refashion', 'reglementation'], summary: 'Refashion publie son bilan annuel de la filiere REP textiles. Objectifs, resultats et enjeux pour l\'annee a venir.' },
          { title: 'Logistique verte dans la collecte textile', tags: ['logistique', 'environnement', 'CO2'], summary: 'Les solutions de logistique durable se developpent : vehicules electriques, optimisation de tournees, reduction de l\'empreinte carbone.' },
          { title: 'Tri optique et automatisation des centres de tri', tags: ['tri', 'innovation', 'automatisation'], summary: 'Les technologies de tri optique (proche infrarouge) permettent d\'identifier automatiquement les compositions de fibres. Un levier de productivite pour les centres de tri.' },
          { title: 'Recyclage chimique des textiles : ou en est-on ?', tags: ['recyclage', 'innovation', 'fibres'], summary: 'Le recyclage chimique promet de regenerer des fibres de qualite vierge a partir de textiles usages. Etat des lieux des projets industriels en France et en Europe.' },
          { title: 'Filiere CSR : valorisation energetique des refus de tri', tags: ['CSR', 'valorisation', 'dechets'], summary: 'Les combustibles solides de recuperation offrent un debouche aux textiles non reemployables ni recyclables. Cadre reglementaire et perspectives.' },
          { title: 'Eco-conception et durabilite des vetements', tags: ['eco-conception', 'durabilite', 'REP'], summary: 'La modulation de l\'eco-contribution Refashion recompense les vetements durables et reparables. Impact attendu sur la qualite du gisement collecte.' },
          { title: 'Affichage environnemental des produits textiles', tags: ['reglementation', 'affichage', 'consommation'], summary: 'Le deploiement de l\'affichage environnemental vise a informer le consommateur sur l\'impact des vetements. Un signal pour la seconde main et le reemploi.' },
        ],
      },
      // ESS / Insertion
      {
        category: 'local',
        themes: [
          { title: 'ESS : les structures d\'insertion en premiere ligne', tags: ['ESS', 'insertion', 'emploi'], summary: 'Les entreprises d\'insertion jouent un role cle dans le retour a l\'emploi des publics eloignes. Focus sur les resultats du secteur.' },
          { title: 'CDDI et parcours d\'insertion : cadre reglementaire', tags: ['CDDI', 'reglementation', 'ASP'], summary: 'Rappel du cadre legal des CDDI et des obligations des structures d\'insertion en matiere de suivi des parcours.' },
          { title: 'Dispositifs d\'aide a la mobilite pour les salaries en insertion', tags: ['mobilite', 'insertion', 'aide'], summary: 'Tour d\'horizon des aides a la mobilite disponibles pour les salaries en parcours d\'insertion professionnelle.' },
          { title: 'Formation professionnelle et insertion par l\'activite economique', tags: ['formation', 'IAE', 'competences'], summary: 'Les formations accessibles aux salaries en insertion : CleA, FLE, qualifications metiers. Comment articuler parcours et formation.' },
          { title: 'Levee des freins a l\'emploi : bonnes pratiques', tags: ['freins', 'accompagnement', 'CIP'], summary: 'Retour d\'experience sur les methodes efficaces pour lever les freins peripheriques a l\'emploi dans les structures d\'insertion.' },
          { title: 'Economie circulaire et emploi social', tags: ['economie-circulaire', 'ESS', 'emploi'], summary: 'L\'economie circulaire genere des emplois locaux non delocalisables. Focus sur le secteur textile et les perspectives.' },
          { title: 'Clauses sociales dans les marches publics', tags: ['clauses-sociales', 'marches-publics', 'insertion'], summary: 'Les clauses sociales d\'insertion dans la commande publique ouvrent des heures de travail aux structures de l\'IAE. Comment se positionner et repondre.' },
          { title: 'Numerique inclusif : lutter contre l\'illectronisme', tags: ['numerique', 'inclusion', 'freins'], summary: 'La maitrise des outils numeriques est devenue un frein a l\'emploi a part entiere. Ateliers, mediation et accompagnement dans les parcours d\'insertion.' },
          { title: 'Sante et prevention des risques dans l\'IAE', tags: ['sante', 'prevention', 'QHSE'], summary: 'La prevention des troubles musculo-squelettiques et des risques professionnels est un enjeu majeur pour les postes de collecte et de tri. Bonnes pratiques QHSE.' },
          { title: 'Partenariats France Travail et structures d\'insertion', tags: ['France-Travail', 'prescription', 'IAE'], summary: 'Le conventionnement et la prescription avec France Travail structurent l\'entree en parcours. Fluidifier les orientations et le suivi des salaries en insertion.' },
          { title: 'Sortie dynamique : mesurer l\'impact de l\'insertion', tags: ['sortie-dynamique', 'DREETS', 'evaluation'], summary: 'Les taux de sortie dynamique (emploi durable, formation) sont au coeur de l\'evaluation des SIAE par la DREETS et l\'ASP. Methodes de suivi et leviers d\'amelioration.' },
        ],
      },
    ];

    // Selectionner aleatoirement un article non encore publie
    for (const source of veilleSources) {
      const randomTheme = source.themes[Math.floor(Math.random() * source.themes.length)];

      // Ne republier un theme que s'il n'a PAS paru recemment (fenetre de
      // rotation de 21 jours). Au-dela, le theme redevient eligible → le fil
      // ne s'asseche jamais. Avant : dedup « title deja existant » DEFINITIF,
      // donc une fois les ~12 titres du catalogue tous publies (≈6 j a 2/j),
      // chaque tirage tombait sur un titre existant → plus aucune publication
      // → le fil se figeait (« ne s'actualise plus automatiquement »).
      const similar = await pool.query(
        `SELECT 1 FROM news_articles
         WHERE title = $1 AND created_at > NOW() - INTERVAL '21 days'
         LIMIT 1`,
        [randomTheme.title]
      );
      if (similar.rows.length > 0) continue;

      await pool.query(
        `INSERT INTO news_articles (category, title, summary, source_name, tags, is_pinned)
         VALUES ($1, $2, $3, 'Veille automatique', $4, false)`,
        [source.category, randomTheme.title, randomTheme.summary, randomTheme.tags]
      );
      console.log(`[SCHEDULER] Article veille publie: ${randomTheme.title}`);
    }
  } catch (err) {
    console.error('[SCHEDULER] Erreur autoFeedNews:', err.message);
  }
}

/**
 * Purge automatique RGPD — Anonymise les candidats non recrutés > 24 mois (Art. 5 RGPD)
 */
async function purgeExpiredCandidates() {
  try {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 24);

    const expired = await pool.query(
      `SELECT id, first_name, last_name FROM candidates
       WHERE status != 'hired' AND created_at < $1
       AND first_name != 'ANONYME'`,
      [cutoff.toISOString()]
    );

    const { anonymizeCandidate } = require('./anonymization');
    for (const candidate of expired.rows) {
      // Transaction par candidat + service mutualisé : couvre désormais le MÊME
      // périmètre que la route manuelle (PCM, entretiens, mises en situation,
      // documents) — la purge auto n'est plus moins complète que le manuel.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await anonymizeCandidate(client, candidate.id);
        await client.query(
          `INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details)
           VALUES (NULL, 'AUTO_PURGE_24M', 'candidate', $1, $2)`,
          [candidate.id, JSON.stringify({ reason: 'Purge automatique RGPD 24 mois', original_name: `${candidate.first_name} ${candidate.last_name}` })]
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[SCHEDULER] purge candidat #${candidate.id} :`, e.message);
      } finally {
        client.release();
      }
    }

    if (expired.rows.length > 0) {
      console.log(`[SCHEDULER] RGPD: ${expired.rows.length} candidat(s) anonymisé(s) (> 24 mois)`);
    }
  } catch (err) {
    console.error('[SCHEDULER] Erreur purgeExpiredCandidates:', err.message);
  }
}

// ══════════════════════════════════════════
// VERROU DISTRIBUÉ (Advisory Lock PostgreSQL)
// ══════════════════════════════════════════

const SCHEDULER_LOCK_ID = 123456789; // ID unique pour le advisory lock

/**
 * Tente d'obtenir une connexion DÉDIÉE pour tenir le verrou pendant tout le run.
 * `pg_try_advisory_lock` est un verrou de SESSION : l'acquisition et la libération
 * doivent passer par la MÊME connexion, sinon `pg_advisory_unlock` est un no-op sur
 * une autre connexion du pool et le verrou fuit (constat audit flux-temps-reel-jobs).
 * Repli sûr : si `pool.connect` n'est pas disponible (ex. mock de test qui n'expose
 * que `query`), on retourne null et l'appelant retombe sur `pool` (mono-instance).
 */
async function getLockClient() {
  if (typeof pool.connect === 'function') {
    try {
      return await pool.connect();
    } catch (err) {
      console.error('[SCHEDULER] Connexion dédiée verrou indisponible, repli sur pool :', err.message);
    }
  }
  return null;
}

/**
 * Acquiert un advisory lock PostgreSQL pour éviter les exécutions concurrentes
 * dans un environnement multi-instance. `conn` = client dédié (ou pool en repli).
 */
async function acquireLock(conn) {
  try {
    const result = await conn.query('SELECT pg_try_advisory_lock($1) as acquired', [SCHEDULER_LOCK_ID]);
    return result.rows[0] && result.rows[0].acquired;
  } catch (err) {
    console.error('[SCHEDULER] Erreur acquisition lock:', err.message);
    return false;
  }
}

async function releaseLock(conn) {
  try {
    await conn.query('SELECT pg_advisory_unlock($1)', [SCHEDULER_LOCK_ID]);
  } catch (err) {
    console.error('[SCHEDULER] Erreur release lock:', err.message);
  }
}

/**
 * Purge automatique GPS — Supprime les positions > 90 jours (rétention RGPD)
 */
async function purgeOldGpsPositions() {
  try {
    // Keep GPS data for 90 days, delete older positions
    const result = await pool.query(
      `DELETE FROM gps_positions WHERE recorded_at < NOW() - INTERVAL '90 days'`
    );
    if (result.rowCount > 0) {
      console.log(`[SCHEDULER] GPS: ${result.rowCount} position(s) supprimée(s) (> 90 jours)`);
      // Log RGPD audit
      await pool.query(
        `INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details)
         VALUES (NULL, 'AUTO_PURGE_GPS_90D', 'gps_positions', 0, $1)`,
        [JSON.stringify({ rows_deleted: result.rowCount, retention_days: 90 })]
      );
    }
  } catch (err) {
    console.error('[SCHEDULER] Erreur purgeOldGpsPositions:', err.message);
  }
}

/**
 * Purge des refresh tokens expirés (audit vague 3, item 3.C-4).
 * Jusqu'ici, les jetons expirés n'étaient supprimés qu'au démarrage (init-db) ;
 * la table grossissait entre deux redémarrages. Purge quotidienne planifiée.
 */
async function purgeExpiredRefreshTokens() {
  try {
    const result = await pool.query('DELETE FROM refresh_tokens WHERE expires_at < NOW()');
    if (result.rowCount > 0) {
      console.log(`[SCHEDULER] Refresh tokens: ${result.rowCount} jeton(s) expiré(s) supprimé(s)`);
    }
  } catch (err) {
    console.error('[SCHEDULER] Erreur purgeExpiredRefreshTokens:', err.message);
  }
}

/**
 * Rafraîchissement des vues matérialisées pour le reporting
 */
async function refreshMaterializedViews() {
  try {
    const views = ['mv_collecte_mensuelle', 'mv_production_mensuelle', 'mv_cav_stats', 'mv_rh_stats'];
    for (const view of views) {
      await pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`);
    }
    console.log('[SCHEDULER] Vues matérialisées rafraîchies');
  } catch (err) {
    console.error('[SCHEDULER] Erreur refreshMaterializedViews:', err.message);
  }
}

// ══════════════════════════════════════════
// IMPORT AUTOMATIQUE PENNYLANE (quotidien)
// ══════════════════════════════════════════

/**
 * Import automatique quotidien des données Pennylane (GL + transactions)
 * S'exécute uniquement si Pennylane est configuré et actif
 */
async function syncPennylaneDaily() {
  try {
    // Vérifier si Pennylane est configuré et actif
    const config = await pool.query(
      'SELECT is_active FROM pennylane_config WHERE is_active = true LIMIT 1'
    );
    if (config.rows.length === 0) {
      console.log('[SCHEDULER] Pennylane non configuré ou inactif, skip sync');
      return;
    }

    const { syncGLAuto, syncTransactionsAuto } = require('../routes/pennylane');
    const year = new Date().getFullYear();

    // Import Grand Livre
    try {
      const glResult = await syncGLAuto(year);
      console.log(`[SCHEDULER] Pennylane GL sync: ${glResult.synced} écritures importées (${year})`);
    } catch (err) {
      console.error('[SCHEDULER] Erreur sync Pennylane GL:', err.message);
      await pool.query(
        `INSERT INTO pennylane_sync_log (sync_type, direction, status, error_message, completed_at)
         VALUES ('gl', 'pull', 'error', $1, NOW())`,
        [err.message]
      ).catch(() => {});
    }

    // Import transactions bancaires
    try {
      const txResult = await syncTransactionsAuto(year);
      console.log(`[SCHEDULER] Pennylane transactions sync: ${txResult.synced} transactions importées (${year})`);
    } catch (err) {
      console.error('[SCHEDULER] Erreur sync Pennylane transactions:', err.message);
      await pool.query(
        `INSERT INTO pennylane_sync_log (sync_type, direction, status, error_message, completed_at)
         VALUES ('transactions', 'pull', 'error', $1, NOW())`,
        [err.message]
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[SCHEDULER] Erreur syncPennylaneDaily:', err.message);
  }
}

/**
 * Sync quotidienne des factures clients Pennylane (contrôle facturation, item 37).
 * La sync manuelle existait déjà (POST /pennylane/sync/customer-invoices) mais
 * dépendait d'un clic. Ce job l'automatise, avec les mêmes garde-fous
 * (incrémental, log dans pennylane_sync_log, idempotent sur pennylane_invoice_id).
 * S'exécute uniquement si Pennylane est configuré et actif.
 */
async function syncPennylaneInvoicesDaily() {
  try {
    const config = await pool.query(
      'SELECT is_active FROM pennylane_config WHERE is_active = true LIMIT 1'
    );
    if (config.rows.length === 0) {
      console.log('[SCHEDULER] Pennylane non configuré ou inactif, skip sync factures');
      return;
    }
    const { syncCustomerInvoicesAuto } = require('../routes/pennylane');
    // Fenêtre glissante de 35 jours (idempotente) : capte une facture datée dans
    // le passé récent mais apparue tardivement sur Pennylane, sans dépendre de
    // last_sync_at (partagé avec la sync GL de 2h qui l'aurait déjà avancé).
    const since = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const r = await syncCustomerInvoicesAuto({ since });
    console.log(`[SCHEDULER] Pennylane factures clients : ${r.imported} importée(s), ${r.matched} rapprochée(s) auto, ${r.unmatched} à rapprocher`);
  } catch (err) {
    console.error('[SCHEDULER] Erreur sync Pennylane factures clients :', err.message);
  }
}

// ══════════════════════════════════════════
// ORCHESTRATEUR
// ══════════════════════════════════════════

let schedulerInterval = null;   // legacy (conservé pour compat, remplacé par schedulerTimeout)
let schedulerTimeout = null;
let tickRunning = false;

/**
 * Délai jusqu'au prochain top d'heure (+ petit offset pour tomber à HH:00:xx et
 * non HH:59:59 à cause de l'imprécision des timers). CORRIGE LA DÉRIVE « minute
 * figée à la minute de boot » (constat audit item 3.D-1c) : chaque tick est
 * réaligné sur l'horloge, donc getMinutes() ≈ 0 → les jobs autrefois gardés par
 * getMinutes() < 30 s'exécutent quelle que soit l'heure de démarrage du conteneur.
 */
function msUntilNextHour(now = new Date()) {
  const next = new Date(now);
  next.setHours(now.getHours() + 1, 0, 20, 0); // HH+1:00:20 (offset 20 s)
  return next.getTime() - now.getTime();
}

/**
 * Corps horaire — un tick par top d'heure. Les gardes de MINUTE d'origine ont été
 * retirées (la fenêtre = l'heure entière) car elles étaient la source de la panne
 * silencieuse : avec un tick désormais aligné sur HH:00, chaque job gardé par une
 * heure s'exécute une fois et une seule dans son heure.
 */
async function hourlyTick() {
  if (tickRunning) {
    console.warn('[SCHEDULER] tick précédent encore en cours, skip de ce tick');
    return;
  }
  tickRunning = true;
  try {
    const now = new Date();
    if ([7, 12, 18].includes(now.getHours())) {
      console.log(`[SCHEDULER] Execution planifiee a ${now.toLocaleTimeString('fr-FR')}`);
      await runAllJobs();
    }
    // Import Pennylane quotidien à 2h du matin (UTC)
    if (now.getHours() === 2) {
      console.log('[SCHEDULER] Lancement sync Pennylane quotidienne...');
      await runInstrumented('syncPennylaneDaily', syncPennylaneDaily);
    }
    // Import factures clients Pennylane à 4h (contrôle facturation, item 37)
    if (now.getHours() === 4) {
      console.log('[SCHEDULER] Lancement sync factures clients Pennylane...');
      await runInstrumented('syncPennylaneInvoicesDaily', syncPennylaneInvoicesDaily);
    }
    // Génération quotidienne des prédictions de remplissage J..J+7 à 5h (résidu 8).
    // Calcul LOCAL (heuristique, sans appel LLM). Alimente ml_fill_predictions pour
    // que la boucle de feedback capteur (liveobjects-processor) puisse se refermer.
    if (now.getHours() === 5) {
      console.log('[SCHEDULER] Génération quotidienne des prédictions de remplissage...');
      await runInstrumented('generateDailyPredictions', async () => {
        const { generateDailyPredictions } = require('../routes/tours/predictions');
        return generateDailyPredictions({ horizonDays: 7 });
      });
    }
    // Niveau 3.1 — Dispatch auto J-1 chaque soir à 18h
    if (now.getHours() === 18) {
      await runInstrumented('generateNextDayDispatchProposals', async () => {
        const { generateNextDayDispatchProposals } = require('./dispatch-optimizer');
        return generateNextDayDispatchProposals();
      });
    }
    // Import quotidien Logic'S à 20h : scan du dossier CSV
    // (les CSV sont déposés en temps réel via le webhook Power Automate
    //  POST /api/boutique-ventes/webhook ; ce scan capture les fichiers
    //  qui auraient été déposés manuellement ou en cas de retry)
    if (now.getHours() === 20) {
      console.log('[SCHEDULER] Scan quotidien CSV boutiques 20h...');
      await runInstrumented('scanBoutiqueCSVFolders', scanBoutiqueCSVFolders);
    }

    // VAK SumUp — catch-up horaire pendant une VAK active (les webhooks
    // alimentent normalement le live, ce job rattrape les éventuels manqués).
    // Hors VAK, sync 1×/jour à 3h.
    try {
      const inVak = await pool.query(
        `SELECT 1 FROM vaks WHERE CURRENT_DATE BETWEEN date_debut AND date_fin LIMIT 1`,
      );
      if (inVak.rows.length > 0) {
        await runInstrumented('syncVakSumUp', syncVakSumUp);
      } else if (now.getHours() === 3) {
        await runInstrumented('syncVakSumUp', syncVakSumUp);
      }
    } catch (err) {
      console.error('[SCHEDULER] VAK SumUp scheduling:', err.message);
    }

    // QHSE — alerte hebdomadaire des habilitations à échéance (lundi 8h, item 58)
    if (now.getDay() === 1 && now.getHours() === 8) {
      console.log('[SCHEDULER] Lundi 8h : contrôle des habilitations QHSE à échéance');
      await runInstrumented('checkQhseHabilitationExpiries', checkQhseHabilitationExpiries);
    }

    // ══ V1.8.4 — Auto-discovery événements + jours fériés ══

    // Mensuel : le 1er à 04h00 → découverte events + recalcul facteurs saisonniers
    if (now.getDate() === 1 && now.getHours() === 4) {
      console.log('[SCHEDULER] Mensuel 1er 04h : découverte events + recalcul facteurs saisonniers');
      await runInstrumented('discoverEvents', async () => {
        const { discoverNearAllCAVs, discoverNearAllAssociations } = require('./event-discovery');
        await discoverNearAllCAVs({ triggeredBy: 'cron' });
        await discoverNearAllAssociations({ triggeredBy: 'cron' });
      });
      await runInstrumented('recalcSeasonalFactors', async () => {
        const { recalcSeasonalFactors } = require('./predictive-ai');
        if (typeof recalcSeasonalFactors === 'function') return recalcSeasonalFactors();
      });
    }

    // Annuel : 1er janvier à 02h00 → sync jours fériés + vacances scolaires
    if (now.getMonth() === 0 && now.getDate() === 1 && now.getHours() === 2) {
      console.log('[SCHEDULER] 1er janvier 02h : sync jours fériés + vacances scolaires');
      await runInstrumented('syncAllHolidays', async () => {
        const { syncAllHolidays } = require('./holidays');
        return syncAllHolidays();
      });
    }
  } catch (err) {
    console.error('[SCHEDULER] Erreur hourlyTick:', err.message);
  } finally {
    tickRunning = false;
  }
}

/**
 * Ré-arme un timer aligné sur le prochain top d'heure. Le ré-armement se fait AU
 * DÉBUT du handler (avant l'exécution des jobs) : le rythme reste calé sur
 * l'horloge quelle que soit la durée du tick (pas de dérive cumulée), et le
 * garde-fou `tickRunning` empêche tout chevauchement.
 */
function scheduleNextTick() {
  schedulerTimeout = setTimeout(() => {
    scheduleNextTick();
    hourlyTick().catch((e) => console.error('[SCHEDULER] hourlyTick rejeté:', e.message));
  }, msUntilNextHour());
  if (schedulerTimeout && schedulerTimeout.unref) schedulerTimeout.unref();
}

function startScheduler() {
  console.log('[SCHEDULER] Demarrage du scheduler (tick aligné sur le top d\'heure, verrou distribué + journal job_runs)');

  // Executer immediatement au demarrage
  setTimeout(async () => {
    console.log('[SCHEDULER] Execution initiale...');
    await runAllJobs();
  }, 10000);

  // Puis à chaque top d'heure (setTimeout ré-aligné → pas de dérive minute)
  scheduleNextTick();
}

// ══════════════════════════════════════════
// MODULE BOUTIQUES : scan dossier CSV + collecte météo
// ══════════════════════════════════════════
async function scanBoutiqueCSVFolders() {
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const { importCSVContent } = require('../routes/boutique-ventes');

  if (!importCSVContent) return; // route pas encore chargée

  try {
    const boutiques = await pool.query(
      'SELECT id, nom, csv_folder_path FROM boutiques WHERE is_active = true AND csv_folder_path IS NOT NULL'
    );
    for (const btq of boutiques.rows) {
      const folder = btq.csv_folder_path;
      if (!folder || !fs.existsSync(folder)) continue;

      const processedDir = path.join(folder, 'processed');
      if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir, { recursive: true });

      const files = fs.readdirSync(folder).filter(f => f.toLowerCase().endsWith('.csv'));
      for (const f of files) {
        const full = path.join(folder, f);
        try {
          const content = fs.readFileSync(full, 'utf-8');
          const hash = crypto.createHash('sha256').update(content).digest('hex');
          const existing = await pool.query(
            'SELECT id FROM boutique_import_batches WHERE file_hash = $1 LIMIT 1',
            [hash]
          );
          if (existing.rows.length > 0) {
            // Déjà importé, on déplace vers processed
            fs.renameSync(full, path.join(processedDir, f));
            continue;
          }
          const result = await importCSVContent(btq.id, content, f, null, 'auto');
          console.log(`[SCHEDULER] CSV ${f} importé pour ${btq.nom}: ${result.nb_lignes_importees} lignes`);
          fs.renameSync(full, path.join(processedDir, `${Date.now()}-${f}`));
        } catch (e) {
          console.error(`[SCHEDULER] Erreur import CSV ${f} pour ${btq.nom}:`, e.message);
        }
      }
    }
  } catch (err) {
    console.error('[SCHEDULER] scanBoutiqueCSVFolders:', err.message);
  }
}

async function collectBoutiqueWeather() {
  const { fetchOpenMeteoDaily } = require('../utils/weather');
  try {
    const boutiques = await pool.query(
      'SELECT id, nom, latitude, longitude FROM boutiques WHERE is_active = true'
    );
    const today = new Date().toISOString().slice(0, 10);
    for (const btq of boutiques.rows) {
      const existing = await pool.query(
        'SELECT id FROM boutique_meteo_quotidien WHERE boutique_id = $1 AND date = $2',
        [btq.id, today]
      );
      if (existing.rows.length > 0) continue;

      const lat = btq.latitude || 49.4431;
      const lng = btq.longitude || 1.0993;
      const data = await fetchOpenMeteoDaily(lat, lng, today);
      if (!data) continue;

      await pool.query(`
        INSERT INTO boutique_meteo_quotidien
          (boutique_id, date, weather_code, weather_label, temp_min, temp_max,
           precipitation_mm, wind_speed_max, sunshine_hours)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (boutique_id, date) DO NOTHING
      `, [btq.id, today, data.code, data.label, data.tempMin, data.tempMax, data.precipMm, data.windMax, data.sunshineHours]);
      console.log(`[SCHEDULER] Météo collectée pour ${btq.nom}: ${data.label}`);
    }
  } catch (err) {
    console.error('[SCHEDULER] collectBoutiqueWeather:', err.message);
  }
}

// ══════════════════════════════════════════
// VAK — Sync SumUp incrémentale + météo + refresh token
// ══════════════════════════════════════════
async function syncVakSumUp() {
  try {
    const sumup = require('./sumup');
    const status = await sumup.getConnectionStatus();
    if (!status.connected) return; // pas de credentials => skip silencieux
    // Pendant une VAK active, le webhook fait le live ; la sync sert de catch-up
    // au cas où un webhook a été manqué (sync horaire pendant VAK, journalière sinon).
    const result = await sumup.syncTransactionsFromApi({ io: global.__io || null });
    if (result.inserted > 0) {
      console.log(`[SCHEDULER] VAK SumUp sync: +${result.inserted}/${result.received} transactions`);
    }
  } catch (err) {
    console.error('[SCHEDULER] syncVakSumUp:', err.message);
  }
}

async function captureVakWeather() {
  try {
    const sumup = require('./sumup');
    const r = await pool.query(`
      SELECT id FROM vaks
      WHERE date_debut <= CURRENT_DATE + INTERVAL '1 day'
        AND date_fin >= CURRENT_DATE - INTERVAL '7 days'
    `);
    for (const row of r.rows) {
      await sumup.captureWeatherForVak(row.id).catch(() => { /* best effort */ });
    }
  } catch (err) {
    console.error('[SCHEDULER] captureVakWeather:', err.message);
  }
}

async function runAllJobs() {
  // Verrou distribué tenu sur une connexion DÉDIÉE pour toute la durée du run
  // (acquisition + libération sur la même session — cf. getLockClient).
  const lockClient = await getLockClient();
  const lockConn = lockClient || pool; // repli mono-instance si connect indisponible

  const locked = await acquireLock(lockConn);
  if (!locked) {
    if (lockClient) lockClient.release();
    console.log('[SCHEDULER] Une autre instance exécute déjà les jobs, skip');
    return;
  }

  try {
    // Chaque job est instrumenté (journal job_runs + timeout ~5 min). Un job
    // bloqué ne gèle plus la chaîne ni ne retient le verrou : le suivant reprend.
    await runInstrumented('checkAppointmentReminders', checkAppointmentReminders);
    await runInstrumented('checkContractEndings', checkContractEndings);
    await runInstrumented('checkInsertionMilestones', checkInsertionMilestones);
    await runInstrumented('checkInsertionInterviewAlerts', checkInsertionInterviewAlerts);
    await runInstrumented('checkVehicleMaintenance', checkVehicleMaintenance);
    await runInstrumented('autoFeedNews', autoFeedNews);
    await runInstrumented('purgeExpiredCandidates', purgeExpiredCandidates);
    await runInstrumented('purgeOldGpsPositions', purgeOldGpsPositions);
    await runInstrumented('purgeExpiredRefreshTokens', purgeExpiredRefreshTokens);
    await runInstrumented('refreshMaterializedViews', refreshMaterializedViews);
    await runInstrumented('scanBoutiqueCSVFolders', scanBoutiqueCSVFolders);
    await runInstrumented('collectBoutiqueWeather', collectBoutiqueWeather);
    await runInstrumented('syncVakSumUp', syncVakSumUp);
    await runInstrumented('captureVakWeather', captureVakWeather);
    await runInstrumented('purgeOldJobRuns', purgeOldJobRuns);
    console.log('[SCHEDULER] Tous les jobs executes');
  } catch (err) {
    console.error('[SCHEDULER] Erreur globale:', err.message);
  } finally {
    await releaseLock(lockConn);
    if (lockClient) lockClient.release();
  }
}

function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  if (schedulerTimeout) {
    clearTimeout(schedulerTimeout);
    schedulerTimeout = null;
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  runAllJobs,
  // Exposés pour l'observabilité (routes/monitoring.js) et les tests.
  runInstrumented,
  purgeOldJobRuns,
};
