self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { body: event.data ? event.data.text() : "A new Vitanova update is available." }; }
  const title = payload.title || "Vitanova";
  const options = {
    body: payload.body || "You have a new order or staff update.",
    icon: "/vitanova-mark.svg",
    badge: "/vitanova-mark.svg",
    data: { url: payload.url || "/staff/orders" },
    tag: payload.tag || "vitanova-update",
    renotify: true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/staff/orders", self.location.origin).href;
  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientsList) {
      if (client.url.startsWith(self.location.origin)) {
        await client.navigate(target);
        return client.focus();
      }
    }
    return clients.openWindow(target);
  })());
});
self.addEventListener("install", event => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(clients.claim()));
