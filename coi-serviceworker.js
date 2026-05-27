/* coi-serviceworker - Cross-Origin Isolation via Service Worker
 * Injects COOP/COEP headers so SharedArrayBuffer (required by ffmpeg.wasm)
 * is available on static hosts like GitHub Pages that don't allow custom headers.
 */

if (typeof window === "undefined") {
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
  (async () => {
    if (window.crossOriginIsolated !== false) return;

    if (!navigator.serviceWorker) return;

    try {
      const reg = await navigator.serviceWorker.register(
        window.document.currentScript.src
      );

      const reload = () => window.location.reload();

      if (reg.active) {
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
      // Service worker registration failed — ffmpeg.wasm may not work
    }
  })();
}
