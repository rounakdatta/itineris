// Pinch to zoom, driven through the browser's real touch pipeline.
//
// This gets its own harness because it is the one gesture that has to share a
// frame with four others -- tap to advance, swipe to change photo, drag down
// to dismiss, hold to pause -- and because a hand-written PointerEvent would
// happily pass against code no actual finger could drive. Every touch below
// goes through CDP's Input.dispatchTouchEvent, which is the same path the
// renderer uses for a real screen: touch-action, pointer capture and pointer
// event synthesis all apply.
//
// Run: npm run test:pinch
import { spawn, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { startAuthProxy } from "./lib/authproxy.mjs";
import { launch, sleep, resolveBrowserEnv, shot } from "./browser.mjs";
import { GMAPS_STUB } from "./lib/gmaps-stub.js";
const sharp = createRequire(path.join(process.cwd(), "package.json"))("sharp");

const ROOT = process.cwd();
const SCRATCH = process.env.SCRATCH ?? mkdtempSync(path.join(tmpdir(), "itineris-pinch-"));
const SHOTS = path.join(SCRATCH, "shots"); mkdirSync(SHOTS, { recursive: true });
const NIX = "nix --extra-experimental-features nix-command --extra-experimental-features flakes";
const nixStore = (pkg) => execSync(`${NIX} build nixpkgs#${pkg} --no-link --print-out-paths`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0];
const V = "http://127.0.0.1:4341", SRV = 4342, A = "http://127.0.0.1:4343";

let fail = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "  ok  " : "  FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!cond) fail++; };
const note = (m) => console.log("        " + m);

// The server shells out to ffprobe for a video's dimensions, and there is no
// ffmpeg on PATH in the sandbox this usually runs in.
let hasFfmpeg = true;
try { execSync("ffprobe -version", { stdio: "ignore" }); }
catch { try { process.env.PATH = `${nixStore("ffmpeg-headless")}/bin:${process.env.PATH}`; execSync("ffprobe -version", { stdio: "ignore" }); } catch { hasFfmpeg = false; } }

const dataDir = path.join(SCRATCH, "data"); rmSync(dataDir, { recursive: true, force: true });
const server = spawn(process.execPath, ["server/index.js"], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"],
  env: { ...process.env, ITINERIS_PORT: String(SRV), ITINERIS_DATA_DIR: dataDir, ITINERIS_SEED_DIR: "", ITINERIS_CREATOR_UI_DIR: "dist-admin" } });
server.stderr.on("data", (b) => process.stderr.write(b));
for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://127.0.0.1:${SRV}/creator/healthz`)).ok) break; } catch { /* starting */ } await sleep(100); }
const proxy = await startAuthProxy({ port: 4343, target: SRV, email: "pinch@example.com" });

const NGINX = nixStore("nginx");
const nd = path.join(SCRATCH, "nginx"); rmSync(nd, { recursive: true, force: true });
for (const d of ["conf", "logs", "tmp", "docroot"]) mkdirSync(path.join(nd, d), { recursive: true });
for (const f of readdirSync(path.join(ROOT, "dist"))) if (!["data", "media"].includes(f)) symlinkSync(path.join(ROOT, "dist", f), path.join(nd, "docroot", f));
symlinkSync(path.join(dataDir, "data"), path.join(nd, "docroot/data"));
symlinkSync(path.join(dataDir, "media"), path.join(nd, "docroot/media"));
writeFileSync(path.join(nd, "docroot/config.json"), JSON.stringify({ googleMapsApiKey: "pinch-fake-key" }));
writeFileSync(path.join(nd, "conf/security-headers.conf"), readFileSync(path.join(ROOT, "nginx/security-headers.conf")));
writeFileSync(path.join(nd, "conf/default.conf"), readFileSync(path.join(ROOT, "nginx/default.conf"), "utf8")
  .replaceAll("/etc/nginx/security-headers.conf", path.join(nd, "conf/security-headers.conf"))
  .replace("root /usr/share/nginx/html;", `root ${path.join(nd, "docroot")};`).replace("listen 8080;", "listen 127.0.0.1:4341;")
  // Traefik path-routes /creator on the same host in production (see the
  // homelab's ingress-admin.yaml), and the viewer posts a view there. Without
  // this the harness is two origins where the real thing is one, and the page
  // logs a 405 on every load.
  .replace("location / {", `location /creator/ {\n        proxy_pass http://127.0.0.1:${SRV};\n        proxy_set_header Host $host;\n        proxy_set_header X-Forwarded-For $remote_addr;\n    }\n\n    location / {`));
writeFileSync(path.join(nd, "conf/nginx.conf"), `pid ${nd}/nginx.pid;\nerror_log ${nd}/logs/error.log;\nevents {}\nhttp {\n  include ${NGINX}/conf/mime.types;\n  access_log ${nd}/logs/access.log;\n  client_body_temp_path ${nd}/tmp; proxy_temp_path ${nd}/tmp; fastcgi_temp_path ${nd}/tmp; uwsgi_temp_path ${nd}/tmp; scgi_temp_path ${nd}/tmp;\n  include ${nd}/conf/default.conf;\n}\n`);
const nginx = spawn(path.join(NGINX, "bin/nginx"), ["-c", path.join(nd, "conf/nginx.conf"), "-p", nd, "-g", "daemon off;"], { stdio: "ignore" });
for (let i = 0; i < 300; i++) { try { if ((await fetch(`${V}/healthz`)).ok) break; } catch { /* starting */ } await sleep(100); }

// A grid rather than a flat colour: at 4x you can see WHICH part of the photo
// is under the fingers, so a zoom that drifts is visible in a screenshot.
const grid = (w, h, hue) => {
  let cells = "";
  for (let y = 0; y < h; y += 100) for (let x = 0; x < w; x += 100)
    cells += `<rect x="${x}" y="${y}" width="98" height="98" fill="hsl(${(hue + x / 6 + y / 6) % 360},60%,${30 + ((x / 100 + y / 100) % 5) * 9}%)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#111"/>${cells}</svg>`;
};
const upload = async (meta, file, name, type) => {
  const fd = new FormData();
  fd.append("files", new Blob([file], { type }), name);
  fd.append("meta", JSON.stringify(meta));
  const r = await fetch(`${A}/creator/api/upload`, { method: "POST", body: fd });
  const j = await r.json();
  if (!j.created?.[0]) { console.log(`  FAIL  upload ${name}: ${r.status} ${JSON.stringify(j.errors ?? j).slice(0, 200)}`); fail++; }
  return j.created?.[0]?.id ?? null;
};
const photo = (meta, hue, w = 900, h = 1200) => sharp(Buffer.from(grid(w, h, hue))).jpeg().toBuffer().then((b) => upload(meta, b, `p${hue}.jpg`, "image/jpeg"));

const ids = [
  // One placed photo, so the gallery has a map and the ring is the loose group.
  await photo({ place: "Maxwell", t: "2026-03-14T08:40:00+08:00", lat: 1.2803, lng: 103.8447 }, 20),
  await photo({ t: "2026-03-14T12:00:00+08:00" }, 200),                 // portrait, covers
  await photo({ t: "2026-03-14T12:30:00+08:00" }, 300),                 // portrait, covers
  await photo({ t: "2026-03-14T13:00:00+08:00" }, 100, 1600, 900),      // landscape, letterboxed
];
if (hasFfmpeg) {
  const clip = path.join(SCRATCH, "clip.mp4");
  execSync(`ffmpeg -v error -y -f lavfi -i testsrc=duration=25:size=720x1280:rate=15 -c:v libx264 -pix_fmt yuv420p ${clip}`);
  ids.push(await upload({ t: "2026-03-14T14:00:00+08:00" }, readFileSync(clip), "clip.mp4", "video/mp4"));
} else {
  console.log("  skip  no ffmpeg and none buildable: the video pinch is not covered");
}
const g = (await (await fetch(`${A}/creator/api/galleries`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "Pinch", momentIds: ids.filter(Boolean) }) })).json()).id;

const env = resolveBrowserEnv(SCRATCH);
const { browser, page, problems } = await launch({ env, width: 390, height: 844, mobile: true });
await page.setRequestInterception(true);
page.on("request", (r) => /^https:\/\/maps\.googleapis\.com\/maps\/api\/js/.test(r.url())
  ? r.respond({ status: 200, contentType: "application/javascript", body: GMAPS_STUB }) : r.continue());
const cdp = await page.target().createCDPSession();

const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", {
  type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1, radiusX: 12, radiusY: 12, force: 1 })),
});
// Two fingers spreading from, or closing on, a midpoint -- in steps, the way
// a hand moves. Returns the "let go" so a test can inspect mid-pinch.
async function pinch(mid, from, to, steps = 10) {
  const at = (d) => [{ x: mid.x - d / 2, y: mid.y }, { x: mid.x + d / 2, y: mid.y }];
  await touch("touchStart", at(from));
  for (let i = 1; i <= steps; i++) { await touch("touchMove", at(from + (to - from) * (i / steps))); await sleep(16); }
  return async () => { await touch("touchEnd", []); await sleep(340); };
}
const drag = async (from, to, steps = 8) => {
  await touch("touchStart", [from]);
  for (let i = 1; i <= steps; i++) { await touch("touchMove", [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }]); await sleep(16); }
  await touch("touchEnd", []); await sleep(340);
};
const tapAt = async (p) => { await touch("touchStart", [p]); await sleep(40); await touch("touchEnd", []); await sleep(340); };

const zstate = () => page.evaluate(() => {
  const el = document.querySelector(".story");
  if (!el) return null;
  const cs = getComputedStyle(el);
  const media = el.querySelector(".media");
  const m = media && new DOMMatrixReadOnly(getComputedStyle(media).transform);
  return {
    z: +cs.getPropertyValue("--z"), zx: +cs.getPropertyValue("--zx").replace("px", ""), zy: +cs.getPropertyValue("--zy").replace("px", ""),
    zoomed: el.classList.contains("zoomed"), pinching: el.classList.contains("pinching"),
    applied: m && { a: +m.a.toFixed(3), e: +m.e.toFixed(1), f: +m.f.toFixed(1) },
    hint: el.querySelector(".hint")?.textContent ?? "",
  };
});
// Sum of the progress bars: a sharper measure of "is the timer running" than
// waiting five seconds to see whether it moved on.
const prog = () => page.evaluate(() => [...document.querySelectorAll(".story .bar .fill")].reduce((a, e) => a + (parseFloat(e.style.width) || 0), 0));
const openStory = async (n = 0) => {
  await page.goto(`${V}/g/${g}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".mine-story", { timeout: 20000 });
  await sleep(900);
  await (await page.$(".mine-story")).tap();
  // A video's .loaded arrives on a different event than a photo's, so wait for
  // the element and let it settle rather than for one particular class.
  await page.waitForSelector(".story .media", { timeout: 15000 });
  await sleep(500);
  for (let i = 0; i < n; i++) { await page.keyboard.press("ArrowRight"); await sleep(500); }
  await page.waitForSelector(".story .media", { timeout: 15000 });
  await sleep(800);
};
const MID = { x: 195, y: 420 };

try {
  console.log("--- the pinch itself ---");
  await openStory();
  ok("before anybody pinches, the photo sits exactly as drawn",
    JSON.stringify((await zstate()).applied) === JSON.stringify({ a: 1, e: 0, f: 0 }), JSON.stringify((await zstate()).applied));
  let letGo = await pinch(MID, 80, 300);
  const mid = await zstate();
  ok("two fingers spreading zooms the photo in", mid.z > 1.5, `--z ${mid.z}`);
  ok("...and the element really is transformed, not just a variable set", mid.applied?.a > 1.5, JSON.stringify(mid.applied));
  ok("...and it is marked pinching, so nothing eases behind the fingers", mid.pinching === true);
  await shot(page, path.join(SHOTS, "01-zoomed-in.png"));
  await letGo();
  const held = await zstate();
  ok("letting go keeps the zoom rather than snapping away", Math.abs(held.z - mid.z) < 0.01 && held.zoomed, `--z ${held.z}`);
  ok("...and the pinching class is gone once the fingers are up", held.pinching === false);

  console.log("--- while zoomed, the frame's other gestures stand down ---");
  const before = held.hint;
  await drag({ x: 300, y: 420 }, { x: 60, y: 420 });
  const afterSwipe = await zstate();
  ok("a sideways drag pans instead of changing photo", afterSwipe.hint === before, `${before} -> ${afterSwipe.hint}`);
  ok("...and it really moved the photo", Math.abs(afterSwipe.zx - held.zx) > 20, `${held.zx.toFixed(1)} -> ${afterSwipe.zx.toFixed(1)}`);
  await drag({ x: 195, y: 300 }, { x: 195, y: 760 });
  ok("a downward drag pans too, and does not dismiss", (await page.$(".story")) !== null);
  ok("...and the photo is still open and still zoomed", (await zstate()).zoomed);
  await shot(page, path.join(SHOTS, "02-panned.png"));

  console.log("--- panning stops at the picture's edge ---");
  for (let i = 0; i < 6; i++) await drag({ x: 40, y: 420 }, { x: 360, y: 420 }, 4);
  const edge = await zstate();
  const bound = await page.evaluate(() => {
    const el = document.querySelector(".story"), r = el.getBoundingClientRect(), img = el.querySelector(".media");
    const fit = Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight);
    return (img.naturalWidth * fit * +getComputedStyle(el).getPropertyValue("--z") - r.width) / 2;
  });
  ok("dragging past the edge stops at the edge, never showing a gap", Math.abs(edge.zx) <= bound + 1.5, `zx ${edge.zx.toFixed(1)} bound ${bound.toFixed(1)}`);

  console.log("--- and back out ---");
  await tapAt(MID);
  const tapped = await zstate();
  ok("a tap on a zoomed photo comes back to normal instead of advancing", !tapped.zoomed && tapped.hint === before, JSON.stringify({ z: tapped.z, hint: tapped.hint }));
  ok("...and it lands exactly home, at the original crop", tapped.applied.a === 1 && tapped.applied.e === 0 && tapped.applied.f === 0, JSON.stringify(tapped.applied));
  letGo = await pinch(MID, 80, 300); await letGo();
  ok("zoomed again", (await zstate()).zoomed);
  letGo = await pinch(MID, 300, 60); await letGo();
  const out = await zstate();
  ok("pinching back in settles at 1:1 and no further", out.z === 1 && !out.zoomed, `--z ${out.z}`);
  ok("...and square, not stranded at some other crop", out.applied.e === 0 && out.applied.f === 0, JSON.stringify(out.applied));

  console.log("--- the ordinary gestures come back ---");
  await tapAt({ x: 320, y: 420 });
  ok("once unzoomed, a tap advances again", (await zstate()).hint !== before, `${before} -> ${(await zstate()).hint}`);
  await drag({ x: 320, y: 420 }, { x: 60, y: 420 });
  ok("...and a swipe changes photo again", (await zstate()).hint !== before);
  await openStory();
  letGo = await pinch(MID, 80, 280); await letGo();
  ok("zoomed on this one", (await zstate()).zoomed);
  await page.keyboard.press("ArrowRight"); await sleep(600);
  const nextPhoto = await zstate();
  ok("moving to the next photo starts it unzoomed", !nextPhoto.zoomed && nextPhoto.applied.a === 1, JSON.stringify(nextPhoto.applied));

  console.log("--- the timer waits while you look ---");
  await openStory();
  await sleep(700);
  const running = await prog(); await sleep(900);
  ok("the bar fills while you are just watching", (await prog()) > running + 5, `${running.toFixed(1)}% -> ${(await prog()).toFixed(1)}%`);
  letGo = await pinch(MID, 80, 300);
  const frozen = await prog(); await sleep(1100);
  ok("...and it stops dead under a pinch", Math.abs((await prog()) - frozen) < 1, `${frozen.toFixed(1)}% -> ${(await prog()).toFixed(1)}%`);
  await letGo();
  const stillHeld = await prog(); await sleep(1400);
  ok("...and stays stopped while the photo is left zoomed", Math.abs((await prog()) - stillHeld) < 1, `${stillHeld.toFixed(1)}% -> ${(await prog()).toFixed(1)}%`);
  await tapAt(MID);
  const resumed = await prog(); await sleep(900);
  ok("...and picks up from where it paused once you come back out",
    (await prog()) > resumed + 5 && resumed >= stillHeld - 1, `${stillHeld.toFixed(1)}% -> ${resumed.toFixed(1)}% -> ${(await prog()).toFixed(1)}%`);

  console.log("--- a letterboxed photo ---");
  await openStory(2);
  ok("the third photo is the letterboxed one", await page.evaluate(() => document.querySelector(".media")?.classList.contains("contain")) === true);
  await drag({ x: 195, y: 300 }, { x: 195, y: 700 });
  ok("a landscape photo still dismisses on a downward drag when unzoomed", (await page.$(".story")) === null);
  await openStory(2);
  letGo = await pinch(MID, 80, 320); await letGo();
  ok("a letterboxed photo zooms too", (await zstate()).zoomed, `--z ${(await zstate()).z}`);
  await drag({ x: 195, y: 250 }, { x: 195, y: 780 }, 6);
  const lp = await zstate();
  const vbound = await page.evaluate(() => {
    const el = document.querySelector(".story"), r = el.getBoundingClientRect(), img = el.querySelector(".media");
    const fit = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    return Math.max(0, (img.naturalHeight * fit * +getComputedStyle(el).getPropertyValue("--z") - r.height) / 2);
  });
  ok("...and its short axis will not drag off into the blurred bands", Math.abs(lp.zy) <= vbound + 1.5, `zy ${lp.zy.toFixed(1)} bound ${vbound.toFixed(1)}`);
  await shot(page, path.join(SHOTS, "03-landscape-zoomed.png"));

  if (hasFfmpeg) {
    console.log("--- a video zooms exactly like a photo ---");
    await openStory(3);
    const isVid = await page.evaluate(() => !!document.querySelector(".story video.media"));
    ok("the fourth item is the video", isVid);
    if (isVid) {
      letGo = await pinch(MID, 80, 300); await letGo();
      const v = await page.evaluate(() => {
        const el = document.querySelector("video.media");
        return { z: +new DOMMatrixReadOnly(getComputedStyle(el).transform).a.toFixed(2), playing: !el.paused };
      });
      ok("a video zooms under a pinch, same as a photo", v.z > 1.5, JSON.stringify(v));
      ok("...and keeps playing while you look closely", v.playing);
      await drag({ x: 300, y: 420 }, { x: 70, y: 420 });
      ok("...and pans rather than skipping to the next item", await page.evaluate(() => !!document.querySelector("video.media")));
      await tapAt(MID);
      ok("...and a tap brings it back to 1:1",
        await page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector("video.media")).transform).a) === 1);
    }
  }

  console.log("--- the chrome gets out of the way ---");
  await openStory();
  letGo = await pinch(MID, 80, 300); await letGo();
  const chrome = await page.evaluate(() => ({
    bars: +getComputedStyle(document.querySelector(".story .bars")).opacity,
    close: +getComputedStyle(document.querySelector(".story .close")).opacity,
    foot: +getComputedStyle(document.querySelector(".story footer")).opacity,
  }));
  ok("the bars and the footer fade out of a zoomed photo's way", chrome.bars === 0 && chrome.foot === 0, JSON.stringify(chrome));
  ok("...but the close button stays, so a zoomed photo is never a trap", chrome.close > 0.6, `opacity ${chrome.close}`);
  await (await page.$(".story .close")).tap(); await sleep(500);
  ok("...and it still closes", (await page.$(".story")) === null);

  console.log("--- a trackpad, which has no fingers ---");
  await openStory();
  await page.evaluate(() => {
    const el = document.querySelector(".story"), r = el.getBoundingClientRect();
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: -240, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
  });
  await sleep(300);
  ok("ctrl+wheel -- how a trackpad pinch arrives -- zooms too", (await zstate()).zoomed, `--z ${(await zstate()).z}`);
  const zBefore = (await zstate()).z;
  await page.evaluate(() => document.querySelector(".story").dispatchEvent(new WheelEvent("wheel", { deltaY: -240, bubbles: true, cancelable: true })));
  await sleep(200);
  ok("...but a plain scroll is left alone", (await zstate()).z === zBefore);
  await page.keyboard.press("Escape"); await sleep(300);
  ok("Escape on a zoomed photo unzooms rather than closing", (await page.$(".story")) !== null && !(await zstate()).zoomed);
  await page.keyboard.press("Escape"); await sleep(300);
  ok("...and the next Escape closes it", (await page.$(".story")) === null);
} catch (e) {
  fail++; console.log("  FAIL  exception:", e?.stack ?? e);
  await shot(page, path.join(SHOTS, "99-failure.png")).catch(() => {});
} finally {
  await browser.close(); nginx.kill(); server.kill(); await proxy.close();
}

const real = problems.filter((p) => !/favicon/.test(p));
console.log(`\nbrowser problems: ${real.length}`); for (const p of real) console.log("  ! " + p);
if (real.length) fail++;
console.log(fail ? `\n${fail} FAILED` : "\nall passed"); console.log(`shots: ${SHOTS}`);
process.exit(fail ? 1 : 0);
