// Screenshot the LIVE site at phone size, waiting for the map to finish
// rendering. Usage: SCRATCH=/tmp/x node scripts/shot-live.mjs [base-url] [path...]
import { mkdirSync } from "node:fs";
import path from "node:path";
import { launch, resolveBrowserEnv, shot, sleep } from "./browser.mjs";

const SCRATCH = process.env.SCRATCH ?? "/tmp/itineris-shots";
const [base = "https://itineris.taptappers.club", ...paths] = process.argv.slice(2);
const targets = paths.length ? paths : ["/", "/#m/m010", "/#wall"];
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
  }
} finally { await browser.close(); }
const real = problems.filter((x) => !/favicon/.test(x));
console.log(real.length ? `browser problems:\n  ${real.join("\n  ")}` : "browser problems: 0");
