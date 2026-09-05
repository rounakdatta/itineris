// End-to-end in a real (headless) Chromium: nginx serving the built site with
// the admin's data volume linked in exactly as production shares it, the admin
// server behind a forged identity header, and puppeteer walking the actual user
// journeys on a phone-sized viewport. Screenshots land in $SCRATCH/shots.
import { spawn, execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launch, shot, tap, swipe, sleep, text, count, tapAt, resolveBrowserEnv } from "./browser.mjs";
import { startAuthProxy } from "./lib/authproxy.mjs";
import { fakeJpeg } from "./lib/fakejpeg.mjs";

const ROOT = process.cwd();
const SCRATCH = process.env.SCRATCH ?? mkdtempSync(path.join(tmpdir(), "itineris-e2e-"));
const SHOTS = path.join(SCRATCH, "shots"); mkdirSync(SHOTS, { recursive: true });
const env = resolveBrowserEnv(SCRATCH);
const NIX = "nix --extra-experimental-features nix-command --extra-experimental-features flakes";
const NGINX_STORE = execSync(`${NIX} build nixpkgs#nginx --no-link --print-out-paths`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").pop();
const V = "http://127.0.0.1:4331", ADMIN_PORT = 4332, A = "http://127.0.0.1:4333";   // A = auth proxy in front of the admin
const WHO = "e2e@example.com";
let fail = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "  ok  " : "  FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!cond) fail++; };
const hash = (page) => page.evaluate(() => location.hash);
const clickText = (page, sel, t) => page.evaluate((s, txt) => { const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim().startsWith(txt)); if (el) el.click(); return !!el; }, sel, t);
// Screenshots taken the instant after a layout change can capture a stale
// compositor tile in headless Chromium; let it settle, and let the map finish.
const settle = async (page, { map = false } = {}) => { if (map) await page.waitForSelector('.map[data-idle="1"]', { timeout: 30000 }).catch(() => {}); await sleep(450); };
// Tap a tile after scrolling it to the middle of the viewport, clear of the fixed bars.
const tapEl = async (page, handle) => { await handle.evaluate((el) => el.scrollIntoView({ block: "center" })); await sleep(120); await handle.tap(); };
const waitFor = async (page, fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn)) return true; await sleep(100); } return false; };

// --- admin server with a fresh data dir -------------------------------------
const dataDir = path.join(SCRATCH, "e2e-data"); rmSync(dataDir, { recursive: true, force: true });
const admin = spawn(process.execPath, ["server/index.js"], { env: { ...process.env, ITINERIS_PORT: "4332", ITINERIS_DATA_DIR: dataDir, ITINERIS_SEED_DIR: "seed", ITINERIS_ADMIN_UI_DIR: "dist-admin" }, stdio: ["ignore", "pipe", "pipe"] });
let adminLog = ""; admin.stdout.on("data", (d) => (adminLog += d)); admin.stderr.on("data", (d) => (adminLog += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${ADMIN_PORT}/admin/healthz`)).ok) break; } catch {} await sleep(100); }
const proxy = await startAuthProxy({ port: 4333, target: ADMIN_PORT, email: WHO });

// --- nginx on a docroot that is dist/ plus the admin's data + media -----------
// (production mounts the same volume into nginx; a symlink farm is the local twin)
const nd = path.join(SCRATCH, "e2e-nginx"); rmSync(nd, { recursive: true, force: true });
for (const d of ["conf", "logs", "tmp", "docroot"]) mkdirSync(path.join(nd, d), { recursive: true });
for (const f of readdirSync(path.join(ROOT, "dist"))) if (!["data", "media"].includes(f)) symlinkSync(path.join(ROOT, "dist", f), path.join(nd, "docroot", f));
symlinkSync(path.join(dataDir, "data"), path.join(nd, "docroot", "data"));
symlinkSync(path.join(dataDir, "media"), path.join(nd, "docroot", "media"));
writeFileSync(path.join(nd, "conf", "security-headers.conf"), readFileSync(path.join(ROOT, "nginx/security-headers.conf")));
writeFileSync(path.join(nd, "conf", "default.conf"), readFileSync(path.join(ROOT, "nginx/default.conf"), "utf8")
  .replace("/etc/nginx/security-headers.conf", path.join(nd, "conf", "security-headers.conf")).replaceAll("/etc/nginx/security-headers.conf", path.join(nd, "conf", "security-headers.conf"))
  .replace("root /usr/share/nginx/html;", `root ${path.join(nd, "docroot")};`).replace("listen 8080;", "listen 127.0.0.1:4331;"));
writeFileSync(path.join(nd, "conf", "nginx.conf"), `pid ${nd}/nginx.pid;\nerror_log ${nd}/logs/error.log;\nevents {}\nhttp {\n  include ${NGINX_STORE}/conf/mime.types;\n  access_log ${nd}/logs/access.log;\n  client_body_temp_path ${nd}/tmp; proxy_temp_path ${nd}/tmp; fastcgi_temp_path ${nd}/tmp; uwsgi_temp_path ${nd}/tmp; scgi_temp_path ${nd}/tmp;\n  include ${nd}/conf/default.conf;\n}\n`);
async function startNginx() {
  const p = spawn(path.join(NGINX_STORE, "bin", "nginx"), ["-c", path.join(nd, "conf", "nginx.conf"), "-p", nd, "-g", "daemon off;"], { stdio: "ignore" });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${V}/healthz`)).ok) break; } catch {} await sleep(100); }
  return p;
}
let nginx = await startNginx();

const { browser, page, problems } = await launch({ env });
page.setDefaultTimeout(20000);
let friendsId = null;
try {
  console.log("--- viewer: home gallery ---");
  await page.goto(`${V}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tick");
  ok("gallery title in the top bar", (await text(page, ".brand .title")) === "Singapore, March 2026", await text(page, ".brand .title"));
  ok("20 photos in the strip", (await count(page, ".tick")) === 20, String(await count(page, ".tick")));
  ok("facet chips with counts", /Spots\s*17/.test(await text(page, ".chrome nav")) && /Activities\s*7/.test(await text(page, ".chrome nav")), await text(page, ".chrome nav"));
  ok("day chips carry dates", /Day 1\s*14 Mar/.test(await text(page, ".days")), await text(page, ".days"));
  ok("no desktop zoom buttons on a phone", (await count(page, ".maplibregl-ctrl-zoom-in")) === 0);
  await settle(page, { map: true }); await shot(page, `${SHOTS}/01-viewer-home.png`);

  console.log("--- viewer: story by tap, swipe, back button ---");
  const ticks = await page.$$(".tick");
  await ticks[2].tap(); await sleep(300);
  ok("first tap focuses (no story yet)", (await page.$eval(".tick.on", (el) => el.dataset.id)) === "m003" && (await page.$(".story")) === null);
  await (await page.$(".tick.on")).tap();
  await page.waitForSelector(".story");
  ok("second tap opens the story, URL carries it", (await hash(page)) === "#m/m003", await hash(page));
  ok("story header: day + place + clock", /Day 1/.test(await text(page, ".story header")) && /Maxwell/.test(await text(page, ".story header")), await text(page, ".story header"));
  ok("story: thumbnail placeholder at once, full image fades in", (await page.$(".story img.placeholder")) !== null && (await page.waitForSelector(".story img.media.loaded", { timeout: 15000 }).then(() => true).catch(() => false)));
  await settle(page); await shot(page, `${SHOTS}/02-story.png`);
  await swipe(page, [300, 450], [70, 455]); await sleep(400);
  ok("swipe left -> next photo", (await hash(page)) === "#m/m004", await hash(page));
  await tapAt(page, 40, 450); await sleep(400);
  ok("tap left third -> previous", (await hash(page)) === "#m/m003", await hash(page));
  await tapAt(page, 300, 450); await sleep(400);
  ok("tap right -> next", (await hash(page)) === "#m/m004");
  await page.goBack(); await sleep(400);
  ok("phone back button closes the story", (await page.$(".story")) === null && (await hash(page)) === "", await hash(page));
  await (await page.$(".tick.on")).tap(); await page.waitForSelector(".story");
  await swipe(page, [200, 380], [205, 640]); await sleep(500);
  ok("swipe down closes", (await page.$(".story")) === null && (await hash(page)) === "");

  console.log("--- viewer: a story on a 2 KB/s link ---");
  // The photo's full copy takes ages; the thumbnail (already on screen in the
  // strip) must stand in at once, the spinner must show, and the 5 s timer must
  // not run until the photo has actually arrived. Never a dark screen.
  const cdp = await page.createCDPSession(); await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 300, downloadThroughput: 1500, uploadThroughput: 1500 });
  const slowTick = (await page.$$(".tick"))[12];   // m013: the seed's one real raster photo (400/960/1600 copies)
  ok("slow: the photo under test is a real photo, not a placeholder", (await slowTick.evaluate((el) => el.dataset.id)) === "m013" && (await slowTick.$eval("img", (i) => i.getAttribute("src"))) === "/media/m013-400.webp", await slowTick.$eval("img", (i) => i.getAttribute("src")));
  await slowTick.tap(); await sleep(250); await (await page.$(".tick.on")).tap(); await page.waitForSelector(".story");
  await sleep(1500);
  ok("slow: the sharp thumbnail is on screen immediately", await page.$eval(".story img.placeholder", (i) => i.complete && i.naturalWidth > 0 && getComputedStyle(i).opacity === "1"));
  ok("slow: the photo itself is still loading, and says so", (await page.$(".story img.media.loaded")) === null && (await page.$('.story .loading[role="status"]')) !== null);
  ok("slow: the story timer waits for the photo", (await page.$$eval(".story .fill", (fs) => fs.map((f) => f.style.width))).filter((w) => w !== "0%" && w !== "100%").length === 0, JSON.stringify(await page.$$eval(".story .fill", (fs) => fs.map((f) => f.style.width))));
  ok("slow: nothing on screen is the blurred backdrop alone", await page.evaluate(() => { const b = document.querySelector(".story img.backdrop"); const p = document.querySelector(".story img.placeholder"); return !b || (p && p.getBoundingClientRect().width > 0); }));
  await settle(page); await shot(page, `${SHOTS}/03-story-slow-link.png`);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await cdp.detach();
  ok("slow: the photo fades in once it arrives", await page.waitForSelector(".story img.media.loaded", { timeout: 20000 }).then(() => true).catch(() => false));
  await page.keyboard.press("Escape"); await sleep(300);

  console.log("--- viewer: deep link, wall, facet ---");
  await page.goto(`${V}/#m/m010`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".story");
  ok("a shared story link opens that story", /Spectra|Marina Bay Sands/.test(await text(page, ".story")), (await text(page, ".story header")).slice(0, 60));
  await page.keyboard.press("Escape"); await sleep(300);
  await tap(page, ".chrome .toggle"); await page.waitForSelector(".wall");
  ok("wall view, URL #wall", (await hash(page)) === "#wall" && (await count(page, ".wall .cell")) === 20);
  await settle(page); await shot(page, `${SHOTS}/03-wall.png`);
  await (await page.$$(".wall .cell"))[5].tap(); await page.waitForSelector(".story");
  await page.goBack(); await sleep(400);
  ok("back from a wall story returns to the wall", (await page.$(".story")) === null && (await hash(page)) === "#wall" && (await page.$(".wall")) !== null);
  await tap(page, ".chrome .toggle"); await sleep(300);
  await clickText(page, ".chrome nav .chip", "Activities"); await sleep(400);
  ok("facet narrows the strip to runs and rides", (await count(page, ".tick")) === 4, String(await count(page, ".tick")));
  await settle(page, { map: true }); await shot(page, `${SHOTS}/04-facet-activities.png`);
  await clickText(page, ".chrome nav .chip", "Activities"); await sleep(300);
  ok("...and back", (await count(page, ".tick")) === 20);
  await page.goto(`${V}/g/nope-not-real`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".card");
  ok("dead gallery link explains itself", /doesn't point to a gallery/.test(await text(page, ".card")));
  await settle(page); await shot(page, `${SHOTS}/05-notfound.png`);

  console.log("--- admin: photos, select, new gallery from selection ---");
  await page.goto(`${A}/admin/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".cell");
  ok("signed-in identity shown", (await text(page, "header")).includes(WHO));
  ok("20 photos, none private (all in the demo gallery)", (await count(page, ".cell")) === 20 && (await count(page, ".flag.private")) === 0);
  await settle(page); await shot(page, `${SHOTS}/10-admin-photos.png`);
  await clickText(page, ".toolbar button", "Select"); await sleep(200);
  const cells = await page.$$(".cell"); await tapEl(page, cells[0]); await tapEl(page, cells[1]); await sleep(200);
  ok("bulk bar counts the selection", (await text(page, ".bulk strong")) === "2 selected", await text(page, ".bulk strong"));
  await settle(page); await shot(page, `${SHOTS}/11-admin-select.png`);
  await clickText(page, ".bulk button", "Gallery"); await sleep(200);
  await page.select(".bulk select", "__new__");
  page.once("dialog", (d) => d.accept("Friends"));
  await clickText(page, ".bulk button", "Add");
  ok("new gallery appears in the filter", await waitFor(page, () => [...document.querySelectorAll(".filter option")].some((o) => /Friends \(2\)/.test(o.textContent))));

  console.log("--- admin: galleries tab ---");
  await clickText(page, ".tabs button", "Galleries"); await page.waitForSelector(".gallery");
  ok("two galleries listed", (await count(page, ".gallery")) === 2);
  const links = await page.$$eval(".gallery code", (els) => els.map((e) => e.textContent));
  friendsId = links.map((l) => l.match(/\/g\/([a-z0-9]+)$/)?.[1]).find((id) => id && id !== "sg2026demo");
  ok("Friends has an unguessable 12-char link", !!friendsId && friendsId.length === 12, friendsId ?? "none");
  ok("demo gallery is home", /home · shown at \//.test(await text(page, ".gallery.home h3")));
  await settle(page); await shot(page, `${SHOTS}/12-admin-galleries.png`);
  await page.evaluate((id) => { const card = [...document.querySelectorAll(".gallery")].find((g) => g.textContent.includes(id)); [...card.querySelectorAll("button")].find((b) => b.textContent.trim() === "Show photos").click(); }, friendsId);
  await page.waitForSelector(".cell");
  ok("Show photos filters to the gallery", (await count(page, ".cell")) === 2 && (await page.$eval(".filter select", (s) => s.value)) === friendsId);
  ok("leaving the context ended selection mode", (await page.$(".bulk")) === null && (await page.$$eval(".toolbar button", (bs) => bs.at(-1).textContent.trim())) === "Select");

  console.log("--- admin: editor ---");
  const editId = await page.$eval(".cell", (c) => c.dataset.id);
  const editRec = (await (await fetch(`${A}/admin/api/moments`, { headers: { "remote-email": WHO } })).json()).find((m) => m.id === editId);
  await (await page.$(".cell")).tap(); await page.waitForSelector(".sheet");
  ok("native time picker holds the photo's local time", (await page.$eval('.sheet input[type="datetime-local"]', (i) => i.value)) === editRec.t.slice(0, 16) && (await page.$eval(".sheet select", (s) => s.value)) === editRec.t.slice(-6), `${editId} ${editRec.t}`);
  ok("gallery checklist: in both", (await page.$$eval(".sheet .gal input", (is) => is.filter((i) => i.checked).length)) === 2);
  await settle(page); await shot(page, `${SHOTS}/13-admin-editor.png`);
  await clickText(page, ".sheet button", "Pick on map"); await page.waitForSelector(".picker canvas");
  ok("map picker renders", true);
  await sleep(2500); await shot(page, `${SHOTS}/14-admin-mappicker.png`);
  await page.evaluate(() => { const home = [...document.querySelectorAll(".sheet .gal")].find((l) => /home/.test(l.textContent)); home.querySelector("input").click(); });
  await clickText(page, ".sheet button", "Save");
  ok("save closes the editor", await waitFor(page, () => !document.querySelector(".sheet")));
  const lib = await (await fetch(`${A}/admin/api/moments`, { headers: { "remote-email": WHO } })).json();
  ok("membership persisted: the edited photo is now only in Friends", JSON.stringify(lib.find((m) => m.id === editId).galleries) === JSON.stringify([friendsId]), JSON.stringify(lib.find((m) => m.id === editId).galleries));

  console.log("--- admin: upload in bad conditions ---");
  const UP = path.join(SCRATCH, "e2e-uploads"); mkdirSync(UP, { recursive: true });
  writeFileSync(path.join(UP, "q1.jpg"), await fakeJpeg({ date: "2026:03:19 10:00:00", offset: "+08:00", lat: 1.29, lng: 103.85, seed: 7 }));
  writeFileSync(path.join(UP, "q2.jpg"), await fakeJpeg({ seed: 8, w: 1200, h: 1600 }));
  await clickText(page, ".tabs button", "Photos"); await page.waitForSelector('[data-testid="file-input"]');
  await page.select(".filter select", "all");   // otherwise uploads land in the filtered gallery, which is the feature
  const before = (await (await fetch(`${A}/admin/api/moments`, { headers: { "remote-email": WHO } })).json()).length;
  await page.setOfflineMode(true);
  await (await page.$('[data-testid="file-input"]')).uploadFile(path.join(UP, "q1.jpg"), path.join(UP, "q2.jpg"));
  ok("photos queued instantly while offline", await waitFor(page, () => document.querySelectorAll(".queue .tile").length === 2));
  ok("status: offline, 2 photos, will upload later", /Offline — 2 photos/.test(await text(page, ".queue .status")), await text(page, ".queue .status"));
  ok("thumbnails made on the device (no network involved)", await waitFor(page, () => { const im = [...document.querySelectorAll(".queue .tile img")]; return im.length === 2 && im.every((i) => i.complete && i.naturalWidth > 0); }));
  ok("header shows Offline", /Offline/.test(await text(page, "header")));
  await settle(page); await shot(page, `${SHOTS}/15-admin-queue-offline.png`);
  await (await page.$(".queue .tile .pick")).tap(); await page.waitForSelector(".sheet");
  ok("a queued photo opens in the editor, marked as waiting", /waiting to upload/.test(await text(page, ".sheet")));
  await page.type(".sheet textarea", "Tagged before it ever left the phone");
  await page.type('.sheet input[aria-label="Add a tag"]', "queued"); await page.keyboard.press("Enter");
  await clickText(page, ".sheet button", "Save");
  ok("annotation saved into the queue", await waitFor(page, () => !document.querySelector(".sheet") && /queued/.test(document.querySelector(".queue .tile .tags")?.textContent ?? "")));
  await clickText(page, ".queue .status button", "Retry now"); await sleep(700);
  ok("Retry while offline: still queued, still honest", (await count(page, ".queue .tile")) === 2 && /Offline/.test(await text(page, ".queue .status")), await text(page, ".queue .status"));
  // Network back, server unreachable for a while: the queue must retry on its own.
  proxy.state.failPattern = /\/admin\/api\/upload/;
  await page.setOfflineMode(false);
  ok("server unreachable: queue reports it is retrying automatically", await waitFor(page, () => /retrying|Connection trouble/.test(document.querySelector(".queue .status")?.textContent ?? ""), 20000), await text(page, ".queue .status"));
  await settle(page); await shot(page, `${SHOTS}/16-admin-queue-retrying.png`);
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector(".queue .tile", { timeout: 15000 });
  ok("the queue survives a reload (IndexedDB)", (await count(page, ".queue .tile")) === 2 && /queued/.test(await text(page, ".queue .tile .tags")));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.setOfflineMode(true); proxy.state.down = true;
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector(".queue .tile", { timeout: 15000 });
  ok("the admin itself opens OFFLINE: shell from the worker, library from the last copy, queue from IndexedDB", (await count(page, ".queue .tile")) === 2 && (await count(page, ".cell")) > 0 && /Offline|Saved copy/.test(await text(page, "header")));
  ok("OFFLINE: the library really came from the worker's saved copy", (await page.evaluate(() => fetch("/admin/api/library").then((r) => r.headers.get("x-itineris-cache")))) === "fallback");
  await settle(page); await shot(page, `${SHOTS}/17-admin-offline-reload.png`);
  proxy.state.down = false; await page.setOfflineMode(false);
  proxy.state.failPattern = null;
  await clickText(page, ".queue .status button", "Retry now");
  ok("uploads complete once the server is back", await waitFor(page, () => !document.querySelector(".queue"), 40000), await text(page, ".queue .status"));
  const libAfter = await (await fetch(`${A}/admin/api/moments`, { headers: { "remote-email": WHO } })).json();
  const q = libAfter.find((m) => m.caption === "Tagged before it ever left the phone");
  ok("arrived annotated: caption + tag from the queue, EXIF time kept", !!q && q.tags.includes("queued") && q.t === "2026-03-19T10:00:00+08:00", JSON.stringify(q && { tags: q.tags, t: q.t }));
  ok("both queued photos are in the library, private", libAfter.length === before + 2 && libAfter.filter((m) => m.galleries.length === 0).length >= 2, `${before} -> ${libAfter.length}`);
  ok("nothing left in the queue on a fresh load", (await page.reload({ waitUntil: "domcontentloaded" }), await page.waitForSelector(".cell"), (await page.$(".queue")) === null));

  console.log("--- photos without GPS: a gallery with no locations, then bulk Set location ---");
  const lib2 = await (await fetch(`${A}/admin/api/moments`, { headers: { "remote-email": WHO } })).json();
  const noGps = lib2.find((m) => m.lat === null && m.galleries.length === 0);
  ok("a photo arrived without GPS (as phones do)", !!noGps, noGps?.id);
  await page.select(".filter select", "all"); await clickText(page, ".toolbar button", "Select");
  await tapEl(page, await page.$(`.cell[data-id="${noGps.id}"]`));
  await clickText(page, ".bulk button", "Gallery"); await page.select(".bulk select", "__new__");
  page.once("dialog", (d) => d.accept("Nowhere in particular")); await clickText(page, ".bulk button", "Add");
  ok("gallery of one unplaced photo created", await waitFor(page, () => [...document.querySelectorAll(".filter option")].some((o) => /Nowhere in particular \(1\)/.test(o.textContent))));
  const nowhere = (await (await fetch(`${A}/admin/api/galleries`, { headers: { "remote-email": WHO } })).json()).find((g) => g.title === "Nowhere in particular");
  await page.goto(`${V}/g/${nowhere.id}`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".wall .cell", { timeout: 20000 });
  ok("a gallery with no locations opens on the wall", (await hash(page)) === "#wall");
  await tap(page, ".chrome .toggle"); await sleep(400);
  ok("...and its map says why it is empty (no city pretends to be the place)", /No locations yet/.test(await text(page, ".chrome .top")), await text(page, ".chrome .top"));
  await settle(page); await shot(page, `${SHOTS}/23-viewer-no-locations.png`);
  await page.goto(`${A}/admin/`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".cell");
  await page.select(".filter select", "all"); await clickText(page, ".toolbar button", "Select");
  await tapEl(page, await page.$(`.cell[data-id="${noGps.id}"]`));
  await clickText(page, ".bulk button", "Location"); await page.waitForSelector('.bulk input[aria-label="Latitude"]');
  await page.type('.bulk input[aria-label="Latitude"]', "37.7749"); await page.type('.bulk input[aria-label="Longitude"]', "-122.4194");
  await clickText(page, ".bulk button", "Apply to 1");
  ok("bulk Set location applied", await waitFor(page, () => !document.querySelector(".bulk .loc")));
  const placedNow = (await (await fetch(`${A}/admin/api/moments`, { headers: { "remote-email": WHO } })).json()).find((m) => m.id === noGps.id);
  ok("...and stored", Math.abs(placedNow.lat - 37.7749) < 1e-4 && Math.abs(placedNow.lng + 122.4194) < 1e-4, `${placedNow.lat},${placedNow.lng}`);
  await page.goto(`${V}/g/${nowhere.id}`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".tick", { timeout: 20000 });
  ok("now that gallery opens on the map, fitted to San Francisco", (await page.$(".wall")) === null && await waitFor(page, () => document.querySelector('.map[data-idle="1"]') !== null, 30000));
  await settle(page, { map: true }); await shot(page, `${SHOTS}/24-viewer-placed.png`);
  await clickText(page, ".tabs button", "Photos").catch(() => {});

  console.log("--- viewer: the new gallery, as a visitor sees it ---");
  await page.goto(`${V}/g/${friendsId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tick");
  ok("Friends gallery: title and exactly its 2 photos", (await text(page, ".brand .title")) === "Friends" && (await count(page, ".tick")) === 2, `${await text(page, ".brand .title")} / ${await count(page, ".tick")}`);
  await page.waitForFunction(() => [...document.querySelectorAll(".tick img")].every((i) => i.complete), { timeout: 10000 });
  ok("thumbnails really load under /g/<token> (absolute media URLs)", await page.$$eval(".tick img", (imgs) => imgs.length > 0 && imgs.every((i) => i.naturalWidth > 0)), await page.$$eval(".tick img", (imgs) => imgs.map((i) => i.getAttribute("src")).join(",")));
  await settle(page, { map: true }); await shot(page, `${SHOTS}/20-viewer-friends.png`);
  await page.goto(`${V}/`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".tick");
  ok("home gallery lost the photo moved out of it", (await count(page, ".tick")) === 19, String(await count(page, ".tick")));
  console.log("--- viewer: save for offline, then no network at all ---");
  await page.goto(`${V}/g/${friendsId}`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".tick");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector(".tick");   // now controlled by the worker
  await settle(page, { map: true });

  console.log("--- viewer: a new version arrives while the page is open ---");
  // This is the path that failed on a real phone: the worker precached the
  // megabyte of MapLibre, never finished installing on a slow link, and the old
  // shell kept being served. Now: MapLibre is cached on use, a new worker only
  // downloads the small shell, and the page offers a reload when it takes over.
  const cachedAssets = async () => page.evaluate(async () => (await (await caches.open("itineris-viewer-assets")).keys()).map((r) => new URL(r.url).pathname));
  ok("MapLibre was cached on first use, outside the versioned shell", (await cachedAssets()).some((u) => /maplibre-/.test(u)), JSON.stringify(await cachedAssets()));
  ok("...and the versioned shell is small", await page.evaluate(async () => { const k = (await caches.keys()).find((n) => n.startsWith("itineris-viewer-shell-")); return !(await (await caches.open(k)).keys()).some((r) => /maplibre-/.test(r.url)); }));
  const swFile = path.join(nd, "docroot", "sw.js");
  rmSync(swFile); writeFileSync(swFile, readFileSync(path.join(ROOT, "dist", "sw.js"), "utf8").replace(/version:"[0-9a-f]{12}"/, 'version:"e2eupdated001"'));
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  ok("the page offers a reload once the new worker has taken over", await waitFor(page, () => !!document.getElementById("itineris-update"), 20000));
  ok("the new version's shell is in place, the old one gone", await page.evaluate(async () => { const ks = await caches.keys(); return ks.includes("itineris-viewer-shell-e2eupdated001") && ks.filter((n) => n.startsWith("itineris-viewer-shell-")).length === 1; }), JSON.stringify(await page.evaluate(() => caches.keys())));
  ok("the photo the story shows on a phone is the 960px copy", await page.evaluate(async () => (await (await caches.open("itineris-media")).keys()).some((r) => /m013-960\.webp$/.test(r.url))), JSON.stringify(await page.evaluate(async () => (await (await caches.open("itineris-media")).keys()).map((r) => new URL(r.url).pathname))));
  ok("MapLibre did not have to be downloaded again", (await cachedAssets()).some((u) => /maplibre-/.test(u)));
  await settle(page); await shot(page, `${SHOTS}/20-viewer-update-toast.png`);
  await tap(page, "#itineris-update"); await page.waitForSelector(".tick"); await settle(page, { map: true });
  ok("reloaded onto the new version, no toast on a plain load", (await page.$("#itineris-update")) === null && (await count(page, ".tick")) === 2);
  await tap(page, '[aria-label="Save for offline"]'); await page.waitForSelector(".sheet");
  ok("sheet knows what it will fetch", /2 images/.test(await text(page, ".sheet")), await text(page, ".sheet"));
  await clickText(page, ".sheet button", "Save for offline");
  ok("saved: photos + map tiles", await waitFor(page, () => /Saved just now/.test(document.querySelector(".sheet")?.textContent ?? ""), 60000), await text(page, ".sheet"));
  await settle(page); await shot(page, `${SHOTS}/21-viewer-saved-offline.png`);
  await clickText(page, ".sheet button", "Close");
  await page.setOfflineMode(true); nginx.kill(); await sleep(400);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tick", { timeout: 20000 });
  ok("OFFLINE: the gallery opens from the saved copy", (await text(page, ".brand .title")) === "Friends" && (await count(page, ".tick")) === 2);
  ok("OFFLINE: the data really came from the worker's cache", (await page.evaluate((id) => fetch(`/data/galleries/${id}.json`).then((r) => r.headers.get("x-itineris-cache")), friendsId)) === "fallback");
  ok("OFFLINE: it says so", /Offline|Saved copy/.test(await text(page, ".chrome .top")), await text(page, ".chrome .top"));
  await page.waitForFunction(() => [...document.querySelectorAll(".tick img")].every((i) => i.complete), { timeout: 10000 });
  ok("OFFLINE: thumbnails come from the cache", await page.$$eval(".tick img", (imgs) => imgs.every((i) => i.naturalWidth > 0)));
  ok("OFFLINE: the map has its tiles", await waitFor(page, () => document.querySelector('.map[data-idle="1"]') !== null, 30000));
  await (await page.$(".tick")).tap(); await sleep(300); await (await page.$(".tick.on")).tap(); await page.waitForSelector(".story");
  ok("OFFLINE: the story opens with its photo", await page.$eval(".story img.media", (i) => i.complete && i.naturalWidth > 0));
  await settle(page); await shot(page, `${SHOTS}/22-viewer-offline.png`);
  await page.keyboard.press("Escape");
  await page.setOfflineMode(false); nginx = await startNginx();
  const pubFriends = await (await fetch(`${V}/data/galleries/${friendsId}.json`)).json();
  ok("public gallery JSON carries no private fields", !JSON.stringify(pubFriends).match(/uploadedBy|filename|camera|original/));
  const libTry = await fetch(`${V}/library/moments.json`);
  ok("manifest served as application/manifest+json", ((await fetch(`${V}/manifest.webmanifest`)).headers.get("content-type") ?? "").includes("manifest+json"));
  ok("the library itself is not reachable publicly", (await fetch(`${V}/data/moments.json`)).status === 404 && !(libTry.headers.get("content-type") ?? "").includes("json") && !(await libTry.text()).includes("uploadedBy"));
} catch (e) {
  fail++; console.log("  FAIL  exception:", e.message); await shot(page, `${SHOTS}/99-failure.png`).catch(() => {});
} finally {
  await browser.close(); nginx.kill(); admin.kill(); await proxy.close();
}
// The dead-link scenario 404s on purpose; the bad-network scenario makes uploads 502 and
// takes servers down on purpose.
const real = problems.filter((p) => !/favicon|nope-not-real|\/admin\/api\/upload|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_RESET|ERR_CONNECTION_REFUSED|status of 502|status of 503/.test(p));
console.log(`\nbrowser problems: ${real.length}`); for (const p of real) console.log("  ! " + p);
if (real.length) fail++;
console.log(fail ? `\n${fail} FAILED` : "\nall passed"); console.log(`shots: ${SHOTS}`);
process.exit(fail ? 1 : 0);
