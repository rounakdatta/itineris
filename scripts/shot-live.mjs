// Screenshot the LIVE site at phone size, waiting for the map to finish
// rendering. Usage: SCRATCH=/tmp/x node scripts/shot-live.mjs [base-url] [path...]
import { mkdirSync } from "node:fs";
import path from "node:path";
import { launch, resolveBrowserEnv, shot, sleep, count } from "./browser.mjs";

const SCRATCH = process.env.SCRATCH ?? "/tmp/itineris-shots";
const [base = "https://itineris.taptappers.club", ...paths] = process.argv.slice(2);
const targets = paths.length ? paths : ["/", "/#m/m010", "/#wall"];
let fail = 0;
const ok = (name, cond, extra = "") => { console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!cond) fail++; };
mkdirSync(path.join(SCRATCH, "shots"), { recursive: true });
const env = resolveBrowserEnv(SCRATCH);
const { browser, page, problems } = await launch({ env });
try {
  for (const p of targets) {
    await page.goto(base + p, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".tick, .card", { timeout: 20000 });
    if (p.includes("#m/")) await page.waitForSelector(".story", { timeout: 10000 }).catch(() => {});
    await page.waitForSelector('.map[data-idle="1"]', { timeout: 30000 }).catch(() => {});
    await sleep(500);
    const file = path.join(SCRATCH, "shots", `live${p.replace(/[^a-z0-9]+/gi, "-").replace(/-$/, "") || "-home"}.png`);
    await shot(page, file);
    console.log(`  ${p.padEnd(12)} -> ${file}`);
    if (p.includes("#m/") && (await page.$(".story"))) {
      ok("story header links the place to Google Maps", await page.$eval(".story header a.place", (a) => a.target === "_blank" && /(google\.com\/maps|maps\.google\.com)/.test(a.href)).catch(() => false));
    }
  }
  // One tap on a strip thumbnail: the place card, above the strip, with its Google Maps link.
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tick", { timeout: 20000 });
  await page.waitForSelector('.map[data-idle="1"]', { timeout: 30000 }).catch(() => {});
  // Which map is drawing, and -- when it is Google -- that Google actually rendered.
  const engine = await page.$eval(".map", (el) => el.dataset.engine ?? "maplibre").catch(() => "none");
  console.log(`  map engine: ${engine}`);
  if (engine === "google") {
    ok("Google Maps rendered its tiles on the live site", await page.waitForSelector(".gm-style", { timeout: 20000 }).then(() => true).catch(() => false));
    ok("...with our photo pins on it", (await count(page, ".gpin")) > 0, String(await count(page, ".gpin")));
    ok("...and no Google error dialog", await page.evaluate(() => !/can't load Google Maps correctly/.test(document.body.innerText)));
  }
  const ticks = await page.$$(".tick");
  if (ticks.length) {
    await ticks[Math.min(2, ticks.length - 1)].tap(); await sleep(600);
    ok("place card appears on the first tap", (await page.$(".place-card")) !== null);
    ok("...with a Google Maps link that opens a new tab", await page.$eval(".place-card a.act[target=_blank]", (a) => a.target === "_blank").catch(() => false));
    ok("...above the strip, not on it", await page.evaluate(() => { const c = document.querySelector(".place-card")?.getBoundingClientRect(); const s = document.querySelector(".strip")?.getBoundingClientRect(); return !!c && !!s && c.bottom <= s.top; }));
    await sleep(500); const file = path.join(SCRATCH, "shots", "live-place-card.png"); await shot(page, file); console.log(`  place card   -> ${file}`);
  }
} finally { await browser.close(); }
if (fail) { console.log(`\n${fail} FAILED`); process.exitCode = 1; }
const real = problems.filter((x) => !/favicon/.test(x));
console.log(real.length ? `browser problems:\n  ${real.join("\n  ")}` : "browser problems: 0");
