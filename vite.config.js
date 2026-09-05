import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Absolute base: gallery URLs live at /g/<token>, so assets and data must not
// resolve relative to that path.
export default defineConfig({
  plugins: [svelte()],
  base: "/",
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
