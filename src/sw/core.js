// One service worker, two apps. Strategies:
//   navigation  network first (4s), else the precached shell -- the app then
//               loads its data through the rules below
//   shell       precached hashed assets, cache first
//   data        network first (5s), else the last copy, marked X-Itineris-Cache
//   media       cache first (content-hashed, immutable)
//   tiles       cache first under a normalized key (Carto round-robins hosts)
// Non-GET requests are never touched: uploads and edits speak to the server or
// fail visibly, and the admin's queue handles the failing.
import { classify, normalizeTileKey } from "./strategies.js";

export function installSw(sw, { app, version, precache, indexUrl, scope, dataPrefixes = [], apiPaths = [] }) {
  const SHELL = `itineris-${app}-shell-${version}`;
  const DATA = `itineris-${app}-data`;
  const MEDIA = "itineris-media";
  const TILES = "itineris-tiles";
  const origin = sw.location.origin;

  sw.addEventListener("install", (e) => {
    e.waitUntil(caches.open(SHELL).then((c) => c.addAll(precache)).then(() => sw.skipWaiting()));
  });
  sw.addEventListener("activate", (e) => {
    e.waitUntil((async () => {
      for (const k of await caches.keys()) if (k.startsWith(`itineris-${app}-shell-`) && k !== SHELL) await caches.delete(k);
      await sw.clients.claim();
    })());
  });

  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
  const marked = (res) => { const h = new Headers(res.headers); h.set("X-Itineris-Cache", "fallback"); return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h }); };

  async function networkFirst(req, cacheName, ms) {
    const c = await caches.open(cacheName);
    try {
      const res = await withTimeout(fetch(req), ms);
      if (res.ok) c.put(req, res.clone());
      return res;
    } catch {
      const hit = await c.match(req);
      if (hit) return marked(hit);
      return new Response("", { status: 503, statusText: "offline" });
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
    } catch {
      return new Response("", { status: 503, statusText: "offline" });
    }
  }
  async function navigation(req) {
    try { return await withTimeout(fetch(req), 4000); }
    catch { return (await caches.match(indexUrl)) ?? new Response("offline", { status: 503 }); }
  }

  sw.addEventListener("fetch", (e) => {
    const req = e.request;
    if (req.method !== "GET") return;
    const kind = classify(req.url, { origin, scope, dataPrefixes, apiPaths });
    if (req.mode === "navigate") { if (kind === "navigation" || kind === "data") e.respondWith(navigation(req)); return; }
    if (kind === "shell") e.respondWith(cacheFirst(req, SHELL));
    else if (kind === "data") e.respondWith(networkFirst(req, DATA, 5000));
    else if (kind === "media") e.respondWith(cacheFirst(req, MEDIA));
    else if (kind === "tiles") e.respondWith(cacheFirst(req, TILES, normalizeTileKey(req.url)));
  });
}
