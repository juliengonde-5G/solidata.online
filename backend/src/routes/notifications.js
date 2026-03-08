const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('ADMIN', 'RH'));

// POST /api/notifications/send — Envoyer une notification (SMS ou email via Brevo)
router.post('/send', async (req, res) => {
  try {
    const { template_id, recipient_email, recipient_phone, variables } = req.body;

    // Récupérer le template
    const tmpl = await pool.query('SELECT * FROM message_templates WHERE id = $1 AND is_active = true', [template_id]);
    if (tmpl.rows.length === 0) return res.status(404).json({ error: 'Template non trouvé' });

    const template = tmpl.rows[0];

    // Remplacer les variables
    let body = template.body;
    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        body = body.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
      }
    }

    const BREVO_API_KEY = process.env.BREVO_API_KEY;

    if (template.type === 'email' && BREVO_API_KEY && recipient_email) {
      // Envoi email via Brevo API
      try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'api-key': BREVO_API_KEY,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            sender: { name: 'Solidarité Textiles', email: 'noreply@solidata.online' },
            to: [{ email: recipient_email }],
            subject: template.subject || 'Solidarité Textiles',
            htmlContent: `<html><body><p>${body.replace(/\n/g, '<br>')}</p></body></html>`,
          }),
        });
        const data = await response.json();
        return res.json({ message: 'Email envoyé', brevo: data });
      } catch (apiErr) {
        return res.status(500).json({ error: 'Erreur envoi email', detail: apiErr.message });
      }
    }

    if (template.type === 'sms' && BREVO_API_KEY && recipient_phone) {
      try {
        const response = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'api-key': BREVO_API_KEY,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            sender: 'SolTextiles',
            recipient: recipient_phone.startsWith('+') ? recipient_phone : `+33${recipient_phone.substring(1)}`,
            content: body,
          }),
        });
        const data = await response.json();
        return res.json({ message: 'SMS envoyé', brevo: data });
      } catch (apiErr) {
        return res.status(500).json({ error: 'Erreur envoi SMS', detail: apiErr.message });
      }
    }

    // Pas de clé API ou pas de destinataire → retourner le message préparé
    res.json({
      message: 'Message préparé (envoi non effectué - vérifier BREVO_API_KEY)',
      template: template.name,
      type: template.type,
      subject: template.subject,
      body,
      recipient: recipient_email || recipient_phone,
    });
  } catch (err) {
    console.error('[NOTIFICATIONS] Erreur envoi :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
