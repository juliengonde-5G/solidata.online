// Service Worker minimal — Web Push (Niveau 2.2)
// Scope : racine du domaine.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Réception d'un push envoyé par le backend (via web-push + VAPID).
self.addEventListener('push', (event) => {
  let payload = { title: 'SOLIDATA', body: 'Notification', data: {} };
  if (event.data) {
    try { payload = event.data.json(); }
    catch { payload = { title: 'SOLIDATA', body: event.data.text(), data: {} }; }
  }
  const { title, body, tag, data, icon } = payload;
  event.waitUntil(
    self.registration.showNotification(title || 'SOLIDATA', {
      body: body || '',
      tag: tag || undefined,
      icon: icon || '/icon-192.png',
      badge: '/icon-192.png',
      data: data || {},
      renotify: !!tag,
    })
  );
});

// Clic sur la notification : ouvre ou focus la page cible.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      try {
        const url = new URL(client.url);
        if (url.pathname === targetUrl && 'focus' in client) return client.focus();
      } catch { /* ignore */ }
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
  })());
});
