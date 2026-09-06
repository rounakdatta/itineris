import path from "node:path";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Store, token, TOKEN_RE } from "./store.js";
import { ingestPhoto, backfillMedium, MEDIUM } from "./ingest.js";
import { isLocalIso } from "./time.js";
import { isGoogleMapsUrl, resolveMapsLink } from "./links.js";
import { lookupPlace, needsLookup } from "./places.js";

const env = (k, d) => process.env[k] ?? d;
const PORT = +env("ITINERIS_PORT", 8080);
const DATA_DIR = path.resolve(env("ITINERIS_DATA_DIR", ".data"));
const SEED_DIR = path.resolve(env("ITINERIS_SEED_DIR", "seed"));
const UI_DIR = path.resolve(env("ITINERIS_ADMIN_UI_DIR", "dist-admin"));
// Optional second gate behind tinyauth's own whitelist. Empty = trust tinyauth.
const ALLOWED = env("ITINERIS_ADMIN_EMAILS", "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const MAX_UPLOAD = 200 * 1024 * 1024;
// Google Places lookups (ratings on the map). A dedicated server key when the
// browser key is referrer-restricted; else the same key. Empty = no lookups.
const PLACES_KEY = env("ITINERIS_GOOGLE_PLACES_KEY", "") || env("ITINERIS_GOOGLE_MAPS_KEY", "");
const placesStatus = { configured: !!PLACES_KEY, lastError: null, lastRunAt: null, lookedUp: 0 };

const store = new Store(DATA_DIR);
const app = new Hono();

// Probe target: kubelet reaches the pod directly, so this must not need identity.
app.get("/admin/healthz", (c) => c.text("ok\n"));

// Identity comes from tinyauth via Traefik's forward-auth response headers. The
// only legitimate way to reach this process is through that gated router, so a
// request WITHOUT the header did not come through the proxy -- refuse it.
app.use("/admin/*", async (c, next) => {
  const email = (c.req.header("remote-email") ?? "").trim().toLowerCase();
  if (!email) return c.text("unauthenticated: no identity from the auth proxy\n", 401);
  if (ALLOWED.length && !ALLOWED.includes(email)) return c.text("forbidden\n", 403);
  c.set("email", email);
  await next();
});

const STR = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : null);
const NUM_OR_NULL = (v) => (v === null || v === "" ? null : Number.isFinite(+v) ? +v : undefined);
const IDS = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string"))] : null);
// A Google Maps link for the exact place, or null to clear; undefined = invalid.
const LINK = (v) => (v === null || v === "" ? null : typeof v === "string" && v.trim().length <= 600 && isGoogleMapsUrl(v.trim()) ? v.trim() : undefined);
const cleanTags = (arr) => [...new Set(arr.map((t) => STR(t, 40)).filter(Boolean).map((t) => t.toLowerCase()))];
const withGalleries = (moments, galleries) => {
  const idx = new Map();
  for (const g of galleries) for (const id of g.momentIds ?? []) (idx.get(id) ?? idx.set(id, []).get(id)).push(g.id);
  return moments.map((m) => ({ ...m, galleries: idx.get(m.id) ?? [] }));
};
const galleryView = (g) => ({ ...g, count: (g.momentIds ?? []).length, trackCount: (g.trackIds ?? []).length });

// ---- read ----------------------------------------------------------------
app.get("/admin/api/me", (c) => c.json({ email: c.get("email"), places: placesStatus }));
app.get("/admin/api/library", async (c) => {
  const [moments, tracks, galleries] = await Promise.all([store.moments(), store.tracks(), store.galleries()]);
  return c.json({ moments: withGalleries(moments, galleries), tracks, galleries: galleries.map(galleryView) });
});
app.get("/admin/api/moments", async (c) => c.json(withGalleries(await store.moments(), await store.galleries())));
app.get("/admin/api/tracks", async (c) => c.json(await store.tracks()));
app.get("/admin/api/galleries", async (c) => c.json((await store.galleries()).map(galleryView)));

// ---- moments -------------------------------------------------------------
function momentPatch(patch, email) {
  const upd = {};
  if ("caption" in patch) upd.caption = STR(patch.caption, 2000) ?? "";
  if ("place" in patch) upd.place = STR(patch.place, 200) ?? "";
  if ("tags" in patch) {
    if (!Array.isArray(patch.tags)) return { error: "tags must be an array" };
    upd.tags = cleanTags(patch.tags);
  }
  if ("lat" in patch || "lng" in patch) {
    const lat = NUM_OR_NULL(patch.lat), lng = NUM_OR_NULL(patch.lng);
    if (lat === undefined || lng === undefined) return { error: "lat/lng must be numbers or null" };
    if ((lat === null) !== (lng === null)) return { error: "lat and lng go together" };
    if (lat !== null && (Math.abs(lat) > 90 || Math.abs(lng) > 180)) return { error: "coordinates out of range" };
    upd.lat = lat; upd.lng = lng;
  }
  if ("t" in patch) {
    if (!isLocalIso(patch.t)) return { error: "t must be ISO-8601 with an explicit offset, e.g. 2026-03-14T08:40:00+08:00" };
    upd.t = patch.t; upd.tz = "manual";
  }
  if ("mapsUrl" in patch) {
    const link = LINK(patch.mapsUrl);
    if (link === undefined) return { error: "mapsUrl must be a Google Maps link" };
    upd.mapsUrl = link;
  }
  return { upd: { ...upd, editedBy: email, editedAt: new Date().toISOString() } };
}

app.post("/admin/api/upload", bodyLimit({ maxSize: MAX_UPLOAD }), async (c) => {
  const body = await c.req.parseBody({ all: true });
  const files = [].concat(body.files ?? body.file ?? []).filter((f) => typeof f === "object" && typeof f.arrayBuffer === "function");
  if (files.length === 0) return c.json({ error: "no files" }, 400);
  // Optional annotations decided while the photo was still in the phone's
  // queue: caption, place, tags, galleries, and lat/lng or t only if the user
  // set them. Validated exactly like a PATCH, applied at creation.
  let meta = {};
  if (typeof body.meta === "string" && body.meta.trim()) {
    try { meta = JSON.parse(body.meta); } catch { return c.json({ error: "meta must be JSON" }, 400); }
  }
  const { upd = {}, error: metaError } = momentPatch(meta, c.get("email"));
  if (metaError) return c.json({ error: `meta: ${metaError}` }, 400);
  delete upd.editedBy; delete upd.editedAt;
  const wanted = new Set([
    ...(typeof body.gallery === "string" && TOKEN_RE.test(body.gallery) ? [body.gallery] : []),
    ...(Array.isArray(meta.galleries) ? meta.galleries.filter((g) => typeof g === "string" && TOKEN_RE.test(g)) : []),
  ]);

  const created = [], duplicates = [], errors = [];
  for (const f of files) {
    try {
      const r = await ingestPhoto(Buffer.from(await f.arrayBuffer()), f.name, { dataDir: DATA_DIR, email: c.get("email") });
      if (r.duplicate) duplicates.push({ id: r.id, filename: f.name });
      else created.push({ ...r.moment, ...upd, tz: upd.t ? "manual" : r.moment.tz });
    } catch (e) {
      errors.push({ filename: f.name, error: e.message });
    }
  }
  if (created.length) {
    await store.updateMoments((list) => {
      const have = new Set(list.map((m) => m.id));
      return [...list, ...created.filter((m) => !have.has(m.id))];
    });
  }
  const touched = [...created.map((m) => m.id), ...duplicates.map((d) => d.id)];
  if (created.length) { const ids = new Set(created.map((m) => m.id)); enrichPlaces((m) => ids.has(m.id)); }
  if (wanted.size && touched.length) {
    await store.updateGalleries((gs) => gs.map((g) => (wanted.has(g.id) ? { ...g, momentIds: [...new Set([...(g.momentIds ?? []), ...touched])], updatedAt: new Date().toISOString() } : g)));
  }
  return c.json({ created, duplicates, errors }, errors.length && !created.length ? 422 : 200);
});

// One lookup queue: a new place is looked up right after it is saved, the
// rest (backfill, monthly refresh) trickles behind it. Never throws.
let placesQueue = Promise.resolve();
function enrichPlaces(filter = () => true) {
  if (!PLACES_KEY) return Promise.resolve(0);
  const run = placesQueue.then(async () => {
    const todo = (await store.moments()).filter((m) => filter(m) && needsLookup(m));
    let n = 0;
    for (const m of todo) {
      let g;
      try {
        g = (await lookupPlace({ name: m.place, lat: m.lat, lng: m.lng }, { key: PLACES_KEY })) ?? { placeId: null, fetchedAt: new Date().toISOString() };
        placesStatus.lastError = null;
      } catch (e) {
        placesStatus.lastError = e.message; console.error(`places ${m.id} (${m.place}): ${e.message}`);
        if (e.status === 400 || e.status === 403 || e.status === 429) break;   // key/API/quota trouble: the rest would fail the same way
        continue;
      }
      await store.updateMoments((ms) => ms.map((x) => (x.id === m.id ? { ...x, google: g } : x)));
      n++; placesStatus.lookedUp++;
      await new Promise((r) => setTimeout(r, 150));
    }
    placesStatus.lastRunAt = new Date().toISOString();
    return n;
  });
  placesQueue = run.catch(() => {});
  return run;
}
// A changed name or spot invalidates what Google said about the old one.
const forgetGoogle = (m, upd) => ("place" in upd || "lat" in upd || "lng" in upd ? (({ google, ...rest }) => rest)(m) : m);

app.patch("/admin/api/moments/:id", async (c) => {
  const id = c.req.param("id");
  let patch; try { patch = await c.req.json(); } catch { return c.json({ error: "invalid json" }, 400); }
  const { upd, error } = momentPatch(patch, c.get("email"));
  if (error) return c.json({ error }, 400);
  let result = null;
  await store.updateMoments((list) => list.map((m) => (m.id === id ? (result = { ...forgetGoogle(m, upd), ...upd }) : m)));
  if (!result) return c.json({ error: "not found" }, 404);
  enrichPlaces((m) => m.id === id);
  const galleries = await store.galleries();
  return c.json(withGalleries([result], galleries)[0]);
});

// Ask Google again about this one place, now.
app.post("/admin/api/moments/:id/google", async (c) => {
  const id = c.req.param("id");
  if (!PLACES_KEY) return c.json({ error: "no Google Places key configured on the server" }, 409);
  let found = false;
  await store.updateMoments((list) => list.map((m) => (m.id === id ? (found = true, (({ google, ...rest }) => rest)(m)) : m)));
  if (!found) return c.json({ error: "not found" }, 404);
  await enrichPlaces((m) => m.id === id);
  const m = (await store.moments()).find((x) => x.id === id);
  return c.json({ ...withGalleries([m], await store.galleries())[0], placesError: placesStatus.lastError });
});

// Bulk: tag a whole selection, set a place, in one atomic write.
app.patch("/admin/api/moments", async (c) => {
  let body; try { body = await c.req.json(); } catch { return c.json({ error: "invalid json" }, 400); }
  const ids = IDS(body.ids);
  if (!ids?.length) return c.json({ error: "ids required" }, 400);
  const add = Array.isArray(body.addTags) ? cleanTags(body.addTags) : [];
  const remove = Array.isArray(body.removeTags) ? cleanTags(body.removeTags) : [];
  const place = "place" in body ? (STR(body.place, 200) ?? "") : undefined;
  // One location for the whole selection: how photos a phone stripped GPS from get placed.
  let loc;
  if ("lat" in body || "lng" in body) {
    const lat = NUM_OR_NULL(body.lat), lng = NUM_OR_NULL(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return c.json({ error: "lat and lng must both be numbers" }, 400);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return c.json({ error: "coordinates out of range" }, 400);
    loc = { lat, lng };
  }
  // The exact Google Maps link, when the spot came from one. A new spot without
  // a link drops any old link: it would point at the previous place.
  let link;
  if ("mapsUrl" in body) { link = LINK(body.mapsUrl); if (link === undefined) return c.json({ error: "mapsUrl must be a Google Maps link" }, 400); }
  if (loc && link === undefined) link = null;
  const set = new Set(ids); let n = 0;
  await store.updateMoments((list) => list.map((m) => {
    if (!set.has(m.id)) return m;
    n++;
    const tags = [...new Set([...(m.tags ?? []).filter((t) => !remove.includes(t)), ...add])];
    const base = place !== undefined || loc ? (({ google, ...rest }) => rest)(m) : m;
    return { ...base, tags, ...(place !== undefined ? { place } : {}), ...(loc ?? {}), ...(link !== undefined ? { mapsUrl: link } : {}), editedBy: c.get("email"), editedAt: new Date().toISOString() };
  }));
  if (place !== undefined || loc) enrichPlaces((m) => set.has(m.id));
  return c.json({ updated: n });
});

// A shared Google Maps link -> place name, coordinates, exact link. Short
// links need a redirect followed, which a browser cannot do cross-origin.
app.get("/admin/api/resolve-link", async (c) => {
  try { return c.json(await resolveMapsLink(c.req.query("url") ?? "")); }
  catch (e) { return c.json({ error: e.message }, e.status ?? 500); }
});

// Removes the moment, its public derivatives and its gallery memberships. The
// ORIGINAL is deliberately kept: deleting from the journal must never destroy
// the only copy of a photo.
app.delete("/admin/api/moments/:id", async (c) => {
  const id = c.req.param("id");
  let gone = null;
  await store.updateMoments((list) => list.filter((m) => (m.id === id ? ((gone = m), false) : true)));
  if (!gone) return c.json({ error: "not found" }, 404);
  await store.updateGalleries((gs) => gs.map((g) => ((g.momentIds ?? []).includes(id) ? { ...g, momentIds: g.momentIds.filter((x) => x !== id), updatedAt: new Date().toISOString() } : g)));
  await store.removeFiles([gone.media?.src, gone.media?.medium, gone.media?.thumb].filter((p) => p && p.startsWith("media/")));
  return c.json({ deleted: id, originalKept: gone.media?.original ?? null });
});

// ---- galleries -----------------------------------------------------------
app.post("/admin/api/galleries", async (c) => {
  let body; try { body = await c.req.json(); } catch { return c.json({ error: "invalid json" }, 400); }
  const title = STR(body.title, 120);
  if (!title) return c.json({ error: "title required" }, 400);
  const now = new Date().toISOString();
  const known = new Set((await store.moments()).map((m) => m.id));
  const g = {
    id: token(), title, description: STR(body.description, 1000) ?? "", home: false,
    momentIds: (IDS(body.momentIds) ?? []).filter((id) => known.has(id)), trackIds: IDS(body.trackIds) ?? [],
    createdAt: now, updatedAt: now, createdBy: c.get("email"),
  };
  await store.updateGalleries((gs) => {
    if (body.home === true) gs = gs.map((x) => ({ ...x, home: false }));
    return [...gs, { ...g, home: body.home === true }];
  });
  return c.json(galleryView({ ...g, home: body.home === true }), 201);
});

app.patch("/admin/api/galleries/:id", async (c) => {
  const id = c.req.param("id");
  if (!TOKEN_RE.test(id)) return c.json({ error: "bad id" }, 400);
  let body; try { body = await c.req.json(); } catch { return c.json({ error: "invalid json" }, 400); }
  const [known, knownTracks] = [new Set((await store.moments()).map((m) => m.id)), new Set((await store.tracks()).map((t) => t.id))];
  let result = null, bad = null;
  await store.updateGalleries((gs) => {
    if (!gs.some((g) => g.id === id)) return gs;
    if (body.home === true) gs = gs.map((g) => ({ ...g, home: g.id === id }));
    return gs.map((g) => {
      if (g.id !== id) return g;
      const n = { ...g };
      if ("title" in body) { const t = STR(body.title, 120); if (!t) { bad = "title required"; return g; } n.title = t; }
      if ("description" in body) n.description = STR(body.description, 1000) ?? "";
      if (body.home === false) n.home = false;
      let ms = new Set(n.momentIds ?? []), ts = new Set(n.trackIds ?? []);
      if (IDS(body.momentIds)) ms = new Set(IDS(body.momentIds));
      for (const x of IDS(body.add) ?? []) ms.add(x);
      for (const x of IDS(body.remove) ?? []) ms.delete(x);
      if (IDS(body.trackIds)) ts = new Set(IDS(body.trackIds));
      for (const x of IDS(body.addTracks) ?? []) ts.add(x);
      for (const x of IDS(body.removeTracks) ?? []) ts.delete(x);
      n.momentIds = [...ms].filter((x) => known.has(x));
      n.trackIds = [...ts].filter((x) => knownTracks.has(x));
      n.updatedAt = new Date().toISOString();
      return (result = n);
    });
  });
  if (bad) return c.json({ error: bad }, 400);
  return result ? c.json(galleryView(result)) : c.json({ error: "not found" }, 404);
});

app.delete("/admin/api/galleries/:id", async (c) => {
  const id = c.req.param("id");
  let found = false;
  await store.updateGalleries((gs) => gs.filter((g) => (g.id === id ? ((found = true), false) : true)));
  return found ? c.json({ deleted: id }) : c.json({ error: "not found" }, 404);
});

// ---- UI ------------------------------------------------------------------
// In production Traefik only routes /admin to this process; the public site is
// nginx. Locally this also serves the public data and media so both UIs work.
app.get("/admin", (c) => c.redirect("/admin/"));
// The worker script itself must be revalidated on every check or updates lag.
app.use("/admin/sw.js", async (c, next) => { await next(); c.res.headers.set("Cache-Control", "no-cache"); });
app.use("/admin/manifest.webmanifest", async (c, next) => { await next(); c.res.headers.set("Content-Type", "application/manifest+json"); c.res.headers.set("Cache-Control", "no-cache"); });
app.use("/admin/*", serveStatic({ root: UI_DIR, rewriteRequestPath: (p) => p.replace(/^\/admin/, "") || "/" }));
app.get("/admin/*", async (c) => c.html(await readFile(path.join(UI_DIR, "index.html"), "utf8")));
app.use("/media/*", serveStatic({ root: DATA_DIR }));
app.use("/data/*", serveStatic({ root: DATA_DIR }));

const how = await store.init(SEED_DIR);
serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, () => {
  console.log(`itineris admin on :${PORT}  data=${DATA_DIR} (${how})  ui=${UI_DIR}  allowlist=${ALLOWED.length ? ALLOWED.join(",") : "(tinyauth only)"}`);
});
// Photos uploaded before the phone-sized tier existed get one now, in the background.
backfillMedium(store, DATA_DIR)
  .then((n) => { if (n) console.log(`backfilled ${MEDIUM}px copies for ${n} photo${n === 1 ? "" : "s"}`); })
  .catch((e) => console.error("backfill failed:", e))
  // Then what Google knows about every named place: new ones now, stale ones monthly.
  .then(() => enrichPlaces())
  .then((n) => { if (n) console.log(`looked up ${n} place${n === 1 ? "" : "s"} on Google`); });
if (PLACES_KEY) setInterval(() => enrichPlaces().catch(() => {}), 6 * 3600e3).unref();
