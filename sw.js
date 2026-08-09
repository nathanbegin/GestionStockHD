const CACHE = "remplissage-v5-68";
const STATIC = ["/", "/index.html", "/update-password", "/update-password.js", "/forgot-password.js", "/styles.css", "/filter-drawer.css", "/article-wizard.css", "/ges-locations.css", "/location-wizard-combined.css", "/sku-ai-entry.css", "/login-logo.css", "/events-layout.css", "/desktop-menu.css", "/appearance-settings.css", "/appearance-settings.js", "/department-defaults.js", "/signup-fix.js", "/dashboard-navigation.js", "/ui-icons.js", "/ges-locations.js", "/location-wizard-combined.js", "/tour-ges-locations.js", "/department-ai-suggestion.js", "/article-wizard.js", "/article-entry-options.js", "/sku-mask.js", "/sku-ai-entry.js", "/pickup-today.js", "/pdf-local-time.js", "/form-sync-guard.js", "/user-management-v2.js", "/user-delete.js", "/user-role-headings.js", "/user-presence.js", "/user-tabs.js", "/user-refresh-policy.js", "/desktop-menu.js", "/event-sync-pause.js", "/events-ui.js", "/events-view-guard.js", "/notification-center.js", "/notification-login-prompt.js", "/pickup-employee-items.js", "/history-item-links.js", "/offline-delete-queue.js", "/filter-drawer.js", "/location-barcode-normalizer.js", "/ges-location-conventions.js", "/app.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/THD_logo_resized.jpg"];

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