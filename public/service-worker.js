const CACHE_VERSION = "shbfinance-pwa-v3";

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/pwa-register.js",
  "/pwa-install-button.js",
  "/pwa-update-toast.js",
  "/open-external-browser.js",
  "/icons/shbfinance-icon.svg",
  "/assets/avatar-chatbot.png"
];

const STATIC_ASSET_RE = /\.(?:js|css|png|jpg|jpeg|svg|webp|gif|ico|woff2?)$/i;

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function (cache) {
        return cache.addAll(APP_SHELL);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key !== CACHE_VERSION;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", function (event) {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/admin")) return;
  if (url.pathname === "/service-worker.js") return;
  if (url.pathname === "/manifest.webmanifest") return;
  if (url.pathname === "/app-version.json") return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (STATIC_ASSET_RE.test(url.pathname) || APP_SHELL.includes(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_VERSION);

  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    return cached || cache.match("/");
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then(function (response) {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(function () {
      return cached;
    });

  return cached || network;
}
