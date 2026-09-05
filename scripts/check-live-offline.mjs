// Production proof of the offline layer: register the worker on the live site,
// then go offline and reopen it from the worker's cache.
import path from "node:path";
import { launch, resolveBrowserEnv, shot, sleep, tap, setOffline } from "./browser.mjs";
const SCRATCH = process.env.SCRATCH ?? "/tmp/itineris-shots";
const base = process.argv[2] ?? "https://itineris.taptappers.club";
const env = resolveBrowserEnv(SCRATCH);
const { browser, page, problems } = await launch({ env });
let fail = 0; const ok = (n, c, x = "") => { console.log(`  ${c ? "ok  " : "FAIL"}  ${n}${x ? "  " + x : ""}`); if (!c) fail++; };
try {
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".tick", { timeout: 30000 });
  const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, state: r.active?.state }; });
  ok("worker registered and active", reg.state === "activated" || reg.state === "activating", JSON.stringify(reg));
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector(".tick", { timeout: 30000 });
  ok("page is controlled by the worker", await page.evaluate(() => !!navigator.serviceWorker.controller));
  const keys = await page.evaluate(() => caches.keys());
  ok("shell precached", keys.some((k) => k.startsWith("itineris-viewer-shell-")), keys.join(", "));
  ok("gallery data cached on first visit", await page.evaluate(async () => (await (await caches.open("itineris-viewer-data")).keys()).some((r) => r.url.includes("/data/galleries/"))));
  await page.waitForSelector('.map[data-idle="1"]', { timeout: 30000 }).catch(() => {});
  await tap(page, '[aria-label="Save for offline"]'); await page.waitForSelector(".sheet");
  const saveBtn = await page.evaluateHandle(() => [...document.querySelectorAll(".sheet button")].find((b) => /Save for offline|Update/.test(b.textContent)));
  await saveBtn.click();
  const saved = await page.waitForFunction(() => /Saved just now/.test(document.querySelector(".sheet")?.textContent ?? ""), { timeout: 120000 }).then(() => true).catch(() => false);
  ok("Save for offline completed on production", saved, await page.$eval(".sheet", (e) => e.textContent.trim().slice(0, 140)).catch(() => ""));
  await page.evaluate(() => [...document.querySelectorAll(".sheet button")].find((b) => b.textContent.trim() === "Close")?.click());
  await setOffline(browser, page, true, base);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tick", { timeout: 30000 });
  ok("OFFLINE on production: the home gallery reopens from cache", (await page.$$eval(".tick", (t) => t.length)) === 20);
  ok("OFFLINE: served by the worker's fallback", (await page.evaluate(() => fetch("/data/home.json").then((r) => r.headers.get("x-itineris-cache")))) === "fallback");
  ok("OFFLINE: the app says so", /Offline|Saved copy/.test(await page.$eval(".chrome .top", (e) => e.textContent)));
  await page.waitForFunction(() => [...document.querySelectorAll(".tick img")].every((i) => i.complete), { timeout: 10000 });
  ok("OFFLINE: thumbnails from cache", await page.$$eval(".tick img", (imgs) => imgs.every((i) => i.naturalWidth > 0)));
  await sleep(1500); await shot(page, path.join(SCRATCH, "shots", "prod-offline.png"));
  ok("OFFLINE: the map has its tiles", await page.waitForSelector('.map[data-idle="1"]', { timeout: 30000 }).then(() => true).catch(() => false));
  await setOffline(browser, page, false, base);
} catch (e) { fail++; console.log("  FAIL  exception:", e.message); }
finally { await browser.close(); }
const real = problems.filter((p) => !/favicon|ERR_INTERNET_DISCONNECTED|status of 503/.test(p));
console.log(real.length ? `browser problems:\n  ${real.join("\n  ")}` : "browser problems: 0");
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
