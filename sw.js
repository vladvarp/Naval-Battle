// Service Worker: отдаёт mp3 из Cache Storage (в т.ч. офлайн для <audio> и fetch).
// Скрипт в корне деплоя, scope "./" — иначе нельзя перехватывать ./audio/*.mp3
// (scope не может быть «выше» каталога файла worker’а).

const AUDIO_CACHE_NAME = "mb-audio-cache-v1";

self.addEventListener("install", (event) => {
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
    return fetch(req);
  })());
});
