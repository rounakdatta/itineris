// What is painted at the spot where a dark block shows up in story screenshots?
// Ask the DOM (elementFromPoint) and compare compositing paths.
import { spawn } from "node:child_process";
import { launch, resolveBrowserEnv, shot, sleep } from "./browser.mjs";
const SCRATCH = process.env.SCRATCH; const env = resolveBrowserEnv(SCRATCH);
const srv = spawn("python3", ["-m", "http.server", "4335", "--directory", "dist", "--bind", "127.0.0.1"], { stdio: "ignore" });
await sleep(900);
for (const v of [{ name: "default", extraArgs: [] }, { name: "no-gpu-compositing", extraArgs: ["--disable-gpu-compositing"] }]) {
  const { browser, page } = await launch({ env, extraArgs: v.extraArgs });
  try {
    await page.goto("http://127.0.0.1:4335/", { waitUntil: "domcontentloaded" }); await page.waitForSelector(".tick");
    const ticks = await page.$$(".tick"); await ticks[2].tap(); await sleep(300); await (await page.$(".tick.on")).tap(); await page.waitForSelector(".story"); await sleep(1500);
    const info = await page.evaluate(() => {
      const at = (x, y) => { const chain = []; for (let e = document.elementFromPoint(x, y); e && chain.length < 4; e = e.parentElement) chain.push(e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : "")); return chain.join(" < "); };
      return { atBlock: at(162, 797), atFooterElsewhere: at(60, 797), dockVisibility: getComputedStyle(document.querySelector(".dock")).visibility, chromeVisibility: getComputedStyle(document.querySelector(".chrome")).visibility };
    });
    console.log(`  ${v.name.padEnd(20)} ${JSON.stringify(info)}`);
    await shot(page, `${SCRATCH}/shots/probe-${v.name}.png`);
  } finally { await browser.close(); }
}
srv.kill();
