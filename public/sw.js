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
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(clients.claim()));
