/*
 * Service worker for the installed admin app. Registered with scope /admin by
 * components/admin/install-app.tsx, so it never touches a guest page.
 *
 * It caches one thing: the offline notice. Nothing else — not the bundle, not
 * a single response from Supabase. This screen shows money, and a figure
 * served from yesterday's cache is worse than no figure at all; a stale
 * bundle after a deploy would be worse still. So every request goes to the
 * network, and the only thing offline gets you is an honest message.
 *
 * Bump VERSION to drop the old cache on the next visit.
 */
const VERSION = 'mehmongo-admin-v1';
// Without the extension: Cloudflare serves the asset at the clean path and
// answers /admin-offline.html with a 307 to it, which is not what we want
// sitting in a cache as the page to show when the network is gone.
const OFFLINE_URL = '/admin-offline';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== VERSION).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  // Anything that is not a page load is left entirely alone: not intercepting
  // is what keeps data and code always fresh.
  if (event.request.mode !== 'navigate') return;

  event.respondWith((async () => {
    try {
      return await fetch(event.request);
    } catch {
      const cache = await caches.open(VERSION);
      const offline = await cache.match(OFFLINE_URL);
      return offline ?? Response.error();
    }
  })());
});
