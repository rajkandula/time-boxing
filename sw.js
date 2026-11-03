// Offline support. Network first, so a new deploy shows up on the next load;
// the cache is the fallback when offline or when the network is very slow.
const CACHE = 'timebox-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/styles.css',
  './js/app.js', './js/core.js', './js/store.js', './js/timer.js', './js/render.js', './js/ui.js', './js/alerts.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('timebox-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  event.respondWith(networkFirst(req));
});

// Always revalidate with the server so a fresh deploy is never hidden behind the HTTP cache.
function revalidate(req) {
  return req.mode === 'navigate'
    ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })
    : new Request(req, { cache: 'no-cache' });
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const network = fetch(revalidate(req)).then((res) => {
    if (res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  });
  network.catch(() => {});
  try {
    return await Promise.race([network, new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 4000))]);
  } catch {
    const cached = (await cache.match(req, { ignoreSearch: true }))
      || (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    return cached || network;
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) if ('focus' in client) return client.focus();
      return self.clients.openWindow('./');
    }),
  );
});
