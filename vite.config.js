import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Absolute base: gallery URLs live at /g/<token>, so assets and data must not
// resolve relative to that path.
export default defineConfig({
  plugins: [svelte()],
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
