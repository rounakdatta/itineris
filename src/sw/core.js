// One service worker, two apps. Strategies:
//   navigation  the cached shell, instantly (works offline and on a 1 KB/s link);
//               new versions arrive through the worker's own update cycle and
//               the page offers a reload
//   shell       hashed assets: the version's own cache first, then the shared
//               asset cache, then the network (stored for next time)
//   data        network first (12s), else the last copy, marked X-Itineris-Cache
//   media       cache first (content-hashed, immutable)
//   tiles       cache first under a normalized key (Carto round-robins hosts)
// Non-GET requests are never touched: uploads and edits speak to the server or
// fail visibly, and the admin's queue handles the failing.
//
// Installing precaches only the small shell; heavy vendor chunks live in a
// shared asset cache and are carried over from the previous version on
// activate, so an update never has to re-download a megabyte to take over.
import { classify, normalizeTileKey } from "./strategies.js";

export function installSw(sw, { app, version, precache, keep = precache, indexUrl, scope, dataPrefixes = [], apiPaths = [] }) {
  const SHELL = `itineris-${app}-shell-${version}`;
  const ASSETS = `itineris-${app}-assets`;
  const DATA = `itineris-${app}-data`;
  const MEDIA = "itineris-media";
  const TILES = "itineris-tiles";
  const origin = sw.location.origin;
  const keepUrls = new Set(keep.map((p) => new URL(p, origin).href));
  const precached = new Set(precache.map((p) => new URL(p, origin).href));
  // What an older version may hand down: kept, and not something this version
  // just fetched fresh itself (its index.html, above all, must never be stale).
  const inherit = (url) => keepUrls.has(url) && !precached.has(url);

  sw.addEventListener("install", (e) => {
    e.waitUntil(caches.open(SHELL).then((c) => c.addAll(precache)).then(() => sw.skipWaiting()));
  });

  sw.addEventListener("activate", (e) => {
    e.waitUntil((async () => {
      const assets = await caches.open(ASSETS);
      for (const k of await caches.keys()) {
        if (!k.startsWith(`itineris-${app}-shell-`) || k === SHELL) continue;
        // Carry over what this version still uses (the MapLibre chunk, typically).
        const old = await caches.open(k);
        for (const req of await old.keys()) {
          if (inherit(req.url) && !(await assets.match(req))) {
            const res = await old.match(req);
            if (res) await assets.put(req, res);
          }
        }
        await caches.delete(k);
      }
      for (const req of await assets.keys()) if (!inherit(req.url)) await assets.delete(req);
      await sw.clients.claim();
    })());
  });

  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
  const marked = (res) => { const h = new Headers(res.headers); h.set("X-Itineris-Cache", "fallback"); return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h }); };
  const offline = () => new Response("", { status: 503, statusText: "offline" });

  async function navigation(req) {
    const cached = await caches.match(indexUrl, { cacheName: SHELL });
    if (cached) return cached;
    try { return await fetch(req); } catch { return new Response("offline", { status: 503 }); }
  }
  async function shellAsset(req) {
    const hit = (await caches.match(req, { cacheName: SHELL })) ?? (await caches.match(req, { cacheName: ASSETS }));
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(ASSETS)).put(req, res.clone());
      return res;
    } catch { return offline(); }
  }
  async function networkFirst(req, cacheName, ms) {
    const c = await caches.open(cacheName);
    try {
      const res = await withTimeout(fetch(req), ms);
      if (res.ok) c.put(req, res.clone());
      return res;
    } catch {
      const hit = await c.match(req);
      return hit ? marked(hit) : offline();
    }
  }
  async function cacheFirst(req, cacheName, key = req) {
    const c = await caches.open(cacheName);
    const hit = await c.match(key);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) c.put(key, res.clone());
      return res;
    } catch { return offline(); }
  }

  sw.addEventListener("fetch", (e) => {
    const req = e.request;
    if (req.method !== "GET") return;
    const kind = classify(req.url, { origin, scope, dataPrefixes, apiPaths });
    if (req.mode === "navigate") { if (kind === "navigation" || kind === "data") e.respondWith(navigation(req)); return; }
    if (kind === "shell") e.respondWith(shellAsset(req));
    else if (kind === "data") e.respondWith(networkFirst(req, DATA, 12000));
    else if (kind === "media") e.respondWith(cacheFirst(req, MEDIA));
    else if (kind === "tiles") e.respondWith(cacheFirst(req, TILES, normalizeTileKey(req.url)));
  });
}
