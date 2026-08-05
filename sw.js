const CACHE = "remplissage-v5-16";
const STATIC = ["/", "/index.html", "/styles.css", "/article-wizard.css", "/ges-locations.css", "/signup-fix.js", "/dashboard-navigation.js", "/ui-icons.js", "/ges-locations.js", "/tour-ges-locations.js", "/department-ai-suggestion.js", "/article-wizard.js", "/pickup-today.js", "/pdf-local-time.js", "/form-sync-guard.js", "/user-management-v2.js", "/app.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || caches.match("/index.html"))));
});
