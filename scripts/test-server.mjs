// Live test of the admin server: forges JPEGs with real EXIF/GPS, uploads them
// through the HTTP API and checks what lands on disk and in moments.json.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import piexif from "piexifjs";

const PORT = 4322, BASE = `http://127.0.0.1:${PORT}`, WHO = "tester@example.com";
const dir = await mkdtemp(path.join(process.env.SCRATCH ?? tmpdir(), "itineris-test-"));
const dataDir = path.join(dir, "data");
let fail = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "  ok  " : "  FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!cond) fail++; };
const exists = (p) => access(p).then(() => true, () => false);
const H = { "remote-email": WHO };
const j = async (r) => ({ status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() });

// piexifjs predates EXIF 2.31; teach it OffsetTimeOriginal so we can write it.
piexif.TAGS.Exif[36881] = { name: "OffsetTimeOriginal", type: "Ascii" };
async function jpeg({ date, offset, lat, lng, w = 2000, h = 1500, seed = 0 }) {
  const raw = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 40 + seed * 20, g: 60, b: 120 } } }).jpeg({ quality: 70 }).toBuffer();
  const exif = { "0th": { [piexif.ImageIFD.Make]: "TestCam", [piexif.ImageIFD.Model]: `T${seed}` }, Exif: {}, GPS: {} };
  if (date) exif.Exif[piexif.ExifIFD.DateTimeOriginal] = date;
  if (offset) exif.Exif[36881] = offset;
  if (lat !== undefined) {
    exif.GPS[piexif.GPSIFD.GPSLatitudeRef] = lat >= 0 ? "N" : "S";
    exif.GPS[piexif.GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDmsRational(Math.abs(lat));
    exif.GPS[piexif.GPSIFD.GPSLongitudeRef] = lng >= 0 ? "E" : "W";
    exif.GPS[piexif.GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDmsRational(Math.abs(lng));
  }
  const withExif = piexif.insert(piexif.dump(exif), raw.toString("binary"));
  return Buffer.from(withExif, "binary");
}
const upload = async (files, headers = H) => {
  const fd = new FormData();
  for (const [name, buf] of files) fd.append("files", new Blob([buf], { type: "image/jpeg" }), name);
  return j(await fetch(`${BASE}/admin/api/upload`, { method: "POST", headers, body: fd }));
};

const server = spawn(process.execPath, ["server/index.js"], {
  env: { ...process.env, ITINERIS_PORT: String(PORT), ITINERIS_DATA_DIR: dataDir, ITINERIS_SEED_DIR: "public", ITINERIS_ADMIN_UI_DIR: "dist-admin" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${BASE}/admin/healthz`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  ok("server up, seeded from public/", log.includes("(seeded)"), log.trim().split("\n").pop());

  // --- auth ---
  ok("no identity header -> 401", (await fetch(`${BASE}/admin/api/me`)).status === 401);
  ok("healthz needs no identity", (await fetch(`${BASE}/admin/healthz`)).status === 200);
  const me = await j(await fetch(`${BASE}/admin/api/me`, { headers: H }));
  ok("identity echoed", me.body.email === WHO, JSON.stringify(me.body));
  ok("public root is not served here", (await fetch(`${BASE}/`)).status === 404);

  // --- seed ---
  const seed = await j(await fetch(`${BASE}/admin/api/moments`, { headers: H }));
  ok("20 seed moments", seed.body.length === 20, String(seed.body.length));

  // --- upload three photos: full EXIF / GPS-only / nothing ---
  const A = await jpeg({ date: "2026:03:14 08:40:12", offset: "+08:00", lat: 1.2829, lng: 103.8443, seed: 1 });
  const B = await jpeg({ date: "2026:03:15 06:35:00", lat: 1.2868, lng: 103.8545, seed: 2 });        // no offset -> tz from GPS (Asia/Singapore)
  const C = await jpeg({ seed: 3, w: 1200, h: 1600 });                                                // no EXIF at all
  const up = await upload([["a.jpg", A], ["b.jpg", B], ["c.jpg", C]]);
  ok("upload 200 with 3 created", up.status === 200 && up.body.created?.length === 3, `status=${up.status} created=${up.body.created?.length} errors=${JSON.stringify(up.body.errors)}`);
  const [a, b, c] = up.body.created ?? [];
  ok("A: t from EXIF date + offset", a?.t === "2026-03-14T08:40:12+08:00" && a.tz === "exif", `${a?.t} ${a?.tz}`);
  ok("A: GPS decoded", Math.abs(a?.lat - 1.2829) < 1e-3 && Math.abs(a?.lng - 103.8443) < 1e-3, `${a?.lat},${a?.lng}`);
  ok("A: camera", a?.camera === "TestCam T1", a?.camera);
  ok("B: offset derived from GPS zone", b?.t === "2026-03-15T06:35:00+08:00" && b.tz === "gps", `${b?.t} ${b?.tz}`);
  ok("C: no EXIF -> upload time, tz unknown, no coords", c?.tz === "unknown" && c.lat === null && c.lng === null && /\+00:00$/.test(c.t), `${c?.t} ${c?.tz} ${c?.lat}`);
  ok("new moments start untagged, uncaptioned", a?.tags.length === 0 && a.caption === "" && a.place === "");
  ok("A: derivative dims 1600x1200, thumb path", a?.media.w === 1600 && a.media.h === 1200 && a.media.thumb.endsWith("-400.webp"), `${a?.media.w}x${a?.media.h}`);
  ok("C: portrait keeps orientation 1200x1600", c?.media.w === 1200 && c.media.h === 1600, `${c?.media.w}x${c?.media.h}`);
  for (const rel of [a.media.original, a.media.src, a.media.thumb]) ok(`file exists: ${rel}`, await exists(path.join(dataDir, rel)));
  const dmeta = await sharp(path.join(dataDir, a.media.src)).metadata();
  ok("A: derivative carries NO EXIF", !dmeta.exif, `format=${dmeta.format}`);
  const tmeta = await sharp(path.join(dataDir, a.media.thumb)).metadata();
  ok("A: thumb 400x300", tmeta.width === 400 && tmeta.height === 300, `${tmeta.width}x${tmeta.height}`);

  // --- idempotency ---
  const again = await upload([["a-again.jpg", A]]);
  ok("same bytes again -> duplicate, nothing created", again.body.created?.length === 0 && again.body.duplicates?.length === 1 && again.body.duplicates[0].id === a.id);

  // --- edit ---
  const p1 = await j(await fetch(`${BASE}/admin/api/moments/${a.id}`, { method: "PATCH", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ tags: ["Food", "night", "food"], caption: "  Satay after dark ", place: "Lau Pa Sat" }) }));
  ok("PATCH tags dedup+lowercase, caption trimmed", p1.status === 200 && p1.body.tags.join() === "food,night" && p1.body.caption === "Satay after dark" && p1.body.place === "Lau Pa Sat", JSON.stringify(p1.body.tags));
  const p2 = await j(await fetch(`${BASE}/admin/api/moments/${c.id}`, { method: "PATCH", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ lat: 1.3, lng: 103.9, t: "2026-03-16T14:00:00+08:00" }) }));
  ok("PATCH coords + manual time", p2.status === 200 && p2.body.lat === 1.3 && p2.body.t === "2026-03-16T14:00:00+08:00" && p2.body.tz === "manual");
  ok("PATCH rejects naive time", (await fetch(`${BASE}/admin/api/moments/${c.id}`, { method: "PATCH", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ t: "2026-03-16T14:00:00" }) })).status === 400);
  ok("PATCH rejects half a coordinate", (await fetch(`${BASE}/admin/api/moments/${c.id}`, { method: "PATCH", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ lat: 1, lng: null }) })).status === 400);
  ok("PATCH unknown id -> 404", (await fetch(`${BASE}/admin/api/moments/nope`, { method: "PATCH", headers: { ...H, "content-type": "application/json" }, body: "{}" })).status === 404);

  // --- persistence: what nginx would serve ---
  const disk = JSON.parse(await readFile(path.join(dataDir, "data", "moments.json"), "utf8"));
  ok("moments.json has 23 entries", disk.length === 23, String(disk.length));
  ok("moments.json sorted by t", disk.every((m, i) => i === 0 || disk[i - 1].t <= m.t));
  ok("edit persisted to disk", disk.find((m) => m.id === a.id)?.tags.join() === "food,night");

  // --- delete keeps the original ---
  const del = await j(await fetch(`${BASE}/admin/api/moments/${b.id}`, { method: "DELETE", headers: H }));
  ok("DELETE removes derivatives, keeps original", del.status === 200 && !(await exists(path.join(dataDir, b.media.src))) && !(await exists(path.join(dataDir, b.media.thumb))) && (await exists(path.join(dataDir, b.media.original))));
  ok("deleted moment gone from list", !(await j(await fetch(`${BASE}/admin/api/moments`, { headers: H }))).body.some((m) => m.id === b.id));

  // --- UI ---
  const ui = await fetch(`${BASE}/admin/`, { headers: H }); const html = await ui.text();
  ok("admin UI served", ui.status === 200 && /<title>/.test(html));
  ok("admin UI SPA fallback", (await fetch(`${BASE}/admin/moments/${a.id}`, { headers: H })).status === 200);
  ok("admin UI also gated", (await fetch(`${BASE}/admin/`)).status === 401);
  ok("media served for local dev", (await fetch(`${BASE}/${a.media.thumb}`)).status === 200);
} finally {
  server.kill();
  await rm(dir, { recursive: true, force: true });
}
console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
