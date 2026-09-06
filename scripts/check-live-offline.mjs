// Production proof of the offline layer, done the honest way: one browser
// profile, two launches. The first visits the live site, lets the worker
// install and saves the gallery for offline. The second reuses the profile but
// resolves the site's host (and the map CDN) to nowhere, so neither the page
// nor the worker can reach any network -- everything must come from cache.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { launch, resolveBrowserEnv, shot, sleep, text, count } from "./browser.mjs";

const SCRATCH = process.env.SCRATCH ?? "/tmp/itineris-shots";
mkdirSync(path.join(SCRATCH, "shots"), { recursive: true });
const base = process.argv[2] ?? "https://itineris.taptappers.club";
const host = new URL(base).host;
const env = resolveBrowserEnv(SCRATCH);
const profile = mkdtempSync(path.join(tmpdir(), "itineris-profile-"));
let fail = 0; const ok = (n, c, x = "") => { console.log(`  ${c ? "ok  " : "FAIL"}  ${n}${x ? "  " + x : ""}`); if (!c) fail++; };
const clickText = (page, sel, re) => page.evaluate((s, src) => { const r = new RegExp(src); const el = [...document.querySelectorAll(s)].find((e) => r.test(e.textContent)); el?.click(); return !!el; }, sel, re.source);
const visibleImgsLoaded = (page) => page.$$eval(".tick img", (imgs) => { const vis = imgs.filter((i) => i.getBoundingClientRect().left < window.innerWidth); return vis.length > 0 && vis.every((i) => i.complete && i.naturalWidth > 0); });

let google = false;
// ---- launch 1: online, install the worker, browse a little ------------------
{
  const { browser, page } = await launch({ env, userDataDir: profile });
  try {
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".tick", { timeout: 30000 });
    const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return r.active?.state; });
    ok("worker registered and active on the live site", reg === "activated" || reg === "activating", reg);
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector(".tick", { timeout: 30000 });
    ok("page is controlled by the worker", await page.evaluate(() => !!navigator.serviceWorker.controller));
    await page.waitForSelector('.map[data-idle="1"]', { timeout: 30000 }).catch(() => {});
    // Which map is live decides what "offline" can mean: Google's tiles may not be
    // cached (their terms), so with Google the save is photos-only and the map
    // needs a connection; MapLibre's Carto tiles are saved too.
    google = await page.evaluate(() => !!document.querySelector('.map[data-engine="google"]'));
    console.log(`  map engine on production: ${google ? "Google Maps" : "MapLibre"}`);
    ok("no download button: nothing to press, the worker keeps what is looked at", (await page.$('[aria-label="Save for offline"]')) === null);
    ok("...and a locate button in its place", (await page.$('[aria-label="Show my location"]')) !== null);
    // Looking at a story is what caches its photo; that is the offline promise now.
    const ticks = await page.$$(".tick");
    if (ticks.length) { await ticks[0].tap(); await page.waitForSelector(".story img.media", { timeout: 20000 }).catch(() => {}); await page.waitForSelector(".story img.media.loaded", { timeout: 30000 }).catch(() => {}); }
    ok("a story opened online, so its photo is in the cache", await page.evaluate(async () => (await (await caches.open("itineris-media")).keys()).length > 0));
    await page.keyboard.press("Escape"); await sleep(400);
    await shot(page, path.join(SCRATCH, "shots", "prod-browsed.png"));
  } finally { await browser.close(); }
}

// ---- launch 2: same profile, the world is unreachable -----------------------
{
  const { browser, page } = await launch({ env, userDataDir: profile, extraArgs: [`--host-resolver-rules=MAP ${host} 127.0.0.1, MAP *.cartocdn.com 127.0.0.1`] });
  try {
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" }).catch(() => {});
    const gotTicks = await page.waitForSelector(".tick", { timeout: 30000 }).then(() => true).catch(() => false);
    ok("NO NETWORK: the home gallery reopens from the worker's cache", gotTicks && (await count(page, ".tick")) > 0, String(await count(page, ".tick").catch(() => 0)));
    ok("NO NETWORK: data is the worker's saved copy", (await page.evaluate(() => fetch("/data/home.json").then((r) => r.headers.get("x-itineris-cache")).catch(() => null))) === "fallback");
    ok("NO NETWORK: the app says so", /Offline|Saved copy/.test(await text(page, ".chrome .top") ?? ""), (await text(page, ".chrome .top") ?? "").replace(/\s+/g, " "));
    await page.waitForFunction(() => [...document.querySelectorAll(".tick img")].filter((i) => i.getBoundingClientRect().left < window.innerWidth).every((i) => i.complete), { timeout: 15000 }).catch(() => {});
    ok("NO NETWORK: visible thumbnails come from cache", await visibleImgsLoaded(page));
    if (google) {
      // Google's map cannot come back without a network (its tiles may not be
      // cached); the strip and the stories must, and do -- checked below.
      console.log("  skip  NO NETWORK: map tiles (Google's map needs a connection, by Google's terms)");
    } else {
      ok("NO NETWORK: the map renders from cached tiles", await page.waitForSelector('.map[data-idle="1"]', { timeout: 30000 }).then(() => true).catch(() => false));
    }
    // A placed photo takes two taps (card, then story); a bare one opens on the first.
    const back = await page.$$(".tick"); await back[0].tap();
    ok("NO NETWORK: the story we had looked at opens with its photo", await page.waitForSelector(".story img.media.loaded", { timeout: 15000 }).then(() => page.$eval(".story img.media", (i) => i.complete && i.naturalWidth > 0)).catch(() => false));
    await sleep(800); await shot(page, path.join(SCRATCH, "shots", "prod-offline.png"));
  } finally { await browser.close(); }
}
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
