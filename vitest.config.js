import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Separate from vite.config.js so test settings never leak into builds.
export default defineConfig({
  plugins: [svelte({ hot: false })],
  // Svelte 5 ships server and browser builds; jsdom tests need the browser one.
  resolve: { conditions: ["browser"] },
  // Same define as vite.config.js: the app stamps its version into the DOM.
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: {
    environment: "jsdom",
    setupFiles: ["tests/setup.js"],
    include: ["tests/**/*.test.js"],
  },
});
