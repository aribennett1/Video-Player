/* coi-serviceworker - Cross-Origin Isolation via Service Worker
 * Injects COOP/COEP headers so SharedArrayBuffer (required by ffmpeg.wasm)
 * is available on static hosts like GitHub Pages that don't allow custom headers.
 */

const coiTs = () => `[${new Date().toISOString()}]`;

if (typeof window === "undefined") {
  // ---- Running as a Service Worker ----
  const CACHE_PREFIX = `media-player:${self.registration.scope}:`;
  const CACHE_NAME = `${CACHE_PREFIX}v1`;
  const assetURL = (path) => new URL(path, self.registration.scope).href;
  const ASSETS = [
    "index.html",
    "coi-serviceworker.js",
    "vendor/ffmpeg/ffmpeg.js",
    "vendor/ffmpeg/814.ffmpeg.js",
    "vendor/ffmpeg/ffmpeg-core.js",
    "vendor/ffmpeg/ffmpeg-core.wasm",
  ];
  const assetURLs = new Set(ASSETS.map(assetURL));

  self.addEventListener("install", (event) => {
    // Install only when the entire offline player is available.
    event.waitUntil(caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(ASSETS.map((path) => new Request(assetURL(path), { cache: "reload" })))
    ).then(() => self.skipWaiting()));
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    )).then(() => self.clients.claim()));
  });

  async function networkFirst(request, key) {
    const controller = new AbortController();
    // Bound the wait for an unresponsive server when an offline copy exists.
    const cached = await caches.open(CACHE_NAME).then((cache) => cache.match(key)).catch(() => null);
    const timer = cached ? setTimeout(() => controller.abort(), 8000) : null;
    try {
      const response = await fetch(request, { cache: "no-cache", signal: controller.signal });
      if (response.ok && response.status !== 206) {
        // Storage failure must never turn a successful live request into an error.
        await caches.open(CACHE_NAME).then((cache) => cache.put(key, response.clone()))
          .catch((error) => console.warn("[coi-sw] Cache update failed:", error));
      }
      return !response.ok && cached ? cached : response;
    } catch (error) {
      if (cached) return cached;
      return new Response("The player is unavailable offline. Connect to the internet and reload to save it.", {
        status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function handleFetch(request) {
    const url = new URL(request.url);
    const isPage = url.origin === self.location.origin &&
      (url.pathname === new URL(self.registration.scope).pathname ||
       url.pathname === new URL(assetURL("index.html")).pathname);
    const key = isPage ? assetURL("index.html") : request.url;
    const shouldCache = request.method === "GET" && !request.headers.has("range") &&
      (isPage || assetURLs.has(request.url));
    const r = shouldCache ? await networkFirst(request, key) : await fetch(request);
    if (r.status === 0) return r;

    const headers = new Headers(r.headers);
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");

    // Log only HTML navigations (not every asset) to avoid noise
    if (request.mode === "navigate") {
      console.log(coiTs(), "[coi-sw WORKER] Injected COOP/COEP headers on:", request.url);
    }

    return new Response(r.body, {
      status: r.status,
      statusText: r.statusText,
      headers,
    });
  }

  self.addEventListener("fetch", (event) => {
    if (
      event.request.cache === "only-if-cached" &&
      event.request.mode !== "same-origin"
    )
      return;
    event.respondWith(handleFetch(event.request));
  });
} else {
  // ---- Running as a page script — registers itself as the Service Worker ----
  (async () => {
    const controller = navigator.serviceWorker && navigator.serviceWorker.controller;
    console.log(coiTs(), "[coi-sw PAGE] Script running.",
      "crossOriginIsolated:", window.crossOriginIsolated,
      "SharedArrayBuffer:", typeof SharedArrayBuffer !== "undefined",
      "SW controller active:", !!controller,
      "controller URL:", controller ? controller.scriptURL : "none"
    );

    if (!navigator.serviceWorker) {
      console.warn(coiTs(), "[coi-sw PAGE] Service workers not supported — ffmpeg.wasm may not work.");
      return;
    }

    try {
      const swURL = window.document.currentScript.src;
      console.log(coiTs(), "[coi-sw PAGE] Registering service worker at:", swURL);
      const reg = await navigator.serviceWorker.register(swURL, { updateViaCache: "none" });
      console.log(coiTs(), "[coi-sw PAGE] register() resolved.",
        "installing:", !!reg.installing,
        "waiting:", !!reg.waiting,
        "active:", !!reg.active,
        "scope:", reg.scope
      );

      // Register even on hosts that already provide isolation headers, for offline use.
      if (window.crossOriginIsolated !== false || controller) return;

      const reload = () => {
        console.log(coiTs(), "[coi-sw PAGE] Triggering location.reload() to activate cross-origin isolation...");
        window.location.reload();
      };

      if (reg.active) {
        console.log(coiTs(), "[coi-sw PAGE] SW already active — reloading immediately.");
        reload();
        return;
      }

      const sw = reg.installing || reg.waiting;
      if (sw) {
        console.log(coiTs(), "[coi-sw PAGE] Waiting for SW state change. Current state:", sw.state);
        sw.addEventListener("statechange", () => {
          console.log(coiTs(), "[coi-sw PAGE] SW state changed to:", sw.state);
          if (sw.state === "activated") reload();
        });
      } else {
        console.warn(coiTs(), "[coi-sw PAGE] No installing/waiting SW found — unexpected state.");
      }
    } catch (err) {
      console.warn(coiTs(), "[coi-sw PAGE] Registration failed:", err);
    }
  })();
}
