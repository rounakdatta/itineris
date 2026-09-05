import path from "node:path";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Store } from "./store.js";
import { ingestPhoto } from "./ingest.js";
import { isLocalIso } from "./time.js";

const env = (k, d) => process.env[k] ?? d;
const PORT = +env("ITINERIS_PORT", 8080);
const DATA_DIR = path.resolve(env("ITINERIS_DATA_DIR", ".data"));
const SEED_DIR = path.resolve(env("ITINERIS_SEED_DIR", "public"));
const UI_DIR = path.resolve(env("ITINERIS_ADMIN_UI_DIR", "dist-admin"));
// Optional second gate behind tinyauth's own whitelist. Empty = trust tinyauth.
const ALLOWED = env("ITINERIS_ADMIN_EMAILS", "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const MAX_UPLOAD = 200 * 1024 * 1024;

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

app.get("/admin/api/me", (c) => c.json({ email: c.get("email") }));
app.get("/admin/api/moments", async (c) => c.json(await store.moments()));

app.post("/admin/api/upload", bodyLimit({ maxSize: MAX_UPLOAD }), async (c) => {
  const body = await c.req.parseBody({ all: true });
  const files = [].concat(body.files ?? body.file ?? []).filter((f) => typeof f === "object" && typeof f.arrayBuffer === "function");
  if (files.length === 0) return c.json({ error: "no files" }, 400);

  const created = [], duplicates = [], errors = [];
  for (const f of files) {
    try {
      const r = await ingestPhoto(Buffer.from(await f.arrayBuffer()), f.name, { dataDir: DATA_DIR, email: c.get("email") });
      if (r.duplicate) duplicates.push({ id: r.id, filename: f.name });
      else created.push(r.moment);
    } catch (e) {
      errors.push({ filename: f.name, error: e.message });
    }
  }
  if (created.length) {
    await store.update((list) => {
      const have = new Set(list.map((m) => m.id));
      return [...list, ...created.filter((m) => !have.has(m.id))];
    });
  }
  return c.json({ created, duplicates, errors }, errors.length && !created.length ? 422 : 200);
});

const STR = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : null);
const NUM_OR_NULL = (v) => (v === null || v === "" ? null : Number.isFinite(+v) ? +v : undefined);

app.patch("/admin/api/moments/:id", async (c) => {
  const id = c.req.param("id");
  let patch;
  try { patch = await c.req.json(); } catch { return c.json({ error: "invalid json" }, 400); }
  const upd = {};
  if ("caption" in patch) upd.caption = STR(patch.caption, 2000) ?? "";
  if ("place" in patch) upd.place = STR(patch.place, 200) ?? "";
  if ("tags" in patch) {
    if (!Array.isArray(patch.tags)) return c.json({ error: "tags must be an array" }, 400);
    upd.tags = [...new Set(patch.tags.map((t) => STR(t, 40)).filter(Boolean).map((t) => t.toLowerCase()))];
  }
  if ("lat" in patch || "lng" in patch) {
    const lat = NUM_OR_NULL(patch.lat), lng = NUM_OR_NULL(patch.lng);
    if (lat === undefined || lng === undefined) return c.json({ error: "lat/lng must be numbers or null" }, 400);
    if ((lat === null) !== (lng === null)) return c.json({ error: "lat and lng go together" }, 400);
    if (lat !== null && (Math.abs(lat) > 90 || Math.abs(lng) > 180)) return c.json({ error: "coordinates out of range" }, 400);
    upd.lat = lat; upd.lng = lng;
  }
  if ("t" in patch) {
    if (!isLocalIso(patch.t)) return c.json({ error: "t must be ISO-8601 with an explicit offset, e.g. 2026-03-14T08:40:00+08:00" }, 400);
    upd.t = patch.t; upd.tz = "manual";
  }
  let result = null;
  await store.update((list) => list.map((m) => (m.id === id ? (result = { ...m, ...upd, editedBy: c.get("email"), editedAt: new Date().toISOString() }) : m)));
  return result ? c.json(result) : c.json({ error: "not found" }, 404);
});

// Removes the moment and its public derivatives. The ORIGINAL is deliberately
// kept: deleting from the journal must never destroy the only copy of a photo.
app.delete("/admin/api/moments/:id", async (c) => {
  const id = c.req.param("id");
  let gone = null;
  await store.update((list) => list.filter((m) => (m.id === id ? ((gone = m), false) : true)));
  if (!gone) return c.json({ error: "not found" }, 404);
  await store.removeFiles([gone.media?.src, gone.media?.thumb].filter((p) => p && p.startsWith("media/")));
  return c.json({ deleted: id, originalKept: gone.media?.original ?? null });
});

// The admin UI. In production Traefik only routes /admin to this process; the
// public site is nginx. Locally this also serves media so thumbnails render.
app.get("/admin", (c) => c.redirect("/admin/"));
app.use("/admin/*", serveStatic({ root: UI_DIR, rewriteRequestPath: (p) => p.replace(/^\/admin/, "") || "/" }));
app.get("/admin/*", async (c) => c.html(await readFile(path.join(UI_DIR, "index.html"), "utf8")));
app.use("/media/*", serveStatic({ root: DATA_DIR }));
app.use("/data/*", serveStatic({ root: DATA_DIR }));

const seeded = await store.init(SEED_DIR);
serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, () => {
  console.log(`itineris admin on :${PORT}  data=${DATA_DIR} (${seeded})  ui=${UI_DIR}  allowlist=${ALLOWED.length ? ALLOWED.join(",") : "(tinyauth only)"}`);
});
