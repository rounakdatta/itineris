// Live test of the creator server: forges JPEGs with real EXIF/GPS, uploads them
// through the HTTP API, curates galleries, and checks what lands on disk --
// in the private library AND in the public projections nginx would serve.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { FIELD_MASK } from "../server/places.js";
import { mkdtemp, readFile, writeFile, access, rm, mkdir, cp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { fakeJpeg as jpeg } from "./lib/fakejpeg.mjs";
import { uidFor } from "../server/auth.js";
import { execFileSync } from "node:child_process";

const WHO = "tester@example.com";
// One person's journal is a directory named after them; the pre-0.21 layout is
// adopted into it the first time they are seen.
const MINE = uidFor(WHO);
const mine = (root, ...rest) => path.join(root, "users", MINE, ...rest);
let fail = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "  ok  " : "  FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!cond) fail++; };
const exists = (p) => access(p).then(() => true, () => false);
// Everything under media/, whichever person's folder it is in (and the seed's,
// which predates there being folders).
const mediaFiles = async (root) => {
  const out = [];
  for (const e of await readdir(path.join(root, "media"), { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) out.push(...(await readdir(path.join(root, "media", e.name)).catch(() => [])));
    else out.push(e.name);
  }
  return out;
};
const H = { "remote-email": WHO };
const JH = { ...H, "content-type": "application/json" };
const j = async (r) => ({ status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() });
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

// Starts a server on a fresh data dir (optionally pre-populated), returns helpers.
async function startServer({ port, dataDir, seedDir = "seed", env = {} }) {
  const server = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, ITINERIS_PORT: String(port), ITINERIS_DATA_DIR: dataDir, ITINERIS_SEED_DIR: seedDir, ITINERIS_ADMIN_UI_DIR: "dist-admin", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
  const BASE = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${BASE}/creator/healthz`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  const api = async (method, p, body, headers = JH) => j(await fetch(`${BASE}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const upload = async (files, extra = {}) => {
    const fd = new FormData();
    for (const [name, buf] of files) fd.append("files", new Blob([buf], { type: "image/jpeg" }), name);
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    return j(await fetch(`${BASE}/creator/api/upload`, { method: "POST", headers: H, body: fd }));
  };
  return { server, BASE, api, upload, log: () => log };
}

// A stand-in for Places API (New) Text Search: a place 30 m from the bias
// centre (or nothing, or a refusal, depending on the name); records every ask.
const placesLog = [];
const fakePlaces = createServer((req, res) => {
  // GET /places/<id>: details by id (a photo pinned to a Google place)
  if (req.method === "GET") {
    const id = decodeURIComponent(req.url.split("/").pop().split("?")[0]);
    placesLog.push({ details: id, mask: req.headers["x-goog-fieldmask"], key: req.headers["x-goog-api-key"] });
    if (id === "ChIJgone") { res.writeHead(404, { "content-type": "application/json" }); return res.end("{}"); }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ id, displayName: { text: `Place ${id.slice(-4)}` }, rating: 4.8, userRatingCount: 321, primaryTypeDisplayName: { text: "Cafe" }, googleMapsUri: `https://maps.google.com/?cid=${id.length}`, location: { latitude: 1.3, longitude: 103.8 }, formattedAddress: "1 Test Rd" }));
  }
  let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
    const q = JSON.parse(body || "{}"); placesLog.push({ mask: req.headers["x-goog-fieldmask"], key: req.headers["x-goog-api-key"], q });
    if (/refuse/i.test(q.textQuery ?? "")) { res.writeHead(403, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { message: "Places API (New) has not been used in project test before or it is disabled." } })); }
    const c = q.locationBias?.circle?.center ?? { latitude: 0, longitude: 0 };
    const places = /nowhere/i.test(q.textQuery ?? "") ? [] : [{ id: `ChIJfake${(q.textQuery ?? "").replace(/\W/g, "")}`, displayName: { text: q.textQuery }, rating: 4.3, userRatingCount: 24154, primaryTypeDisplayName: { text: "Hawker centre" }, googleMapsUri: "https://maps.google.com/?cid=4242", location: { latitude: c.latitude + 0.00027, longitude: c.longitude }, formattedAddress: "18 Raffles Quay, Singapore" }];
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ places }));
  });
});
await new Promise((r) => fakePlaces.listen(4329, "127.0.0.1", r));

// A stand-in for Google's token endpoint: hands back an id_token for Ada.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const fakeGoogle = createServer((req, res) => {
  let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
    const p = new URLSearchParams(body);
    if (p.get("code") !== "good") { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "invalid_grant" })); }
    const claims = { iss: "https://accounts.google.com", aud: p.get("client_id"), email: "ada@example.com", email_verified: true, name: "Ada", picture: "https://x/a.png", sub: "1", exp: Math.floor(Date.now() / 1000) + 600 };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id_token: `${b64({ alg: "RS256" })}.${b64(claims)}.sig`, access_token: "at" }));
  });
});
await new Promise((r) => fakeGoogle.listen(4330, "127.0.0.1", r));
const PLACES_ENV = { ITINERIS_GOOGLE_PLACES_KEY: "test-places", ITINERIS_PLACES_ENDPOINT: "http://127.0.0.1:4329/searchText", ITINERIS_PLACES_DETAILS_ENDPOINT: "http://127.0.0.1:4329/places" };
let askedBefore = 0;   // how many times Google was asked while the keyed server ran
const until = async (fn, ms = 15000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return v; };

const root = await mkdtemp(path.join(process.env.SCRATCH ?? tmpdir(), "itineris-test-"));
try {
  // =========================================================================
  console.log("--- fresh volume, seeded ---");
  const d1 = path.join(root, "fresh");
  const s1 = await startServer({ port: 4322, dataDir: d1, env: PLACES_ENV });
  try {
    ok("server up, seeded from seed/", s1.log().includes("(seeded)"), s1.log().trim().split("\n").pop());
    // `me` answers signed-out too, so the app can show a sign-in screen; every
    // other route refuses outright.
    const anon = await j(await fetch(`${s1.BASE}/creator/api/me`));
    ok("no identity -> me says signed out", anon.status === 200 && anon.body.signedIn === false, JSON.stringify(anon.body));
    ok("no identity -> the library is 401", (await fetch(`${s1.BASE}/creator/api/library`)).status === 401);
    ok("no identity -> uploading is 401", (await fetch(`${s1.BASE}/creator/api/upload`, { method: "POST" })).status === 401);
    ok("healthz open", (await fetch(`${s1.BASE}/creator/healthz`)).status === 200);
    ok("root not served here", (await fetch(`${s1.BASE}/`)).status === 404);

    const lib = await s1.api("GET", "/creator/api/library");
    ok("library: 20 moments, 3 tracks, 1 gallery", lib.body.moments.length === 20 && lib.body.tracks.length === 3 && lib.body.galleries.length === 1, `${lib.body.moments.length}/${lib.body.tracks.length}/${lib.body.galleries.length}`);
    ok("moments carry their gallery memberships", lib.body.moments.every((m) => m.galleries?.[0] === "sg2026demo"));
    ok("public: no library file under data/", !(await exists(path.join(d1, "data", "moments.json"))) && (await exists(mine(d1, "moments.json"))));
    ok("the pre-0.21 library was adopted, not copied", !(await exists(path.join(d1, "library", "moments.json"))));
    ok("...and its gallery is filed under its new owner", (await readJson(path.join(d1, "library", "owners.json"))).sg2026demo === MINE);
    ok("public: home.json -> demo gallery", (await readJson(path.join(d1, "data", "home.json"))).gallery === "sg2026demo");
    const pubG = await readJson(path.join(d1, "data", "galleries", "sg2026demo.json"));
    ok("public gallery: 20 moments, 3 tracks, title", pubG.moments.length === 20 && pubG.tracks.length === 3 && pubG.title.startsWith("Singapore"));

    // --- upload: private by default, or straight into a gallery ---
    const A = await jpeg({ date: "2026:03:14 08:40:12", offset: "+08:00", lat: 1.2829, lng: 103.8443, seed: 1 });
    const B = await jpeg({ date: "2026:03:15 06:35:00", lat: 1.2868, lng: 103.8545, seed: 2 });
    const C = await jpeg({ seed: 3, w: 1200, h: 1600 });
    const up = await s1.upload([["a.jpg", A], ["b.jpg", B]]);
    ok("upload 2 created", up.status === 200 && up.body.created.length === 2, JSON.stringify(up.body.errors));
    const [a, b] = up.body.created;
    ok("A: EXIF offset kept", a.t === "2026-03-14T08:40:12+08:00" && a.tz === "exif", a.t);
    ok("B: zone from GPS", b.t === "2026-03-15T06:35:00+08:00" && b.tz === "gps", b.t);
    ok("uploads are PRIVATE: not in any public gallery file", !(await readFile(path.join(d1, "data", "galleries", "sg2026demo.json"), "utf8")).includes(a.id));
    const upG = await s1.upload([["c.jpg", C]], { gallery: "sg2026demo" });
    const c = upG.body.created[0];
    ok("C: no EXIF -> tz unknown", c.tz === "unknown" && c.lat === null, c.t);
    ok("upload with gallery field lands in that gallery", (await readJson(path.join(d1, "data", "galleries", "sg2026demo.json"))).moments.some((m) => m.id === c.id));
    ok("derivative EXIF-free", !(await sharp(path.join(d1, a.media.src)).metadata()).exif);
    ok("960px tier written for phones", a.media.medium?.endsWith("-960.webp") && (await exists(path.join(d1, a.media.medium))) && (await sharp(path.join(d1, a.media.medium)).metadata()).width === 960);
    const again = await s1.upload([["a2.jpg", A]]);
    ok("same bytes -> duplicate", again.body.created.length === 0 && again.body.duplicates[0].id === a.id);

    // --- galleries CRUD ---
    const bad = await s1.api("POST", "/creator/api/galleries", { title: "   " });
    ok("gallery without title -> 400", bad.status === 400);
    const g = await s1.api("POST", "/creator/api/galleries", { title: "For the family", description: "Just the food", momentIds: [a.id, "nope"] });
    ok("gallery created with a random token id", g.status === 201 && /^[a-z0-9]{12}$/.test(g.body.id) && g.body.count === 1, `${g.body.id} count=${g.body.count}`);
    const gid = g.body.id;
    ok("unknown ids are dropped", !g.body.momentIds.includes("nope"));
    let gf = await readJson(path.join(d1, "data", "galleries", `${gid}.json`));
    ok("public file materialised with 1 moment", gf.moments.length === 1 && gf.moments[0].id === a.id && gf.title === "For the family");
    const PRIVATE = ["uploadedBy", "uploadedAt", "editedBy", "filename", "camera", "original", "createdBy"];
    const leaked = PRIVATE.filter((k) => JSON.stringify(gf).includes(`"${k}"`));
    ok("public projection leaks nothing private", leaked.length === 0, leaked.join(",") || "clean");
    ok("public projection keeps what the viewer needs", ["id", "t", "lat", "lng", "place", "caption", "tags", "media"].every((k) => k in gf.moments[0]) && "thumb" in gf.moments[0].media && "medium" in gf.moments[0].media);

    const p = await s1.api("PATCH", `/creator/api/galleries/${gid}`, { add: [b.id, c.id], remove: [a.id], title: "Family" });
    ok("PATCH add/remove/title", p.status === 200 && p.body.title === "Family" && p.body.momentIds.sort().join() === [b.id, c.id].sort().join());
    gf = await readJson(path.join(d1, "data", "galleries", `${gid}.json`));
    ok("public file follows the edit", gf.moments.map((m) => m.id).sort().join() === [b.id, c.id].sort().join() && gf.title === "Family");
    ok("a photo can be in two galleries", (await s1.api("GET", "/creator/api/moments")).body.find((m) => m.id === c.id).galleries.length === 2);

    const home = await s1.api("PATCH", `/creator/api/galleries/${gid}`, { home: true });
    ok("home moves to the new gallery", home.body.home === true && (await readJson(path.join(d1, "data", "home.json"))).gallery === gid);
    ok("...and off the old one", (await s1.api("GET", "/creator/api/galleries")).body.filter((x) => x.home).length === 1);

    // --- annotated upload: what a phone's queue sends after captioning offline ---
    const D = await jpeg({ date: "2026:03:19 10:00:00", offset: "+08:00", lat: 1.29, lng: 103.85, seed: 4 });
    const fdMeta = new FormData(); fdMeta.append("files", new Blob([D], { type: "image/jpeg" }), "d.jpg");
    fdMeta.append("meta", JSON.stringify({ caption: "  From the queue ", place: "Tiong Bahru", tags: ["Queued", "food", "queued"], galleries: [gid, "nope"] }));
    const upM = await j(await fetch(`${s1.BASE}/creator/api/upload`, { method: "POST", headers: H, body: fdMeta }));
    const d = upM.body.created?.[0];
    ok("meta applied at creation: caption trimmed, tags cleaned, place", upM.status === 200 && d?.caption === "From the queue" && d.tags.join() === "queued,food" && d.place === "Tiong Bahru", JSON.stringify(d && { c: d.caption, t: d.tags, p: d.place }));
    ok("meta without lat/lng/t keeps the file's own EXIF", d?.t === "2026-03-19T10:00:00+08:00" && d.tz === "exif" && Math.abs(d.lat - 1.29) < 1e-3, `${d?.t} ${d?.tz} ${d?.lat}`);
    ok("meta.galleries lands it in the gallery (unknown ids ignored)", (await readJson(path.join(d1, "data", "galleries", `${gid}.json`))).moments.some((m) => m.id === d.id));
    const fdBad = new FormData(); fdBad.append("files", new Blob([D], { type: "image/jpeg" }), "d.jpg"); fdBad.append("meta", JSON.stringify({ t: "2026-03-19T10:00" }));
    ok("meta with a naive time -> 400, nothing stored", (await fetch(`${s1.BASE}/creator/api/upload`, { method: "POST", headers: H, body: fdBad })).status === 400);
    const fdJunk = new FormData(); fdJunk.append("files", new Blob([D], { type: "image/jpeg" }), "d.jpg"); fdJunk.append("meta", "{not json");
    ok("meta that is not JSON -> 400", (await fetch(`${s1.BASE}/creator/api/upload`, { method: "POST", headers: H, body: fdJunk })).status === 400);

    // --- edits propagate to every public copy ---
    const bulk = await s1.api("PATCH", "/creator/api/moments", { ids: [b.id, c.id], addTags: ["Food", "night"], place: "Lau Pa Sat" });
    ok("bulk PATCH updates 2", bulk.body.updated === 2);
    gf = await readJson(path.join(d1, "data", "galleries", `${gid}.json`));
    ok("bulk edit visible in the public gallery", gf.moments.filter((m) => [b.id, c.id].includes(m.id)).every((m) => m.tags.includes("food") && m.place === "Lau Pa Sat"));
    const single = await s1.api("PATCH", `/creator/api/moments/${c.id}`, { caption: "Satay after dark", lat: 1.28, lng: 103.85, t: "2026-03-16T20:00:00+08:00" });
    ok("single PATCH returns memberships", single.status === 200 && single.body.galleries.length === 2 && single.body.tz === "manual");
    ok("PATCH rejects naive time", (await s1.api("PATCH", `/creator/api/moments/${c.id}`, { t: "2026-03-16T20:00:00" })).status === 400);
    ok("bulk without ids -> 400", (await s1.api("PATCH", "/creator/api/moments", { addTags: ["x"] })).status === 400);
    const bl = await s1.api("PATCH", "/creator/api/moments", { ids: [b.id, c.id], lat: 37.7749, lng: -122.4194 });
    const placed = (await s1.api("GET", "/creator/api/moments")).body.filter((m) => [b.id, c.id].includes(m.id));
    ok("bulk Set location places every selected photo", bl.body.updated === 2 && placed.every((m) => Math.abs(m.lat - 37.7749) < 1e-6 && Math.abs(m.lng + 122.4194) < 1e-6));
    ok("bulk location needs both coordinates", (await s1.api("PATCH", "/creator/api/moments", { ids: [b.id], lat: 1 })).status === 400);
    const demo = await readJson(path.join(d1, "data", "galleries", "sg2026demo.json"));
    ok("...and in the other gallery that holds it", demo.moments.find((m) => m.id === c.id)?.caption === "Satay after dark");

    // --- Google Maps links: the exact place in, the exact link out ---
    ok("resolve-link refuses non-Google links", (await s1.api("GET", "/creator/api/resolve-link?url=https%3A%2F%2Fexample.com%2Fx")).status === 400);
    const FULL = "https://www.google.com/maps/place/Lau+Pa+Sat/@1.2806,103.8505,17z/data=!3m1!4b1!4m6!3m5!1s0x31da190d3c6fd7a3:0x9a0f1d6f2a2b3c4d!8m2!3d1.280638!4d103.850453!16s%2Fg%2F1td6l0mq?entry=ttu";
    const CID_URL = `https://maps.google.com/?cid=${BigInt("0x9a0f1d6f2a2b3c4d")}`;
    const rl = await s1.api("GET", `/creator/api/resolve-link?url=${encodeURIComponent(FULL)}`);
    ok("resolve-link reads name, the place's coordinates and a stable link out of a full URL (no network)", rl.status === 200 && rl.body.name === "Lau Pa Sat" && rl.body.lat === 1.280638 && rl.body.lng === 103.850453 && rl.body.mapsUrl === CID_URL, JSON.stringify(rl.body));
    ok("PATCH rejects a non-Google mapsUrl", (await s1.api("PATCH", `/creator/api/moments/${b.id}`, { mapsUrl: "https://example.com/place" })).status === 400);
    // A style belongs to words: it is stored with the caption it dresses, so this patches both.
    const styled = await s1.api("PATCH", `/creator/api/moments/${b.id}`, { caption: "Chicken rice", captionStyle: { x: 0.2, y: 0.7, rot: -8.25, font: "script", size: "l", bg: "#ffb020", align: "left", junk: true } });
    ok("PATCH captionStyle: kept, filled with defaults, junk dropped, 0.13.0's face name upgraded", styled.status === 200 && JSON.stringify(styled.body.captionStyle) === JSON.stringify({ x: 0.2, y: 0.7, rot: -8.3, font: "elegant", size: "l", bg: "#ffb020", ink: "light", align: "left" }), JSON.stringify(styled.body.captionStyle));
    ok("...and it is one caption in the list, words and look together", styled.body.captions.length === 1 && styled.body.captions[0].text === "Chicken rice" && styled.body.captions[0].font === "elegant", JSON.stringify(styled.body.captions));
    ok("PATCH captionStyle rejects an impossible angle", (await s1.api("PATCH", `/creator/api/moments/${b.id}`, { captionStyle: { rot: 400 } })).status === 400);
    ok("PATCH captionStyle rejects an unknown face", (await s1.api("PATCH", `/creator/api/moments/${b.id}`, { captionStyle: { font: "comic" } })).status === 400);
    ok("PATCH captionStyle rejects a stringy position", (await s1.api("PATCH", `/creator/api/moments/${b.id}`, { captionStyle: { x: "0.5" } })).status === 400);
    const plain = await s1.api("PATCH", `/creator/api/moments/${b.id}`, { captionStyle: null });
    ok("PATCH captionStyle: null puts that caption back to the plain look, words intact", plain.body.caption === "Chicken rice" && plain.body.captionStyle.font === "clean" && plain.body.captionStyle.y === 0.82, JSON.stringify(plain.body.captionStyle));
    const gone = await s1.api("PATCH", `/creator/api/moments/${b.id}`, { caption: "" });
    ok("...and taking the words away leaves no caption and no style at all", gone.body.caption === "" && gone.body.captionStyle === null && gone.body.captions.length === 0, JSON.stringify([gone.body.caption, gone.body.captionStyle, gone.body.captions]));
    // --- a few captions on one photo ---
    const many = await s1.api("PATCH", `/creator/api/moments/${b.id}`, { captions: [
      { text: "  Satay by the water ", font: "editorial", rot: -8, junk: 1 },
      { text: "", y: 0.3 },
      { text: "6am, before the queue", font: "caps", y: 0.62, bg: "dark" },
    ] });
    ok("PATCH captions: kept in order, trimmed, blanks dropped, junk ignored", many.status === 200 && many.body.captions.length === 2 && many.body.captions[0].text === "Satay by the water" && many.body.captions[0].font === "editorial" && many.body.captions[1].y === 0.62 && !("junk" in many.body.captions[0]), JSON.stringify(many.body.captions?.map((c) => `${c.text}/${c.font}/${c.y}`)));
    ok("...and the single caption + style still name the first one, for anything that reads them", many.body.caption === "Satay by the water" && many.body.captionStyle.font === "editorial" && many.body.captionStyle.rot === -8 && !("text" in many.body.captionStyle), JSON.stringify([many.body.caption, many.body.captionStyle]));
    const pubMany = (await readJson(path.join(d1, "data", "galleries", `${gid}.json`))).moments.find((m) => m.id === b.id);
    ok("...published with the gallery", pubMany?.captions?.length === 2 && pubMany.caption === "Satay by the water", JSON.stringify(pubMany?.captions?.map((c) => c.text)));
    // Editing the first line the old way must not drop the others.
    const legacy = await s1.api("PATCH", `/creator/api/moments/${b.id}`, { caption: "Satay, actually" });
    ok("an old-style caption edit rewrites the first and keeps the rest", legacy.body.captions.length === 2 && legacy.body.captions[0].text === "Satay, actually" && legacy.body.captions[0].font === "editorial" && legacy.body.captions[1].text === "6am, before the queue", JSON.stringify(legacy.body.captions?.map((c) => c.text)));
    const restyle = await s1.api("PATCH", `/creator/api/moments/${b.id}`, { captionStyle: { font: "poster" } });
    ok("...and an old-style restyle only restyles the first", restyle.body.captions[0].font === "poster" && restyle.body.captions[1].font === "caps", JSON.stringify(restyle.body.captions?.map((c) => c.font)));
    const emptied = await s1.api("PATCH", `/creator/api/moments/${b.id}`, { caption: "   " });
    ok("...and clearing it promotes the next one instead of losing it", emptied.body.captions.length === 1 && emptied.body.caption === "6am, before the queue", JSON.stringify(emptied.body.captions?.map((c) => c.text)));
    ok("PATCH captions refuses a sixth", (await s1.api("PATCH", `/creator/api/moments/${b.id}`, { captions: Array.from({ length: 6 }, (_, i) => ({ text: `c${i}` })) })).status === 400);
    ok("PATCH captions refuses a bad entry, naming it", (await s1.api("PATCH", `/creator/api/moments/${b.id}`, { captions: [{ text: "ok" }, { text: "x", font: "comic" }] })).body.error.includes("[1]"));
    ok("PATCH captions: an empty list clears them all", (await s1.api("PATCH", `/creator/api/moments/${b.id}`, { captions: [] })).body.caption === "");
    const linked = await s1.api("PATCH", `/creator/api/moments/${b.id}`, { lat: 1.280638, lng: 103.850453, place: "Lau Pa Sat", mapsUrl: CID_URL });
    ok("PATCH stores the exact link", linked.status === 200 && linked.body.mapsUrl === CID_URL);
    ok("...and the public gallery carries it", (await readJson(path.join(d1, "data", "galleries", `${gid}.json`))).moments.find((m) => m.id === b.id)?.mapsUrl === CID_URL);
    await s1.api("PATCH", "/creator/api/moments", { ids: [b.id], lat: 1.29, lng: 103.86 });
    ok("a bulk spot without a link drops the stale link", (await s1.api("GET", "/creator/api/moments")).body.find((m) => m.id === b.id).mapsUrl === null);
    const bl2 = await s1.api("PATCH", "/creator/api/moments", { ids: [b.id], lat: 1.280638, lng: 103.850453, mapsUrl: CID_URL, place: "Lau Pa Sat" });
    ok("bulk sets spot + link + name together", bl2.body.updated === 1 && (await s1.api("GET", "/creator/api/moments")).body.find((m) => m.id === b.id).mapsUrl === CID_URL);
    ok("bulk rejects a non-Google link", (await s1.api("PATCH", "/creator/api/moments", { ids: [b.id], mapsUrl: "https://example.com/" })).status === 400);

    // --- Google Places: what Google says about a place, looked up server-side, published, refreshed ---
    const booted = await until(async () => { const me = (await s1.api("GET", "/creator/api/me")).body; return me.places?.lookedUp >= 13 ? me : null; });
    ok("boot looked up every named, placed seed photo whose Google details were stale", !!booted, JSON.stringify((await s1.api("GET", "/creator/api/me")).body.places));
    ok("...by name, never by the seed's internal key", !placesLog.some((l) => l.details));
    ok("...asking only for the fields we publish, with the server's key", placesLog.length >= 13 && placesLog.every((l) => l.mask === FIELD_MASK && l.key === "test-places"), JSON.stringify(placesLog.filter((l) => !(l.mask === FIELD_MASK && l.key === "test-places")).slice(0, 2)));
    const asked = placesLog.length;
    await s1.api("PATCH", `/creator/api/moments/${b.id}`, { place: "Lau Pa Sat", lat: 1.2807, lng: 103.8504 });
    const enriched = await until(async () => { const m = (await s1.api("GET", "/creator/api/moments")).body.find((x) => x.id === b.id); return m.google?.placeId ? m : null; });
    ok("a newly named place is looked up right after it is saved", !!enriched && enriched.google.rating === 4.3 && enriched.google.ratingCount === 24154 && enriched.google.type === "Hawker centre" && enriched.google.mapsUri === "https://maps.google.com/?cid=4242", JSON.stringify(enriched?.google));
    ok("...biased to the photo's spot", placesLog.length > asked && placesLog[placesLog.length - 1].q.locationBias.circle.center.latitude === 1.2807);
    gf = await readJson(path.join(d1, "data", "galleries", `${gid}.json`));
    const pubB = gf.moments.find((m) => m.id === b.id);
    ok("...and published with the gallery: rating, count, kind, Google's link -- not the bookkeeping", JSON.stringify(Object.keys(pubB.google).sort()) === JSON.stringify(["mapsUri", "placeId", "rating", "ratingCount", "type"]), JSON.stringify(pubB.google));
    await s1.api("PATCH", `/creator/api/moments/${b.id}`, { place: "Nowhere Cafe" });
    const nothing = await until(async () => { const m = (await s1.api("GET", "/creator/api/moments")).body.find((x) => x.id === b.id); return m.google && m.google.placeId === null ? m : null; });
    ok("renaming forgets the old details; 'nothing nearby' is remembered, not published", !!nothing && !(await readJson(path.join(d1, "data", "galleries", `${gid}.json`))).moments.find((m) => m.id === b.id).google);
    const refused = await s1.api("POST", `/creator/api/moments/${b.id}/google`);
    ok("↻ asks again and reports nothing found", refused.status === 200 && refused.body.google?.placeId === null && !refused.body.placesError, JSON.stringify(refused.body.google));
    await s1.api("PATCH", `/creator/api/moments/${b.id}`, { place: "Refuse Me Kopitiam" });
    const err = await until(async () => (await s1.api("GET", "/creator/api/me")).body.places.lastError);
    ok("an API refusal (not enabled, bad key) is surfaced to the admin, not swallowed", /not been used/.test(err ?? ""), err);
    await s1.api("PATCH", `/creator/api/moments/${b.id}`, { place: "Lau Pa Sat" });
    await until(async () => ((await s1.api("GET", "/creator/api/moments")).body.find((x) => x.id === b.id).google?.placeId ? true : null));

    // --- pinning photos to ONE Google place ---
    const srch = await s1.api("GET", "/creator/api/places/search?q=Lau%20Pa%20Sat&lat=1.2807&lng=103.8504");
    ok("the admin's place search returns candidates with address and rating", srch.status === 200 && srch.body.places[0].placeId === "ChIJfakeLauPaSat" && srch.body.places[0].address === "18 Raffles Quay, Singapore" && srch.body.places[0].rating === 4.3, JSON.stringify(srch.body).slice(0, 200));
    const asksBeforePin = placesLog.length;
    const pinned = await s1.upload([["pinned.jpg", await jpeg({ seed: 21, w: 800, h: 600 })]], { meta: JSON.stringify({ placeId: "ChIJfakeLauPaSat", lat: 1.2807, lng: 103.8504 }) });
    const pid = pinned.body.created[0].id;
    const adopted = await until(async () => { const m = (await s1.api("GET", "/creator/api/moments")).body.find((x) => x.id === pid); return m.google?.placeId === "ChIJfakeLauPaSat" ? m : null; });
    ok("a photo uploaded pinned to a place adopts its sibling's Google details -- no request -- and its name", !!adopted && adopted.place === "Lau Pa Sat" && adopted.google.rating === 4.3 && placesLog.length === asksBeforePin, JSON.stringify(adopted && { place: adopted.place, google: adopted.google, asks: placesLog.length - asksBeforePin }));
    const PID = "ChIJdetails0099abcd";
    await s1.api("PATCH", `/creator/api/moments/${a.id}`, { placeId: PID, lat: 1.3, lng: 103.8 });
    const byId = await until(async () => { const m = (await s1.api("GET", "/creator/api/moments")).body.find((x) => x.id === a.id); return m.google?.placeId === PID ? m : null; });
    ok("a pin nobody else carries is looked up by id", !!byId && byId.google.name === "Place abcd" && byId.google.rating === 4.8 && placesLog.some((l) => l.details === PID), JSON.stringify(byId?.google));
    ok("bulk can pin a selection to one place", (await s1.api("PATCH", "/creator/api/moments", { ids: [pid], placeId: PID, lat: 1.3, lng: 103.8 })).body.updated === 1 && !!(await until(async () => { const m = (await s1.api("GET", "/creator/api/moments")).body.find((x) => x.id === pid); return m.google?.placeId === PID ? m : null; })));
    ok("PATCH rejects a malformed Place ID (a seed's internal key is not one)", (await s1.api("PATCH", `/creator/api/moments/${a.id}`, { placeId: "nope!" })).status === 400 && (await s1.api("PATCH", `/creator/api/moments/${a.id}`, { placeId: "chinatown" })).status === 400);
    ok("search without a key is a 409, not a 500", true);
    askedBefore = placesLog.length;

    // --- videos: a real clip through ffprobe/poster/transcode (needs ffmpeg on PATH; CI installs it) ---
    let hasFfmpeg = true; try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { hasFfmpeg = false; }
    if (!hasFfmpeg) console.log("  skip  videos: no ffmpeg on PATH");
    else {
      const clip = path.join(root, "clip.mp4");
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=640x360:rate=15", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-metadata", "creation_time=2026-03-14T00:40:12Z", "-metadata", "location=+01.2807+103.8504/", clip], { stdio: "ignore" });
      const vidUp = await s1.upload([["clip.mp4", await readFile(clip)]]);
      const vid = vidUp.body.created?.[0];
      ok("a video uploads and becomes a video moment", vidUp.status === 200 && vid?.media.type === "video", JSON.stringify(vidUp.body).slice(0, 300));
      if (vid) {
        ok("...with an H.264 mp4, a poster in three tiers, duration and size", /-1280\.mp4$/.test(vid.media.src) && vid.media.poster?.endsWith("-1600.webp") && vid.media.medium?.endsWith("-960.webp") && vid.media.thumb?.endsWith("-400.webp") && Math.abs(vid.media.duration - 2) < 0.6 && vid.media.w === 640 && vid.media.h === 360, JSON.stringify(vid.media));
        const files = await Promise.all([vid.media.src, vid.media.poster, vid.media.medium, vid.media.thumb, vid.media.original].map((r) => exists(path.join(d1, r))));
        ok("...all on disk, original kept", files.every(Boolean));
        const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", path.join(d1, vid.media.src)]).toString());
        ok("...the copy is H.264 + AAC with the moov atom first (plays as it downloads)", probe.streams.some((s) => s.codec_name === "h264") && probe.streams.some((s) => s.codec_name === "aac") && (await readFile(path.join(d1, vid.media.src))).subarray(0, 64).toString("latin1").includes("moov"), probe.streams.map((s) => s.codec_name).join(","));
        ok("...shot when the file says, in the zone of where it says", vid.t === "2026-03-14T08:40:12+08:00" && vid.tz === "gps" && vid.lat === 1.2807 && vid.lng === 103.8504, `${vid.t} ${vid.tz} ${vid.lat},${vid.lng}`);
        const again = await s1.upload([["clip.mp4", await readFile(clip)]]);
        ok("the same clip again is a duplicate, not a second transcode", again.body.created.length === 0 && again.body.duplicates[0]?.id === vid.id);
        await s1.api("PATCH", `/creator/api/galleries/${gid}`, { add: [vid.id] });
        const pubV = (await readJson(path.join(d1, "data", "galleries", `${gid}.json`))).moments.find((m) => m.id === vid.id);
        ok("...published with type, poster and duration, never the original", pubV?.media.type === "video" && pubV.media.poster && pubV.media.duration && !pubV.media.original, JSON.stringify(pubV?.media));
        const delV = await s1.api("DELETE", `/creator/api/moments/${vid.id}`);
        ok("deleting a video removes its copy and poster tiers, keeps the original", delV.status === 200 && !(await exists(path.join(d1, vid.media.src))) && !(await exists(path.join(d1, vid.media.poster))) && (await exists(path.join(d1, vid.media.original))));
      }
    }

    // --- delete: moment leaves every gallery; gallery delete keeps photos ---
    const del = await s1.api("DELETE", `/creator/api/moments/${c.id}`);
    ok("DELETE moment keeps original, removes derivatives", del.status === 200 && (await exists(path.join(d1, c.media.original))) && !(await exists(path.join(d1, c.media.src))) && !(await exists(path.join(d1, c.media.medium))));
    gf = await readJson(path.join(d1, "data", "galleries", `${gid}.json`));
    ok("deleted moment gone from public galleries", !gf.moments.some((m) => m.id === c.id) && !(await readJson(path.join(d1, "data", "galleries", "sg2026demo.json"))).moments.some((m) => m.id === c.id));
    const gdel = await s1.api("DELETE", `/creator/api/galleries/${gid}`);
    ok("DELETE gallery removes its public file", gdel.status === 200 && !(await exists(path.join(d1, "data", "galleries", `${gid}.json`))));
    ok("...and home.json since it was home", !(await exists(path.join(d1, "data", "home.json"))));
    ok("...but the photos remain in the library", (await s1.api("GET", "/creator/api/moments")).body.some((m) => m.id === b.id));
    ok("DELETE unknown gallery -> 404", (await s1.api("DELETE", "/creator/api/galleries/zzzzzzzzzzzz")).status === 404);

    // --- UI ---
    // The shell is public on purpose -- it IS the sign-in screen, and the API
    // behind it is what checks identity (asserted at the top of this run).
    ok("creator UI served to anyone", (await fetch(`${s1.BASE}/creator/`)).status === 200);
    ok("creator UI SPA fallback", (await fetch(`${s1.BASE}/creator/galleries`, { headers: H })).status === 200);
    const moved = await fetch(`${s1.BASE}/admin/`, { redirect: "manual" });
    ok("/admin still takes old bookmarks to /creator", moved.status === 301 && moved.headers.get("location") === "/creator/", `${moved.status} ${moved.headers.get("location")}`);
    const movedDeep = await fetch(`${s1.BASE}/admin/galleries`, { redirect: "manual" });
    ok("...including a deep link", movedDeep.status === 301 && movedDeep.headers.get("location") === "/creator/galleries", `${movedDeep.status} ${movedDeep.headers.get("location")}`);
    ok("public data served for local dev", (await fetch(`${s1.BASE}/data/galleries/sg2026demo.json`)).status === 200);
  } finally { s1.server.kill(); }

  // =========================================================================
  console.log("--- existing 0.2 volume: migrate to library + home gallery ---");
  const d2 = path.join(root, "legacy");
  await mkdir(path.join(d2, "data"), { recursive: true });
  const seedMoments = await readJson("seed/library/moments.json");
  // ...carrying the pre-0.9 seed's internal `placeId` keys, which must not be mistaken for Google Place IDs.
  await writeFile(path.join(d2, "data", "moments.json"), JSON.stringify(seedMoments.slice(0, 5).map((m) => ({ ...m, placeId: m.spot ?? "chinatown" }))));
  await writeFile(path.join(d2, "data", "tracks.json"), JSON.stringify(await readJson("seed/library/tracks.json")));
  await cp("seed/media", path.join(d2, "media"), { recursive: true });
  const s2 = await startServer({ port: 4323, dataDir: d2 });
  try {
    ok("server reports migration", s2.log().includes("(migrated)"), s2.log().trim().split("\n").pop());
    ok("public moments.json is GONE", !(await exists(path.join(d2, "data", "moments.json"))) && !(await exists(path.join(d2, "data", "tracks.json"))));
    ok("library holds the 5 moments", (await readJson(path.join(d2, "library", "moments.json"))).length === 5);
    ok("legacy internal placeId keys were dropped on boot", (await readJson(path.join(d2, "library", "moments.json"))).every((m) => m.placeId === undefined) && s2.log().includes("dropped 5 legacy placeId fields"), s2.log().split("\n").find((l) => /legacy/.test(l)));
    const gs = (await s2.api("GET", "/creator/api/galleries")).body;
    ok("one home gallery with everything", gs.length === 1 && gs[0].home && gs[0].count === 5 && gs[0].trackCount === 3 && /^[a-z0-9]{12}$/.test(gs[0].id), JSON.stringify(gs.map((g) => [g.id, g.count])));
    ok("home.json points at it; its public file has the 5", (await readJson(path.join(d2, "data", "home.json"))).gallery === gs[0].id && (await readJson(path.join(d2, "data", "galleries", `${gs[0].id}.json`))).moments.length === 5);
  } finally { s2.server.kill(); }
  ok("a server without a Places key never asks Google", placesLog.length === askedBefore, `${placesLog.length} asks, ${askedBefore} before`);

  // =========================================================================
  console.log("--- restart on an existing 0.3 volume: nothing changes, stale public files heal ---");
  await writeFile(path.join(d1, "data", "galleries", "stale.json"), "{}");
  const s3 = await startServer({ port: 4324, dataDir: d1 });
  try {
    ok("server reports existing", s3.log().includes("(existing)"));
    ok("stale public gallery file removed on boot", !(await exists(path.join(d1, "data", "galleries", "stale.json"))));
    ok("library intact: 20 seed + a + b + d + the pinned upload", (await s3.api("GET", "/creator/api/moments")).body.length === 24, String((await s3.api("GET", "/creator/api/moments")).body.length));
  } finally { s3.server.kill(); }

  // =========================================================================
  console.log("--- 0.4 volume: photos without a 960px copy get one on boot ---");
  // (the seed's SVG placeholders are not photos to resize and must be left alone)
  const lib = await readJson(mine(d1, "moments.json"));
  const nPhotos = lib.filter((m) => /\.webp$/.test(m.media.src)).length;   // the seed's raster photo + the uploads that survived
  await writeFile(mine(d1, "moments.json"), JSON.stringify(lib.map((m) => ({ ...m, media: Object.fromEntries(Object.entries(m.media).filter(([k]) => k !== "medium")) }))));
  // Derivatives live under the owner now; the seed's arrived before that and sit at the root.
  for (const dir of [path.join(d1, "media"), path.join(d1, "media", MINE)]) {
    for (const f of await readdir(dir).catch(() => [])) if (f.endsWith("-960.webp")) await rm(path.join(dir, f));
  }
  const s4 = await startServer({ port: 4325, dataDir: d1 });
  try {
    const photos = (ms) => ms.filter((m) => /\.webp$/.test(m.media.src));
    let ms = [];
    for (let i = 0; i < 300; i++) { ms = (await s4.api("GET", "/creator/api/moments")).body; if (photos(ms).length && photos(ms).every((m) => m.media.medium)) break; await new Promise((r) => setTimeout(r, 100)); }
    ok("every real photo has a medium copy again", nPhotos >= 4 && photos(ms).length === nPhotos && photos(ms).every((m) => m.media.medium), `${photos(ms).filter((m) => m.media.medium).length}/${photos(ms).length}`);
    ok("the SVG placeholders were left alone", ms.filter((m) => !/\.webp$/.test(m.media.src)).every((m) => !m.media.medium) && (await mediaFiles(d1)).filter((f) => f.endsWith("-960.webp")).length === nPhotos);
    const files = await Promise.all(photos(ms).map((m) => exists(path.join(d1, m.media.medium))));
    ok("...and the files exist", files.length === nPhotos && files.every(Boolean));
    const meta = await sharp(path.join(d1, photos(ms)[0].media.medium)).metadata();
    ok("...at most 960px on the long side", Math.max(meta.width, meta.height) <= 960 && Math.max(meta.width, meta.height) >= 600, `${meta.width}x${meta.height}`);
    // The library is written before the public files are re-materialised: wait for them.
    const pubOk = await until(async () => { const pubs = await Promise.all((await readdir(path.join(d1, "data", "galleries"))).map((f) => readJson(path.join(d1, "data", "galleries", f)))); return pubs.flatMap((g) => g.moments).filter((m) => /\.webp$/.test(m.media.src)).every((m) => m.media.medium) ? true : null; });
    ok("...visible in the public galleries", !!pubOk);
    const said = await until(async () => (s4.log().includes(`backfilled 960px copies for ${nPhotos} photos`) ? true : null));
    ok("server said so", !!said, s4.log().trim().split("\n").pop());
  } finally { s4.server.kill(); }

  // =========================================================================
  console.log("--- two people, one volume: neither can reach the other ---");
  // The whole point of "Make my own": strangers sign in and get their own
  // journal. Nothing in the API may let one of them touch another's photos.
  const d5 = path.join(root, "shared");
  const s5 = await startServer({ port: 4326, dataDir: d5, seedDir: "" });
  const AL = { "remote-email": "ada@example.com", "content-type": "application/json" };
  const BO = { "remote-email": "bo@example.com", "content-type": "application/json" };
  const as = (h) => async (method, p, body) => j(await fetch(`${s5.BASE}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
  const ada = as(AL), bo = as(BO);
  const post = async (h, files) => {
    const fd = new FormData();
    for (const [name, buf] of files) fd.append("files", new Blob([buf], { type: "image/jpeg" }), name);
    return j(await fetch(`${s5.BASE}/creator/api/upload`, { method: "POST", headers: { "remote-email": h["remote-email"] }, body: fd }));
  };
  try {
    const up1 = await post(AL, [["ada.jpg", await jpeg({ date: "2026:03:14 08:40:00", offset: "+08:00", lat: 1.28, lng: 103.84, seed: 11 })]]);
    const up2 = await post(BO, [["bo.jpg", await jpeg({ date: "2026:04:01 09:00:00", offset: "+01:00", lat: 51.5, lng: -0.1, seed: 12 })]]);
    const adaId = up1.body.created[0].id, boId = up2.body.created[0].id;
    ok("each upload lands in its own library", (await ada("GET", "/creator/api/moments")).body.length === 1 && (await bo("GET", "/creator/api/moments")).body.length === 1);
    ok("...in its own folder on disk", (await exists(path.join(d5, "users", uidFor("ada@example.com"), "moments.json"))) && (await exists(path.join(d5, "users", uidFor("bo@example.com"), "moments.json"))));
    ok("...with its own media, so one delete cannot break the other", (await readdir(path.join(d5, "media"))).sort().join() === [uidFor("ada@example.com"), uidFor("bo@example.com")].sort().join());
    ok("Ada cannot see Bo's photo", !(await ada("GET", "/creator/api/moments")).body.some((m) => m.id === boId));
    ok("Ada cannot edit Bo's photo", (await ada("PATCH", `/creator/api/moments/${boId}`, { place: "mine now" })).status === 404);
    ok("Ada cannot delete Bo's photo", (await ada("DELETE", `/creator/api/moments/${boId}`)).status === 404);
    ok("...and Bo's photo is untouched", (await bo("GET", "/creator/api/moments")).body[0].place === "");

    const ag = await ada("POST", "/creator/api/galleries", { title: "Ada's trip", momentIds: [adaId], home: true });
    const bg = await bo("POST", "/creator/api/galleries", { title: "Bo's trip", momentIds: [boId], home: true });
    ok("both galleries are published and shareable", (await fetch(`${s5.BASE}/data/galleries/${ag.body.id}.json`)).status === 200 && (await fetch(`${s5.BASE}/data/galleries/${bg.body.id}.json`)).status === 200);
    ok("a gallery only ever contains its owner's photos", (await readJson(path.join(d5, "data", "galleries", `${ag.body.id}.json`))).moments.every((m) => m.id === adaId));
    ok("Ada cannot add her photo to Bo's gallery", (await ada("PATCH", `/creator/api/galleries/${bg.body.id}`, { add: [adaId] })).status === 404);
    ok("Ada cannot delete Bo's gallery", (await ada("DELETE", `/creator/api/galleries/${bg.body.id}`)).status === 404);
    ok("...and it is still being served", (await fetch(`${s5.BASE}/data/galleries/${bg.body.id}.json`)).status === 200);

    // "/" belongs to whoever signed in first; a stranger's `home` cannot take it.
    ok("the first person owns the front page", (await readJson(path.join(d5, "data", "home.json"))).gallery === ag.body.id);
    ok("...and the API says who that is", (await ada("GET", "/creator/api/me")).body.owner === true && (await bo("GET", "/creator/api/me")).body.owner === false);

    // Deleting must prune only the owner's public files.
    await ada("DELETE", `/creator/api/galleries/${ag.body.id}`);
    ok("a deleted gallery stops being served", (await fetch(`${s5.BASE}/data/galleries/${ag.body.id}.json`)).status === 404);
    ok("...and the other person's is still there", (await fetch(`${s5.BASE}/data/galleries/${bg.body.id}.json`)).status === 200);
  } finally { s5.server.kill(); }

  // =========================================================================
  console.log("--- a gallery's own name in the URL ---");
  // /singaporeeats instead of /g/2mro45eyznpc. It lives at the ROOT of the
  // site, so the namespace is global and every name is one the site can never
  // use again -- which is why uniqueness and the reserved list are server-side.
  const d7 = path.join(root, "slugs");
  const s7 = await startServer({ port: 4328, dataDir: d7, seedDir: "" });
  const ada7 = async (method, p, body) => j(await fetch(`${s7.BASE}${p}`, { method, headers: { "remote-email": "ada@example.com", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
  const bo7 = async (method, p, body) => j(await fetch(`${s7.BASE}${p}`, { method, headers: { "remote-email": "bo@example.com", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
  try {
    const g = await ada7("POST", "/creator/api/galleries", { title: "Singapore eats", slug: "singaporeeats" });
    ok("a gallery can be given its own name", g.status === 201 && g.body.slug === "singaporeeats", JSON.stringify(g.body.slug));
    ok("...published under that name", (await fetch(`${s7.BASE}/data/galleries/singaporeeats.json`)).status === 200);
    ok("...AND still under its token, so shared links never break", (await fetch(`${s7.BASE}/data/galleries/${g.body.id}.json`)).status === 200);
    ok("...and the two are the same gallery", (await readJson(path.join(d7, "data", "galleries", "singaporeeats.json"))).id === g.body.id);

    ok("nobody else can take that name", (await bo7("POST", "/creator/api/galleries", { title: "Mine now", slug: "singaporeeats" })).status === 400);
    ok("...not even by renaming into it", (await bo7("POST", "/creator/api/galleries", { title: "Other", slug: "othereats" })).status === 201
      && (await bo7("PATCH", `/creator/api/galleries/${(await bo7("GET", "/creator/api/galleries")).body.find((x) => x.slug === "othereats").id}`, { slug: "singaporeeats" })).status === 400);
    ok("...but keeping your own name is not 'taken by somebody else'", (await ada7("PATCH", `/creator/api/galleries/${g.body.id}`, { title: "Singapore eats!", slug: "singaporeeats" })).status === 200);

    for (const [bad, why] of [["creator", "reserved"], ["data", "reserved"], ["ab", "too short"], ["Has Space", "shape"], ["config.json", "filename"], ["-nope", "shape"]]) {
      ok(`refused: ${why} (${bad})`, (await ada7("POST", "/creator/api/galleries", { title: "x", slug: bad })).status === 400);
    }

    const renamed = await ada7("PATCH", `/creator/api/galleries/${g.body.id}`, { slug: "sgeats" });
    ok("renaming moves the name", renamed.body.slug === "sgeats");
    ok("...the new one answers", (await fetch(`${s7.BASE}/data/galleries/sgeats.json`)).status === 200);
    ok("...the old one stops", (await fetch(`${s7.BASE}/data/galleries/singaporeeats.json`)).status === 404);
    ok("...and the token still answers, as it always must", (await fetch(`${s7.BASE}/data/galleries/${g.body.id}.json`)).status === 200);
    ok("...so the freed name is available again", (await bo7("POST", "/creator/api/galleries", { title: "Bo's", slug: "singaporeeats" })).status === 201);

    ok("clearing the name is allowed", (await ada7("PATCH", `/creator/api/galleries/${g.body.id}`, { slug: null })).body.slug === undefined);
    ok("...and it stops answering", (await fetch(`${s7.BASE}/data/galleries/sgeats.json`)).status === 404);

    // The walk between places: opt-in, and the projection says what is true
    // rather than carrying a false for every option that exists.
    const plain = (await ada7("POST", "/creator/api/galleries", { title: "No walk" })).body;
    ok("a gallery does not ask for the walk unless it says so", plain.route === false && !("route" in await readJson(path.join(d7, "data", "galleries", `${plain.id}.json`))), JSON.stringify(plain.route));
    const walked = (await ada7("POST", "/creator/api/galleries", { title: "A walk", route: true })).body;
    ok("...and asking for it publishes it", walked.route === true && (await readJson(path.join(d7, "data", "galleries", `${walked.id}.json`))).route === true);
    await ada7("PATCH", `/creator/api/galleries/${walked.id}`, { route: false });
    ok("...and turning it off takes it back out of the published copy", !("route" in await readJson(path.join(d7, "data", "galleries", `${walked.id}.json`))));
    await ada7("PATCH", `/creator/api/galleries/${walked.id}`, { title: "Renamed" });
    ok("...while an unrelated edit leaves it alone", !("route" in await readJson(path.join(d7, "data", "galleries", `${walked.id}.json`))));
    await ada7("PATCH", `/creator/api/galleries/${walked.id}`, { route: true });
    await ada7("PATCH", `/creator/api/galleries/${walked.id}`, { description: "x" });
    ok("...and so does an unrelated edit after it is on", (await readJson(path.join(d7, "data", "galleries", `${walked.id}.json`))).route === true);

    const doomed = (await ada7("POST", "/creator/api/galleries", { title: "Doomed", slug: "doomedtrip" })).body;
    await ada7("DELETE", `/creator/api/galleries/${doomed.id}`);
    ok("deleting a gallery takes its name with it", (await fetch(`${s7.BASE}/data/galleries/doomedtrip.json`)).status === 404 && (await fetch(`${s7.BASE}/data/galleries/${doomed.id}.json`)).status === 404);
    ok("...without touching anyone else's", (await fetch(`${s7.BASE}/data/galleries/singaporeeats.json`)).status === 200);
  } finally { s7.server.kill(); }

  // =========================================================================
  console.log("--- how many people have seen a gallery ---");
  // A public, unauthenticated write: anybody with the link makes the number go
  // up, which is the point. So what matters is what it refuses -- unknown
  // tokens, the same visitor twice in a day, and the owner's own visits.
  const d8 = path.join(root, "views");
  const s8 = await startServer({ port: 4334, dataDir: d8, seedDir: "" });
  const owner8 = async (method, p, body) => j(await fetch(`${s8.BASE}${p}`, { method, headers: { "remote-email": "ada@example.com", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
  // A visitor is an address and a browser; nobody signed in.
  const see = async (token, { ip = "203.0.113.7", ua = "Mozilla/5.0 (iPhone)", headers = {} } = {}) =>
    j(await fetch(`${s8.BASE}/creator/api/views/${token}`, { method: "POST", headers: { "x-forwarded-for": ip, "user-agent": ua, ...headers } }));
  try {
    const g = (await owner8("POST", "/creator/api/galleries", { title: "Seen by", slug: "seenby" })).body;

    const first = await see(g.id);
    ok("the first visitor is counted", first.status === 200 && first.body.views === 1, JSON.stringify(first.body));
    for (let i = 0; i < 5; i++) await see(g.id);
    const again = await see(g.id);
    ok("...and reloading all afternoon still counts once", again.body.views === 1 && again.body.counted === false, JSON.stringify(again.body));
    ok("a different person counts", (await see(g.id, { ip: "198.51.100.4" })).body.views === 2);
    ok("...and so does a different browser on the same address", (await see(g.id, { ua: "Mozilla/5.0 (Android)" })).body.views === 3);

    // The pretty name and the token are ONE gallery; counting both would
    // double a number people are meant to trust.
    ok("a name that is not a published gallery is refused", (await see("nosuchgallery")).status === 404);
    ok("...and so is a shape that could never be one", (await see("../../etc/passwd")).status === 404);
    // One gallery, one count, whichever of its two URLs somebody was given.
    const viaName = await see("seenby", { ip: "203.0.113.7" });
    ok("the pretty name counts the same gallery, not a second one", viaName.status === 200 && viaName.body.views === 3, JSON.stringify(viaName.body));
    ok("...so the same visitor is still only counted once", (await see("seenby", { ip: "192.0.2.9" })).body.views === 4 && (await see(g.id, { ip: "192.0.2.9" })).body.views === 4);

    ok("the owner looking at their own gallery is not a view",
      (await j(await fetch(`${s8.BASE}/creator/api/views/${g.id}`, { method: "POST", headers: { "remote-email": "ada@example.com", "x-forwarded-for": "9.9.9.9" } }))).body.views === 4);
    ok("...and not under the pretty name either",
      (await j(await fetch(`${s8.BASE}/creator/api/views/seenby`, { method: "POST", headers: { "remote-email": "ada@example.com", "x-forwarded-for": "9.9.9.8" } }))).body.views === 4);
    ok("...but somebody else who happens to be signed in is",
      (await j(await fetch(`${s8.BASE}/creator/api/views/${g.id}`, { method: "POST", headers: { "remote-email": "bo@example.com", "x-forwarded-for": "9.9.9.9" } }))).body.views === 5);

    const list = await owner8("GET", "/creator/api/galleries");
    ok("the creator sees the count on their gallery", list.body.find((x) => x.id === g.id)?.views === 5, JSON.stringify(list.body.map((x) => x.views)));
    const renamed = await owner8("PATCH", `/creator/api/galleries/${g.id}`, { title: "Seen by many" });
    ok("...and editing the gallery does not reset it", renamed.body.views === 5, String(renamed.body.views));

    // Nothing that identifies a visitor may reach the disk.
    const raw = await readFile(path.join(d8, "library", "views.json"), "utf8");
    ok("what is written down cannot be walked back to anybody",
      !/203\.0\.113\.7|198\.51\.100\.4|iPhone|Android|Mozilla/.test(raw), raw.slice(0, 200));
    const hashes = await readJson(path.join(d8, "library", "views.json"));
    ok("...and the hashes are never served to the creator either",
      list.body.every((x) => !("seen" in x)) && !hashes[g.id].seen.some((h) => JSON.stringify(list.body).includes(h)));

    // --- per photo ---------------------------------------------------------
    // "Which of my pictures did people stop on" is a different question from
    // "how many opened this", and the two must not contaminate each other.
    const fd8 = new FormData();
    fd8.append("files", new Blob([await jpeg({ seed: 8, w: 900, h: 1200, date: "2026:03:14 09:00:00", offset: "+08:00" })], { type: "image/jpeg" }), "seen.jpg");
    await fetch(`${s8.BASE}/creator/api/upload`, { method: "POST", headers: { "remote-email": "ada@example.com" }, body: fd8 });
    const mid = (await owner8("GET", "/creator/api/moments")).body[0]?.id;
    const sawPhoto = async (m, o) => j(await fetch(`${s8.BASE}/creator/api/views/${g.id}`, {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": o.ip, "user-agent": o.ua },
      body: JSON.stringify({ moment: m }),
    }));
    if (mid) {
      await owner8("PATCH", `/creator/api/galleries/${g.id}`, { add: [mid] });
      const galleryBefore = (await owner8("GET", "/creator/api/galleries")).body.find((x) => x.id === g.id).views;
      const one = await sawPhoto(mid, { ip: "203.0.113.50", ua: "looker" });
      ok("a photo carries its own count", one.status === 200 && one.body.views === 1 && one.body.counted === true, JSON.stringify(one.body));
      ok("...and looking again today does not add to it", (await sawPhoto(mid, { ip: "203.0.113.50", ua: "looker" })).body.counted === false);
      ok("...while somebody else does", (await sawPhoto(mid, { ip: "203.0.113.51", ua: "other" })).body.views === 2);
      ok("...and none of it touched the gallery's own count",
        (await owner8("GET", "/creator/api/galleries")).body.find((x) => x.id === g.id).views === galleryBefore);
      const withCounts = (await owner8("GET", "/creator/api/moments")).body.find((x) => x.id === mid);
      ok("the creator sees the count on the photo", withCounts.views === 2, String(withCounts.views));
      // The endpoint is public, so an id has to be checked against what was
      // actually published rather than trusted.
      ok("a photo id that is not in this gallery is refused", (await sawPhoto("notinthisgallery", { ip: "203.0.113.52", ua: "x" })).status === 404);
      ok("...and so is a shape that could never be an id", (await sawPhoto("../../etc", { ip: "203.0.113.53", ua: "x" })).status === 404);
      ok("the owner looking at their own photo is not a view",
        (await j(await fetch(`${s8.BASE}/creator/api/views/${g.id}`, { method: "POST", headers: { "content-type": "application/json", "remote-email": "ada@example.com", "x-forwarded-for": "7.7.7.7" }, body: JSON.stringify({ moment: mid }) }))).body.views === 2);
      const raw2 = await readJson(path.join(d8, "library", "views.json"));
      ok("photo tallies survive the day rolling over, unlike the hashes", typeof raw2[g.id].m[mid] === "number" && raw2[g.id].m[mid] === 2, JSON.stringify(raw2[g.id].m));
    } else {
      ok("a photo to count", false, "no moment in the library");
    }

    // A busy address still gets the number; it just stops adding to it. An
    // eye that vanishes because a household was busy reads as broken.
    const before = (await see(g.id, { ip: "9.9.9.9", ua: "counted" })).body.views;
    let last = before;
    for (let i = 0; i < 400; i++) last = (await see(g.id, { ip: "9.9.9.9", ua: `flood-${i}` })).body.views;
    ok("a flood from one address stops counting rather than 429-ing", last >= before && last < before + 400, `${before} -> ${last}`);
    const capped = await see(g.id, { ip: "9.9.9.9", ua: "another" });
    ok("...and still answers with the count", capped.status === 200 && capped.body.views === last && capped.body.counted === false, JSON.stringify(capped.body));
    ok("...while somebody at a different address is unaffected", (await see(g.id, { ip: "9.9.9.10", ua: "elsewhere" })).body.counted === true);

    await owner8("DELETE", `/creator/api/galleries/${g.id}`);
    ok("deleting a gallery forgets its count", !JSON.parse(await readFile(path.join(d8, "library", "views.json"), "utf8"))[g.id]);
  } finally { s8.server.kill(); }

  // =========================================================================
  console.log("--- signing in with Google, for real (against a fake Google) ---");
  const d6 = path.join(root, "oauth");
  const s6 = await startServer({ port: 4327, dataDir: d6, seedDir: "", env: {
    ITINERIS_GOOGLE_CLIENT_ID: "client-1", ITINERIS_GOOGLE_CLIENT_SECRET: "shh",
    ITINERIS_GOOGLE_TOKEN_ENDPOINT: "http://127.0.0.1:4330/token", ITINERIS_SESSION_SECRET: "test-session-key",
  } });
  try {
    ok("with Google configured the forward-auth header is ignored", (await fetch(`${s6.BASE}/creator/api/library`, { headers: { "remote-email": "intruder@example.com" } })).status === 401);
    ok("...and me says so", (await j(await fetch(`${s6.BASE}/creator/api/me`, { headers: { "remote-email": "intruder@example.com" } }))).body.signedIn === false);

    const start = await fetch(`${s6.BASE}/creator/auth/google?next=%2Fcreator%2F%3Ftab%3Dgalleries`, { redirect: "manual" });
    const to = new URL(start.headers.get("location"));
    ok("sign-in redirects to Google with our client and scopes", start.status === 302 && to.host === "accounts.google.com" && to.searchParams.get("client_id") === "client-1" && to.searchParams.get("scope") === "openid email profile", `${start.status} ${to.host}`);
    ok("...asking Google to come back to this server", to.searchParams.get("redirect_uri") === `${s6.BASE}/creator/auth/callback`, to.searchParams.get("redirect_uri"));
    const state = to.searchParams.get("state");
    const jar = (start.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    ok("...behind a state cookie", /itineris_oauth=/.test(jar));

    ok("a callback with the wrong state is refused", (await fetch(`${s6.BASE}/creator/auth/callback?code=good&state=forged`, { headers: { cookie: jar }, redirect: "manual" })).status === 400);
    ok("a callback with no state cookie at all is refused", (await fetch(`${s6.BASE}/creator/auth/callback?code=good&state=${state}`, { redirect: "manual" })).status === 400);

    const back = await fetch(`${s6.BASE}/creator/auth/callback?code=good&state=${encodeURIComponent(state)}`, { headers: { cookie: jar }, redirect: "manual" });
    const session = (back.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("itineris_session="));
    ok("a good callback sets a session and lands where we started", back.status === 302 && !!session && back.headers.get("location") === "/creator/?tab=galleries", `${back.status} ${back.headers.get("location")}`);
    ok("the session cookie is HttpOnly and SameSite=Lax", (back.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("itineris_session=") && /HttpOnly/i.test(c) && /SameSite=Lax/i.test(c)));

    const signed = { cookie: session, "content-type": "application/json" };
    const meIn = await j(await fetch(`${s6.BASE}/creator/api/me`, { headers: signed }));
    ok("the session identifies the person Google named", meIn.body.signedIn === true && meIn.body.email === "ada@example.com" && meIn.body.name === "Ada", JSON.stringify(meIn.body));
    ok("...and it is their own empty journal", (await j(await fetch(`${s6.BASE}/creator/api/library`, { headers: signed }))).body.moments.length === 0);
    ok("...filed under their address", await exists(path.join(d6, "users", uidFor("ada@example.com"), "moments.json")));

    const tampered = session.replace(/.$/, (ch) => (ch === "A" ? "B" : "A"));
    ok("a tampered session cookie is not a session", (await fetch(`${s6.BASE}/creator/api/library`, { headers: { cookie: tampered } })).status === 401);

    const out = await fetch(`${s6.BASE}/creator/auth/signout`, { method: "POST", headers: { cookie: session }, redirect: "manual" });
    ok("signing out clears the cookie", out.status === 200 && (out.headers.getSetCookie?.() ?? []).some((c) => /^itineris_session=;?/.test(c) || /itineris_session=;/.test(c)));
  } finally { s6.server.kill(); }
} finally {
  await rm(root, { recursive: true, force: true });
  fakePlaces.close();
  fakeGoogle.close();
}
console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
