// End-to-end in a real (headless) Chromium: nginx serving the built site with
// the admin's data volume linked in exactly as production shares it, the admin
// server behind a forged identity header, and puppeteer walking the actual user
// journeys on a phone-sized viewport. Screenshots land in $SCRATCH/shots.
import { spawn, execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launch, shot, tap, swipe, sleep, text, count, resolveBrowserEnv } from "./browser.mjs";

const ROOT = process.cwd();
const SCRATCH = process.env.SCRATCH ?? mkdtempSync(path.join(tmpdir(), "itineris-e2e-"));
const SHOTS = path.join(SCRATCH, "shots"); mkdirSync(SHOTS, { recursive: true });
const env = resolveBrowserEnv(SCRATCH);
const NIX = "nix --extra-experimental-features nix-command --extra-experimental-features flakes";
const NGINX_STORE = execSync(`${NIX} build nixpkgs#nginx --no-link --print-out-paths`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").pop();
const V = "http://127.0.0.1:4331", A = "http://127.0.0.1:4332";
const WHO = "e2e@example.com";
let fail = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "  ok  " : "  FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!cond) fail++; };
const hash = (page) => page.evaluate(() => location.hash);
const clickText = (page, sel, t) => page.evaluate((s, txt) => { const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim().startsWith(txt)); if (el) el.click(); return !!el; }, sel, t);
const waitFor = async (page, fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn)) return true; await sleep(100); } return false; };

// --- admin server with a fresh data dir -------------------------------------
const dataDir = path.join(SCRATCH, "e2e-data"); rmSync(dataDir, { recursive: true, force: true });
const admin = spawn(process.execPath, ["server/index.js"], { env: { ...process.env, ITINERIS_PORT: "4332", ITINERIS_DATA_DIR: dataDir, ITINERIS_SEED_DIR: "seed", ITINERIS_ADMIN_UI_DIR: "dist-admin" }, stdio: ["ignore", "pipe", "pipe"] });
let adminLog = ""; admin.stdout.on("data", (d) => (adminLog += d)); admin.stderr.on("data", (d) => (adminLog += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${A}/admin/healthz`)).ok) break; } catch {} await sleep(100); }

// --- nginx on a docroot that is dist/ plus the admin's data + media -----------
// (production mounts the same volume into nginx; a symlink farm is the local twin)
const nd = path.join(SCRATCH, "e2e-nginx"); rmSync(nd, { recursive: true, force: true });
for (const d of ["conf", "logs", "tmp", "docroot"]) mkdirSync(path.join(nd, d), { recursive: true });
for (const f of ["index.html", "assets"]) symlinkSync(path.join(ROOT, "dist", f), path.join(nd, "docroot", f));
symlinkSync(path.join(dataDir, "data"), path.join(nd, "docroot", "data"));
symlinkSync(path.join(dataDir, "media"), path.join(nd, "docroot", "media"));
writeFileSync(path.join(nd, "conf", "security-headers.conf"), readFileSync(path.join(ROOT, "nginx/security-headers.conf")));
writeFileSync(path.join(nd, "conf", "default.conf"), readFileSync(path.join(ROOT, "nginx/default.conf"), "utf8")
  .replace("/etc/nginx/security-headers.conf", path.join(nd, "conf", "security-headers.conf")).replaceAll("/etc/nginx/security-headers.conf", path.join(nd, "conf", "security-headers.conf"))
  .replace("root /usr/share/nginx/html;", `root ${path.join(nd, "docroot")};`).replace("listen 8080;", "listen 127.0.0.1:4331;"));
writeFileSync(path.join(nd, "conf", "nginx.conf"), `pid ${nd}/nginx.pid;\nerror_log ${nd}/logs/error.log;\nevents {}\nhttp {\n  include ${NGINX_STORE}/conf/mime.types;\n  access_log ${nd}/logs/access.log;\n  client_body_temp_path ${nd}/tmp; proxy_temp_path ${nd}/tmp; fastcgi_temp_path ${nd}/tmp; uwsgi_temp_path ${nd}/tmp; scgi_temp_path ${nd}/tmp;\n  include ${nd}/conf/default.conf;\n}\n`);
const nginx = spawn(path.join(NGINX_STORE, "bin", "nginx"), ["-c", path.join(nd, "conf", "nginx.conf"), "-p", nd, "-g", "daemon off;"], { stdio: "ignore" });
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${V}/healthz`)).ok) break; } catch {} await sleep(100); }

const { browser, page, problems } = await launch({ env, identity: { origin: A, email: WHO } });
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
  await sleep(2500);   // let tiles land for the screenshot
  await shot(page, `${SHOTS}/01-viewer-home.png`);

  console.log("--- viewer: story by tap, swipe, back button ---");
  const ticks = await page.$$(".tick");
  await ticks[2].tap(); await sleep(300);
  ok("first tap focuses (no story yet)", (await page.$eval(".tick.on", (el) => el.dataset.id)) === "m003" && (await page.$(".story")) === null);
  await (await page.$(".tick.on")).tap();
  await page.waitForSelector(".story");
  ok("second tap opens the story, URL carries it", (await hash(page)) === "#m/m003", await hash(page));
  ok("story header: day + place + clock", /Day 1/.test(await text(page, ".story header")) && /Maxwell/.test(await text(page, ".story header")), await text(page, ".story header"));
  await shot(page, `${SHOTS}/02-story.png`);
  await swipe(page, [300, 450], [70, 455]); await sleep(400);
  ok("swipe left -> next photo", (await hash(page)) === "#m/m004", await hash(page));
  await page.evaluate(() => { window.__pe = []; const s = document.querySelector(".story"); for (const t of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) s.addEventListener(t, (ev) => window.__pe.push([t, Math.round(ev.clientX), Math.round(performance.now())])); });
  await page.touchscreen.tap(40, 450); await sleep(400);
  ok("tap left third -> previous", (await hash(page)) === "#m/m003", `${await hash(page)} events=${JSON.stringify(await page.evaluate(() => window.__pe))}`);
  await page.touchscreen.tap(300, 450); await sleep(400);
  ok("tap right -> next", (await hash(page)) === "#m/m004");
  await page.goBack(); await sleep(400);
  ok("phone back button closes the story", (await page.$(".story")) === null && (await hash(page)) === "", await hash(page));
  await (await page.$(".tick.on")).tap(); await page.waitForSelector(".story");
  await swipe(page, [200, 380], [205, 640]); await sleep(500);
  ok("swipe down closes", (await page.$(".story")) === null && (await hash(page)) === "");

  console.log("--- viewer: deep link, wall, facet ---");
  await page.goto(`${V}/#m/m010`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".story");
  ok("a shared story link opens that story", /Spectra|Marina Bay Sands/.test(await text(page, ".story")), (await text(page, ".story header")).slice(0, 60));
  await page.keyboard.press("Escape"); await sleep(300);
  await tap(page, ".chrome .toggle"); await page.waitForSelector(".wall");
  ok("wall view, URL #wall", (await hash(page)) === "#wall" && (await count(page, ".wall .cell")) === 20);
  await shot(page, `${SHOTS}/03-wall.png`);
  await (await page.$$(".wall .cell"))[5].tap(); await page.waitForSelector(".story");
  await page.goBack(); await sleep(400);
  ok("back from a wall story returns to the wall", (await page.$(".story")) === null && (await hash(page)) === "#wall" && (await page.$(".wall")) !== null);
  await tap(page, ".chrome .toggle"); await sleep(300);
  await clickText(page, ".chrome nav .chip", "Activities"); await sleep(400);
  ok("facet narrows the strip to runs and rides", (await count(page, ".tick")) === 4, String(await count(page, ".tick")));
  await shot(page, `${SHOTS}/04-facet-activities.png`);
  await clickText(page, ".chrome nav .chip", "Activities"); await sleep(300);
  ok("...and back", (await count(page, ".tick")) === 20);
  await page.goto(`${V}/g/nope-not-real`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".card");
  ok("dead gallery link explains itself", /doesn't point to a gallery/.test(await text(page, ".card")));
  await shot(page, `${SHOTS}/05-notfound.png`);

  console.log("--- admin: photos, select, new gallery from selection ---");
  await page.goto(`${A}/admin/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".cell");
  ok("signed-in identity shown", (await text(page, "header")).includes(WHO));
  ok("20 photos, none private (all in the demo gallery)", (await count(page, ".cell")) === 20 && (await count(page, ".flag.private")) === 0);
  await shot(page, `${SHOTS}/10-admin-photos.png`);
  await clickText(page, ".toolbar button", "Select"); await sleep(200);
  const cells = await page.$$(".cell"); await cells[0].tap(); await cells[1].tap(); await sleep(200);
  ok("bulk bar counts the selection", (await text(page, ".bulk strong")) === "2 selected", await text(page, ".bulk strong"));
  await shot(page, `${SHOTS}/11-admin-select.png`);
  await clickText(page, ".bulk button", "Add to gallery"); await sleep(200);
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
  await shot(page, `${SHOTS}/12-admin-galleries.png`);
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
  await shot(page, `${SHOTS}/13-admin-editor.png`);
  await clickText(page, ".sheet button", "Pick on map"); await page.waitForSelector(".picker canvas");
  ok("map picker renders", true);
  await sleep(1500); await shot(page, `${SHOTS}/14-admin-mappicker.png`);
  await page.evaluate(() => { const home = [...document.querySelectorAll(".sheet .gal")].find((l) => /home/.test(l.textContent)); home.querySelector("input").click(); });
  await clickText(page, ".sheet button", "Save");
  ok("save closes the editor", await waitFor(page, () => !document.querySelector(".sheet")));
  const lib = await (await fetch(`${A}/admin/api/moments`, { headers: { "remote-email": WHO } })).json();
  ok("membership persisted: the edited photo is now only in Friends", JSON.stringify(lib.find((m) => m.id === editId).galleries) === JSON.stringify([friendsId]), JSON.stringify(lib.find((m) => m.id === editId).galleries));

  console.log("--- viewer: the new gallery, as a visitor sees it ---");
  await page.goto(`${V}/g/${friendsId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tick");
  ok("Friends gallery: title and exactly its 2 photos", (await text(page, ".brand .title")) === "Friends" && (await count(page, ".tick")) === 2, `${await text(page, ".brand .title")} / ${await count(page, ".tick")}`);
  await page.waitForFunction(() => [...document.querySelectorAll(".tick img")].every((i) => i.complete), { timeout: 10000 });
  ok("thumbnails really load under /g/<token> (absolute media URLs)", await page.$$eval(".tick img", (imgs) => imgs.length > 0 && imgs.every((i) => i.naturalWidth > 0)), await page.$$eval(".tick img", (imgs) => imgs.map((i) => i.getAttribute("src")).join(",")));
  await sleep(4500); await shot(page, `${SHOTS}/20-viewer-friends.png`);
  await page.goto(`${V}/`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".tick");
  ok("home gallery lost the photo moved out of it", (await count(page, ".tick")) === 19, String(await count(page, ".tick")));
  const pubFriends = await (await fetch(`${V}/data/galleries/${friendsId}.json`)).json();
  ok("public gallery JSON carries no private fields", !JSON.stringify(pubFriends).match(/uploadedBy|filename|camera|original/));
  const libTry = await fetch(`${V}/library/moments.json`);
  ok("the library itself is not reachable publicly", (await fetch(`${V}/data/moments.json`)).status === 404 && !(libTry.headers.get("content-type") ?? "").includes("json") && !(await libTry.text()).includes("uploadedBy"));
} catch (e) {
  fail++; console.log("  FAIL  exception:", e.message); await shot(page, `${SHOTS}/99-failure.png`).catch(() => {});
} finally {
  await browser.close(); nginx.kill(); admin.kill();
}
const real = problems.filter((p) => !/favicon|nope-not-real/.test(p));   // the dead-link scenario 404s on purpose
console.log(`\nbrowser problems: ${real.length}`); for (const p of real) console.log("  ! " + p);
if (real.length) fail++;
console.log(fail ? `\n${fail} FAILED` : "\nall passed"); console.log(`shots: ${SHOTS}`);
process.exit(fail ? 1 : 0);
