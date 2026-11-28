// Offline support. Every file of the app is kept on the computer, so the app opens without internet.
// To publish an update: change VERSION below (e.g. 3.0.1) and upload the changed files to GitHub.
// Open copies of the app notice it and show "A new version of the app is ready – Update now".
// Your records are NOT stored here; updates never touch them.
const VERSION = '5.4.0';
const CACHE = 'padma-finance-' + VERSION;
const FILES = [
  './',
  'index.html',
  'tailwind.css',
  'styles.css',
  'js/bs-data.js',
  'js/core.js',
  'js/padma-web.js',
  'js/app.js',
  'js/pwa.js',
  'privacy.html',
  'vendor/html2canvas.min.js',
  'vendor/jspdf.umd.min.js',
  'assets/logo.png',
  'assets/icon.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-512.png',
  'fonts/ibm-plex-sans-latin-400-normal.woff2',
  'fonts/ibm-plex-sans-latin-500-normal.woff2',
  'fonts/ibm-plex-sans-latin-600-normal.woff2',
  'fonts/ibm-plex-sans-latin-700-normal.woff2',
  'fonts/jetbrains-mono-latin-500-normal.woff2',
  'fonts/jetbrains-mono-latin-700-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('padma-finance-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // server pages (Drive connect, scanner) always come from the internet
  if (/^\/(admin\.html|js\/admin\.js)$/.test(url.pathname)) return; // the admin panel is online-only and always fresh
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      const scope = new URL(self.registration.scope).pathname;
      const isApp = url.pathname === scope || url.pathname === scope + 'index.html';
      if (isApp) return (await cache.match('index.html')) || fetch(req);
      try { return await fetch(req); } catch { return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('index.html')); }
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return new Response('Offline', { status: 503 });
    }
  })());
});
