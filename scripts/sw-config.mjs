// Shared Vite config for the two service-worker builds. Runs AFTER the app
// build it belongs to, so it can list the hashed assets to precache and derive
// a version from them.
import { defineConfig } from "vite";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

export function swConfig({ entry, dist, base, extra = [] }) {
  const assets = existsSync(`${dist}/assets`) ? readdirSync(`${dist}/assets`).map((f) => `${base}assets/${f}`) : [];
  const shell = [`${base}index.html`, ...extra, ...assets];
  const version = createHash("sha256").update(shell.join("\n") + readFileSync(`${dist}/index.html`, "utf8")).digest("hex").slice(0, 12);
  return defineConfig({
    publicDir: false,
    define: { __PRECACHE__: JSON.stringify(shell), __VERSION__: JSON.stringify(version) },
    build: {
      outDir: dist, emptyOutDir: false, minify: true,
      lib: { entry, formats: ["iife"], name: "sw", fileName: () => "sw.js" },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
}
