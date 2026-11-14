const CACHE_VERSION = "step-town-static-v2026-11-14-cart2";
const CACHE_PREFIX = "step-town-";

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { body: event.data ? event.data.text() : "A new Step Town update is available." }; }
  const title = payload.title || "Step Town";
  const options = {
    body: payload.body || "You have a new order or staff update.",
    icon: "/step-town-logo.png",
    badge: "/step-town-logo.png",
    data: { url: payload.url || payload.data?.url || "/staff/orders" },
    tag: payload.tag || payload.order_id || "step-town-update",
    renotify: true,
    requireInteraction: true,
    vibrate: [180, 90, 180]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const requested = event.notification.data?.url || "/staff/orders";
  const target = new URL(requested, self.location.origin);
  if (target.origin !== self.location.origin || !target.pathname.startsWith("/staff/")) target.pathname = "/staff/orders";
  event.waitUntil((async () => {
    const openTabs = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of openTabs) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(target.href);
        return client.focus();
      }
    }
    return clients.openWindow(target.href);
  })());
});

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_VERSION)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;

  const acceptsHtml = (request.headers.get("accept") || "").includes("text/html");
  if (request.mode === "navigate" || request.destination === "document" || acceptsHtml) {
    const cacheablePage = !/^\/(?:cart|cart-debug|profile|login|register|staff|order)(?:\/|$)/.test(url.pathname);
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        const response = await fetch(new Request(request, { cache: "no-store" }));
        if (cacheablePage && response.ok && response.headers.get("content-type")?.includes("text/html")) {
          try { await cache.put(request, response.clone()); } catch { /* A cache write must never block navigation. */ }
        }
        return response;
      } catch (error) {
        if (cacheablePage) {
          const cached = await cache.match(request);
          if (cached) return cached;
        }
        throw error;
      }
    })());
    return;
  }

  // Vite's production assets include content hashes. Only these immutable
  // bundles are cached; HTML and API responses always come from the network.
  if (/^\/assets\/[^/]+-[a-z0-9_-]{8,}\.(?:js|css)$/i.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
  }
});
