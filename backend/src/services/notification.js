/**
 * Service de notification (Email + SMS via Brevo)
 */
const BREVO_API_KEY = process.env.BREVO_API_KEY;

async function sendNotification(template, recipientEmail, recipientPhone, variables) {
  let body = template.body;
  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      body = body.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
    }
  }

  if (!BREVO_API_KEY) {
    console.log(`[NOTIFICATION] [DRY-RUN] ${template.type} → ${recipientEmail || recipientPhone}: ${body.substring(0, 80)}...`);
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

module.exports = { sendNotification };
