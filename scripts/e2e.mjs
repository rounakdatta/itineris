// End-to-end in a real (headless) Chromium: nginx serving the built site with
// the admin's data volume linked in exactly as production shares it, the admin
// server behind a forged identity header, and puppeteer walking the actual user
// journeys on a phone-sized viewport. Screenshots land in $SCRATCH/shots.
import { spawn, execSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launch, shot, tap, swipe, sleep, text, count, tapAt, resolveBrowserEnv, setNetwork } from "./browser.mjs";
import { startAuthProxy } from "./lib/authproxy.mjs";
import { fakeJpeg } from "./lib/fakejpeg.mjs";
import { GMAPS_STUB } from "./lib/gmaps-stub.js";
import sharp from "sharp";

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
for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${ADMIN_PORT}/creator/healthz`)).ok) break; } catch {} await sleep(100); }
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
  .replace("root /usr/share/nginx/html;", `root ${path.join(nd, "docroot")};`).replace("listen 8080;", "listen 127.0.0.1:4331;")
  // In production Traefik path-routes /creator on the SAME host to the creator
  // pod (see ingress-admin.yaml); nginx never sees it. The viewer relies on
  // that being one origin -- it posts a view to /creator/api/views/<id> -- so
  // the harness has to reproduce the routing or it is testing a layout that
  // does not exist anywhere. Deliberately anonymous: a visitor is not signed
  // in, and the creator app itself is reached through the auth proxy at A.
  .replace("location / {", `location /creator/ {\n        proxy_pass http://127.0.0.1:${ADMIN_PORT};\n        proxy_set_header Host $host;\n        proxy_set_header X-Forwarded-For $remote_addr;\n    }\n\n    location / {`));
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
  ok("no day chips: the strip is the whole dock", (await page.$(".days")) === null && !/Whole trip/.test(await text(page, ".dock")));
  ok("no desktop zoom buttons on a phone", (await count(page, ".maplibregl-ctrl-zoom-in")) === 0);
  // Every gallery is an advert for making one. It sits above the strip, clear
  // of Google's logo and terms, and gets out of the way while a story plays.
  // The seed places every photo, so the mark stays a mark. The ring is only
  // earned by photos that belong nowhere -- see the no-GPS section below.
  ok("the wordmark is gone; the gallery's name is the heading", (await page.$(".brand .word")) === null && (await text(page, ".brand")).startsWith("itineris"));
  ok("...and no story ring on the mark when every photo is placed", (await page.$(".mine-story")) === null);
  ok("a Make my own button at the bottom of the gallery", (await text(page, ".mine")) === "Make my own" && (await page.$eval(".mine", (a) => a.getAttribute("href"))) === "/creator/");
  {
    const m = await page.$eval(".mine", (el) => { const r = el.getBoundingClientRect(); const d = document.querySelector(".dock").getBoundingClientRect(); return { b: Math.round(r.bottom), dockTop: Math.round(d.top), l: Math.round(r.left), r: Math.round(r.right), w: innerWidth }; });
    ok("...above the photo strip and inside the screen", m.b <= m.dockTop && m.l >= 0 && m.r <= m.w, JSON.stringify(m));
    // The credit line both map engines draw along the bottom is not ours to sit on.
    const clash = await page.evaluate(() => {
      // The whole control container, not just the text: its padding is part of
      // what the credit needs to stay legible.
      const a = document.querySelector(".maplibregl-ctrl-bottom-right")?.getBoundingClientRect();
      const b = document.querySelector(".mine").getBoundingClientRect();
      return a ? !(b.bottom <= a.top || b.top >= a.bottom || b.right <= a.left || b.left >= a.right) : false;
    });
    ok("...and clear of the map's attribution", clash === false);
  }
  await settle(page, { map: true }); await shot(page, `${SHOTS}/01-viewer-home.png`);

  console.log("--- viewer: story by tap, swipe, back button ---");
  const ticks = await page.$$(".tick");
  await ticks[2].tap();
  await page.waitForSelector(".story");
  ok("ONE tap on a thumbnail opens the story (no card in between), URL carries it", (await hash(page)) === "#m/m003" && (await page.$(".place-card")) === null, await hash(page));
  await page.keyboard.press(" ");   // hold the 5 s timer while we look around (the swipe's release resumes it)
  ok("story header: the date, minimally, + place + clock", /14 Mar/.test(await text(page, ".story header")) && !/Day 1/.test(await text(page, ".story header")) && /Maxwell/.test(await text(page, ".story header")), await text(page, ".story header"));
  ok("the place in the story header is a Google Maps link", await page.$eval(".story header a.place", (a) => a.target === "_blank" && /google\.com\/maps/.test(a.href)));
  ok("story: thumbnail placeholder at once, full image fades in", (await page.$(".story img.placeholder")) !== null && (await page.waitForSelector(".story img.media.loaded", { timeout: 15000 }).then(() => true).catch(() => false)));
  await settle(page); await shot(page, `${SHOTS}/02-story.png`);
  ok("still on the photo we opened (paused)", (await hash(page)) === "#m/m003" && /paused/.test(await text(page, ".story .hint")), `${await hash(page)} ${await text(page, ".story .hint")}`);
  await swipe(page, [300, 450], [70, 455]); await sleep(400);
  ok("swipe left -> next photo", (await hash(page)) === "#m/m004", await hash(page));
  // Every seed place here has one photo, so each step is a "Next stop" handoff: let it finish before navigating on (a touch would skip it instead).
  const handedOver = async () => { const t0 = Date.now(); const done = await waitFor(page, () => !document.querySelector(".story.handoff") && !document.querySelector(".handoff-veil"), 8000); if (!done) console.log(`  !     handoff still showing after ${Date.now() - t0} ms`); return done; };
  await handedOver(); await tapAt(page, 40, 450); await sleep(400);
  ok("tap left third -> previous", (await hash(page)) === "#m/m003", await hash(page));
  await handedOver(); await tapAt(page, 300, 450); await sleep(400);
  ok("tap right -> next", (await hash(page)) === "#m/m004", await hash(page));
  await page.goBack(); await sleep(400);
  ok("phone back button closes the story", (await page.$(".story")) === null && (await hash(page)) === "", await hash(page));
  await (await page.$(".tick.on")).tap(); await page.waitForSelector(".story");
  await swipe(page, [200, 380], [205, 640]); await sleep(500);
  ok("swipe down closes", (await page.$(".story")) === null && (await hash(page)) === "");

  console.log("--- viewer: a story on a 2 KB/s link ---");
  // The photo's full copy takes ages; the thumbnail (already on screen in the
  // strip) must stand in at once, the spinner must show, and the 5 s timer must
  // not run until the photo has actually arrived. Never a dark screen.
  // The premise is "the thumbnail is already on the device" (it is in the
  // strip): make sure it has actually landed before the link goes slow.
  await page.waitForFunction(() => { const i = document.querySelector('.tick[data-id="m013"] img'); return i && i.complete && i.naturalWidth > 0; }, { timeout: 15000 });
  // (the worker may already control this page: throttle its fetches too)
  await setNetwork(browser, page, { offline: false, latency: 300, downloadThroughput: 1500, uploadThroughput: 1500 }, V);
  const slowTick = (await page.$$(".tick"))[12];   // m013: a real raster photo (400/960/1600 copies)
  ok("slow: the photo under test is a real photo, not a placeholder", (await slowTick.evaluate((el) => el.dataset.id)) === "m013" && (await slowTick.$eval("img", (i) => i.getAttribute("src"))) === "/media/m013-400.webp", await slowTick.$eval("img", (i) => i.getAttribute("src")));
  await slowTick.tap(); await page.waitForSelector(".story");
  await sleep(1500);
  // "Immediately" = well inside a second, while the photo itself takes several on this link (a cached image can still report `complete` a frame late).
  ok("slow: the sharp thumbnail is on screen immediately", await waitFor(page, () => { const i = document.querySelector(".story img.placeholder"); return !!i && i.complete && i.naturalWidth > 0 && getComputedStyle(i).opacity === "1"; }, 4000), await page.$eval(".story img.placeholder", (i) => `complete=${i.complete} w=${i.naturalWidth}`).catch(() => "no placeholder"));
  ok("slow: the photo itself is still loading, and says so", (await page.$(".story img.media.loaded")) === null && (await page.$('.story .loading[role="status"]')) !== null);
  ok("slow: the story timer waits for the photo", (await page.$$eval(".story .fill", (fs) => fs.map((f) => f.style.width))).filter((w) => w !== "0%" && w !== "100%").length === 0, JSON.stringify(await page.$$eval(".story .fill", (fs) => fs.map((f) => f.style.width))));
  ok("slow: nothing on screen is the blurred backdrop alone", await page.evaluate(() => { const b = document.querySelector(".story img.backdrop"); const p = document.querySelector(".story img.placeholder"); return !b || (p && p.getBoundingClientRect().width > 0); }));
  await settle(page); await shot(page, `${SHOTS}/03-story-slow-link.png`);
  await setNetwork(browser, page, { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, V);
  ok("slow: the photo fades in once it arrives", await page.waitForSelector(".story img.media.loaded", { timeout: 20000 }).then(() => true).catch(() => false));
  await page.keyboard.press("Escape"); await sleep(300);

  console.log("--- viewer: a LANDSCAPE photo in the story is the photo, not its blurred backdrop ---");
  // Pixel-level: the contained photo occupies the middle band of a portrait
  // screen; the blurred, darkened copy fills the rest. Read both bands off a
  // screenshot: the photo has strong adjacent-pixel contrast (16 px blocks) and
  // is bright; the backdrop is smooth and dark. Anything else is a paint bug.
  const texture = async (png, [fx0, fy0, fx1, fy1]) => {
    const { width, height } = await sharp(png).metadata();
    const left = Math.round(width * fx0), top = Math.round(height * fy0), w = Math.round(width * (fx1 - fx0)), h = Math.round(height * (fy1 - fy0));
    const { data, info } = await sharp(png).extract({ left, top, width: w, height: h }).greyscale().raw().toBuffer({ resolveWithObject: true });
    let diff = 0, sum = 0, n = 0;
    for (let y = 0; y < info.height; y++) for (let x = 1; x < info.width; x++) { const i = y * info.width + x; diff += Math.abs(data[i] - data[i - 1]); sum += data[i]; n++; }
    return { contrast: +(diff / n).toFixed(1), luma: Math.round(sum / n) };
  };
  await page.goto(`${V}/#m/m005`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".story");
  ok("landscape: it is the landscape photo, shown whole over a blurred copy", (await page.$eval(".story img.media", (i) => i.classList.contains("contain") && /m005-960\.webp$/.test(i.getAttribute("src")))) && (await page.$(".story img.backdrop")) !== null, await page.$eval(".story img.media", (i) => i.getAttribute("src")));
  await page.waitForSelector(".story img.media.loaded", { timeout: 15000 }); await sleep(700);
  const png = await page.screenshot({ encoding: "binary" }); writeFileSync(`${SHOTS}/04-story-landscape.png`, png);
  const photo = await texture(png, [0.1, 0.42, 0.9, 0.58]), above = await texture(png, [0.1, 0.22, 0.9, 0.3]);
  ok("landscape: the middle band is the sharp, bright photo", photo.contrast > 4 && photo.luma > 100, JSON.stringify(photo));
  ok("landscape: the band above it is the smooth, dimmed backdrop", above.contrast < 2 && above.luma < 90, JSON.stringify(above));
  await page.keyboard.press("Escape"); await sleep(300);

  console.log("--- viewer: deep link, wall, facet ---");
  // A COLD load: leave the site first, so this is a shared link opened from a
  // chat, not a same-document hash change on a page that is already running.
  await page.goto("about:blank"); await page.goto(`${V}/#m/m010`, { waitUntil: "domcontentloaded" });
  ok("a shared story link opens that story on a cold load, URL intact", await page.waitForSelector(".story", { timeout: 15000 }).then(() => true).catch(() => false) && /Spectra|Marina Bay Sands/.test(await text(page, ".story")) && (await hash(page)) === "#m/m010", `${await hash(page)} ${(await text(page, ".story header").catch(() => "")).slice(0, 60)}`);
  await page.waitForSelector(".story .cap-host .cap", { timeout: 10000 });
  ok("a photo can wear a few captions: both, where they were put, in the faces they were given", await page.evaluate(() => {
    const caps = [...document.querySelectorAll(".story .cap-host .cap")];
    if (caps.length !== 2) return `${caps.length} captions`;
    const s = (el) => getComputedStyle(el), box = (el) => el.getBoundingClientRect(), frame = document.querySelector(".story").getBoundingClientRect();
    const mid = (el) => (box(el).top + box(el).height / 2 - frame.top) / frame.height;
    const turn = (el) => { const m = new DOMMatrixReadOnly(s(el).transform); return (Math.atan2(m.b, m.a) * 180) / Math.PI; };
    if (!/Spectra/.test(caps[0].textContent) || !/twice a night/.test(caps[1].textContent)) return "wrong texts";
    if (Math.abs(mid(caps[0]) - 0.86) > 0.03 || Math.abs(mid(caps[1]) - 0.2) > 0.03) return `at ${mid(caps[0]).toFixed(2)} and ${mid(caps[1]).toFixed(2)}`;
    if (!/Cinzel/.test(s(caps[1]).fontFamily) || s(caps[1]).backgroundColor !== "rgba(8, 9, 12, 0.66)") return `second is ${s(caps[1]).fontFamily}`;
    if (Math.abs(turn(caps[1]) + 7) > 0.5) return `second turned ${turn(caps[1]).toFixed(1)}`;
    return true;
  }) === true, String(await page.evaluate(() => [...document.querySelectorAll(".story .cap-host .cap")].map((c) => c.textContent).join(" | "))));
  await settle(page); await shot(page, `${SHOTS}/02c-two-captions.png`);
  ok("a story is ONE place's: Marina Bay Sands has two photos, so two bars and 2 / 2 -- no other shop's pointer", (await count(page, ".story .bars .bar")) === 2 && /2 \/ 2/.test(await text(page, ".story .hint")), `${await count(page, ".story .bars .bar")} bars, ${await text(page, ".story .hint")}`);
  await page.keyboard.press("Escape"); await sleep(300);
  // Gardens by the Bay (m008 10:20, m009 13:00) is interleaved in time with Marina Bay Sands (m007 07:05, m010 19:50):
  // its story is its own two photos, then the NEXT place begins -- not m010.
  await page.goto(`${V}/#m/m008`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".story");
  ok("...Gardens by the Bay: 1 / 2 of its own two", (await count(page, ".story .bars .bar")) === 2 && /1 \/ 2/.test(await text(page, ".story .hint")), await text(page, ".story .hint"));
  await swipe(page, [300, 450], [70, 455]); await sleep(400);
  ok("...swipe: its second photo", (await hash(page)) === "#m/m009", await hash(page));
  await swipe(page, [300, 450], [70, 455]);
  // The handoff lasts 1.4 s: read everything about it in one go, the moment the postcard has shrunk.
  const ho = await page.evaluate(async () => {
    const t0 = performance.now(); let last = null;
    while (performance.now() - t0 < 2500) {
      const s = document.querySelector(".story.handoff"), v = document.querySelector(".handoff-veil");
      if (s && v) { const r = s.getBoundingClientRect(); last = { hash: location.hash, bars: document.querySelectorAll(".story .bars .bar").length, hint: document.querySelector(".story .hint")?.textContent ?? "", veil: v.textContent.replace(/\s+/g, " ").trim(), top: Math.round(r.top), height: Math.round(r.height), inner: window.innerHeight }; if (r.height < window.innerHeight * 0.5) return last; }
      await new Promise((r) => requestAnimationFrame(r));
    }
    return last;
  });
  ok("...swipe past its end: the next place's story starts (East Coast Park), bars reset", ho?.hash === "#m/m011" && ho?.bars === 3 && /1 \/ 3/.test(ho?.hint ?? ""), JSON.stringify(ho));
  ok("...with a Next stop handoff: a pill under the map's pin names the place and what is waiting", /Next stop/.test(ho?.veil ?? "") && /East Coast Park/.test(ho?.veil ?? "") && /3 photos/.test(ho?.veil ?? ""), ho?.veil ?? "(no veil)");
  ok("...the story really shrank to a postcard at the top, the map showing beneath", !!ho && ho.height < ho.inner * 0.5 && ho.top < 40, ho ? `top ${ho.top} height ${ho.height} of ${ho.inner}` : "no handoff seen");
  await shot(page, `${SHOTS}/02b-next-stop.png`);
  ok("...and the handoff ends on its own, the story playing on", await waitFor(page, () => !document.querySelector(".story.handoff") && !document.querySelector(".handoff-veil"), 3000) && (await hash(page)) === "#m/m011");
  await page.keyboard.press("Escape"); await sleep(300);
  ok("no Wall/Map toggle: the map is the view", (await page.$(".chrome .toggle")) === null && (await page.$(".wall")) === null);
  await page.goto("about:blank"); await page.goto(`${V}/#wall`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".tick", { timeout: 15000 }); await sleep(300);
  ok("an old #wall link is ignored and cleaned up", (await hash(page)) === "" && (await page.$(".wall")) === null, await hash(page));
  await clickText(page, ".chrome nav .chip", "Activities"); await sleep(400);
  ok("facet narrows the strip to runs and rides", (await count(page, ".tick")) === 4, String(await count(page, ".tick")));
  await settle(page, { map: true }); await shot(page, `${SHOTS}/04-facet-activities.png`);
  await clickText(page, ".chrome nav .chip", "Activities"); await sleep(300);
  ok("...and back", (await count(page, ".tick")) === 20);
  await page.goto(`${V}/g/nope-not-real`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".card");
  ok("dead gallery link explains itself", /doesn't point to a gallery/.test(await text(page, ".card")));
  await settle(page); await shot(page, `${SHOTS}/05-notfound.png`);

  console.log("--- viewer: Google Maps as the map (stubbed API, real integration) ---");
  // A key in /config.json switches the engine. The Google script is served by a
  // stub here (there is no key in CI), so what this proves is our side of it:
  // config -> loader -> one photo pin per located photo -> the same two-step
  // tap -> place card -> story, and honest copy about offline.
  writeFileSync(path.join(nd, "docroot", "config.json"), JSON.stringify({ googleMapsApiKey: "e2e-fake-key" }));
  const gctx = await browser.createBrowserContext();
  const gp = await gctx.newPage();
  await gp.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await gp.setRequestInterception(true);
  let gmapsRequested = null;
  gp.on("request", (r) => {
    const u = r.url();
    if (/^https:\/\/maps\.googleapis\.com\/maps\/api\/js/.test(u)) { gmapsRequested = u; return r.respond({ status: 200, contentType: "application/javascript", body: GMAPS_STUB }); }
    if (/googleapis\.com|gstatic\.com|google\.com/.test(u)) return r.abort();
    return r.continue();
  });
  await gp.goto(`${V}/`, { waitUntil: "domcontentloaded" });
  await gp.waitForSelector('.map[data-engine="google"] .gpin', { timeout: 20000 });
  ok("Google Maps is the map, loaded with the configured key", !!gmapsRequested && gmapsRequested.includes("key=e2e-fake-key") && gmapsRequested.includes("libraries=maps,marker"), gmapsRequested ?? "(not requested)");
  const pub = JSON.parse(readFileSync(path.join(nd, "docroot", "data", "galleries", "sg2026demo.json"), "utf8"));
  const key = (m) => (m.google?.placeId ? "g:" + m.google.placeId : (m.place || "").trim().toLowerCase() || "#" + m.id);   // how the app keys pins
  const pinOf = (name) => `.gpin[data-place="${key(pub.moments.find((m) => m.place === name))}"]`;
  const perPlace = pub.moments.filter((m) => m.lat != null).reduce((acc, m) => acc.set(key(m), (acc.get(key(m)) || 0) + 1), new Map());
  const rated = new Set(pub.moments.filter((m) => m.lat != null && m.google?.rating).map(key));
  ok("one story-ring pin per PLACE, none of MapLibre", (await count(gp, ".gpin")) === perPlace.size && (await gp.$(".maplibregl-canvas")) === null, `${await count(gp, ".gpin")} pins for ${perPlace.size} places`);
  const named = new Set(pub.moments.filter((m) => m.lat != null && (m.place || "").trim()).map(key));
  ok("every named place wears its name on the chip; Google's rating follows where it is known", (await count(gp, ".gpin .chip")) === named.size && (await gp.$$eval(".gpin .chip", (cs) => cs.every((c) => c.querySelector(".nm")?.textContent.length > 0))) && (await gp.$$eval(".gpin .chip", (cs) => cs.filter((c) => /\d\.\d★$/.test(c.textContent)).length)) === rated.size, `${await count(gp, ".gpin .chip")} chips, ${named.size} named, ${rated.size} rated`);
  ok("...e.g. the Maxwell pin reads its name and rating", (await text(gp, `${pinOf("Maxwell Food Centre")} .chip`)) === "Maxwell Food Centre4.4★", await text(gp, `${pinOf("Maxwell Food Centre")} .chip`));
  ok("a count badge where several photos share the place", (await count(gp, ".gpin .ring .n")) === [...perPlace.values()].filter((n) => n > 1).length);
  ok("every ring is bright: nothing seen yet", (await count(gp, ".gpin .ring.seen")) === 0 && (await count(gp, ".gpin .ring")) === perPlace.size);
  ok("the pins are the photos", await gp.$eval(".gpin .ring img", (i) => /\/media\//.test(i.getAttribute("src"))));

  // A real trip puts several places within a few hundred metres, and their
  // name chips then land on top of one another. Squeeze the stub's grid until
  // they do, and the map should thin the LABELS out -- never the pins, which
  // are the photos and the thing you tap.
  const overlaps = () => gp.evaluate(() => {
    const on = [...document.querySelectorAll(".gpin .chip")].filter((c) => !c.classList.contains("crowded")).map((c) => c.getBoundingClientRect());
    let n = 0;
    for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
      const a = on[i], b = on[j];
      if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) n++;
    }
    return { n, showing: on.length };
  });
  const roomy = await overlaps();
  ok("with room to breathe, no two labels overlap either", roomy.n === 0, JSON.stringify(roomy));

  // evaluateOnNewDocument, not evaluate: a reload throws away the page's JS
  // context, so a value set on the old one is gone before the stub reads it --
  // which made the first version of this test pass against a grid it had
  // never actually squeezed.
  const squeeze = await gp.evaluateOnNewDocument(() => { globalThis.__gmapsSpread = { x: 34, y: 30 }; });
  await gp.reload({ waitUntil: "domcontentloaded" });
  await gp.waitForSelector('.map[data-engine="google"] .gpin', { timeout: 20000 });
  await sleep(1400);
  const crowded = await overlaps();
  ok("crowded together, no two labels are left sitting on each other", crowded.n === 0, JSON.stringify(crowded));
  ok("...which it manages by showing fewer of them, not by shrinking them",
    crowded.showing < roomy.showing && crowded.showing >= 1, `${roomy.showing} with room -> ${crowded.showing} crowded`);
  ok("...but every pin is still there: the photo is never what gets hidden",
    (await count(gp, ".gpin .ring")) === perPlace.size, `${await count(gp, ".gpin .ring")} of ${perPlace.size}`);
  ok("...nor is one left half behind somebody else's photo",
    await gp.evaluate(() => {
      // Grazed at one end is allowed -- the name ellipsizes anyway; what is
      // not allowed is a neighbour's photo eating a readable chunk of it.
      const on = [...document.querySelectorAll(".gpin")].filter((g) => g.querySelector(".chip:not(.crowded)"));
      const rings = [...document.querySelectorAll(".gpin .ring")];
      return on.every((g) => {
        const c = g.querySelector(".chip").getBoundingClientRect();
        return rings.filter((r) => !g.contains(r)).every((r) => {
          const b = r.getBoundingClientRect();
          const w = Math.min(c.right, b.right) - Math.max(c.left, b.left);
          const h = Math.min(c.bottom, b.bottom) - Math.max(c.top, b.top);
          return !(w > 0 && h > 0) || (w * h) / (c.width * c.height) < 0.16;
        });
      });
    }));
  ok("...and no label hangs off the edge of the map",
    await gp.evaluate(() => {
      const v = document.querySelector('.map[data-engine="google"]').getBoundingClientRect();
      return [...document.querySelectorAll(".gpin .chip")].filter((c) => !c.classList.contains("crowded"))
        .every((c) => { const r = c.getBoundingClientRect(); return r.left >= v.left - 1 && r.right <= v.right + 1; });
    }));
  await shot(gp, `${SHOTS}/19b-google-crowded.png`);
  // Given room again, every name that fits comes back -- nothing is hidden for good.
  await gp.removeScriptToEvaluateOnNewDocument(squeeze.identifier);
  await gp.reload({ waitUntil: "domcontentloaded" });
  await gp.waitForSelector('.map[data-engine="google"] .gpin', { timeout: 20000 });
  await sleep(1400);
  ok("given room again, the names come back", (await overlaps()).showing === roomy.showing, JSON.stringify(await overlaps()));
  // The map's bottom reserve and the dock's height were two independent magic
  // numbers (100px vs 12 + 72 + max(10, safe-area)); they now both come from
  // --dock-h. Flush means Google's logo and terms are never under the strip,
  // and the strip is never sliced by the bottom of the window.
  {
    const g = await gp.evaluate(() => {
      const box = (s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height) }; };
      return { map: box(".map"), dock: box(".dock"), tick: box(".tick"), vh: innerHeight };
    });
    ok("the map ends exactly where the photo strip begins", g.map.b === g.dock.t, `map ${g.map.b}, dock ${g.dock.t}`);
    ok("...and the strip is inside the window, not sliced by it", g.tick.b <= g.vh, `tick ${g.tick.b}, viewport ${g.vh}`);
  }
  // Instagram: tap the ring and the story opens, at once.
  await (await gp.$(`${pinOf("Maxwell Food Centre")} .ring`)).tap(); await gp.waitForSelector(".story", { timeout: 10000 });
  ok("tap the ring: the story opens straight away", /Maxwell/.test(await text(gp, ".story header")), await text(gp, ".story header"));
  ok("...with Google's rating beside the place name", (await text(gp, ".story header .rate")) === "4.4★", await text(gp, ".story header .rate"));
  await gp.keyboard.press("Escape"); await sleep(400);
  ok("that ring has gone quiet: seen on this device", await gp.$eval(`${pinOf("Maxwell Food Centre")} .ring`, (r) => r.classList.contains("seen")));
  ok("the others are still bright", (await count(gp, ".gpin .ring.seen")) === 1);
  // The chip (name + rating) opens the story too: what Google says is on the pin and in the story header, no card.
  await (await gp.$(`${pinOf("Lau Pa Sat")} .chip`)).tap(); await gp.waitForSelector(".story", { timeout: 10000 });
  ok("tap the chip: the story opens, no place card", /Lau Pa Sat/.test(await text(gp, ".story header")) && (await text(gp, ".story header .rate")) === "4.3★" && (await gp.$(".place-card")) === null, await text(gp, ".story header"));
  await gp.keyboard.press("Escape"); await sleep(400);
  ok("...and that pin is the dark, chosen one", await gp.$eval(pinOf("Lau Pa Sat"), (el) => el.classList.contains("on")));
  await settle(gp); await shot(gp, `${SHOTS}/06-google-maps.png`);
  await (await gp.$(`${pinOf("Lau Pa Sat")} .chip`)).tap(); await gp.waitForSelector(".story", { timeout: 10000 });
  ok("a second tap on the chip opens the story too", /Lau Pa Sat/.test(await text(gp, ".story header")));
  await gp.keyboard.press("Escape"); await sleep(300);
  await gctx.close();
  rmSync(path.join(nd, "docroot", "config.json"));
  // And with no key the same page draws MapLibre, as every other section here relies on.
  await page.goto(`${V}/`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".tick");
  ok("without a key the map is MapLibre again", await waitFor(page, () => !!document.querySelector(".map:not([data-engine])") && !document.querySelector('.map[data-engine="google"]')));

  console.log("--- creator: signed out, you are offered a way in ---");
  // Straight at the server, past the proxy that forges the identity header:
  // nobody, which is what a stranger following "Make my own" looks like.
  await page.goto(`http://127.0.0.1:${ADMIN_PORT}/creator/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".hello", { timeout: 10000 });
  ok("signed out: the sign-in screen, not the editor", /Make your own/.test(await text(page, ".hello h1")) && (await page.$(".cell")) === null && (await page.$("[data-testid=file-input]")) === null);
  // Asked from here rather than from the page: the answer is the same with no
  // session either way, and a deliberate 401 should not look like a page error.
  ok("...and the library is refused outright", (await fetch(`http://127.0.0.1:${ADMIN_PORT}/creator/api/library`)).status === 401);
  await settle(page); await shot(page, `${SHOTS}/09-creator-signin.png`);

  console.log("--- creator: photos, select, new gallery from selection ---");
  await page.goto(`${A}/creator/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".cell");
  ok("signed-in identity shown", (await text(page, "header")).includes(WHO));
  // A tile marks what is exceptional, not the state every photo arrives in:
  // these are all in the demo gallery, so each carries the "published" mark
  // and nothing else.
  ok("20 photos, each marked as being in a gallery", (await count(page, ".cell")) === 20 && (await count(page, ".flag.out")) === 20, `${await count(page, ".cell")} cells, ${await count(page, ".flag.out")} marked`);
  await settle(page); await shot(page, `${SHOTS}/10-admin-photos.png`);
  await clickText(page, ".toolbar button", "Select"); await sleep(200);
  const cells = await page.$$(".cell"); await tapEl(page, cells[0]); await tapEl(page, cells[1]); await sleep(200);
  ok("bulk bar counts the selection", (await text(page, ".bulk strong")) === "2 selected", await text(page, ".bulk strong"));
  await settle(page); await shot(page, `${SHOTS}/11-admin-select.png`);
  await clickText(page, ".bulk button", "Gallery"); await sleep(200);
  await page.select(".bulk select", "__new__"); await sleep(200);
  // Named in the bar, not in an OS prompt. If a dialog ever appears again the
  // run should fail rather than quietly answer it.
  page.once("dialog", async (d) => { ok("no operating-system prompt for a gallery name", false, d.message()); await d.dismiss(); });
  await page.type('.bulk input[aria-label="New gallery name"]', "Friends");
  await clickText(page, ".bulk button", "Create with 2");
  ok("new gallery appears in the filter", await waitFor(page, () => [...document.querySelectorAll(".filter option")].some((o) => /Friends \(2\)/.test(o.textContent))));

  console.log("--- creator: galleries tab ---");
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

  // The worker's scope covers /creator/, so a navigation to the sign-in route
  // is exactly the shape it likes to answer from cache -- and answering it
  // means "Continue with Google" quietly reloads the app instead of going to
  // Google. Assert the SERVER answered: with no client configured here, that
  // is its 503, and never the app shell.
  {
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    const r = await page.evaluate(async () => { const x = await fetch("/creator/auth/google", { redirect: "manual" }); return { status: x.status, type: x.type, body: (await x.text()).slice(0, 60) }; });
    ok("the worker lets sign-in through to the server", controlled && !/<!doctype|<html/i.test(r.body), `controlled=${controlled} ${r.status} ${JSON.stringify(r.body)}`);
  }

  // A gallery's own name at the ROOT of the site. nginx serves the SPA for any
  // path it has no file for, and the projection is published under the name as
  // well as the token, so this resolves in one fetch with no routing at all.
  console.log("--- a gallery's own name in the URL ---");
  await fetch(`${A}/creator/api/galleries/${friendsId}`, { method: "PATCH", headers: { "remote-email": WHO, "content-type": "application/json" }, body: JSON.stringify({ slug: "friendstrip" }) });
  await page.goto(`${V}/friendstrip`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tick", { timeout: 20000 });
  ok("the pretty URL opens the gallery", (await text(page, ".brand .title")) === "Friends", await text(page, ".brand .title"));
  ok("...and a story deep-link under it works too", await (async () => {
    const id = await page.$eval(".tick", (e) => e.dataset.id);
    await page.goto(`${V}/friendstrip#m/${id}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".story", { timeout: 15000 });
    return (await hash(page)) === `#m/${id}`;
  })());
  await page.keyboard.press("Escape"); await sleep(300);
  await page.goto(`${V}/g/${friendsId}`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".tick", { timeout: 20000 });
  ok("...and the token URL still opens the same one, as it always must", (await text(page, ".brand .title")) === "Friends");
  ok("a name nobody has taken is not a gallery", (await (await fetch(`${V}/data/galleries/nobodyhasthis.json`)).status) === 404);
  await page.goto(`${A}/creator/`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".cell");   // back to the creator app for what follows

  console.log("--- creator: editor ---");
  const editId = await page.$eval(".cell", (c) => c.dataset.id);
  const editRec = (await (await fetch(`${A}/creator/api/moments`, { headers: { "remote-email": WHO } })).json()).find((m) => m.id === editId);
  await (await page.$(".cell")).tap(); await page.waitForSelector(".sheet");
  ok("native time picker holds the photo's local time", (await page.$eval('.sheet input[type="datetime-local"]', (i) => i.value)) === editRec.t.slice(0, 16) && (await page.$eval(".sheet select", (s) => s.value)) === editRec.t.slice(-6), `${editId} ${editRec.t}`);
  ok("gallery checklist: in both", (await page.$$eval(".sheet .gal input", (is) => is.filter((i) => i.checked).length)) === 2);
  // A caption, styled: typing one brings up the styler (a phone-shaped preview with the real caption renderer); pick a face and a pill, nudge it up.
  await page.$eval(".sheet textarea", (el) => { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); });   // the seed photo already has a caption
  await page.type(".sheet textarea", "Satay by the water");
  ok("the caption styler appears with the caption on the photo", await waitFor(page, () => document.querySelector('[data-testid="caption-frame"] .cap')?.textContent === "Satay by the water"));
  await clickText(page, '[role="group"][aria-label="Font"] button', "Editorial"); await clickText(page, '[role="group"][aria-label="Background"] button', "Dark");
  await page.focus('[data-testid="caption-frame"] .cap'); await page.keyboard.down("Shift"); await page.keyboard.press("ArrowUp"); await page.keyboard.up("Shift");
  // ...and tilt it: the slider takes any angle, and the caption in the preview turns with it.
  await page.$eval('input[type="range"]', (el) => { el.value = "-8"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  // The angle a rendered element is actually turned by, read back out of its matrix.
  const turnOf = (page, sel) => page.$eval(sel, (c) => { const m = new DOMMatrixReadOnly(getComputedStyle(c).transform); return +((Math.atan2(m.b, m.a) * 180) / Math.PI).toFixed(1); });
  ok("the preview follows: Editorial face, dark pill, moved up 5%, tilted 8 degrees left", await page.$eval('[data-testid="caption-frame"] .cap', (c) => { const s = getComputedStyle(c); return /Playfair Display/.test(s.fontFamily) && s.backgroundColor === "rgba(8, 9, 12, 0.66)" && c.getAttribute("style").replace(/\s/g, "").includes("--cap-y:77.00%"); }) && Math.abs((await turnOf(page, '[data-testid="caption-frame"] .cap')) + 8) < 0.5, `${await page.$eval('[data-testid="caption-frame"] .cap', (c) => getComputedStyle(c).fontFamily)} | turned ${await turnOf(page, '[data-testid="caption-frame"] .cap')}°`);
  ok("...and the tilt handle is there to drag", (await page.$('[data-testid="caption-frame"] .cap .turn')) !== null);
  // A second caption on the same photo: it lands above the first, keeps its face, and owns the controls.
  await clickText(page, ".caps button", "+ caption");
  ok("a second caption is added, empty and chosen", /Caption 2 of 2/.test(await text(page, ".sheet")) && (await page.$eval(".sheet textarea", (t) => t.value)) === "");
  await page.type(".sheet textarea", "and the queue was worth it");
  await clickText(page, '[role="group"][aria-label="Font"] button', "Retro");
  ok("both captions are on the photo, the new one above and chosen", await page.evaluate(() => {
    const caps = [...document.querySelectorAll('[data-testid="caption-frame"] .cap')];
    if (caps.length !== 2) return `${caps.length} in the preview`;
    const y = (el) => +el.getAttribute("style").replace(/\s/g, "").match(/--cap-y:([\d.]+)%/)[1];
    if (!(y(caps[1]) < y(caps[0]))) return `${y(caps[0])} then ${y(caps[1])}`;
    if (!caps[1].classList.contains("selected") || caps[0].querySelector(".turn")) return "the wrong one is chosen";
    return /Pacifico/.test(getComputedStyle(caps[1]).fontFamily) ? true : `second is ${getComputedStyle(caps[1]).fontFamily}`;
  }) === true, String(await page.evaluate(() => [...document.querySelectorAll('[data-testid="caption-frame"] .cap')].map((c) => c.textContent.trim()).join(" | "))));
  ok("...and the picker names them both", /1\. Satay by the/.test(await text(page, ".caps")) && /2\. and the queue/.test(await text(page, ".caps")), await text(page, ".caps"));
  ok("twelve faces, in three moods, each chip written in the face it offers", await page.evaluate(() => {
    const g = document.querySelector('[role="group"][aria-label="Font"]');
    const moods = [...g.querySelectorAll(".glabel")].map((e) => e.textContent);
    const chips = [...g.querySelectorAll("button")];
    if (chips.length !== 12) return `${chips.length} faces`;
    if (String(moods) !== "Plain,Classic,Playful") return `moods ${moods}`;
    const punchy = chips.find((c) => c.textContent.trim() === "Punchy");
    return /Shrikhand/.test(getComputedStyle(punchy).fontFamily) ? true : `Punchy chip is ${getComputedStyle(punchy).fontFamily}`;
  }) === true, String(await page.evaluate(() => [...document.querySelectorAll('[role="group"][aria-label="Font"] button')].map((b) => b.textContent.trim()).join(" "))));
  await page.$eval('[role="group"][aria-label="Font"]', (el) => el.scrollIntoView({ block: "center" })); await settle(page);
  await shot(page, `${SHOTS}/13c-admin-font-picker.png`);
  await settle(page); await shot(page, `${SHOTS}/13-admin-editor.png`);
  await clickText(page, ".sheet button", "Pick on map"); await page.waitForSelector(".picker canvas");
  ok("map picker renders", true);
  await sleep(2500); await shot(page, `${SHOTS}/14-admin-mappicker.png`);
  // A Google Maps link pasted where a place name would go: the exact place, its name, and the link to keep.
  const GMAPS = "https://www.google.com/maps/place/Lau+Pa+Sat/@1.2806,103.8505,17z/data=!3m1!4b1!4m6!3m5!1s0x31da190d3c6fd7a3:0x9a0f1d6f2a2b3c4d!8m2!3d1.280638!4d103.850453!16s%2Fg%2F1td6l0mq?entry=ttu";
  const GMAPS_CID = `https://maps.google.com/?cid=${BigInt("0x9a0f1d6f2a2b3c4d")}`;
  await page.$eval('.sheet input[aria-label="Search a place"]', (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, GMAPS);
  await page.focus('.sheet input[aria-label="Search a place"]'); await page.keyboard.press("Enter");
  ok("a pasted Google Maps link fills the place, the spot and keeps the exact link", await waitFor(page, () => /From Google Maps: Lau Pa Sat/.test(document.querySelector(".sheet .note")?.textContent ?? "")) && (await page.$eval('.sheet input[placeholder="Chinatown Complex"]', (i) => i.value)) === "Lau Pa Sat" && (await page.$eval('.sheet input[placeholder="1.2829"]', (i) => i.value)) === "1.280638" && (await page.$eval(".sheet .linked a", (a) => a.href)) === GMAPS_CID, await text(page, ".sheet .note"));
  await settle(page); await shot(page, `${SHOTS}/14b-admin-gmaps-link.png`);
  await page.evaluate(() => { const home = [...document.querySelectorAll(".sheet .gal")].find((l) => /home/.test(l.textContent)); home.querySelector("input").click(); });
  await clickText(page, ".sheet button", "Save");
  ok("save closes the editor", await waitFor(page, () => !document.querySelector(".sheet")));
  const lib = await (await fetch(`${A}/creator/api/moments`, { headers: { "remote-email": WHO } })).json();
  ok("membership persisted: the edited photo is now only in Friends", JSON.stringify(lib.find((m) => m.id === editId).galleries) === JSON.stringify([friendsId]), JSON.stringify(lib.find((m) => m.id === editId).galleries));
  ok("the exact Google Maps link and the place name were saved", lib.find((m) => m.id === editId).mapsUrl === GMAPS_CID && lib.find((m) => m.id === editId).place === "Lau Pa Sat", JSON.stringify([lib.find((m) => m.id === editId).mapsUrl, lib.find((m) => m.id === editId).place]));
  const savedCaps = lib.find((m) => m.id === editId).captions;
  ok("...and both captions with their styles", savedCaps?.length === 2 && JSON.stringify(savedCaps[0]) === JSON.stringify({ text: "Satay by the water", x: 0.5, y: 0.77, rot: -8, font: "editorial", size: "m", bg: "dark", ink: "light", align: "center" }) && savedCaps[1].text === "and the queue was worth it" && savedCaps[1].font === "retro" && savedCaps[1].y < savedCaps[0].y, JSON.stringify(savedCaps));
  ok("...and the single caption still names the first, for alt text and lists", lib.find((m) => m.id === editId).caption === "Satay by the water" && lib.find((m) => m.id === editId).captionStyle.font === "editorial");
  // ...and the story shows exactly that: the same renderer, on the photo, where it was put.
  await page.goto(`${V}/g/${friendsId}#m/${editId}`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".story .cap-host .cap", { timeout: 15000 });
  ok("the viewer's story wears both captions", (await count(page, ".story .cap-host .cap")) === 2 && /and the queue was worth it/.test(await text(page, ".story .cap-host")), await text(page, ".story .cap-host"));
  ok("the viewer's story wears the styled caption: Editorial face in a dark pill, 77% down, on the photo", await page.$eval(".story .cap-host .cap", (c) => { const s = getComputedStyle(c), r = c.getBoundingClientRect(), f = c.closest(".story").getBoundingClientRect(); return c.textContent === "Satay by the water" && /Playfair Display/.test(s.fontFamily) && s.backgroundColor === "rgba(8, 9, 12, 0.66)" && Math.abs((r.top + r.height / 2 - f.top) / f.height - 0.77) < 0.03; }), await page.$eval(".story .cap-host .cap", (c) => { const r = c.getBoundingClientRect(), f = c.closest(".story").getBoundingClientRect(); return `${getComputedStyle(c).fontFamily} | centre at ${((r.top + r.height / 2 - f.top) / f.height).toFixed(2)}`; }));
  ok("...tilted exactly as it was in the admin, and with no handle for visitors to grab", Math.abs((await turnOf(page, ".story .cap-host .cap")) + 8) < 0.5 && (await page.$(".story .cap-host .cap .turn")) === null, `turned ${await turnOf(page, ".story .cap-host .cap")}°`);
  ok("...with both bundled faces actually loaded, the classic one and the playful one", await page.evaluate(() => document.fonts.check('16px "Playfair Display"') && document.fonts.check('16px Pacifico')));
  ok("...which the worker fetched on demand, not at install", await page.evaluate(async () => { const k = (await caches.keys()).find((n) => n.startsWith("itineris-viewer-shell-")); const shell = k ? (await (await caches.open(k)).keys()).map((r) => r.url) : []; return !shell.some((u) => /\.woff2$/.test(u)); }));
  await settle(page); await shot(page, `${SHOTS}/13b-story-caption.png`);
  await page.keyboard.press("Escape"); await sleep(300);
  await page.goto(`${A}/creator/`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".cell");

  console.log("--- creator: a Google Maps link pasted for the next photos ---");
  // The place box is one tap away rather than permanently open above the
  // photos it is about.
  ok("the place picker is folded away until asked for", (await page.$('.drop input[aria-label="Search a place"]')) === null);
  await clickText(page, ".drop button", "Pin the next photos to a place");
  await page.waitForSelector('.drop input[aria-label="Search a place"]', { timeout: 5000 });
  await page.$eval('.drop input[aria-label="Search a place"]', (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, GMAPS);
  await page.focus('.drop input[aria-label="Search a place"]'); await page.keyboard.press("Enter");
  const bannerUp = () => /Lau Pa Sat/.test(document.querySelector(".shared")?.textContent ?? "") && /Add photos at “Lau Pa Sat”/.test(document.querySelector(".drop .btn.primary")?.textContent ?? "");
  let bannerOk = await waitFor(page, bannerUp, 5000);
  if (!bannerOk) { await page.focus('.drop input[aria-label="Search a place"]'); await page.keyboard.press("Enter"); bannerOk = await waitFor(page, bannerUp, 10000); }   // a busy box can swallow the first Enter
  ok("the place banner appears and the upload button targets it", bannerOk, `${await text(page, ".shared")} | ${await text(page, ".drop .btn.primary")}`);
  await settle(page); await shot(page, `${SHOTS}/14c-admin-shared-place.png`);
  await tap(page, '.shared button[aria-label="Dismiss place"]'); await sleep(200);
  ok("dismissed: back to plain uploads", (await page.$(".shared")) === null && /^Add photos/.test(await text(page, ".drop .btn.primary")) && !/Lau Pa Sat/.test(await text(page, ".drop .btn.primary")));
  // Your places: one tap pins the next photos to a place already in the journal.
  ok("your places are offered on the upload surface", (await count(page, ".drop .kchip")) > 0, String(await count(page, ".drop .kchip")));
  const kname = await page.$eval(".drop .kchip .nm", (el) => el.textContent);
  await (await page.$(".drop .kchip")).tap(); await sleep(300);
  ok("one tap pins the next photos to that place", new RegExp(kname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(await text(page, ".shared")) && (await text(page, ".drop .btn.primary")).includes(kname), await text(page, ".shared"));
  await tap(page, '.shared button[aria-label="Dismiss place"]'); await sleep(200);

  console.log("--- creator: upload in bad conditions ---");
  const UP = path.join(SCRATCH, "e2e-uploads"); mkdirSync(UP, { recursive: true });
  writeFileSync(path.join(UP, "q1.jpg"), await fakeJpeg({ date: "2026:03:19 10:00:00", offset: "+08:00", lat: 1.29, lng: 103.85, seed: 7 }));
  writeFileSync(path.join(UP, "q2.jpg"), await fakeJpeg({ seed: 8, w: 1200, h: 1600 }));
  await clickText(page, ".tabs button", "Photos"); await page.waitForSelector('[data-testid="file-input"]');
  await page.select(".filter select", "all");   // otherwise uploads land in the filtered gallery, which is the feature
  const before = (await (await fetch(`${A}/creator/api/moments`, { headers: { "remote-email": WHO } })).json()).length;
  await page.setOfflineMode(true);
  await (await page.$('[data-testid="file-input"]')).uploadFile(path.join(UP, "q1.jpg"), path.join(UP, "q2.jpg"));
  // "Instantly" = without waiting for any network; on-device thumbnails and EXIF
  // still take a moment in a software-rendered headless browser.
  ok("photos queued instantly while offline", await waitFor(page, () => document.querySelectorAll(".queue .tile").length === 2, 25000));
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
  proxy.state.failPattern = /\/creator\/api\/upload/;
  await page.setOfflineMode(false);
  ok("server unreachable: queue reports it is retrying automatically", await waitFor(page, () => /retrying|Connection trouble/.test(document.querySelector(".queue .status")?.textContent ?? ""), 20000), await text(page, ".queue .status"));
  await settle(page); await shot(page, `${SHOTS}/16-admin-queue-retrying.png`);
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector(".queue .tile", { timeout: 15000 });
  ok("the queue survives a reload (IndexedDB)", (await count(page, ".queue .tile")) === 2 && /queued/.test(await text(page, ".queue .tile .tags")));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.setOfflineMode(true); proxy.state.down = true;
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector(".queue .tile", { timeout: 15000 });
  ok("the admin wears the mark too", await page.$eval("header .brand .mark", (i) => i.complete && i.naturalWidth > 0), await page.$eval("header .brand .mark", (i) => i.getAttribute("src")).catch(() => "(no mark)"));
  ok("the admin itself opens OFFLINE: shell from the worker, library from the last copy, queue from IndexedDB", (await count(page, ".queue .tile")) === 2 && (await waitFor(page, () => document.querySelectorAll(".cell").length > 0)) && /Offline|Saved copy/.test(await text(page, "header")), `${await count(page, ".cell")} cells; ${await text(page, "header")}`);
  ok("OFFLINE: the library really came from the worker's saved copy", (await page.evaluate(() => fetch("/creator/api/library").then((r) => r.headers.get("x-itineris-cache")))) === "fallback");
  await settle(page); await shot(page, `${SHOTS}/17-admin-offline-reload.png`);
  proxy.state.down = false; await page.setOfflineMode(false);
  proxy.state.failPattern = null;
  await clickText(page, ".queue .status button", "Retry now");
  ok("uploads complete once the server is back", await waitFor(page, () => !document.querySelector(".queue"), 40000), await text(page, ".queue .status"));
  const libAfter = await (await fetch(`${A}/creator/api/moments`, { headers: { "remote-email": WHO } })).json();
  const q = libAfter.find((m) => m.caption === "Tagged before it ever left the phone");
  ok("arrived annotated: caption + tag from the queue, EXIF time kept", !!q && q.tags.includes("queued") && q.t === "2026-03-19T10:00:00+08:00", JSON.stringify(q && { tags: q.tags, t: q.t }));
  ok("both queued photos are in the library, private", libAfter.length === before + 2 && libAfter.filter((m) => m.galleries.length === 0).length >= 2, `${before} -> ${libAfter.length}`);
  ok("nothing left in the queue on a fresh load", (await page.reload({ waitUntil: "domcontentloaded" }), await page.waitForSelector(".cell"), (await page.$(".queue")) === null));

  console.log("--- a video: queued with its own poster, transcoded on the server, played in the story ---");
  let hasFfmpeg = true; try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { hasFfmpeg = false; }
  if (!hasFfmpeg) console.log("  skip  no ffmpeg on PATH");
  else {
    const clip = path.join(UP, "clip.mp4");
    // Twenty seconds: the story moves on (here: closes) when its video ends, and every check below must land before that.
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=20:size=640x360:rate=15", "-f", "lavfi", "-i", "sine=frequency=440:duration=20", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      "-metadata", "creation_time=2026-03-19T02:00:00Z", "-metadata", "location=+01.2900+103.8600/", clip], { stdio: "ignore" });
    await page.select(".filter select", "all");
    await (await page.$('[data-testid="file-input"]')).uploadFile(clip);
    ok("a video queues like a photo, marked as one", await waitFor(page, () => document.querySelector(".queue .tile .vid") !== null, 15000));
    ok("...with a poster drawn on the device", await waitFor(page, () => { const i = document.querySelector(".queue .tile img"); return !!i && i.complete && i.naturalWidth > 0; }, 15000));
    ok("it uploads and the server finishes the video", await waitFor(page, () => !document.querySelector(".queue"), 120000));
    const libV = (await (await fetch(`${A}/creator/api/moments`, { headers: { "remote-email": WHO } })).json()).find((m) => m.media?.type === "video");
    ok("the library has a video moment placed and timed from the file", !!libV && libV.lat === 1.29 && libV.t === "2026-03-19T10:00:00+08:00", JSON.stringify(libV && { t: libV.t, lat: libV.lat, media: libV.media.src }));
    ok("the library list marks it ▶", await waitFor(page, () => document.querySelector(".cell .flag.vid") !== null));
    // The editor has to show a still: an <img> cannot draw the .mp4 itself.
    await tapEl(page, await page.$(`.cell[data-id="${libV.id}"]`)); await page.waitForSelector(".sheet .top img");
    ok("the editor shows the video as a still, loaded, and marks it ▶", await page.$eval(".sheet .top img", (i) => i.complete && i.naturalWidth > 0 && /\.webp$/.test(i.getAttribute("src"))) && (await page.$(".sheet .shot .vid")) !== null, await page.$eval(".sheet .top img", (i) => `${i.getAttribute("src")} ${i.naturalWidth}px`));
    await settle(page); await shot(page, `${SHOTS}/19-admin-video-editor.png`);
    await clickText(page, ".sheet button", "Cancel"); await waitFor(page, () => !document.querySelector(".sheet"));
    await fetch(`${A}/creator/api/galleries/${friendsId}`, { method: "PATCH", headers: { "remote-email": WHO, "content-type": "application/json" }, body: JSON.stringify({ add: [libV.id] }) });
    await page.goto(`${V}/g/${friendsId}#m/${libV.id}`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".story video.media", { timeout: 20000 });
    ok("the story plays it: a <video> over its poster, muted, with a sound button and its length", (await page.$eval(".story video.media", (v) => v.muted && v.hasAttribute("playsinline") && /-1280\.mp4$/.test(v.getAttribute("src")) && /-960\.webp$/.test(v.getAttribute("poster")))) && (await page.$('.story .sound[aria-label="Turn sound on"]')) !== null && (await text(page, ".story .dur")) === "0:20");
    ok("...and the browser can actually decode it", await page.waitForFunction(() => { const v = document.querySelector(".story video.media"); return v && v.readyState >= 2; }, { timeout: 20000 }).then(() => true).catch(() => false), await page.$eval(".story video.media", (v) => `readyState ${v.readyState} error ${v.error?.code ?? "none"}`));
    ok("the strip marks the video ▶", (await count(page, ".tick .vid")) === 1);
    await settle(page); await shot(page, `${SHOTS}/18-story-video.png`);
    await page.keyboard.press("Escape"); await sleep(300);
    // put the Friends gallery back the way the later checks expect it
    await fetch(`${A}/creator/api/galleries/${friendsId}`, { method: "PATCH", headers: { "remote-email": WHO, "content-type": "application/json" }, body: JSON.stringify({ remove: [libV.id] }) });
    await page.goto(`${A}/creator/`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".cell");
  }

  console.log("--- photos without GPS: a gallery with no locations, then bulk Set location ---");
  const lib2 = await (await fetch(`${A}/creator/api/moments`, { headers: { "remote-email": WHO } })).json();
  const noGps = lib2.find((m) => m.lat === null && m.galleries.length === 0);
  ok("a photo arrived without GPS (as phones do)", !!noGps, noGps?.id);
  await page.select(".filter select", "all"); await clickText(page, ".toolbar button", "Select");
  await tapEl(page, await page.$(`.cell[data-id="${noGps.id}"]`));
  await clickText(page, ".bulk button", "Gallery"); await page.select(".bulk select", "__new__"); await sleep(200);
  await page.type('.bulk input[aria-label="New gallery name"]', "Nowhere in particular");
  await clickText(page, ".bulk button", "Create with 1");
  ok("gallery of one unplaced photo created", await waitFor(page, () => [...document.querySelectorAll(".filter option")].some((o) => /Nowhere in particular \(1\)/.test(o.textContent))));
  const nowhere = (await (await fetch(`${A}/creator/api/galleries`, { headers: { "remote-email": WHO } })).json()).find((g) => g.title === "Nowhere in particular");
  await page.goto(`${V}/g/${nowhere.id}`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".wall .cell", { timeout: 20000 });
  ok("a gallery with no locations opens on the wall (the one case the map is not the view), clean URL", (await page.$(".wall .cell")) !== null && (await hash(page)) === "" && (await page.$(".chrome .toggle")) === null, await hash(page));
  ok("...and says why there is no map (no city pretends to be the place)", /No locations yet/.test(await text(page, ".chrome .top")), await text(page, ".chrome .top"));
  // Every photo is already in the grid here, so a ring meaning "these have no
  // pin" would be pointing at all of them. It belongs to the map, not the wall.
  ok("...and no story ring on the wall, where the grid already shows everything", (await page.$(".mine-story")) === null);
  await settle(page); await shot(page, `${SHOTS}/23-viewer-no-locations.png`);

  // A gallery with BOTH kinds: now the ring has a job, and has to be doing it.
  // Nobody looks at a logo, so the turning is the whole reason the photos with
  // no place get discovered -- "is an animation declared" is not enough, the
  // pixels have to move.
  await fetch(`${A}/creator/api/galleries/${friendsId}`, { method: "PATCH", headers: { "remote-email": WHO, "content-type": "application/json" }, body: JSON.stringify({ add: [noGps.id] }) });
  await page.goto(`${V}/g/${friendsId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".mine-story", { timeout: 20000 });
  // (MapLibre by here -- the Google section removed its config.json -- so the
  // placed photos are canvas pins, not .gpin nodes.)
  ok("a mixed gallery puts a story ring on the mark", (await page.$(".mine-story")) !== null && (await page.$(".map")) !== null);
  {
    const a = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector(".mine-story"), "::before"); return { name: cs.animationName, iter: cs.animationIterationCount, conic: cs.backgroundImage.includes("conic") }; });
    ok("...and while unseen it turns, in Instagram's colours", a.name !== "none" && a.iter === "infinite" && a.conic, JSON.stringify(a));
    const clip = await page.$eval(".mine-story", (e) => { const r = e.getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; });
    const frames = [];
    for (let i = 0; i < 4; i++) { frames.push(await page.screenshot({ clip, encoding: "base64" })); await sleep(340); }
    ok("...and the pixels really move", new Set(frames).size >= 3, `${new Set(frames).size} distinct of ${frames.length}`);
    ok("...while the mark inside stays upright", await page.evaluate(() => getComputedStyle(document.querySelector(".mine-story .mark")).animationName === "none"));
    await (await page.$(".mine-story")).tap();
    await page.waitForSelector(".story", { timeout: 10000 });
    await page.keyboard.press("Escape"); await waitFor(page, () => !document.querySelector(".story"));
    await sleep(600);
    const after = await page.evaluate(() => { const el = document.querySelector(".mine-story"); return { seen: el.classList.contains("seen"), anim: getComputedStyle(el, "::before").animationName }; });
    ok("...and it goes grey and still once watched", after.seen && after.anim === "none", JSON.stringify(after));
  }
  await fetch(`${A}/creator/api/galleries/${friendsId}`, { method: "PATCH", headers: { "remote-email": WHO, "content-type": "application/json" }, body: JSON.stringify({ remove: [noGps.id] }) });

  await page.goto(`${A}/creator/`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".cell");
  await page.select(".filter select", "all"); await clickText(page, ".toolbar button", "Select");
  await tapEl(page, await page.$(`.cell[data-id="${noGps.id}"]`));
  await clickText(page, ".bulk button", "Location"); await page.waitForSelector('.bulk input[aria-label="Latitude"]');
  await page.type('.bulk input[aria-label="Latitude"]', "37.7749"); await page.type('.bulk input[aria-label="Longitude"]', "-122.4194");
  await clickText(page, ".bulk button", "Apply to 1");
  ok("bulk Set location applied", await waitFor(page, () => !document.querySelector(".bulk .loc")));
  const placedNow = (await (await fetch(`${A}/creator/api/moments`, { headers: { "remote-email": WHO } })).json()).find((m) => m.id === noGps.id);
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
  const pubFriendsNow = await (await fetch(`${V}/data/galleries/${friendsId}.json`)).json();
  ok("the exact Google Maps link reached the public gallery", pubFriendsNow.moments.find((m) => m.id === editId)?.mapsUrl === GMAPS_CID);
  ok("thumbnails really load under /g/<token> (absolute media URLs)", await page.$$eval(".tick img", (imgs) => imgs.length > 0 && imgs.every((i) => i.naturalWidth > 0)), await page.$$eval(".tick img", (imgs) => imgs.map((i) => i.getAttribute("src")).join(",")));
  await settle(page, { map: true }); await shot(page, `${SHOTS}/20-viewer-friends.png`);
  await page.goto(`${V}/`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".tick");
  ok("home gallery lost the photo moved out of it", (await count(page, ".tick")) === 19, String(await count(page, ".tick")));
  console.log("--- viewer: how many people have seen this ---");
  // The eye in the top right. The number is recorded server-side and comes
  // back on the same request, so what matters here is that the round trip
  // works across the two pods, that reloading does not inflate it, and that
  // the pretty name and the token are one gallery with one count.
  await page.goto(`${V}/g/${friendsId}`, { waitUntil: "domcontentloaded" });
  ok("an eye appears once the count comes back", await waitFor(page, () => !!document.querySelector(".views"), 10000));
  const eye1 = await text(page, ".views .count");
  ok("...showing a real number", /^\d/.test(eye1), eye1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitFor(page, () => !!document.querySelector(".views"), 10000);
  ok("...that reloading does not inflate", (await text(page, ".views .count")) === eye1, `${eye1} -> ${await text(page, ".views .count")}`);
  ok("...and reads as views to a screen reader", /views?$/.test((await page.$eval(".views", (e) => e.textContent)).trim()), await page.$eval(".views", (e) => e.textContent));
  ok("...and says the exact number on hover", /^\d[\d,]* views?$/.test(await page.$eval(".views", (e) => e.title)), await page.$eval(".views", (e) => e.title));
  ok("the eye is at the right-hand end of the bar, after the gallery's name",
    await page.evaluate(() => {
      const bar = document.querySelector(".top").getBoundingClientRect();
      const v = document.querySelector(".views").getBoundingClientRect();
      const brand = document.querySelector(".brand").getBoundingClientRect();
      return { ok: v.left > brand.right - 1 && bar.right - v.right < 90 && v.top >= bar.top - 1 && v.bottom <= bar.bottom + 1, gapRight: Math.round(bar.right - v.right), afterBrand: Math.round(v.left - brand.right) };
    }).then((r) => { if (!r.ok) console.log("        " + JSON.stringify(r)); return r.ok; }));
  ok("...and it is out of the way once a story is open",
    await page.evaluate(() => getComputedStyle(document.querySelector(".chrome")).opacity) === "1");
  await shot(page, `${SHOTS}/20b-viewer-views.png`);
  // The same gallery by its pretty name must not start a second count.
  const listNow = await (await fetch(`${A}/creator/api/galleries`)).json();
  const friends = listNow.find((x) => x.id === friendsId);
  ok("the creator sees the same count on the gallery", String(friends?.views) === eye1, `${friends?.views} vs ${eye1}`);

  console.log("--- viewer: where am I ---");
  // The browser asks nobody until the button is tapped; then a blue dot, and the
  // camera goes there once. (There is no download button: the worker keeps
  // whatever was actually looked at -- see the offline section below.)
  await page.goto(`${V}/`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".tick");
  ok("no download button in the top bar", (await page.$('[aria-label="Save for offline"]')) === null);
  const stamped = (await (await fetch(`${V}/`)).text()).match(/name="itineris-version" content="([^"]+)"/)?.[1] ?? "";
  ok("the served HTML says which build it is, without running any of it", /^\d+\.\d+\.\d+$/.test(stamped), stamped || "(none)");
  ok("...and so does the running app", /^\d+\.\d+\.\d+$/.test(await page.$eval("main", (m) => m.dataset.appVersion ?? "")), await page.$eval("main", (m) => m.dataset.appVersion ?? "(none)"));
  ok("the mark rides in the top bar, loaded", await page.$eval(".brand .mark", (i) => i.complete && i.naturalWidth > 0 && /mark-96\.png$/.test(i.getAttribute("src"))), await page.$eval(".brand .mark", (i) => `${i.getAttribute("src")} ${i.naturalWidth}px`).catch(() => "(no mark)"));
  await browser.defaultBrowserContext().overridePermissions(V, ["geolocation"]);
  await page.setGeolocation({ latitude: 1.3521, longitude: 103.8198, accuracy: 18 });
  ok("the locate button is there, and nothing has been asked yet", (await page.$('[aria-label="Show my location"]')) !== null && (await page.$('.map[data-me="1"]')) === null);
  await tap(page, '[aria-label="Show my location"]');
  ok("tapping it puts the visitor on the map", await waitFor(page, () => document.querySelector('.map[data-me="1"]') !== null, 15000));
  ok("...and the button says so", (await page.$('[aria-label="Hide my location"]')) !== null && (await page.$(".locate.on")) !== null);
  await settle(page, { map: true }); await shot(page, `${SHOTS}/25-viewer-my-location.png`);
  await tap(page, '[aria-label="Hide my location"]');
  ok("tapping again takes it off the map and forgets it", await waitFor(page, () => document.querySelector('.map[data-me="1"]') === null) && (await page.$('[aria-label="Show my location"]')) !== null);

  console.log("--- viewer: no network at all, on what the visit itself cached ---");
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
  // Look at a story while there is still a network: that is what puts its photo in the cache.
  await (await page.$(".tick")).tap(); await page.waitForSelector(".story img.media");
  await page.waitForSelector(".story img.media.loaded", { timeout: 15000 }).catch(() => {});
  await page.keyboard.press("Escape"); await sleep(300); await settle(page, { map: true });
  await page.setOfflineMode(true); nginx.kill(); await sleep(400);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tick", { timeout: 20000 });
  ok("OFFLINE: the gallery opens from the worker's copy", (await text(page, ".brand .title")) === "Friends" && (await count(page, ".tick")) === 2);
  ok("OFFLINE: the data really came from the worker's cache", (await page.evaluate((id) => fetch(`/data/galleries/${id}.json`).then((r) => r.headers.get("x-itineris-cache")), friendsId)) === "fallback");
  ok("OFFLINE: it says so", /Offline|Saved copy/.test(await text(page, ".chrome .top")), await text(page, ".chrome .top"));
  await page.waitForFunction(() => [...document.querySelectorAll(".tick img")].every((i) => i.complete), { timeout: 10000 });
  ok("OFFLINE: thumbnails come from the cache", await page.$$eval(".tick img", (imgs) => imgs.every((i) => i.naturalWidth > 0)));
  ok("OFFLINE: the map has its tiles", await waitFor(page, () => document.querySelector('.map[data-idle="1"]') !== null, 30000));
  await (await page.$(".tick")).tap(); await page.waitForSelector(".story");
  ok("OFFLINE: the story we had looked at opens with its photo", await page.waitForSelector(".story img.media.loaded", { timeout: 10000 }).then(() => page.$eval(".story img.media", (i) => i.complete && i.naturalWidth > 0)).catch(() => false));
  await settle(page); await shot(page, `${SHOTS}/22-viewer-offline.png`);
  await page.keyboard.press("Escape");
  await page.setOfflineMode(false); nginx = await startNginx();
  const pubFriends = await (await fetch(`${V}/data/galleries/${friendsId}.json`)).json();
  ok("public gallery JSON carries no private fields", !JSON.stringify(pubFriends).match(/uploadedBy|filename|camera|original/));
  const libTry = await fetch(`${V}/library/moments.json`);
  ok("manifest served as application/manifest+json", ((await fetch(`${V}/manifest.webmanifest`)).headers.get("content-type") ?? "").includes("manifest+json"));
  // The mark: every slot the head and the manifest name has to be there, and be an image.
  const icons = ["/mark-96.png", "/favicon.ico", "/favicon-16.png", "/favicon-32.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png", "/og-card.png"];
  const served = await Promise.all(icons.map(async (u) => { const r = await fetch(`${V}${u}`); return `${u} ${r.status} ${(r.headers.get("content-type") ?? "").split(";")[0]} ${(await r.arrayBuffer()).byteLength}B`; }));
  ok("the mark is served in every size the page and the manifest ask for", served.every((s) => / 200 image\/(png|x-icon|vnd\.microsoft\.icon) [1-9]/.test(s)), served.join(" | "));
  const mani = await (await fetch(`${V}/manifest.webmanifest`)).json();
  ok("...and the manifest offers a maskable one for Android's circle", mani.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512") && mani.icons.every((i) => icons.includes(i.src)), JSON.stringify(mani.icons.map((i) => `${i.src} ${i.purpose}`)));
  ok("the page points at the mark, not at a leftover placeholder", await page.evaluate(() => { const hrefs = [...document.querySelectorAll('link[rel*="icon"]')].map((l) => l.getAttribute("href")); return hrefs.length >= 3 && hrefs.every((h) => /favicon|apple-touch/.test(h)) && !hrefs.some((h) => /icon\.svg/.test(h)); }), await page.evaluate(() => [...document.querySelectorAll('link[rel*="icon"]')].map((l) => l.getAttribute("href")).join(",")));
  ok("the library itself is not reachable publicly", (await fetch(`${V}/data/moments.json`)).status === 404 && !(libTry.headers.get("content-type") ?? "").includes("json") && !(await libTry.text()).includes("uploadedBy"));
} catch (e) {
  fail++; console.log("  FAIL  exception:", e.message); await shot(page, `${SHOTS}/99-failure.png`).catch(() => {});
} finally {
  await browser.close(); nginx.kill(); admin.kill(); await proxy.close();
}
// The dead-link scenario 404s on purpose; the bad-network scenario makes uploads 502 and
// takes servers down on purpose.
const real = problems.filter((p) => !/favicon|nope-not-real|\/creator\/api\/upload|\/creator\/auth\/google|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_RESET|ERR_CONNECTION_REFUSED|status of 502|status of 503/.test(p));
console.log(`\nbrowser problems: ${real.length}`); for (const p of real) console.log("  ! " + p);
if (real.length) fail++;
console.log(fail ? `\n${fail} FAILED` : "\nall passed"); console.log(`shots: ${SHOTS}`);
process.exit(fail ? 1 : 0);
