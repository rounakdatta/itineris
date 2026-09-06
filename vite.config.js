import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// index.html says which build it is, so a deploy can be checked with one curl.
export const stampVersion = (v) => ({ name: "itineris-stamp-version", transformIndexHtml: (html) => html.replaceAll("%APP_VERSION%", v) });

// Absolute base: gallery URLs live at /g/<token>, so assets and data must not
// resolve relative to that path.
export default defineConfig({
  plugins: [svelte(), stampVersion(version)],
  base: "/",
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    rollupOptions: {
      output: {
        // MapLibre is ~80% of the bundle and changes far less often than app
        // code -- splitting it keeps it cached across deploys.
        manualChunks: { maplibre: ["maplibre-gl"] },
      },
    },
  },
});
