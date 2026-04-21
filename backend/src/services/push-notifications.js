// ══════════════════════════════════════════════════════════════
// Service d'envoi de notifications push (Web Push API + VAPID)
// ══════════════════════════════════════════════════════════════
//
// Nécessite les variables d'environnement :
//   VAPID_PUBLIC_KEY   — clé publique (à exposer au client)
//   VAPID_PRIVATE_KEY  — clé privée (jamais exposée)
//   VAPID_SUBJECT      — mailto:admin@solidata.online (défaut)
//
// Génération des clés (dev) :
//   npx web-push generate-vapid-keys
// Puis ajouter dans .env :
//   VAPID_PUBLIC_KEY=…
//   VAPID_PRIVATE_KEY=…
//
// Si les clés ne sont pas configurées, le service se désactive
// silencieusement (sendPush retourne { skipped: true }).

const webpush = require('web-push');
const pool = require('../config/database');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || null;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || null;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@solidata.online';

let configured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
  } catch (err) {
    console.error('[PUSH] VAPID setup error:', err.message);
  }
} else {
  console.warn('[PUSH] VAPID keys non configurées — push désactivé (voir services/push-notifications.js)');
}

function isConfigured() {
  return configured;
}

function getPublicKey() {
  return VAPID_PUBLIC_KEY;
}

// Envoie un push à un abonnement donné. Supprime l'abonnement si endpoint
// renvoie 410 Gone (désinscrit).
async function sendToSubscription(sub, payload) {
  if (!configured) return { skipped: true };
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    await pool.query('UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = $1', [sub.id]).catch(() => {});
    return { sent: true };
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      // Abonnement invalide → purge
      await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
      return { removed: true, statusCode: err.statusCode };
    }
    console.warn('[PUSH] sendNotification error:', err.statusCode, err.message);
    return { error: err.message, statusCode: err.statusCode };
  }
}

// Envoi à tous les abonnements d'un user.
async function sendPushToUser(userId, payload) {
  if (!configured || !userId) return { skipped: true };
  const res = await pool.query('SELECT * FROM push_subscriptions WHERE user_id = $1', [userId]);
  return Promise.all(res.rows.map(s => sendToSubscription(s, payload)));
}

// Envoi à tous les users ayant un rôle donné.
async function sendPushToRoles(roles, payload) {
  if (!configured) return { skipped: true };
  if (!Array.isArray(roles) || roles.length === 0) return { skipped: true };
  const res = await pool.query(
    `SELECT ps.* FROM push_subscriptions ps
       JOIN users u ON u.id = ps.user_id
      WHERE u.role = ANY($1::text[])`,
    [roles]
  );
  return Promise.all(res.rows.map(s => sendToSubscription(s, payload)));
}

module.exports = {
  isConfigured,
  getPublicKey,
  sendPushToUser,
  sendPushToRoles,
};
