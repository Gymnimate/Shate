const CACHE_NAME = "shate-cache-v1";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icons/512x512-maskable.png",
  "./icons/512x512-monochrome.png",
  "./screenshot-desktop.png",
  "./screenshot-mobile.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn("Some assets could not be cached during install:", err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Only handle GET requests
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Skip chrome-extension, voice web socket, dynamic APIs, etc.
  if (!url.protocol.startsWith("http")) return;

  // We use a network-first falling back to cache strategy.
  // This is the safest strategy for active web apps to avoid loading stale versions
  // of index.html/js bundles when you push updates, whilst still letting PWA Builder pass 100/100.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // If response is valid, clone and put it into current cache
        if (response && response.status === 200 && response.type === "basic") {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Fallback to index.html if navigating offline
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
        });
      })
  );
});
