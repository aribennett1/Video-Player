/* coi-serviceworker - Cross-Origin Isolation via Service Worker
 * Injects COOP/COEP headers so SharedArrayBuffer (required by ffmpeg.wasm)
 * is available on static hosts like GitHub Pages that don't allow custom headers.
 */

const ts = () => `[${new Date().toISOString()}]`;

if (typeof window === "undefined") {
  // ---- Running as a Service Worker ----
  self.addEventListener("install", (e) => {
    console.log(ts(), "[coi-sw WORKER] install event fired — calling skipWaiting()");
    self.skipWaiting();
  });

  self.addEventListener("activate", (event) => {
    console.log(ts(), "[coi-sw WORKER] activate event fired — calling clients.claim()");
    event.waitUntil(self.clients.claim());
  });

  async function handleFetch(request) {
    const r = await fetch(request);
    if (r.status === 0) return r;

    const headers = new Headers(r.headers);
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");

    // Log only HTML navigations (not every asset) to avoid noise
    if (request.mode === "navigate") {
      console.log(ts(), "[coi-sw WORKER] Injected COOP/COEP headers on:", request.url);
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
    console.log(ts(), "[coi-sw PAGE] Script running.",
      "crossOriginIsolated:", window.crossOriginIsolated,
      "SharedArrayBuffer:", typeof SharedArrayBuffer !== "undefined",
      "SW controller active:", !!controller,
      "controller URL:", controller ? controller.scriptURL : "none"
    );

    if (window.crossOriginIsolated !== false) {
      console.log(ts(), "[coi-sw PAGE] Already cross-origin isolated — nothing to do.");
      return;
    }

    if (!navigator.serviceWorker) {
      console.warn(ts(), "[coi-sw PAGE] Service workers not supported — ffmpeg.wasm may not work.");
      return;
    }

    try {
      const swURL = window.document.currentScript.src;
      console.log(ts(), "[coi-sw PAGE] Registering service worker at:", swURL);
      const reg = await navigator.serviceWorker.register(swURL);
      console.log(ts(), "[coi-sw PAGE] register() resolved.",
        "installing:", !!reg.installing,
        "waiting:", !!reg.waiting,
        "active:", !!reg.active,
        "scope:", reg.scope
      );

      const reload = () => {
        console.log(ts(), "[coi-sw PAGE] Triggering location.reload() to activate cross-origin isolation...");
        window.location.reload();
      };

      if (reg.active) {
        console.log(ts(), "[coi-sw PAGE] SW already active — reloading immediately.");
        reload();
        return;
      }

      const sw = reg.installing || reg.waiting;
      if (sw) {
        console.log(ts(), "[coi-sw PAGE] Waiting for SW state change. Current state:", sw.state);
        sw.addEventListener("statechange", () => {
          console.log(ts(), "[coi-sw PAGE] SW state changed to:", sw.state);
          if (sw.state === "activated") reload();
        });
      } else {
        console.warn(ts(), "[coi-sw PAGE] No installing/waiting SW found — unexpected state.");
      }
    } catch (err) {
      console.warn(ts(), "[coi-sw PAGE] Registration failed:", err);
    }
  })();
}
