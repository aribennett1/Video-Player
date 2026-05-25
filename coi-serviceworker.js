/* coi-serviceworker - Cross-Origin Isolation via Service Worker
 * Injects COOP/COEP headers so SharedArrayBuffer (required by ffmpeg.wasm)
 * is available on static hosts like GitHub Pages that don't allow custom headers.
 * Based on https://github.com/nicolo-ribaudo/tc39-proposal-shadowrealm-api/tree/main/coi-serviceworker
 */

if (typeof window === "undefined") {
  // ---- Running as a Service Worker ----
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) =>
    event.waitUntil(self.clients.claim())
  );

  async function handleFetch(request) {
    const r = await fetch(request);
    if (r.status === 0) return r;

    const headers = new Headers(r.headers);
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");

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
    if (window.crossOriginIsolated !== false) return; // already isolated, nothing to do

    if (!navigator.serviceWorker) {
      console.warn("[coi-serviceworker] Service workers not supported — ffmpeg.wasm may not work.");
      return;
    }

    try {
      const reg = await navigator.serviceWorker.register(
        window.document.currentScript.src
      );

      const reload = () => window.location.reload();

      if (reg.active) {
        // Service worker already active — just reload to pick up headers
        reload();
        return;
      }

      const sw = reg.installing || reg.waiting;
      if (sw) {
        sw.addEventListener("statechange", () => {
          if (sw.state === "activated") reload();
        });
      }
    } catch (err) {
      console.warn("[coi-serviceworker] Registration failed:", err);
    }
  })();
}
