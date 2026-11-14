/* My Asset – service worker
   - Pre-caches the app shell so the app opens offline.
   - ALWAYS asks the network first and skips the browser's own HTTP cache (GitHub Pages lets browsers keep
     files for ~10 minutes, which is why an old copy kept showing). Cache is used only when offline.
   - Never touches the Google Apps Script API or any other cross-origin request,
     so your financial data is never stored by the service worker.
   Bump CACHE whenever you replace this file (any change to sw.js makes phones install the new worker). */
const CACHE = 'my-asset-v58';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', event => {
  // cache each file separately so one missing file can never block installation
  event.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => fetch(new Request(u, { cache: 'reload' })).then(r => r.ok && c.put(u, r)).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;   // API calls pass straight through

  event.respondWith(
    fetch(new Request(req, { cache: 'reload' }))                 // bypass the HTTP cache so the newest file always arrives
      .then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
      )
  );
});
