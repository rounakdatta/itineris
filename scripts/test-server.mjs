// Live test of the admin server: forges JPEGs with real EXIF/GPS, uploads them
// through the HTTP API, curates galleries, and checks what lands on disk --
// in the private library AND in the public projections nginx would serve.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, access, rm, mkdir, cp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { fakeJpeg as jpeg } from "./lib/fakejpeg.mjs";

const WHO = "tester@example.com";
let fail = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "  ok  " : "  FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!cond) fail++; };
const exists = (p) => access(p).then(() => true, () => false);
const H = { "remote-email": WHO };
const JH = { ...H, "content-type": "application/json" };
const j = async (r) => ({ status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() });
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

// Starts a server on a fresh data dir (optionally pre-populated), returns helpers.
async function startServer({ port, dataDir, seedDir = "seed" }) {
  const server = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, ITINERIS_PORT: String(port), ITINERIS_DATA_DIR: dataDir, ITINERIS_SEED_DIR: seedDir, ITINERIS_ADMIN_UI_DIR: "dist-admin" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
  const BASE = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${BASE}/admin/healthz`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  const api = async (method, p, body, headers = JH) => j(await fetch(`${BASE}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const upload = async (files, extra = {}) => {
    const fd = new FormData();
    for (const [name, buf] of files) fd.append("files", new Blob([buf], { type: "image/jpeg" }), name);
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    return j(await fetch(`${BASE}/admin/api/upload`, { method: "POST", headers: H, body: fd }));
  };
  return { server, BASE, api, upload, log: () => log };
}

const root = await mkdtemp(path.join(process.env.SCRATCH ?? tmpdir(), "itineris-test-"));
try {
  // =========================================================================
  console.log("--- fresh volume, seeded ---");
  const d1 = path.join(root, "fresh");
  const s1 = await startServer({ port: 4322, dataDir: d1 });
  try {
    ok("server up, seeded from seed/", s1.log().includes("(seeded)"), s1.log().trim().split("\n").pop());
    ok("no identity -> 401", (await fetch(`${s1.BASE}/admin/api/me`)).status === 401);
    ok("healthz open", (await fetch(`${s1.BASE}/admin/healthz`)).status === 200);
    ok("root not served here", (await fetch(`${s1.BASE}/`)).status === 404);

    const lib = await s1.api("GET", "/admin/api/library");
    ok("library: 20 moments, 3 tracks, 1 gallery", lib.body.moments.length === 20 && lib.body.tracks.length === 3 && lib.body.galleries.length === 1, `${lib.body.moments.length}/${lib.body.tracks.length}/${lib.body.galleries.length}`);
    ok("moments carry their gallery memberships", lib.body.moments.every((m) => m.galleries?.[0] === "sg2026demo"));
    ok("public: no library file under data/", !(await exists(path.join(d1, "data", "moments.json"))) && (await exists(path.join(d1, "library", "moments.json"))));
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
    const bad = await s1.api("POST", "/admin/api/galleries", { title: "   " });
    ok("gallery without title -> 400", bad.status === 400);
    const g = await s1.api("POST", "/admin/api/galleries", { title: "For the family", description: "Just the food", momentIds: [a.id, "nope"] });
    ok("gallery created with a random token id", g.status === 201 && /^[a-z0-9]{12}$/.test(g.body.id) && g.body.count === 1, `${g.body.id} count=${g.body.count}`);
    const gid = g.body.id;
    ok("unknown ids are dropped", !g.body.momentIds.includes("nope"));
    let gf = await readJson(path.join(d1, "data", "galleries", `${gid}.json`));
    ok("public file materialised with 1 moment", gf.moments.length === 1 && gf.moments[0].id === a.id && gf.title === "For the family");
    const PRIVATE = ["uploadedBy", "uploadedAt", "editedBy", "filename", "camera", "original", "createdBy"];
    const leaked = PRIVATE.filter((k) => JSON.stringify(gf).includes(`"${k}"`));
    ok("public projection leaks nothing private", leaked.length === 0, leaked.join(",") || "clean");
    ok("public projection keeps what the viewer needs", ["id", "t", "lat", "lng", "place", "caption", "tags", "media"].every((k) => k in gf.moments[0]) && "thumb" in gf.moments[0].media && "medium" in gf.moments[0].media);

    const p = await s1.api("PATCH", `/admin/api/galleries/${gid}`, { add: [b.id, c.id], remove: [a.id], title: "Family" });
    ok("PATCH add/remove/title", p.status === 200 && p.body.title === "Family" && p.body.momentIds.sort().join() === [b.id, c.id].sort().join());
    gf = await readJson(path.join(d1, "data", "galleries", `${gid}.json`));
    ok("public file follows the edit", gf.moments.map((m) => m.id).sort().join() === [b.id, c.id].sort().join() && gf.title === "Family");
    ok("a photo can be in two galleries", (await s1.api("GET", "/admin/api/moments")).body.find((m) => m.id === c.id).galleries.length === 2);

    const home = await s1.api("PATCH", `/admin/api/galleries/${gid}`, { home: true });
    ok("home moves to the new gallery", home.body.home === true && (await readJson(path.join(d1, "data", "home.json"))).gallery === gid);
    ok("...and off the old one", (await s1.api("GET", "/admin/api/galleries")).body.filter((x) => x.home).length === 1);

    // --- annotated upload: what a phone's queue sends after captioning offline ---
    const D = await jpeg({ date: "2026:03:19 10:00:00", offset: "+08:00", lat: 1.29, lng: 103.85, seed: 4 });
    const fdMeta = new FormData(); fdMeta.append("files", new Blob([D], { type: "image/jpeg" }), "d.jpg");
    fdMeta.append("meta", JSON.stringify({ caption: "  From the queue ", place: "Tiong Bahru", tags: ["Queued", "food", "queued"], galleries: [gid, "nope"] }));
    const upM = await j(await fetch(`${s1.BASE}/admin/api/upload`, { method: "POST", headers: H, body: fdMeta }));
    const d = upM.body.created?.[0];
    ok("meta applied at creation: caption trimmed, tags cleaned, place", upM.status === 200 && d?.caption === "From the queue" && d.tags.join() === "queued,food" && d.place === "Tiong Bahru", JSON.stringify(d && { c: d.caption, t: d.tags, p: d.place }));
    ok("meta without lat/lng/t keeps the file's own EXIF", d?.t === "2026-03-19T10:00:00+08:00" && d.tz === "exif" && Math.abs(d.lat - 1.29) < 1e-3, `${d?.t} ${d?.tz} ${d?.lat}`);
    ok("meta.galleries lands it in the gallery (unknown ids ignored)", (await readJson(path.join(d1, "data", "galleries", `${gid}.json`))).moments.some((m) => m.id === d.id));
    const fdBad = new FormData(); fdBad.append("files", new Blob([D], { type: "image/jpeg" }), "d.jpg"); fdBad.append("meta", JSON.stringify({ t: "2026-03-19T10:00" }));
    ok("meta with a naive time -> 400, nothing stored", (await fetch(`${s1.BASE}/admin/api/upload`, { method: "POST", headers: H, body: fdBad })).status === 400);
    const fdJunk = new FormData(); fdJunk.append("files", new Blob([D], { type: "image/jpeg" }), "d.jpg"); fdJunk.append("meta", "{not json");
    ok("meta that is not JSON -> 400", (await fetch(`${s1.BASE}/admin/api/upload`, { method: "POST", headers: H, body: fdJunk })).status === 400);

    // --- edits propagate to every public copy ---
    const bulk = await s1.api("PATCH", "/admin/api/moments", { ids: [b.id, c.id], addTags: ["Food", "night"], place: "Lau Pa Sat" });
    ok("bulk PATCH updates 2", bulk.body.updated === 2);
    gf = await readJson(path.join(d1, "data", "galleries", `${gid}.json`));
    ok("bulk edit visible in the public gallery", gf.moments.filter((m) => [b.id, c.id].includes(m.id)).every((m) => m.tags.includes("food") && m.place === "Lau Pa Sat"));
    const single = await s1.api("PATCH", `/admin/api/moments/${c.id}`, { caption: "Satay after dark", lat: 1.28, lng: 103.85, t: "2026-03-16T20:00:00+08:00" });
    ok("single PATCH returns memberships", single.status === 200 && single.body.galleries.length === 2 && single.body.tz === "manual");
    ok("PATCH rejects naive time", (await s1.api("PATCH", `/admin/api/moments/${c.id}`, { t: "2026-03-16T20:00:00" })).status === 400);
    ok("bulk without ids -> 400", (await s1.api("PATCH", "/admin/api/moments", { addTags: ["x"] })).status === 400);
    const bl = await s1.api("PATCH", "/admin/api/moments", { ids: [b.id, c.id], lat: 37.7749, lng: -122.4194 });
    const placed = (await s1.api("GET", "/admin/api/moments")).body.filter((m) => [b.id, c.id].includes(m.id));
    ok("bulk Set location places every selected photo", bl.body.updated === 2 && placed.every((m) => Math.abs(m.lat - 37.7749) < 1e-6 && Math.abs(m.lng + 122.4194) < 1e-6));
    ok("bulk location needs both coordinates", (await s1.api("PATCH", "/admin/api/moments", { ids: [b.id], lat: 1 })).status === 400);
    const demo = await readJson(path.join(d1, "data", "galleries", "sg2026demo.json"));
    ok("...and in the other gallery that holds it", demo.moments.find((m) => m.id === c.id)?.caption === "Satay after dark");

    // --- Google Maps links: the exact place in, the exact link out ---
    ok("resolve-link refuses non-Google links", (await s1.api("GET", "/admin/api/resolve-link?url=https%3A%2F%2Fexample.com%2Fx")).status === 400);
    const FULL = "https://www.google.com/maps/place/Lau+Pa+Sat/@1.2806,103.8505,17z/data=!3m1!4b1!4m6!3m5!1s0x31da190d3c6fd7a3:0x9a0f1d6f2a2b3c4d!8m2!3d1.280638!4d103.850453!16s%2Fg%2F1td6l0mq?entry=ttu";
    const CID_URL = `https://maps.google.com/?cid=${BigInt("0x9a0f1d6f2a2b3c4d")}`;
    const rl = await s1.api("GET", `/admin/api/resolve-link?url=${encodeURIComponent(FULL)}`);
    ok("resolve-link reads name, the place's coordinates and a stable link out of a full URL (no network)", rl.status === 200 && rl.body.name === "Lau Pa Sat" && rl.body.lat === 1.280638 && rl.body.lng === 103.850453 && rl.body.mapsUrl === CID_URL, JSON.stringify(rl.body));
    ok("PATCH rejects a non-Google mapsUrl", (await s1.api("PATCH", `/admin/api/moments/${b.id}`, { mapsUrl: "https://example.com/place" })).status === 400);
    const linked = await s1.api("PATCH", `/admin/api/moments/${b.id}`, { lat: 1.280638, lng: 103.850453, place: "Lau Pa Sat", mapsUrl: CID_URL });
    ok("PATCH stores the exact link", linked.status === 200 && linked.body.mapsUrl === CID_URL);
    ok("...and the public gallery carries it", (await readJson(path.join(d1, "data", "galleries", `${gid}.json`))).moments.find((m) => m.id === b.id)?.mapsUrl === CID_URL);
    await s1.api("PATCH", "/admin/api/moments", { ids: [b.id], lat: 1.29, lng: 103.86 });
    ok("a bulk spot without a link drops the stale link", (await s1.api("GET", "/admin/api/moments")).body.find((m) => m.id === b.id).mapsUrl === null);
    const bl2 = await s1.api("PATCH", "/admin/api/moments", { ids: [b.id], lat: 1.280638, lng: 103.850453, mapsUrl: CID_URL, place: "Lau Pa Sat" });
    ok("bulk sets spot + link + name together", bl2.body.updated === 1 && (await s1.api("GET", "/admin/api/moments")).body.find((m) => m.id === b.id).mapsUrl === CID_URL);
    ok("bulk rejects a non-Google link", (await s1.api("PATCH", "/admin/api/moments", { ids: [b.id], mapsUrl: "https://example.com/" })).status === 400);

    // --- delete: moment leaves every gallery; gallery delete keeps photos ---
    const del = await s1.api("DELETE", `/admin/api/moments/${c.id}`);
    ok("DELETE moment keeps original, removes derivatives", del.status === 200 && (await exists(path.join(d1, c.media.original))) && !(await exists(path.join(d1, c.media.src))) && !(await exists(path.join(d1, c.media.medium))));
    gf = await readJson(path.join(d1, "data", "galleries", `${gid}.json`));
    ok("deleted moment gone from public galleries", !gf.moments.some((m) => m.id === c.id) && !(await readJson(path.join(d1, "data", "galleries", "sg2026demo.json"))).moments.some((m) => m.id === c.id));
    const gdel = await s1.api("DELETE", `/admin/api/galleries/${gid}`);
    ok("DELETE gallery removes its public file", gdel.status === 200 && !(await exists(path.join(d1, "data", "galleries", `${gid}.json`))));
    ok("...and home.json since it was home", !(await exists(path.join(d1, "data", "home.json"))));
    ok("...but the photos remain in the library", (await s1.api("GET", "/admin/api/moments")).body.some((m) => m.id === b.id));
    ok("DELETE unknown gallery -> 404", (await s1.api("DELETE", "/admin/api/galleries/zzzzzzzzzzzz")).status === 404);

    // --- UI ---
    ok("admin UI served + gated", (await fetch(`${s1.BASE}/admin/`, { headers: H })).status === 200 && (await fetch(`${s1.BASE}/admin/`)).status === 401);
    ok("admin UI SPA fallback", (await fetch(`${s1.BASE}/admin/galleries`, { headers: H })).status === 200);
    ok("public data served for local dev", (await fetch(`${s1.BASE}/data/galleries/sg2026demo.json`)).status === 200);
  } finally { s1.server.kill(); }

  // =========================================================================
  console.log("--- existing 0.2 volume: migrate to library + home gallery ---");
  const d2 = path.join(root, "legacy");
  await mkdir(path.join(d2, "data"), { recursive: true });
  const seedMoments = await readJson("seed/library/moments.json");
  await writeFile(path.join(d2, "data", "moments.json"), JSON.stringify(seedMoments.slice(0, 5)));
  await writeFile(path.join(d2, "data", "tracks.json"), JSON.stringify(await readJson("seed/library/tracks.json")));
  await cp("seed/media", path.join(d2, "media"), { recursive: true });
  const s2 = await startServer({ port: 4323, dataDir: d2 });
  try {
    ok("server reports migration", s2.log().includes("(migrated)"), s2.log().trim().split("\n").pop());
    ok("public moments.json is GONE", !(await exists(path.join(d2, "data", "moments.json"))) && !(await exists(path.join(d2, "data", "tracks.json"))));
    ok("library holds the 5 moments", (await readJson(path.join(d2, "library", "moments.json"))).length === 5);
    const gs = (await s2.api("GET", "/admin/api/galleries")).body;
    ok("one home gallery with everything", gs.length === 1 && gs[0].home && gs[0].count === 5 && gs[0].trackCount === 3 && /^[a-z0-9]{12}$/.test(gs[0].id), JSON.stringify(gs.map((g) => [g.id, g.count])));
    ok("home.json points at it; its public file has the 5", (await readJson(path.join(d2, "data", "home.json"))).gallery === gs[0].id && (await readJson(path.join(d2, "data", "galleries", `${gs[0].id}.json`))).moments.length === 5);
  } finally { s2.server.kill(); }

  // =========================================================================
  console.log("--- restart on an existing 0.3 volume: nothing changes, stale public files heal ---");
  await writeFile(path.join(d1, "data", "galleries", "stale.json"), "{}");
  const s3 = await startServer({ port: 4324, dataDir: d1 });
  try {
    ok("server reports existing", s3.log().includes("(existing)"));
    ok("stale public gallery file removed on boot", !(await exists(path.join(d1, "data", "galleries", "stale.json"))));
    ok("library intact: 20 seed + a + b + d", (await s3.api("GET", "/admin/api/moments")).body.length === 23);
  } finally { s3.server.kill(); }

  // =========================================================================
  console.log("--- 0.4 volume: photos without a 960px copy get one on boot ---");
  // (the seed's SVG placeholders are not photos to resize and must be left alone)
  const lib = await readJson(path.join(d1, "library", "moments.json"));
  const nPhotos = lib.filter((m) => /\.webp$/.test(m.media.src)).length;   // the seed's raster photo + the uploads that survived
  await writeFile(path.join(d1, "library", "moments.json"), JSON.stringify(lib.map((m) => ({ ...m, media: Object.fromEntries(Object.entries(m.media).filter(([k]) => k !== "medium")) }))));
  for (const f of await readdir(path.join(d1, "media"))) if (f.endsWith("-960.webp")) await rm(path.join(d1, "media", f));
  const s4 = await startServer({ port: 4325, dataDir: d1 });
  try {
    const photos = (ms) => ms.filter((m) => /\.webp$/.test(m.media.src));
    let ms = [];
    for (let i = 0; i < 300; i++) { ms = (await s4.api("GET", "/admin/api/moments")).body; if (photos(ms).length && photos(ms).every((m) => m.media.medium)) break; await new Promise((r) => setTimeout(r, 100)); }
    ok("every real photo has a medium copy again", nPhotos >= 4 && photos(ms).length === nPhotos && photos(ms).every((m) => m.media.medium), `${photos(ms).filter((m) => m.media.medium).length}/${photos(ms).length}`);
    ok("the SVG placeholders were left alone", ms.filter((m) => !/\.webp$/.test(m.media.src)).every((m) => !m.media.medium) && (await readdir(path.join(d1, "media"))).filter((f) => f.endsWith("-960.webp")).length === nPhotos);
    const files = await Promise.all(photos(ms).map((m) => exists(path.join(d1, m.media.medium))));
    ok("...and the files exist", files.length === nPhotos && files.every(Boolean));
    const meta = await sharp(path.join(d1, photos(ms)[0].media.medium)).metadata();
    ok("...at most 960px on the long side", Math.max(meta.width, meta.height) <= 960 && Math.max(meta.width, meta.height) >= 600, `${meta.width}x${meta.height}`);
    const pubs = await Promise.all((await readdir(path.join(d1, "data", "galleries"))).map((f) => readJson(path.join(d1, "data", "galleries", f))));
    ok("...visible in the public galleries", pubs.flatMap((g) => g.moments).filter((m) => /\.webp$/.test(m.media.src)).every((m) => m.media.medium));
    ok("server said so", s4.log().includes(`backfilled 960px copies for ${nPhotos} photos`), s4.log().trim().split("\n").pop());
  } finally { s4.server.kill(); }
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
