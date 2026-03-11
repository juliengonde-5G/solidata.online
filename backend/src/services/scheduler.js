/**
 * Scheduler CRON — Execute les triggers automatiques
 * - Rappel entretien J-1
 * - Fin de contrat J-30 et J-15
 * - Autres evenements planifies
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
       AND status IN ('preselected', 'interview')
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
 * Bilans insertion ASP (M+2, M+6, M+10)
 * Cree automatiquement les entretiens de bilan quand les jalons arrivent
 */
async function checkInsertionMilestones() {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Trouver les employes en parcours insertion dont un jalon tombe aujourd'hui
    const employees = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.email, e.insertion_start_date
       FROM employees e
       WHERE e.insertion_status = 'en_parcours'
       AND e.insertion_start_date IS NOT NULL
       AND e.is_active = true`
    );

    const milestones = [
      { months: 2, label: 'Bilan M+2' },
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
          // Verifier qu'on n'a pas deja cree ce jalon
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

      // Alerte km
      if (v.maintenance_interval_km && v.last_maintenance_km) {
        const kmSince = (v.current_km || 0) - v.last_maintenance_km;
        if (kmSince >= v.maintenance_interval_km * 0.9) {
          alerts.push(`Revision km: ${kmSince}/${v.maintenance_interval_km} km`);
        }
      }

      // Alerte date
      if (v.maintenance_interval_months && v.last_maintenance_date) {
        const lastDate = new Date(v.last_maintenance_date);
        const nextDate = new Date(lastDate);
        nextDate.setMonth(nextDate.getMonth() + v.maintenance_interval_months);
        const daysUntil = Math.round((nextDate - today) / (1000 * 60 * 60 * 24));
        if (daysUntil <= 30) {
          alerts.push(`Revision date: dans ${daysUntil} jours`);
        }
      }

      // Controle technique
      if (v.controle_technique_date) {
        const ctDate = new Date(v.controle_technique_date);
        const daysUntil = Math.round((ctDate - today) / (1000 * 60 * 60 * 24));
        if (daysUntil <= 60) {
          alerts.push(`Controle technique: dans ${daysUntil} jours`);
        }
      }

      if (alerts.length > 0) {
        // Creer/updater alerte en base
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

// ══════════════════════════════════════════
// ORCHESTRATEUR
// ══════════════════════════════════════════

let schedulerInterval = null;

function startScheduler() {
  console.log('[SCHEDULER] Demarrage du scheduler (interval: 1h)');

  // Executer immediatement au demarrage
  setTimeout(async () => {
    console.log('[SCHEDULER] Execution initiale...');
    await runAllJobs();
  }, 10000); // 10s apres le demarrage pour laisser la DB s'initialiser

  // Puis toutes les heures
  schedulerInterval = setInterval(async () => {
    const now = new Date();
    // Executer les jobs a 7h, 12h et 18h
    if ([7, 12, 18].includes(now.getHours())) {
      console.log(`[SCHEDULER] Execution planifiee a ${now.toLocaleTimeString('fr-FR')}`);
      await runAllJobs();
    }
  }, 60 * 60 * 1000); // Verifier toutes les heures
}

async function runAllJobs() {
  try {
    await checkAppointmentReminders();
    await checkContractEndings();
    await checkInsertionMilestones();
    await checkVehicleMaintenance();
    console.log('[SCHEDULER] Tous les jobs executes');
  } catch (err) {
    console.error('[SCHEDULER] Erreur globale:', err.message);
  }
}

function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

module.exports = { startScheduler, stopScheduler, runAllJobs };
