const SW_VERSION = "step-town-2026-11-15-cart-2";
const STATIC_CACHE = SW_VERSION + "-assets";
const PAGE_CACHE = SW_VERSION + "-pages";
const OWN_CACHES = new Set([STATIC_CACHE, PAGE_CACHE]);

async function cleanOldCaches() {
  const names = await caches.keys();
  await Promise.all(names
    .filter(name => name.startsWith("step-town-") && !OWN_CACHES.has(name))
    .map(name => caches.delete(name)));
}

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    await cleanOldCaches();
    await clients.claim();
    const windows = await clients.matchAll({ type:"window", includeUncontrolled:true });
    for (const client of windows) {
      client.postMessage({ type:"STEP_TOWN_SW_UPDATED", version:SW_VERSION });
    }
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache:"no-store" });
        if (response.ok && url.pathname !== "/cart" && !url.search) {
          const cache = await caches.open(PAGE_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        if (url.pathname === "/cart" || url.searchParams.has("product")) {
          return new Response("Step Town needs an internet connection to load this order page. Please reconnect and refresh.", {
            status:503,
            headers:{ "Content-Type":"text/plain; charset=utf-8", "Cache-Control":"no-store" }
          });
        }
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response("Step Town is offline. Reconnect and refresh to continue.", {
          status:503,
          headers:{ "Content-Type":"text/plain; charset=utf-8", "Cache-Control":"no-store" }
        });
      }
    })());
    return;
  }

  // Vite's production JS/CSS filenames include content hashes. A cache-first
  // strategy is safe for these immutable assets; new builds use new URLs.
  if (url.pathname.startsWith("/assets/") && /-[A-Za-z0-9_-]{6,}\.(?:js|css)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
  }
});

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { body:event.data ? event.data.text() : "A new Step Town update is available." }; }
  const title = payload.title || "Step Town";
  const options = {
    body:payload.body || "You have a new order or staff update.",
    icon:"/step-town-logo.png",
    badge:"/step-town-logo.png",
    data:{ url:payload.url || payload.data?.url || "/staff/orders" },
    tag:payload.tag || payload.order_id || "step-town-update",
    renotify:true,
    requireInteraction:true,
    vibrate:[180,90,180]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const requested = event.notification.data?.url || "/staff/orders";
  const target = new URL(requested, self.location.origin);
  if (target.origin !== self.location.origin || !target.pathname.startsWith("/staff/")) target.pathname = "/staff/orders";
  event.waitUntil((async () => {
    const openTabs = await clients.matchAll({ type:"window", includeUncontrolled:true });
    for (const client of openTabs) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(target.href);
        return client.focus();
      }
    }
    return clients.openWindow(target.href);
  })());
});
