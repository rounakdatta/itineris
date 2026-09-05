// Headless Chromium (nix-provided) driven by puppeteer-core, for tests that
// need a real browser: layout, gestures, WebGL, console errors. Reads CHROMIUM
// and FONTCONFIG_FILE from the environment (see scripts/e2e.mjs for resolving
// them via nix); without fonts, every HTML label renders blank.
import puppeteer from "puppeteer-core";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const NIX = "nix --extra-experimental-features nix-command --extra-experimental-features flakes";
const nixPath = (attr) => execSync(`${NIX} build nixpkgs#${attr} --no-link --print-out-paths`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").pop();

export function resolveBrowserEnv(scratch) {
  const env = { ...process.env };
  if (!env.CHROMIUM) env.CHROMIUM = path.join(nixPath("chromium"), "bin", "chromium");
  if (!env.FONTCONFIG_FILE) {
    const conf = path.join(scratch, "fonts-v2.conf");
    if (!existsSync(conf)) {
      const dejavu = nixPath("dejavu_fonts");
      mkdirSync(path.join(scratch, "fc-cache"), { recursive: true });
      writeFileSync(conf, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig><dir>${dejavu}/share/fonts</dir><cachedir>${scratch}/fc-cache</cachedir>
<match target="pattern"><edit name="family" mode="prepend" binding="strong"><string>DejaVu Sans</string></edit></match>
</fontconfig>\n`);
    }
    env.FONTCONFIG_FILE = conf;
  }
  return env;
}

// `identity` adds the forward-auth header ONLY to requests for that origin --
// a page-wide extra header would turn every cross-origin fetch (map tiles!)
// into a CORS preflight the CDN rejects, which never happens in production.
export async function launch({ width = 390, height = 844, mobile = true, env = process.env, identity = null } = {}) {
  const browser = await puppeteer.launch({
    executablePath: env.CHROMIUM,
    headless: true,
    env,
    args: [
      "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars",
      // WebGL via SwiftShader so MapLibre actually renders a map.
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  if (identity) {
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      const headers = r.headers();
      if (r.url().startsWith(identity.origin)) headers["remote-email"] = identity.email;
      r.continue({ headers });
    });
  }

  // Anything a user would experience as "broken" ends up here.
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console.error: ${m.text()} @ ${m.location()?.url ?? ""}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => { if (!/cartocdn|basemaps/.test(r.url())) problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ""}`); });
  page.on("response", (r) => { if (r.status() >= 400 && !/cartocdn|basemaps/.test(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });

  return { browser, page, problems };
}

export const shot = (page, file) => page.screenshot({ path: file });

export async function tap(page, selector) {
  const el = await page.waitForSelector(selector, { visible: true, timeout: 10000 });
  await el.tap();
  return el;
}

// A finger drag: touchstart, N touchmoves, touchend. Pointer events follow.
export async function swipe(page, [x0, y0], [x1, y1], { steps = 14, holdMs = 0 } = {}) {
  const t = page.touchscreen;
  await t.touchStart(x0, y0);
  if (holdMs) await new Promise((r) => setTimeout(r, holdMs));
  for (let i = 1; i <= steps; i++) {
    await t.touchMove(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await new Promise((r) => setTimeout(r, 12));
  }
  await t.touchEnd();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim()).catch(() => null);
export const count = (page, sel) => page.$$eval(sel, (els) => els.length);
