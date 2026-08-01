const CACHE = "radiusly-v39";
const APP = ["./", "./styles.css", "./app.js", "./route.mjs", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin)
    return;
  if (location.hostname === "localhost") return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
