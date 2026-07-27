/**
 * StayFlow Staff service worker.
 *
 * Scope is deliberately narrow at this stage:
 *   - precache the app shell and offline fallback
 *   - serve a usable offline page when a navigation fails
 *   - never cache anything that could contain staff or roster data
 *
 * Cache versioning: bumping CACHE_VERSION invalidates every old cache on
 * activate. Combined with the no-store header on this file (see
 * next.config.ts), a deploy always reaches clients rather than leaving them
 * stranded on a superseded build.
 */

const CACHE_VERSION = "v1";
const CACHE_NAME = `stayflow-shell-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";

/** Assets required to render the offline fallback without a network. */
const PRECACHE_URLS = [OFFLINE_URL, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      // A precache miss must not block installation, or one renamed asset
      // would leave the worker permanently uninstallable.
      .catch(() => undefined),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * Allow the page to activate a waiting worker immediately, which is what the
 * "new version available" prompt triggers when the user accepts.
 */
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

/**
 * Paths that must never be cached: they carry authentication state or staff
 * data, and a cached copy could be served to the wrong person on a shared
 * device such as the property kiosk tablet.
 */
function isPrivatePath(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.includes("/rest/v1/") ||
    url.pathname.includes("/auth/v1/")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only GET is ever cacheable; a cached POST would be meaningless here.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never touch cross-origin requests (Supabase) or private paths.
  if (url.origin !== self.location.origin || isPrivatePath(url)) return;

  // Navigations: go to the network, and fall back to the offline page.
  // Network-first, never cache-first — a stale roster is worse than none.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const offline = await cache.match(OFFLINE_URL);
        return (
          offline ??
          new Response("You are offline.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      }),
    );
    return;
  }

  // Static build output is content-hashed, so it is safe to serve from cache.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

/* ------------------------------------------------------------------ */
/* Push notifications                                                  */
/* ------------------------------------------------------------------ */

/**
 * Show an incoming push.
 *
 * The payload carries only what is safe on a lock screen — the server is
 * responsible for that — so this displays it as sent without embellishment.
 * A malformed or empty payload still shows something generic rather than
 * nothing, because a silent push looks to the user like a lost message.
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "StayFlow";
  const options = {
    body: payload.body || "Open StayFlow for details.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // Same tag per category, so a second roster notification replaces the
    // first rather than stacking three identical ones on the lock screen.
    tag: payload.category || "stayflow",
    renotify: true,
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Focus an existing tab rather than opening another.
 *
 * Someone tapping three notifications should not end up with three copies
 * of the app open.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(target);
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
