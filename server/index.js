import path from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Store, token, TOKEN_RE } from "./store.js";
import { ingestMedia, backfillMedium, MEDIUM } from "./ingest.js";
import { isLocalIso } from "./time.js";
import { isGoogleMapsUrl, resolveMapsLink } from "./links.js";
import { lookupPlace, needsLookup, searchPlaces, fetchPlaceDetails, isStale, isPlaceId } from "./places.js";
import { validateStyle, validateCaptions, captionsOf, normalizeStyle, styleOf, MAX_CAPTION_TEXT } from "./caption.js";
import { slugProblem, cleanSlug } from "./slug.js";
import { clientIp, makeLimiter } from "./views.js";
import {
  SESSION_COOKIE, SESSION_DAYS, uidFor, normalizeEmail, signSession, readSession, newSession,
  randomState, authorizeUrl, exchangeCode, readIdToken, allowedBy, redirectUriFor, safeNext,
} from "./auth.js";

const env = (k, d) => process.env[k] ?? d;
const PORT = +env("ITINERIS_PORT", 8080);
const DATA_DIR = path.resolve(env("ITINERIS_DATA_DIR", ".data"));
const SEED_DIR = path.resolve(env("ITINERIS_SEED_DIR", "seed"));
const UI_DIR = path.resolve(env("ITINERIS_CREATOR_UI_DIR", env("ITINERIS_ADMIN_UI_DIR", "dist-admin")));
const MAX_UPLOAD = 200 * 1024 * 1024;

// The creator app lives here. It was /admin behind tinyauth; it is /creator and
// signs people in itself, because anyone can now make their own journal.
const BASE = "/creator";

// --- who may come in ---------------------------------------------------------
// Google's authorization-code flow when a client is configured; otherwise the
// forward-auth header a trusted proxy sets. Never both: a deployment that has
// Google must not also believe a header anybody on the network can write.
const CLIENT_ID = env("ITINERIS_GOOGLE_CLIENT_ID", "").trim();
const CLIENT_SECRET = env("ITINERIS_GOOGLE_CLIENT_SECRET", "").trim();
const GOOGLE = !!(CLIENT_ID && CLIENT_SECRET);
const PUBLIC_URL = env("ITINERIS_PUBLIC_URL", "").trim();
// Test seam, exactly like ITINERIS_PLACES_ENDPOINT: the harness stands a fake
// Google up on localhost so the whole sign-in can be driven for real.
const TOKEN_ENDPOINT = env("ITINERIS_GOOGLE_TOKEN_ENDPOINT", "") || undefined;
// Sessions outlive a restart, so the key must too: derived from the client
// secret when none is given, rather than a fresh random that signs everyone out.
const SESSION_SECRET = env("ITINERIS_SESSION_SECRET", "").trim()
  || (GOOGLE ? createHash("sha256").update(`itineris:session:${CLIENT_SECRET}`).digest("hex") : "dev-only-not-a-secret");
// An optional guest list. Empty is the point of the product: anyone with a
// Google account can make their own.
const isAllowed = allowedBy(env("ITINERIS_CREATOR_EMAILS", env("ITINERIS_ADMIN_EMAILS", "")));
// Google Places lookups (ratings on the map). A dedicated server key when the
// browser key is referrer-restricted; else the same key. Empty = no lookups.
const PLACES_KEY = env("ITINERIS_GOOGLE_PLACES_KEY", "") || env("ITINERIS_GOOGLE_MAPS_KEY", "");
const placesStatus = { configured: !!PLACES_KEY, lastError: null, lastRunAt: null, lookedUp: 0 };

const store = new Store(DATA_DIR);
const app = new Hono();

// Probe target: kubelet reaches the pod directly, so this must not need identity.
app.get(`${BASE}/healthz`, (c) => c.text("ok\n"));
app.get("/admin/healthz", (c) => c.text("ok\n"));   // the old probe path, while charts catch up

const https = (c) => (c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "")) === "https";
const cookieOpts = (c) => ({ httpOnly: true, sameSite: "Lax", path: "/", secure: https(c), maxAge: SESSION_DAYS * 24 * 3600 });

// The person making this request, or null. Two sources, never at the same time.
function identify(c) {
  if (GOOGLE) {
    const claims = readSession(getCookie(c, SESSION_COOKIE), SESSION_SECRET);
    return claims && { email: claims.email, uid: claims.uid ?? uidFor(claims.email), name: claims.name ?? "", picture: claims.picture ?? "" };
  }
  const email = normalizeEmail(c.req.header("remote-email"));
  return email ? { email, uid: uidFor(email), name: "", picture: "" } : null;
}

// A library is created (and the pre-0.21 single-tenant one adopted) the first
// time its owner is seen in this process.
const ready = new Set();
async function libraryFor(who) {
  if (!ready.has(who.uid)) { await store.adopt(who.uid, who.email); ready.add(who.uid); }
  return store.library(who.uid);
}

// ---- sign in ----------------------------------------------------------------
app.get(`${BASE}/auth/google`, (c) => {
  if (!GOOGLE) return c.text("Google sign-in is not configured on this server\n", 503);
  const state = randomState();
  const next = safeNext(c.req.query("next"), `${BASE}/`);
  // The state is the CSRF guard and carries where to land; it is signed, so the
  // callback can trust both without a server-side table.
  setCookie(c, "itineris_oauth", signSession({ email: "-", state, next, exp: Math.floor(Date.now() / 1000) + 600 }, SESSION_SECRET), { ...cookieOpts(c), maxAge: 600 });
  return c.redirect(authorizeUrl({ clientId: CLIENT_ID, redirectUri: redirectUriFor(c.req, PUBLIC_URL, `${BASE}/auth/callback`), state }));
});

app.get(`${BASE}/auth/callback`, async (c) => {
  if (!GOOGLE) return c.text("Google sign-in is not configured on this server\n", 503);
  const fail = (msg, code = 400) => c.html(signInError(msg), code);
  const pending = readSession(getCookie(c, "itineris_oauth"), SESSION_SECRET);
  deleteCookie(c, "itineris_oauth", { path: "/" });
  if (c.req.query("error")) return fail(`Google said: ${c.req.query("error")}`);
  if (!pending) return fail("That sign-in took too long. Please try again.");
  if (c.req.query("state") !== pending.state) return fail("That sign-in did not come from here. Please try again.");
  const code = c.req.query("code");
  if (!code) return fail("Google did not send a code back.");
  let user;
  try {
    const tokens = await exchangeCode({ code, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: redirectUriFor(c.req, PUBLIC_URL, `${BASE}/auth/callback`), endpoint: TOKEN_ENDPOINT });
    user = readIdToken(tokens.id_token, { clientId: CLIENT_ID });
  } catch (e) { return fail(e.message, 502); }
  if (!isAllowed(user.email)) return c.html(signInError(`${user.email} is not on this server's guest list.`), 403);
  setCookie(c, SESSION_COOKIE, signSession(newSession(user), SESSION_SECRET), cookieOpts(c));
  await libraryFor({ email: user.email, uid: uidFor(user.email) });
  return c.redirect(safeNext(pending.next, `${BASE}/`));
});

app.post(`${BASE}/auth/signout`, (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ signedOut: true });
});

const signInError = (msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>itineris · sign in</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d10;color:#e8eaed;font:15px/1.6 system-ui,sans-serif;padding:24px}
.c{max-width:26em;text-align:center}a{color:#7aa2f7}</style><div class=c><h1>Couldn't sign you in</h1><p>${String(msg).replace(/[<&]/g, (ch) => (ch === "<" ? "&lt;" : "&amp;"))}</p><p><a href="${BASE}/">Try again</a></p></div>`;

// ---- everything below is one person's own journal ---------------------------
// `me` answers without a session so the app can render a sign-in screen.
app.get(`${BASE}/api/me`, async (c) => {
  const who = identify(c);
  if (!who) return c.json({ signedIn: false, google: GOOGLE, signInUrl: GOOGLE ? `${BASE}/auth/google` : null });
  if (!isAllowed(who.email)) return c.json({ signedIn: false, google: GOOGLE, error: "not on this server's guest list" }, 403);
  await libraryFor(who);
  return c.json({
    signedIn: true, google: GOOGLE, email: who.email, name: who.name, picture: who.picture,
    owner: (await store.ownerUid()) === who.uid, places: placesStatus,
  });
});

// PUBLIC on purpose, and registered above the session gate so it stays that
// way: this is the one thing a visitor's browser tells the server. It refuses
// tokens that are not a published gallery, dedupes per visitor per day, and
// keeps nothing but a salted hash -- see server/views.js.
const viewLimit = makeLimiter();
app.post(`${BASE}/api/views/:token`, async (c) => {
  const token = c.req.param("token");
  const ip = clientIp((k) => c.req.header(k));
  const id = (await store.slugs())[token] ?? token;
  // Two reasons not to count somebody, and neither is their problem: they are
  // the owner looking at their own gallery, or their address has been busy.
  // Both still get the number -- an eye that vanishes reads as broken, and
  // the count is public either way.
  const who = identify(c);
  const mine = who && (await store.ownerOf(id)) === who.uid;
  if (mine || !viewLimit(ip)) {
    const n = await store.viewsOf(id);
    return n === 0 && !(await store.ownerOf(id)) ? c.json({ error: "no such gallery" }, 404) : c.json({ views: n, counted: false });
  }
  const seen = await store.recordView(token, { ip, ua: c.req.header("user-agent") ?? "" });
  // `counted` is false for somebody already counted today, not just for the
  // owner and the rate limit -- it should mean what it says.
  return seen === null ? c.json({ error: "no such gallery" }, 404) : c.json({ views: seen.n, counted: seen.fresh });
});

app.use(`${BASE}/api/*`, async (c, next) => {
  const who = identify(c);
  if (!who) return c.json({ error: "not signed in" }, 401);
  if (!isAllowed(who.email)) return c.json({ error: "forbidden" }, 403);
  c.set("who", who);
  c.set("lib", await libraryFor(who));
  await next();
});

const STR = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : null);
const NUM_OR_NULL = (v) => (v === null || v === "" ? null : Number.isFinite(+v) ? +v : undefined);
const IDS = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string"))] : null);
// A Google Maps link for the exact place, or null to clear; undefined = invalid.
const LINK = (v) => (v === null || v === "" ? null : typeof v === "string" && v.trim().length <= 600 && isGoogleMapsUrl(v.trim()) ? v.trim() : undefined);
// A Google Place ID (photos pinned to one Google place share one pin), or null to unpin; undefined = invalid.
const PLACE_ID = (v) => (v === null || v === "" ? null : isPlaceId(String(v).trim()) ? String(v).trim() : undefined);
const cleanTags = (arr) => [...new Set(arr.map((t) => STR(t, 40)).filter(Boolean).map((t) => t.toLowerCase()))];
const withGalleries = (moments, galleries) => {
  const idx = new Map();
  for (const g of galleries) for (const id of g.momentIds ?? []) (idx.get(id) ?? idx.set(id, []).get(id)).push(g.id);
  return moments.map((m) => ({ ...m, galleries: idx.get(m.id) ?? [] }));
};
const galleryView = (g, views = {}) => ({ ...g, count: (g.momentIds ?? []).length, trackCount: (g.trackIds ?? []).length, views: views[g.id] ?? 0 });
// The counts live outside anyone's library (a view is recorded by a stranger,
// not by the owner), so they are fetched alongside rather than stored with it.
const galleryViews = (galleries) => store.views().then((v) => galleries.map((g) => galleryView(g, v)));

// ---- read ----------------------------------------------------------------
app.get(`${BASE}/api/library`, async (c) => {
  const lib = c.get("lib");
  const [moments, tracks, galleries] = await Promise.all([lib.moments(), lib.tracks(), lib.galleries()]);
  return c.json({ moments: withGalleries(moments, galleries), tracks, galleries: await galleryViews(galleries) });
});
app.get(`${BASE}/api/moments`, async (c) => c.json(withGalleries(await c.get("lib").moments(), await c.get("lib").galleries())));
app.get(`${BASE}/api/tracks`, async (c) => c.json(await c.get("lib").tracks()));
app.get(`${BASE}/api/galleries`, async (c) => c.json(await galleryViews(await c.get("lib").galleries())));

// ---- moments -------------------------------------------------------------
// Captions. The `captions` list is the truth; `caption` and `captionStyle` are
// kept in step with its first entry, so everything that wants one line of text
// -- alt text, list titles, a phone still running an older bundle -- keeps
// working. Reconciling needs the moment as it stands (editing the first line of
// a photo with three captions must not drop the other two), so this returns a
// function to apply where that moment is in hand.
const mirror = (captions) => ({ captions, caption: captions[0]?.text ?? "", captionStyle: captions[0] ? styleOf(captions[0]) : null });
function captionFields(patch) {
  if ("captions" in patch) {
    const v = validateCaptions(patch.captions);
    if (v.error) return { error: `captions: ${v.error}` };
    return { apply: () => mirror(v.captions) };
  }
  if (!("caption" in patch) && !("captionStyle" in patch)) return {};
  let style;
  if ("captionStyle" in patch) {
    if (patch.captionStyle === null) style = null;
    else {
      const v = validateStyle(patch.captionStyle);
      if (v.error) return { error: `captionStyle: ${v.error}` };
      style = v.style;
    }
  }
  const text = "caption" in patch ? (STR(patch.caption, MAX_CAPTION_TEXT) ?? "").trim() : undefined;
  return {
    apply: (m) => {
      const have = captionsOf(m);
      const first = have[0] ?? null;
      const t = text !== undefined ? text : (first?.text ?? "");
      const s = style !== undefined ? style : (first ? styleOf(first) : null);
      return mirror(t ? [{ text: t, ...normalizeStyle(s) }, ...have.slice(1)] : have.slice(1));
    },
  };
}

function momentPatch(patch, email) {
  const upd = {};
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
  if ("placeId" in patch) {
    const id = PLACE_ID(patch.placeId);
    if (id === undefined) return { error: "placeId must be a Google Place ID" };
    upd.placeId = id;
  }
  const caps = captionFields(patch);
  if (caps.error) return { error: caps.error };
  return { upd: { ...upd, editedBy: email, editedAt: new Date().toISOString() }, captions: caps.apply ?? null };
}

app.post(`${BASE}/api/upload`, bodyLimit({ maxSize: MAX_UPLOAD }), async (c) => {
  const lib = c.get("lib"), who = c.get("who");
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
  const { upd = {}, error: metaError, captions: metaCaptions } = momentPatch(meta, who.email);
  if (metaError) return c.json({ error: `meta: ${metaError}` }, 400);
  delete upd.editedBy; delete upd.editedAt;
  // A photo captioned while it was still in the phone's queue arrives with them.
  Object.assign(upd, metaCaptions ? metaCaptions({}) : {});
  const mine = new Set((await lib.galleries()).map((g) => g.id));
  const wanted = new Set([
    ...(typeof body.gallery === "string" && TOKEN_RE.test(body.gallery) ? [body.gallery] : []),
    ...(Array.isArray(meta.galleries) ? meta.galleries.filter((g) => typeof g === "string" && TOKEN_RE.test(g)) : []),
  ].filter((g) => mine.has(g)));

  const created = [], duplicates = [], errors = [];
  for (const f of files) {
    try {
      const r = await ingestMedia(Buffer.from(await f.arrayBuffer()), f.name, f.type, { dataDir: DATA_DIR, email: who.email, uid: who.uid });
      if (r.duplicate) duplicates.push({ id: r.id, filename: f.name });
      else created.push({ ...r.moment, ...upd, tz: upd.t ? "manual" : r.moment.tz });
    } catch (e) {
      errors.push({ filename: f.name, error: e.message });
    }
  }
  if (created.length) {
    await lib.updateMoments((list) => {
      const have = new Set(list.map((m) => m.id));
      return [...list, ...created.filter((m) => !have.has(m.id))];
    });
  }
  const touched = [...created.map((m) => m.id), ...duplicates.map((d) => d.id)];
  if (created.length) { const ids = new Set(created.map((m) => m.id)); enrichPlaces(lib, (m) => ids.has(m.id)); }
  if (wanted.size && touched.length) {
    await lib.updateGalleries((gs) => gs.map((g) => (wanted.has(g.id) ? { ...g, momentIds: [...new Set([...(g.momentIds ?? []), ...touched])], updatedAt: new Date().toISOString() } : g)));
  }
  return c.json({ created, duplicates, errors }, errors.length && !created.length ? 422 : 200);
});

// One lookup queue for the whole process: a new place is looked up right after
// it is saved, the rest (backfill, monthly refresh) trickles behind it. Never throws.
let placesQueue = Promise.resolve();
function enrichPlaces(lib, filter = () => true) {
  if (!PLACES_KEY) return Promise.resolve(0);
  const run = placesQueue.then(async () => {
    const all = await lib.moments();
    const todo = all.filter((m) => filter(m) && needsLookup(m));
    let n = 0;
    for (const m of todo) {
      let g;
      try {
        if (isPlaceId(m.placeId)) {
          // Pinned to a Google place: another photo on the same pin already
          // knows it (no request), else ask Google by id.
          const sibling = all.find((x) => x.id !== m.id && x.google?.placeId === m.placeId && !isStale(x.google));
          g = sibling ? { ...sibling.google } : (await fetchPlaceDetails(m.placeId, { key: PLACES_KEY })) ?? { placeId: null, fetchedAt: new Date().toISOString() };
        } else {
          g = (await lookupPlace({ name: m.place, lat: m.lat, lng: m.lng }, { key: PLACES_KEY })) ?? { placeId: null, fetchedAt: new Date().toISOString() };
        }
        placesStatus.lastError = null;
      } catch (e) {
        placesStatus.lastError = e.message; console.error(`places ${m.id} (${m.place}): ${e.message}`);
        if (e.status === 400 || e.status === 403 || e.status === 429) break;   // key/API/quota trouble: the rest would fail the same way
        continue;
      }
      // A pinned photo without a name or spot of its own takes Google's.
      const fill = g.placeId && m.placeId ? { ...(!(m.place ?? "").trim() && g.name ? { place: g.name } : {}), ...(!Number.isFinite(m.lat) && Number.isFinite(g.lat) ? { lat: g.lat, lng: g.lng } : {}) } : {};
      const { lat: _l, lng: _g, address: _a, ...google } = g;
      await lib.updateMoments((ms) => ms.map((x) => (x.id === m.id ? { ...x, ...fill, google } : x)));
      n++; if (!(m.placeId && all.some((x) => x.id !== m.id && x.google?.placeId === m.placeId))) placesStatus.lookedUp++;
      await new Promise((r) => setTimeout(r, 150));
    }
    placesStatus.lastRunAt = new Date().toISOString();
    return n;
  });
  placesQueue = run.catch(() => {});
  return run;
}
// A changed name or spot invalidates what Google said about the old one.
const forgetGoogle = (m, upd) => ("place" in upd || "lat" in upd || "lng" in upd || "placeId" in upd ? (({ google, ...rest }) => rest)(m) : m);

app.patch(`${BASE}/api/moments/:id`, async (c) => {
  const lib = c.get("lib");
  const id = c.req.param("id");
  let patch; try { patch = await c.req.json(); } catch { return c.json({ error: "invalid json" }, 400); }
  const { upd, error, captions } = momentPatch(patch, c.get("who").email);
  if (error) return c.json({ error }, 400);
  let result = null;
  await lib.updateMoments((list) => list.map((m) => (m.id === id ? (result = { ...forgetGoogle(m, upd), ...upd, ...(captions ? captions(m) : {}) }) : m)));
  if (!result) return c.json({ error: "not found" }, 404);
  enrichPlaces(lib, (m) => m.id === id);
  return c.json(withGalleries([result], await lib.galleries())[0]);
});

// The creator's place search: Google Places when the server has a key.
app.get(`${BASE}/api/places/search`, async (c) => {
  if (!PLACES_KEY) return c.json({ error: "no Google Places key configured on the server" }, 409);
  const q = c.req.query("q") ?? "", lat = NUM_OR_NULL(c.req.query("lat")), lng = NUM_OR_NULL(c.req.query("lng"));
  try {
    const places = await searchPlaces(q, { lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null }, { key: PLACES_KEY });
    placesStatus.lastError = null;
    return c.json({ places });
  } catch (e) { placesStatus.lastError = e.message; return c.json({ error: e.message }, e.status && e.status >= 400 && e.status < 600 ? e.status : 502); }
});

// Ask Google again about this one place, now.
app.post(`${BASE}/api/moments/:id/google`, async (c) => {
  const lib = c.get("lib");
  const id = c.req.param("id");
  if (!PLACES_KEY) return c.json({ error: "no Google Places key configured on the server" }, 409);
  let found = false;
  await lib.updateMoments((list) => list.map((m) => (m.id === id ? (found = true, (({ google, ...rest }) => rest)(m)) : m)));
  if (!found) return c.json({ error: "not found" }, 404);
  await enrichPlaces(lib, (m) => m.id === id);
  const m = (await lib.moments()).find((x) => x.id === id);
  return c.json({ ...withGalleries([m], await lib.galleries())[0], placesError: placesStatus.lastError });
});

// Bulk: tag a whole selection, set a place, in one atomic write.
app.patch(`${BASE}/api/moments`, async (c) => {
  const lib = c.get("lib");
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
  // Pin the whole selection to one Google place: one pin, shared details.
  let pid;
  if ("placeId" in body) { pid = PLACE_ID(body.placeId); if (pid === undefined) return c.json({ error: "placeId must be a Google Place ID" }, 400); }
  if (loc && pid === undefined) pid = null;
  const set = new Set(ids); let n = 0;
  await lib.updateMoments((list) => list.map((m) => {
    if (!set.has(m.id)) return m;
    n++;
    const tags = [...new Set([...(m.tags ?? []).filter((t) => !remove.includes(t)), ...add])];
    const base = place !== undefined || loc || pid !== undefined ? (({ google, ...rest }) => rest)(m) : m;
    return { ...base, tags, ...(place !== undefined ? { place } : {}), ...(loc ?? {}), ...(link !== undefined ? { mapsUrl: link } : {}), ...(pid !== undefined ? { placeId: pid } : {}), editedBy: c.get("who").email, editedAt: new Date().toISOString() };
  }));
  if (place !== undefined || loc || pid !== undefined) enrichPlaces(lib, (m) => set.has(m.id));
  return c.json({ updated: n });
});

// A shared Google Maps link -> place name, coordinates, exact link. Short
// links need a redirect followed, which a browser cannot do cross-origin.
app.get(`${BASE}/api/resolve-link`, async (c) => {
  try { return c.json(await resolveMapsLink(c.req.query("url") ?? "")); }
  catch (e) { return c.json({ error: e.message }, e.status ?? 500); }
});

// Removes the moment, its public derivatives and its gallery memberships. The
// ORIGINAL is deliberately kept: deleting from the journal must never destroy
// the only copy of a photo.
app.delete(`${BASE}/api/moments/:id`, async (c) => {
  const lib = c.get("lib");
  const id = c.req.param("id");
  let gone = null;
  await lib.updateMoments((list) => list.filter((m) => (m.id === id ? ((gone = m), false) : true)));
  if (!gone) return c.json({ error: "not found" }, 404);
  await lib.updateGalleries((gs) => gs.map((g) => ((g.momentIds ?? []).includes(id) ? { ...g, momentIds: g.momentIds.filter((x) => x !== id), updatedAt: new Date().toISOString() } : g)));
  await store.removeFiles([gone.media?.src, gone.media?.medium, gone.media?.thumb, gone.media?.poster].filter((p) => p && p.startsWith("media/")));
  return c.json({ deleted: id, originalKept: gone.media?.original ?? null });
});

// ---- galleries -----------------------------------------------------------
// The gallery's own name in the URL. Global, because it lives at the root of
// the site, so "taken" means taken by anybody. Absent or "" clears it back to
// the token URL, which never stops working either way.
async function wantedSlug(body, exceptToken = null) {
  if (!("slug" in body)) return {};
  if (body.slug === null || body.slug === "") return { slug: null };
  const slug = cleanSlug(body.slug);
  const problem = slugProblem(slug);
  if (problem) return { error: `slug: ${problem}` };
  if (await store.slugTaken(slug, exceptToken)) return { error: `slug: “${slug}” is already somebody's gallery` };
  return { slug };
}

app.post(`${BASE}/api/galleries`, async (c) => {
  const lib = c.get("lib");
  let body; try { body = await c.req.json(); } catch { return c.json({ error: "invalid json" }, 400); }
  const title = STR(body.title, 120);
  if (!title) return c.json({ error: "title required" }, 400);
  const want = await wantedSlug(body);
  if (want.error) return c.json({ error: want.error }, 400);
  const now = new Date().toISOString();
  const known = new Set((await lib.moments()).map((m) => m.id));
  // Only the instance owner's home gallery is what "/" shows; for everyone else
  // `home` is a flag with no front page behind it (see Store.materialize).
  const wantsHome = body.home === true;
  const g = {
    id: token(), title, description: STR(body.description, 1000) ?? "", home: false,
    ...(want.slug ? { slug: want.slug } : {}),
    momentIds: (IDS(body.momentIds) ?? []).filter((id) => known.has(id)), trackIds: IDS(body.trackIds) ?? [],
    createdAt: now, updatedAt: now, createdBy: c.get("who").email,
  };
  await lib.updateGalleries((gs) => {
    if (wantsHome) gs = gs.map((x) => ({ ...x, home: false }));
    return [...gs, { ...g, home: wantsHome }];
  });
  return c.json(galleryView({ ...g, home: wantsHome }), 201);
});

app.patch(`${BASE}/api/galleries/:id`, async (c) => {
  const lib = c.get("lib");
  const id = c.req.param("id");
  if (!TOKEN_RE.test(id)) return c.json({ error: "bad id" }, 400);
  let body; try { body = await c.req.json(); } catch { return c.json({ error: "invalid json" }, 400); }
  const [known, knownTracks] = [new Set((await lib.moments()).map((m) => m.id)), new Set((await lib.tracks()).map((t) => t.id))];
  const want = await wantedSlug(body, id);
  if (want.error) return c.json({ error: want.error }, 400);
  let result = null, bad = null;
  await lib.updateGalleries((gs) => {
    if (!gs.some((g) => g.id === id)) return gs;
    if (body.home === true) gs = gs.map((g) => ({ ...g, home: g.id === id }));
    return gs.map((g) => {
      if (g.id !== id) return g;
      const n = { ...g };
      if ("title" in body) { const t = STR(body.title, 120); if (!t) { bad = "title required"; return g; } n.title = t; }
      if ("description" in body) n.description = STR(body.description, 1000) ?? "";
      if ("slug" in want) { if (want.slug) n.slug = want.slug; else delete n.slug; }
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
  return result ? c.json((await galleryViews([result]))[0]) : c.json({ error: "not found" }, 404);
});

app.delete(`${BASE}/api/galleries/:id`, async (c) => {
  const lib = c.get("lib");
  const id = c.req.param("id");
  let found = false;
  await lib.updateGalleries((gs) => gs.filter((g) => (g.id === id ? ((found = true), false) : true)));
  return found ? c.json({ deleted: id }) : c.json({ error: "not found" }, 404);
});

// ---- UI ------------------------------------------------------------------
// In production Traefik only routes /creator to this process; the public site
// is nginx. Locally this also serves the public data and media so both UIs work.
app.get(BASE, (c) => c.redirect(`${BASE}/`));
// Bookmarks and the PWA people already installed still point at /admin.
app.all("/admin", (c) => c.redirect(`${BASE}/`, 301));
app.all("/admin/*", (c) => c.redirect(c.req.path.replace(/^\/admin/, BASE) + (new URL(c.req.url).search || ""), 301));
// The worker script itself must be revalidated on every check or updates lag.
app.use(`${BASE}/sw.js`, async (c, next) => { await next(); c.res.headers.set("Cache-Control", "no-cache"); });
app.use(`${BASE}/manifest.webmanifest`, async (c, next) => { await next(); c.res.headers.set("Content-Type", "application/manifest+json"); c.res.headers.set("Cache-Control", "no-cache"); });
app.use(`${BASE}/*`, serveStatic({ root: UI_DIR, rewriteRequestPath: (p) => p.replace(new RegExp(`^${BASE}`), "") || "/" }));
app.get(`${BASE}/*`, async (c) => c.html(await readFile(path.join(UI_DIR, "index.html"), "utf8")));
app.use("/media/*", serveStatic({ root: DATA_DIR }));
app.use("/data/*", serveStatic({ root: DATA_DIR }));

// Every journal on the volume, including the pre-0.21 one that still serves
// "/" until somebody signs in and adopts it.
async function libraries() {
  const legacy = await store.legacy();
  return [...(await store.users()).map((uid) => store.library(uid)), ...(legacy ? [legacy] : [])];
}

const how = await store.init(SEED_DIR);
// A data migration, not housekeeping: it has to be done before anything can
// read the library, or the first request races it (and, if that request is the
// one that adopts the old layout, wins).
for (const lib of await libraries()) await dropLegacyPlaceIds(lib);
serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, () => {
  console.log(`itineris creator on :${PORT}  data=${DATA_DIR} (${how})  ui=${UI_DIR}  sign-in=${GOOGLE ? "google" : "proxy header"}`);
});

// Seeds before 0.9 carried their own `placeId` (an internal key like "chinatown");
// the field now means a Google Place ID. Drop anything that is not one.
async function dropLegacyPlaceIds(lib) {
  const bad = (m) => m.placeId !== undefined && m.placeId !== null && !isPlaceId(m.placeId);
  const legacy = (await lib.moments()).filter(bad);
  if (!legacy.length) return;
  await lib.updateMoments((ms) => ms.map((m) => (bad(m) ? (({ placeId, ...rest }) => rest)(m) : m)));
  console.log(`dropped ${legacy.length} legacy placeId field${legacy.length === 1 ? "" : "s"}`);
}

// Background housekeeping for every journal on the volume, one at a time.
async function sweep() {
  for (const lib of await libraries()) {
    // Photos uploaded before the phone-sized tier existed get one now.
    const n = await backfillMedium(lib, DATA_DIR).catch((e) => { console.error("backfill failed:", e); return 0; });
    if (n) console.log(`backfilled ${MEDIUM}px copies for ${n} photo${n === 1 ? "" : "s"}`);
    // Then what Google knows about every named place: new ones now, stale ones monthly.
    const p = await enrichPlaces(lib).catch(() => 0);
    if (p) console.log(`looked up ${p} place${p === 1 ? "" : "s"} on Google`);
  }
}
sweep();
if (PLACES_KEY) setInterval(() => sweep().catch(() => {}), 6 * 3600e3).unref();
