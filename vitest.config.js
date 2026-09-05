import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Separate from vite.config.js so test settings never leak into builds.
export default defineConfig({
  plugins: [svelte({ hot: false })],
  // Svelte 5 ships server and browser builds; jsdom tests need the browser one.
  resolve: { conditions: ["browser"] },
  test: {
    environment: "jsdom",
    setupFiles: ["tests/setup.js"],
    include: ["tests/**/*.test.js"],
  },
});
