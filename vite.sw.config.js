import { swConfig } from "./scripts/sw-config.mjs";
export default swConfig({ entry: "src/sw/viewer.js", dist: "dist", base: "/", extra: ["/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"] });
