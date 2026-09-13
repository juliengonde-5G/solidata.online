/**
 * Service de notification (Email + SMS via Brevo).
 *
 * ═══ CE QUE CE FICHIER REND, ET POURQUOI C'EST IMPORTANT ══════════════════
 *
 * Il rendait le JSON de Brevo SANS REGARDER LE STATUT HTTP. Un 400 (numéro
 * invalide), un 401 (clé révoquée) ou un 402 (crédits épuisés) étaient donc
 * indiscernables d'un envoi réussi — et le job de rappels de rendez-vous
 * inscrivait « envoyé » dans sa trace, que l'`UNIQUE(milestone_id)` rendait
 * définitive : la personne n'était pas prévenue, et la preuve RGPD du service
 * rendu affirmait le contraire (constat M-04 de la revue de sécurité PR C).
 *
 * La réponse porte désormais `ok` (succès HTTP constaté) et `status`, en PLUS
 * du corps rendu par Brevo — ajout purement additif : les six autres appelants
 * qui ignorent la valeur de retour ne changent pas de comportement.
 */
const BREVO_API_KEY = process.env.BREVO_API_KEY;

/** Échappement HTML minimal — le corps porte des données de dossier ({prenom}). */
function echapperHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Normalise un numéro français en E.164 (« 06 12 34 56 78 » → « +33612345678 »).
 *
 * L'ancienne version faisait `+33${phone.substring(1)}` et CONSERVAIT les
 * séparateurs : Brevo répondait « recipient is invalid » sur le format même que
 * l'écran de consentement encourage à saisir (M-04).
 */
function normaliserTelephone(phone) {
  const brut = String(phone == null ? '' : phone).trim();
  if (!brut) return '';
  const compact = brut.replace(/[\s.\-()]/g, '');
  if (compact.startsWith('+')) return compact;
  if (compact.startsWith('00')) return `+${compact.slice(2)}`;
  if (/^0\d{9}$/.test(compact)) return `+33${compact.slice(1)}`;
  return compact;
}

/** Destinataire masqué pour les journaux serveur (jamais le contact en clair). */
function masquerPourJournal(valeur) {
  const v = String(valeur == null ? '' : valeur).trim();
  if (!v) return '—';
  if (v.includes('@')) {
    const at = v.indexOf('@');
    return `${at >= 3 ? v.slice(0, 1) : ''}***${v.slice(at)}`;
  }
  const chiffres = v.replace(/\D/g, '');
  return chiffres.length < 4 ? '***' : `${chiffres.slice(0, 2)} ** ** ** ${chiffres.slice(-2)}`;
}

async function sendNotification(template, recipientEmail, recipientPhone, variables) {
  let body = template.body;
  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      body = body.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
    }
  }

  if (!BREVO_API_KEY) {
    // Le contact est MASQUÉ même ici : c'est l'état des environnements de
    // recette, et tout le reste du module s'applique à ne garder qu'un
    // destinataire masqué (constat m-11).
    console.log(`[NOTIFICATION] [DRY-RUN] ${template.type} → ${masquerPourJournal(recipientEmail || recipientPhone)}: ${body.substring(0, 80)}...`);
    return { dryRun: true, ok: true };
  }

  if (template.type === 'email' && recipientEmail) {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Solidarite Textiles', email: 'noreply@solidata.online' },
        to: [{ email: recipientEmail }],
        subject: template.subject || 'Solidarite Textiles',
        // Le corps porte des données de dossier : il est échappé avant d'être
        // versé dans du HTML (m-10).
        htmlContent: `<html><body><p>${echapperHtml(body).replace(/\n/g, '<br>')}</p></body></html>`,
      }),
    });
    const json = await response.json().catch(() => ({}));
    return { ...json, ok: response.ok, status: response.status };
  }

  if (template.type === 'sms' && recipientPhone) {
    const phone = normaliserTelephone(recipientPhone);
    const response = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ sender: 'SolTextiles', recipient: phone, content: body }),
    });
    const json = await response.json().catch(() => ({}));
    return { ...json, ok: response.ok, status: response.status };
  }

  return { skipped: true, ok: false, reason: 'no_recipient' };
}

module.exports = { sendNotification, normaliserTelephone, echapperHtml, masquerPourJournal };
