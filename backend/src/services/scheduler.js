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
    const today = new Date().toISOString().split('T')[0];

    const employees = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.email, e.insertion_start_date
       FROM employees e
       WHERE e.insertion_status = 'en_parcours'
       AND e.insertion_start_date IS NOT NULL
       AND e.is_active = true`
    );

    const milestones = [
      { months: 1, label: 'Diagnostic accueil' },
      { months: 3, label: 'Bilan M+3' },
      { months: 6, label: 'Bilan M+6' },
      { months: 10, label: 'Bilan M+10' },
    ];

    for (const emp of employees.rows) {
      const startDate = new Date(emp.insertion_start_date);
      for (const ms of milestones) {
        const milestoneDate = new Date(startDate);
        milestoneDate.setMonth(milestoneDate.getMonth() + ms.months);
        const msStr = milestoneDate.toISOString().split('T')[0];

        if (msStr === today) {
          const existing = await pool.query(
            `SELECT id FROM insertion_milestones WHERE employee_id = $1 AND milestone_type = $2`,
            [emp.id, ms.label]
          );
          if (existing.rows.length === 0) {
            await pool.query(
              `INSERT INTO insertion_milestones (employee_id, milestone_type, due_date, status)
               VALUES ($1, $2, $3, 'a_planifier')`,
              [emp.id, ms.label, today]
            );
            console.log(`[SCHEDULER] Jalon ${ms.label} cree pour ${emp.first_name} ${emp.last_name}`);
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
        ],
      },
    ];

    // Selectionner aleatoirement un article non encore publie
    for (const source of veilleSources) {
      const randomTheme = source.themes[Math.floor(Math.random() * source.themes.length)];

      // Verifier si un article similaire existe deja
      const similar = await pool.query(
        `SELECT id FROM news_articles WHERE title = $1`,
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

// ══════════════════════════════════════════
// VERROU DISTRIBUÉ (Advisory Lock PostgreSQL)
// ══════════════════════════════════════════

const SCHEDULER_LOCK_ID = 123456789; // ID unique pour le advisory lock

/**
 * Acquiert un advisory lock PostgreSQL pour éviter les exécutions concurrentes
 * dans un environnement multi-instance
 */
async function acquireLock() {
  try {
    const result = await pool.query('SELECT pg_try_advisory_lock($1) as acquired', [SCHEDULER_LOCK_ID]);
    return result.rows[0].acquired;
  } catch (err) {
    console.error('[SCHEDULER] Erreur acquisition lock:', err.message);
    return false;
  }
}

async function releaseLock() {
  try {
    await pool.query('SELECT pg_advisory_unlock($1)', [SCHEDULER_LOCK_ID]);
  } catch (err) {
    console.error('[SCHEDULER] Erreur release lock:', err.message);
  }
}

// ══════════════════════════════════════════
// ORCHESTRATEUR
// ══════════════════════════════════════════

let schedulerInterval = null;

function startScheduler() {
  console.log('[SCHEDULER] Demarrage du scheduler (interval: 1h, avec distributed locking)');

  // Executer immediatement au demarrage
  setTimeout(async () => {
    console.log('[SCHEDULER] Execution initiale...');
    await runAllJobs();
  }, 10000);

  // Puis toutes les heures
  schedulerInterval = setInterval(async () => {
    const now = new Date();
    if ([7, 12, 18].includes(now.getHours())) {
      console.log(`[SCHEDULER] Execution planifiee a ${now.toLocaleTimeString('fr-FR')}`);
      await runAllJobs();
    }
  }, 60 * 60 * 1000);
}

async function runAllJobs() {
  // Distributed locking: seule une instance exécute les jobs
  const locked = await acquireLock();
  if (!locked) {
    console.log('[SCHEDULER] Une autre instance exécute déjà les jobs, skip');
    return;
  }

  try {
    await checkAppointmentReminders();
    await checkContractEndings();
    await checkInsertionMilestones();
    await checkInsertionInterviewAlerts();
    await checkVehicleMaintenance();
    await autoFeedNews();
    console.log('[SCHEDULER] Tous les jobs executes');
  } catch (err) {
    console.error('[SCHEDULER] Erreur globale:', err.message);
  } finally {
    await releaseLock();
  }
}

function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

module.exports = { startScheduler, stopScheduler, runAllJobs };
