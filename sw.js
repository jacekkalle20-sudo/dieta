// sw.js – Dieta dla Rodziny – service worker v0.3.0 (pamięć podręczna aplikacji do pracy offline)
const CACHE = "dieta-v0.3.0";
const SHELL = ["./", "index.html", "styles.css", "manifest.json", "config.js", "icon-192.png", "icon-512.png",
  "app.js", "version.js", "defaults.js", "importer.js", "nutrition.js", "scaling.js", "week.js", "backend-firebase.js"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const own = url.origin === location.origin;
  const sdk = url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/");
  if (!own && !sdk) return; // Firestore i logowanie zawsze przez sieć (obsługuje je SDK)
  // sieć najpierw (świeża wersja), pamięć podręczna gdy offline
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
