// /sw.js
// Simple offline-first service worker with precache + runtime cache.

const VERSION = 'v1.0.0';
const CACHE_NAME = `nebula-cache-${VERSION}`;

const PRECACHE_URLS = [
  '/', '/index.html', '/styles.css',
  '/manifest.webmanifest',

  // Core
  '/core/store.js',
  '/core/time.js',
  '/core/ledger.js',
  '/core/db.js',
  '/core/seeds.js',

  // Engines
  '/engines/engine-day.js',
  '/engines/engine-chal.js',
  '/engines/engine-boss.js',
  '/engines/engine-coins.js',

  // UI
  '/ui/app.js',
  '/ui/components.js',
  '/ui/modals.js',
  '/ui/home.js',
  '/ui/calendar.js',
  '/ui/charts.js',
  '/ui/insights.js',
  '/ui/manage.js',
  '/ui/rewards.js'
];

// Install: precache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k.startsWith('nebula-cache-') && k !== CACHE_NAME) ? caches.delete(k) : null));
    await self.clients.claim();
  })());
});

// Fetch: navigation fallback + stale-while-revalidate for same-origin GET
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin
  if (url.origin !== self.location.origin) return;

  // HTML navigations -> Network falling back to cache, then index.html
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        return net;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  // Non-GET: pass-through
  if (req.method !== 'GET') return;

  // Stale-while-revalidate for same-origin GET
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const fetchPromise = fetch(req).then(netRes => {
      if (netRes && netRes.status === 200 && netRes.type === 'basic') {
        cache.put(req, netRes.clone());
      }
      return netRes;
    }).catch(() => null);
    return cached || fetchPromise || new Response('', { status: 504 });
  })());
});

// Optional: allow page to trigger SW update
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
