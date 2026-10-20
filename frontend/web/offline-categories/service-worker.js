/* Replaced by the build: these are public assets only, never session/API responses. */
const ASSETS = __ASSETS__;
const CACHE = __CACHE__;
const PREFIX = "lumiere-category-shell-";
const SHELL = "/offline/categories/index.html";
const allowed = new Set(
  ASSETS.map((path) => new URL(path, self.location.origin).href),
);
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        await cache.addAll(
          ASSETS.map(
            (path) =>
              new Request(path, {
                credentials: "omit",
                cache: "reload",
                redirect: "error",
              }),
          ),
        );
      } catch (error) {
        await caches.delete(CACHE);
        throw error;
      }
    })(),
  );
});
// Default waiting lifecycle keeps the old shell and worker/WASM generation together.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all(
        (await caches.keys())
          .filter((key) => key.startsWith(PREFIX) && key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const navigation =
    request.mode === "navigate" &&
    ["/offline/categories/", "/offline/categories/index.html"].includes(
      url.pathname,
    );
  if (!navigation && !allowed.has(url.href)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(navigation ? SHELL : request.url);
      return cached ?? fetch(request);
    })(),
  );
});
