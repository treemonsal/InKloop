const CACHE = "inkloop-shell-dev";
const PRECACHE = [];
const ROOT = new URL("./", self.location.href).href;
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll([
          ROOT,
          ...PRECACHE.map((path) => new URL(path, ROOT).href),
        ]),
      ),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("inkloop-shell-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.includes("/auth/") ||
    url.pathname.includes("/api/")
  )
    return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (
            response.ok &&
            !response.redirected &&
            response.headers.get("content-type")?.includes("text/html")
          ) {
            const clone = response.clone();
            event.waitUntil(
              caches.open(CACHE).then((cache) => cache.put(ROOT, clone)),
            );
          }
          return response;
        })
        .catch(() => caches.match(ROOT).then((hit) => hit || Response.error())),
    );
    return;
  }
  if (!/\.(?:js|css|png|svg|webmanifest|woff2?)$/.test(url.pathname)) return;
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok && !response.redirected) {
            const clone = response.clone();
            event.waitUntil(
              caches.open(CACHE).then((cache) => cache.put(request, clone)),
            );
          }
          return response;
        }),
    ),
  );
});
