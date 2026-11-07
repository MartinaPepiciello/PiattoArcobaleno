// Piatto Arcobaleno: service worker per i promemoria giornalieri.
// Il server manda una notifica push vuota; il testo lo scegliamo qui.
const MESSAGES = [
  'Cosa c\'era nel piatto oggi? Segnalo prima di dimenticarlo 🌈',
  'Hai segnato cosa hai mangiato oggi?',
  'Due secondi per il diario di oggi? 🥦🍝🍎',
  'Il tuo arcobaleno di oggi ti aspetta 🌈',
];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  const body = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
  e.waitUntil(self.registration.showNotification('Piatto Arcobaleno', {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'promemoria',
    renotify: true,
    data: { url: '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) return c.focus();
    }
    return self.clients.openWindow('/');
  })());
});
