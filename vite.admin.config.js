import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { stampVersion } from "./vite.config.js";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// The admin UI is a separate build: served by the admin server under /admin/,
// never part of the public nginx image.
export default defineConfig({
  root: "admin",
  base: "/admin/",
  plugins: [svelte(), stampVersion(version)],
  build: {
    outDir: "../dist-admin",
    emptyOutDir: true,
    rollupOptions: { output: { manualChunks: { maplibre: ["maplibre-gl"] } } },
  },
  server: { proxy: { "/admin/api": "http://localhost:8080", "/media": "http://localhost:8080", "/data": "http://localhost:8080" } },
});
