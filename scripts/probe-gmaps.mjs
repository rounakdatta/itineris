// Manual check with a REAL Google Maps key: serves the built site with a
// config.json carrying the key from the environment (never from a file in the
// repo), opens it in headless Chromium and reports whether Google's map came
// up with our photo pins. One or two map loads of quota.
//   GOOGLE_MAPS_API_KEY=... SCRATCH=/tmp/x node scripts/probe-gmaps.mjs
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { launch, resolveBrowserEnv, shot, sleep, count } from "./browser.mjs";

const key = process.env.GOOGLE_MAPS_API_KEY;
if (!key) { console.error("GOOGLE_MAPS_API_KEY is required"); process.exit(2); }
const SCRATCH = process.env.SCRATCH ?? "/tmp/itineris-gmaps-probe";
mkdirSync(path.join(SCRATCH, "shots"), { recursive: true });
const env = resolveBrowserEnv(SCRATCH);
const cfg = path.join(process.cwd(), "dist", "config.json");
writeFileSync(cfg, JSON.stringify({ googleMapsApiKey: key }));
const preview = spawn("npx", ["vite", "preview", "--port", "4399", "--strictPort"], { stdio: ["ignore", "pipe", "pipe"] });
for (let i = 0; i < 100; i++) { try { if ((await fetch("http://127.0.0.1:4399/config.json")).ok) break; } catch {} await sleep(150); }
const { browser, page, problems } = await launch({ env });
let fail = 0;
const ok = (n, c, x = "") => { console.log(`  ${c ? "ok  " : "FAIL"}  ${n}${x ? "  " + x : ""}`); if (!c) fail++; };
try {
  await page.goto("http://127.0.0.1:4399/", { waitUntil: "domcontentloaded" });
  const engine = await page.waitForFunction(() => document.querySelector(".map")?.dataset.engine ?? (document.querySelector(".map") ? "maplibre" : null), { timeout: 30000 }).then((h) => h.jsonValue());
  ok("engine chosen from the key", engine === "google", engine);
  const pins = await page.waitForSelector('.map[data-engine="google"] .gpin', { timeout: 30000 }).then(() => true).catch(() => false);
  ok("Google's map is up with our photo pins", pins, String(await count(page, ".gpin")));
  ok("Google's own tiles rendered (a .gm-style container exists)", (await page.$(".gm-style")) !== null);
  await page.waitForSelector('.map[data-idle="1"]', { timeout: 30000 }).catch(() => {});
  await sleep(1500);
  const v = await page.evaluate(() => window.google?.maps?.version ?? null);
  ok("Maps JavaScript API version reported", !!v, v ?? "");
  const f = path.join(SCRATCH, "shots", "probe-gmaps.png"); await shot(page, f); console.log(`  shot -> ${f}`);
  const pin = (await page.$$(".gpin"))[2]; if (pin) { await pin.tap(); await sleep(600); ok("tap on a Google-positioned pin shows the place card", (await page.$(".place-card")) !== null); await shot(page, path.join(SCRATCH, "shots", "probe-gmaps-card.png")); }
} finally {
  await browser.close(); preview.kill(); if (existsSync(cfg)) rmSync(cfg);
}
const real = problems.filter((p) => !/favicon/.test(p));
console.log(real.length ? `browser problems:\n  ${real.join("\n  ")}` : "browser problems: 0");
process.exit(fail ? 1 : 0);
