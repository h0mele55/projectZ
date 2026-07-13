 
/**
 * The service worker. Hand-written, committed, no build step.
 *
 * ═══ WHY THIS IS NOT SERWIST / WORKBOX ═══
 *
 * It was, briefly. `@serwist/next` does not support TURBOPACK, and Next 16 builds
 * with Turbopack by default. It printed a warning, emitted NOTHING, and the build
 * still reported success — so the app would have shipped a PWA with no service
 * worker at all, and CI would have been perfectly green about it.
 *
 * That is the worst class of failure: a feature that is absent rather than
 * broken. Nothing to notice.
 *
 * So the worker is written by hand. It is short enough to read in one sitting,
 * it has no build step that can silently no-op, and the one property that really
 * matters is auditable in ten seconds:
 *
 * ═══ IT NEVER CACHES AN AUTHENTICATED RESPONSE ═══
 *
 * A service worker cache is per-DEVICE, not per-user. Cache `/api/bookings` and
 * the next person to sign in on that laptop — a partner, a colleague, the next
 * shift on the club's front desk — is served the PREVIOUS user's data, from
 * disk, without a single request reaching us.
 *
 * There is no session check to fail. There is no log line. The data simply
 * appears under the wrong person's name, and the only way anyone finds out is
 * that somebody notices.
 *
 * So: anything under /api/ is fetched from the network and never stored. What IS
 * cached is the SHELL — JS, CSS, fonts, icons — which is identical for everybody
 * and is what lets the app open on a bad connection at a tennis club.
 *
 * tests/guardrails/pwa-safety.test.ts fails the build if that changes.
 */

const VERSION = 'v1';
const SHELL_CACHE = `playerz-shell-${VERSION}`;

/** The offline page. Deliberately tiny and static. */
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Only the offline fallback is precached. Everything else is cached
      // lazily, on first use — precaching a manifest we do not have is how the
      // Serwist path went wrong in the first place.
      await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
    })(),
  );

  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from an older VERSION. Without this, a released fix to the
      // shell is invisible to anyone who ever loaded the old one.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith('playerz-shell-') && n !== SHELL_CACHE)
          .map((n) => caches.delete(n)),
      );

      await self.clients.claim();
    })(),
  );
});

/** Is this a request whose response is specific to WHO IS SIGNED IN? */
function isAuthenticated(url, request) {
  // Everything under /api/. No exceptions, and no allowlist — an allowlist is a
  // list somebody will add to on a Friday.
  if (url.pathname.startsWith('/api/')) return true;

  // A navigation is a server-rendered page, and our pages are personalised.
  if (request.mode === 'navigate') return true;

  // Anything carrying credentials.
  if (request.credentials === 'include') return true;

  return false;
}

/** Static, content-addressed, identical for every user. */
function isShellAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/_next/static/') ||
      url.pathname.startsWith('/icons/') ||
      url.pathname.startsWith('/engine/') ||
      /\.(?:css|js|woff2?|png|jpg|jpeg|svg|webp|avif)$/.test(url.pathname))
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never touch a non-GET. A POST is not cacheable and replaying one would be a
  // duplicate booking.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (isAuthenticated(url, request)) {
    // NETWORK ONLY. Never stored, never served from disk.
    //
    // A navigation that fails offline falls back to the offline PAGE — which is
    // static and personal to nobody. It does NOT fall back to a cached copy of
    // the last page this device saw, because that page belonged to whoever was
    // signed in at the time.
    if (request.mode === 'navigate') {
      event.respondWith(
        fetch(request).catch(async () => {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match(OFFLINE_URL)) ?? Response.error();
        }),
      );
    }
    return;
  }

  if (isShellAsset(url)) {
    // Cache-first: these are content-hashed and immutable.
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;

        const response = await fetch(request);
        // Only store a real success. Caching a 404 or an opaque error means
        // serving it from disk forever.
        if (response.ok && response.status === 200) {
          cache.put(request, response.clone());
        }
        return response;
      })(),
    );
  }
});

// ── Push ─────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // A malformed payload is not worth a blank notification reading "undefined".
    // Say nothing rather than say nonsense.
    return;
  }

  if (!payload || !payload.title) return;

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      // Same tag → this REPLACES the previous notification about the same thing
      // rather than stacking. Three reminders about one booking is three
      // reminders too many.
      tag: payload.tag,
      data: { url: payload.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // FOCUS an existing tab rather than opening another. A user who taps three
      // notifications should not end up with three copies of the app.
      for (const client of clients) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(url);
          return;
        }
      }

      await self.clients.openWindow(url);
    })(),
  );
});
