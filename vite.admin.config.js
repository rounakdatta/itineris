import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// The admin UI is a separate build: served by the admin server under /admin/,
// never part of the public nginx image.
export default defineConfig({
  root: "admin",
  base: "/admin/",
  plugins: [svelte()],
  build: {
    outDir: "../dist-admin",
    emptyOutDir: true,
    rollupOptions: { output: { manualChunks: { maplibre: ["maplibre-gl"] } } },
  },
  server: { proxy: { "/admin/api": "http://localhost:8080", "/media": "http://localhost:8080", "/data": "http://localhost:8080" } },
});
