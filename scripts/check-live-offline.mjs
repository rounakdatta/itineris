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
// ---- launch 1: online, install the worker, save the gallery ------------------
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
    await page.click('[aria-label="Save for offline"]'); await page.waitForSelector(".sheet");
    const plan = await text(page, ".sheet");
    if (google) ok("save sheet plans the photos, and no map tiles (Google's may not be cached)", /\d+ images/.test(plan) && !/tiles/.test(plan), plan.replace(/\s+/g, " ").slice(0, 120));
    else ok("save sheet plans photos and map tiles", /\d+ images/.test(plan) && /tiles/.test(plan), plan.replace(/\s+/g, " ").slice(0, 120));
    ok("clicked Save", await clickText(page, ".sheet button", /^Save for offline|^Update/));
    let last = "";
    const saved = await page.waitForFunction(() => /Saved just now/.test(document.querySelector(".sheet")?.textContent ?? ""), { timeout: 180000 }).then(() => true).catch(() => false);
    last = (await text(page, ".sheet")).replace(/\s+/g, " ");
    ok("Save for offline completed on production", saved, last.slice(0, 160));
    await shot(page, path.join(SCRATCH, "shots", "prod-saved.png"));
  } finally { await browser.close(); }
}

// ---- launch 2: same profile, the world is unreachable -----------------------
{
  const { browser, page } = await launch({ env, userDataDir: profile, extraArgs: [`--host-resolver-rules=MAP ${host} 127.0.0.1, MAP *.cartocdn.com 127.0.0.1`] });
  try {
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" }).catch(() => {});
    const gotTicks = await page.waitForSelector(".tick", { timeout: 30000 }).then(() => true).catch(() => false);
    ok("NO NETWORK: the home gallery reopens from the worker's cache", gotTicks && (await count(page, ".tick")) === 20, String(await count(page, ".tick").catch(() => 0)));
    ok("NO NETWORK: data is the worker's saved copy", (await page.evaluate(() => fetch("/data/home.json").then((r) => r.headers.get("x-itineris-cache")).catch(() => null))) === "fallback");
    ok("NO NETWORK: the app says so", /Offline|Saved copy/.test(await text(page, ".chrome .top") ?? ""), (await text(page, ".chrome .top") ?? "").replace(/\s+/g, " "));
    await page.waitForFunction(() => [...document.querySelectorAll(".tick img")].filter((i) => i.getBoundingClientRect().left < window.innerWidth).every((i) => i.complete), { timeout: 15000 }).catch(() => {});
    ok("NO NETWORK: visible thumbnails come from cache", await visibleImgsLoaded(page));
    if (google) {
      // Google's map cannot come back without a network; the photos must.
      await page.click(".chrome .toggle"); await sleep(300);
      ok("NO NETWORK: the wall shows every photo (Google's map itself needs a connection, by Google's terms)", (await page.waitForSelector(".wall .cell", { timeout: 15000 }).then(() => true).catch(() => false)) && (await count(page, ".wall .cell")) === 20, String(await count(page, ".wall .cell").catch(() => 0)));
      await page.click(".chrome .toggle"); await sleep(300);
    } else {
      ok("NO NETWORK: the map renders from cached tiles", await page.waitForSelector('.map[data-idle="1"]', { timeout: 30000 }).then(() => true).catch(() => false));
    }
    // A placed photo takes two taps (card, then story); a bare one opens on the first.
    const ticks = await page.$$(".tick"); await ticks[1].tap(); await sleep(300); if (!(await page.$(".story"))) await (await page.$(".tick.on")).tap();
    ok("NO NETWORK: a story opens with its photo", await page.waitForSelector(".story img.media", { timeout: 10000 }).then(() => page.$eval(".story img.media", (i) => i.complete && i.naturalWidth > 0)).catch(() => false));
    await sleep(800); await shot(page, path.join(SCRATCH, "shots", "prod-offline.png"));
  } finally { await browser.close(); }
}
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
