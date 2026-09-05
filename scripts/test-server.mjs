// Live test of the admin server: forges JPEGs with real EXIF/GPS, uploads them
// through the HTTP API, curates galleries, and checks what lands on disk --
// in the private library AND in the public projections nginx would serve.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, access, rm, mkdir, cp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import piexif from "piexifjs";

const WHO = "tester@example.com";
let fail = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "  ok  " : "  FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!cond) fail++; };
const exists = (p) => access(p).then(() => true, () => false);
const H = { "remote-email": WHO };
const JH = { ...H, "content-type": "application/json" };
const j = async (r) => ({ status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() });
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

piexif.TAGS.Exif[36881] = { name: "OffsetTimeOriginal", type: "Ascii" };
async function jpeg({ date, offset, lat, lng, w = 2000, h = 1500, seed = 0 }) {
  const raw = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 40 + seed * 20, g: 60, b: 120 } } }).jpeg({ quality: 70 }).toBuffer();
  const exif = { "0th": { [piexif.ImageIFD.Make]: "TestCam", [piexif.ImageIFD.Model]: `T${seed}` }, Exif: {}, GPS: {} };
  if (date) exif.Exif[piexif.ExifIFD.DateTimeOriginal] = date;
  if (offset) exif.Exif[36881] = offset;
  if (lat !== undefined) {
    exif.GPS[piexif.GPSIFD.GPSLatitudeRef] = lat >= 0 ? "N" : "S"; exif.GPS[piexif.GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDmsRational(Math.abs(lat));
    exif.GPS[piexif.GPSIFD.GPSLongitudeRef] = lng >= 0 ? "E" : "W"; exif.GPS[piexif.GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDmsRational(Math.abs(lng));
  }
  return Buffer.from(piexif.insert(piexif.dump(exif), raw.toString("binary")), "binary");
}

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
    ok("public projection keeps what the viewer needs", ["id", "t", "lat", "lng", "place", "caption", "tags", "media"].every((k) => k in gf.moments[0]) && "thumb" in gf.moments[0].media);

    const p = await s1.api("PATCH", `/admin/api/galleries/${gid}`, { add: [b.id, c.id], remove: [a.id], title: "Family" });
    ok("PATCH add/remove/title", p.status === 200 && p.body.title === "Family" && p.body.momentIds.sort().join() === [b.id, c.id].sort().join());
    gf = await readJson(path.join(d1, "data", "galleries", `${gid}.json`));
    ok("public file follows the edit", gf.moments.map((m) => m.id).sort().join() === [b.id, c.id].sort().join() && gf.title === "Family");
    ok("a photo can be in two galleries", (await s1.api("GET", "/admin/api/moments")).body.find((m) => m.id === c.id).galleries.length === 2);

    const home = await s1.api("PATCH", `/admin/api/galleries/${gid}`, { home: true });
    ok("home moves to the new gallery", home.body.home === true && (await readJson(path.join(d1, "data", "home.json"))).gallery === gid);
    ok("...and off the old one", (await s1.api("GET", "/admin/api/galleries")).body.filter((x) => x.home).length === 1);

    // --- edits propagate to every public copy ---
    const bulk = await s1.api("PATCH", "/admin/api/moments", { ids: [b.id, c.id], addTags: ["Food", "night"], place: "Lau Pa Sat" });
    ok("bulk PATCH updates 2", bulk.body.updated === 2);
    gf = await readJson(path.join(d1, "data", "galleries", `${gid}.json`));
    ok("bulk edit visible in the public gallery", gf.moments.every((m) => m.tags.includes("food") && m.place === "Lau Pa Sat"));
    const single = await s1.api("PATCH", `/admin/api/moments/${c.id}`, { caption: "Satay after dark", lat: 1.28, lng: 103.85, t: "2026-03-16T20:00:00+08:00" });
    ok("single PATCH returns memberships", single.status === 200 && single.body.galleries.length === 2 && single.body.tz === "manual");
    ok("PATCH rejects naive time", (await s1.api("PATCH", `/admin/api/moments/${c.id}`, { t: "2026-03-16T20:00:00" })).status === 400);
    ok("bulk without ids -> 400", (await s1.api("PATCH", "/admin/api/moments", { addTags: ["x"] })).status === 400);
    const demo = await readJson(path.join(d1, "data", "galleries", "sg2026demo.json"));
    ok("...and in the other gallery that holds it", demo.moments.find((m) => m.id === c.id)?.caption === "Satay after dark");

    // --- delete: moment leaves every gallery; gallery delete keeps photos ---
    const del = await s1.api("DELETE", `/admin/api/moments/${c.id}`);
    ok("DELETE moment keeps original, removes derivatives", del.status === 200 && (await exists(path.join(d1, c.media.original))) && !(await exists(path.join(d1, c.media.src))));
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
    ok("library intact: 20 seed + a + b", (await s3.api("GET", "/admin/api/moments")).body.length === 22);
  } finally { s3.server.kill(); }
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
