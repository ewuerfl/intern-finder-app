// Offline support: the app shell is cached; listings load fresh when online and fall back to the last copy offline.
const SHELL = 'if-shell-v4', DATA = 'if-data', ASSETS = 'if-assets';
const FILES = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest', 'vendor/supabase-2.117.2.js', 'icons/icon-192.png', 'icons/favicon-32.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![SHELL, DATA, ASSETS].includes(k)).map(k => caches.delete(k)))));
  self.clients.claim();
});
const fresh = async (req, name) => {           // network first, cache fallback
  try { const r = await fetch(req); if (r.ok) (await caches.open(name)).put(req, r.clone()); return r; }
  catch (e) { const c = await caches.match(req); if (c) return c; throw e; }
};
const swr = async (req, name) => {             // cached copy now, refresh in background
  const c = await caches.match(req);
  const f = fetch(req).then(async r => { if (r.ok || r.type === 'opaque') (await caches.open(name)).put(req, r.clone()); return r; }).catch(() => c);
  return c || f;
};
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/')) return;
  if (u.origin === location.origin) {
    if (u.pathname.endsWith('data.json')) return e.respondWith(fresh(e.request, DATA));
    return e.respondWith(fresh(e.request, SHELL));
  }
  if (/fonts\.(googleapis|gstatic)\.com$|img\.logo\.dev$/.test(u.hostname)) e.respondWith(swr(e.request, ASSETS));
});
