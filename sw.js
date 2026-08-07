const CACHE = "remplissage-v5-38";
const STATIC = ["/", "/index.html", "/update-password", "/update-password.js", "/forgot-password.js", "/styles.css", "/article-wizard.css", "/ges-locations.css", "/login-logo.css", "/department-defaults.js", "/signup-fix.js", "/dashboard-navigation.js", "/ui-icons.js", "/ges-locations.js", "/tour-ges-locations.js", "/department-ai-suggestion.js", "/article-wizard.js", "/article-entry-options.js", "/pickup-today.js", "/pdf-local-time.js", "/form-sync-guard.js", "/user-management-v2.js", "/user-delete.js", "/user-role-headings.js", "/user-presence.js", "/user-tabs.js", "/user-refresh-policy.js", "/notification-center.js", "/notification-login-prompt.js", "/pickup-employee-items.js", "/history-item-links.js", "/app.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/THD_logo_resized.jpg"];

self.addEventListener("install", event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(STATIC)).then(() => self.skipWaiting())
));

self.addEventListener("activate", event => event.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request).then(cached => cached || caches.match("/index.html")))
  );
});

function pushPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return { body: event.data.text() };
  }
}

self.addEventListener("push", event => {
  const payload = pushPayload(event);
  const title = payload.title || "Nouvelle tâche attribuée";
  const destination = payload.destination || "notifications";
  const url = payload.url || `/?push=${encodeURIComponent(destination)}`;
  const options = {
    body: payload.body || "Ouvre l’application pour consulter les détails.",
    icon: payload.icon || "/icons/icon-192.png",
    badge: payload.badge || "/icons/icon-192.png",
    tag: payload.tag || `assignment-${Date.now()}`,
    renotify: true,
    timestamp: Number(payload.timestamp || Date.now()),
    vibrate: [120, 60, 120],
    data: {
      url,
      destination,
      notificationId: payload.notificationId || "",
      notificationIds: Array.isArray(payload.notificationIds) ? payload.notificationIds : []
    },
    actions: [{ action: "open", title: "Ouvrir" }]
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    windows.forEach(client => client.postMessage({
      type: "push-received",
      destination,
      notificationId: payload.notificationId || ""
    }));
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const data = event.notification.data || {};
  const destination = data.destination || "notifications";
  const notificationId = data.notificationId || "";
  const targetUrl = new URL(data.url || `/?push=${encodeURIComponent(destination)}`, self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      existing.postMessage({
        type: "push-notification-click",
        destination,
        notificationId
      });
      return;
    }
    await self.clients.openWindow(targetUrl);
  })());
});
