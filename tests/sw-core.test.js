import { describe, it, expect, vi, beforeEach } from "vitest";
import { installSw } from "../src/sw/core.js";

const origin = "https://itineris.taptappers.club";
const abs = (u) => (typeof u === "string" ? new URL(u, origin).href : u.url);

// Just enough of the Cache API for the worker's code paths.
class FakeCache {
  constructor() { this.map = new Map(); }
  async addAll(urls) { for (const u of urls) { const r = await fetch(abs(u)); if (!r.ok) throw new Error(`addAll ${u}`); this.map.set(abs(u), r); } }
  async put(req, res) { this.map.set(abs(req), res); }
  async match(req) { const r = this.map.get(abs(req)); return r ? r.clone() : undefined; }
  async keys() { return [...this.map.keys()].map((url) => ({ url })); }
  async delete(req) { return this.map.delete(abs(req)); }
}
class FakeCaches {
  constructor() { this.stores = new Map(); }
  async open(n) { if (!this.stores.has(n)) this.stores.set(n, new FakeCache()); return this.stores.get(n); }
  async keys() { return [...this.stores.keys()]; }
  async delete(n) { return this.stores.delete(n); }
  async match(req, { cacheName } = {}) { for (const n of cacheName ? [cacheName] : this.stores.keys()) { const hit = await this.stores.get(n)?.match(req); if (hit) return hit; } return undefined; }
}

let caches, fetched, network, sw, handlers, pending;
const boot = (opts) => {
  handlers = {}; pending = [];
  sw = { location: { origin }, addEventListener: (t, fn) => (handlers[t] = fn), skipWaiting: vi.fn(async () => {}), clients: { claim: vi.fn(async () => {}) } };
  installSw(sw, { app: "viewer", indexUrl: "/index.html", scope: "/", dataPrefixes: ["/data/"], ...opts });
};
const fire = async (type, event = {}) => { handlers[type]({ waitUntil: (p) => pending.push(p), ...event }); await Promise.all(pending); pending = []; };
const request = async (url, extra = {}) => { let out = null; handlers.fetch({ request: { url: abs(url), method: "GET", mode: "cors", ...extra }, respondWith: (p) => (out = p) }); return out ? await out : null; };
const body = (r) => r.text();

beforeEach(() => {
  caches = new FakeCaches(); fetched = [];
  network = (url) => new Response(`net:${new URL(url).pathname}`, { status: 200 });
  vi.stubGlobal("caches", caches);
  vi.stubGlobal("fetch", vi.fn(async (req) => { const url = abs(req); fetched.push(new URL(url).pathname); return network(url); }));
});

describe("worker: install and update", () => {
  it("precaches only the light shell, never the heavy chunk", async () => {
    boot({ version: "v2", precache: ["/index.html", "/assets/index-2.js"], keep: ["/index.html", "/assets/index-2.js", "/assets/maplibre-x.js"] });
    await fire("install");
    expect(fetched).toEqual(["/index.html", "/assets/index-2.js"]);
    expect([...caches.stores.get("itineris-viewer-shell-v2").map.keys()]).toEqual([`${origin}/index.html`, `${origin}/assets/index-2.js`]);
    expect(sw.skipWaiting).toHaveBeenCalled();
  });
  it("on activate, carries the still-used chunk over from the previous version and drops the rest", async () => {
    const v1 = await caches.open("itineris-viewer-shell-v1");
    await v1.put("/index.html", new Response("old index")); await v1.put("/assets/index-1.js", new Response("old app")); await v1.put("/assets/maplibre-x.js", new Response("maplibre"));
    (await caches.open("itineris-viewer-assets")).put("/assets/stale-y.js", new Response("stale"));
    boot({ version: "v2", precache: ["/index.html", "/assets/index-2.js"], keep: ["/index.html", "/assets/index-2.js", "/assets/maplibre-x.js"] });
    await fire("install"); await fire("activate");
    expect(await caches.keys()).toEqual(["itineris-viewer-assets", "itineris-viewer-shell-v2"]);
    const assets = caches.stores.get("itineris-viewer-assets");
    expect([...assets.map.keys()]).toEqual([`${origin}/assets/maplibre-x.js`]);   // not the old index.html, not the old app
    expect(await body(await assets.match("/assets/maplibre-x.js"))).toBe("maplibre");
    expect(await body(await request("/", { mode: "navigate" }))).toBe("net:/index.html");   // the new page, never the old one
    expect(fetched).not.toContain("/assets/maplibre-x.js");     // it did not have to be downloaded again
    expect(sw.clients.claim).toHaveBeenCalled();
  });
});

describe("worker: serving", () => {
  beforeEach(async () => {
    boot({ version: "v2", precache: ["/index.html", "/assets/index-2.js"], keep: ["/index.html", "/assets/index-2.js", "/assets/maplibre-x.js"] });
    await fire("install"); await fire("activate"); fetched = [];
  });
  it("pages come from the cached shell without touching the network", async () => {
    const res = await request("/g/abc123abc123", { mode: "navigate" });
    expect(await body(res)).toBe("net:/index.html");
    expect(fetched).toEqual([]);
    const data = await request("/data/galleries/abc123abc123.json", { mode: "navigate" });   // a JSON URL typed into the bar is still the app
    expect(await body(data)).toBe("net:/index.html");
  });
  it("hashed assets missing from the shell cache are fetched once and kept in the shared asset cache", async () => {
    expect(await body(await request("/assets/maplibre-x.js"))).toBe("net:/assets/maplibre-x.js");
    expect(await body(await request("/assets/maplibre-x.js"))).toBe("net:/assets/maplibre-x.js");
    expect(fetched).toEqual(["/assets/maplibre-x.js"]);
    expect(await caches.stores.get("itineris-viewer-assets").match("/assets/maplibre-x.js")).toBeTruthy();
  });
  it("data is network first, and the last copy is served marked when the network is gone", async () => {
    expect(await body(await request("/data/home.json"))).toBe("net:/data/home.json");
    network = () => { throw new TypeError("Failed to fetch"); };
    const res = await request("/data/home.json");
    expect(await body(res)).toBe("net:/data/home.json");
    expect(res.headers.get("X-Itineris-Cache")).toBe("fallback");
    expect((await request("/data/galleries/never.json")).status).toBe(503);
  });
  it("photos and tiles are cache first; tiles share one key across Carto's hosts", async () => {
    await request("/media/p1-960.webp"); await request("/media/p1-960.webp");
    await request("https://tiles-b.basemaps.cartocdn.com/v/1/2/3.mvt"); await request("https://tiles-d.basemaps.cartocdn.com/v/1/2/3.mvt");
    expect(fetched).toEqual(["/media/p1-960.webp", "/v/1/2/3.mvt"]);
  });
  it("leaves uploads, edits and other sites alone", async () => {
    expect(await request("/admin/api/upload", { method: "POST" })).toBeNull();
    expect(await request("https://example.com/x")).toBeNull();
  });
});
