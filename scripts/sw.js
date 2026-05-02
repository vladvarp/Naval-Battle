// Service Worker for Naval Battle audio caching
// Cache Storage is controlled from the page code; SW serves cached audio fast.

const AUDIO_CACHE_NAME = "mb-audio-cache-v1";

self.addEventListener("install", (event) => {
  // Activate immediately
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function isAudioRequest(request) {
  try {
    const url = new URL(request.url);
    return url.pathname.includes("/audio/") && url.pathname.endsWith(".mp3");
  } catch {
    return false;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (!isAudioRequest(req)) return;

  event.respondWith((async () => {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;

    // Fallback: network (do not populate here; page controls overwrite rules)
    return fetch(req);
  })());
});

