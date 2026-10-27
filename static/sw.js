// Service worker: offline app shell, cached API reads, and push notifications.
const VERSION = "v2";
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
const SHELL_FILES = ["/", "/styles.css", "/app.js", "/manifest.webmanifest", "/icons/icon.svg",
                     "/icons/icon-192.png", "/icons/icon-512.png"];
const CACHED_API = ["/api/me", "/api/calendars", "/api/events"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (![SHELL, DATA].includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(request, cacheName, markCached) {
  const cache = await caches.open(cacheName);
  try {
    // Revalidate with the server so app updates show up on the next load.
    const res = await fetch(request, request.mode === "navigate" ? undefined : { cache: "no-cache" });
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: false }) ||
                (request.mode === "navigate" ? await caches.match("/") : null);
    if (!hit) throw err;
    if (!markCached) return hit;
    const headers = new Headers(hit.headers);
    headers.set("x-from-cache", "1");
    return new Response(await hit.blob(), { status: hit.status, headers });
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) {
    if (CACHED_API.some((p) => url.pathname === p)) event.respondWith(networkFirst(req, DATA, true));
    return;
  }
  if (url.pathname.startsWith("/ics/")) return;
  event.respondWith(networkFirst(req, SHELL, false));
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: event.data?.text() }; }
  const title = data.title || "Calendar";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    tag: data.tag,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    data: { url: data.url || "/" },
    renotify: !!data.tag,
    timestamp: data.start ? Date.parse(data.start) : Date.now(),
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if (new URL(client.url).origin === location.origin) {
        await client.focus();
        client.postMessage({ type: "open-event", url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
