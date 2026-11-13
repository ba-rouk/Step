self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { body: event.data ? event.data.text() : "A new Step Town update is available." }; }
  const title = payload.title || "Step Town";
  const options = {
    body: payload.body || "You have a new order or staff update.",
    icon: "https://d2ol7oe51mr4n9.cloudfront.net/user_3JPd9e1eRECK2nSPsNLigKlzn1d/9a5d19f1-c3c6-42d6-a9e9-a35ddaaeae13.jpg",
    badge: "https://d2ol7oe51mr4n9.cloudfront.net/user_3JPd9e1eRECK2nSPsNLigKlzn1d/9a5d19f1-c3c6-42d6-a9e9-a35ddaaeae13.jpg",
    data: { url: payload.url || "/staff/orders" },
    tag: payload.tag || "step-town-update",
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
