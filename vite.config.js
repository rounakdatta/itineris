import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Relative base so the built site works at a domain root or under a subpath.
export default defineConfig({
  plugins: [svelte()],
  base: "./",
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
