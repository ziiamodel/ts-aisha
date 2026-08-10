const CACHE = 'aisha-v3';
// Only pre-cache shell assets — offline page + icons + manifest
// Never cache HTML pages so the app is always fresh
const PRECACHE = [
  '/offline.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// ── INSTALL ───────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // ── External requests (Supabase images, CDN fonts, etc.) ─────
  // Always real-time — never intercept, never cache.
  if (url.origin !== location.origin) return;

  // ── Navigation / HTML pages ───────────────────────────────────
  // Network-ONLY. If offline → show offline.html (never stale cached HTML).
  if (e.request.destination === 'document' ||
      url.pathname.endsWith('.html') ||
      url.pathname === '/') {
    e.respondWith(
      fetch(e.request)
        .catch(() => caches.match('/offline.html'))
    );
    return;
  }

  // ── Static shell assets (icons, manifest) ────────────────────
  // Cache-first so the app shell loads fast, but update cache in background.
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
      return cached || networkFetch;
    })
  );
});
