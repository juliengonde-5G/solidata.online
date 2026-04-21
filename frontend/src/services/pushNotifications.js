// ══════════════════════════════════════════════════════════════
// Client Web Push (Niveau 2.2)
// ══════════════════════════════════════════════════════════════

import api from './api';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getPushPermissionState() {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

async function ensureRegistration() {
  if (!('serviceWorker' in navigator)) return null;
  let reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg) {
    reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  }
  // Attend que le SW soit actif
  if (reg.installing || reg.waiting) {
    await navigator.serviceWorker.ready;
  }
  return reg;
}

// Enregistre le navigateur auprès du backend. Retourne la subscription ou null.
export async function enablePushNotifications() {
  if (!isPushSupported()) return { error: 'unsupported' };
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { error: 'permission_denied', permission };

  const { data } = await api.get('/push/vapid-public-key');
  if (!data?.configured || !data?.publicKey) return { error: 'not_configured' };

  const reg = await ensureRegistration();
  if (!reg) return { error: 'sw_registration_failed' };

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey),
    });
  }
  const json = sub.toJSON();
  await api.post('/push/subscribe', {
    endpoint: json.endpoint,
    keys: json.keys,
    platform: 'web',
  });
  return { ok: true, subscription: json };
}

export async function disablePushNotifications() {
  if (!isPushSupported()) return { error: 'unsupported' };
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    const json = sub.toJSON();
    await api.post('/push/unsubscribe', { endpoint: json.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
  return { ok: true };
}

export async function isPushActive() {
  if (!isPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return Boolean(sub);
  } catch { return false; }
}

export async function sendTestPush() {
  return api.post('/push/test');
}
