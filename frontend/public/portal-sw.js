/*
 * Avisos del portal del dueño (notificaciones web, sin costo). Solo controla /p/: el sistema de
 * la clínica no se ve afectado. La dirección del portal llega en ?u= al registrarlo.
 */
const portalUrl = new URL(self.location.href).searchParams.get('u') || '/';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Aviso de tu veterinaria', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Aviso de tu veterinaria', {
      body: data.body || '',
      tag: data.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      lang: 'es-PE',
      data: { url: portalUrl },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || portalUrl;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).pathname.startsWith('/p/'));
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
