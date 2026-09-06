import { swConfig } from "./scripts/sw-config.mjs";
export default swConfig({ entry: "src/sw/viewer.js", dist: "dist", base: "/", extra: ["/manifest.webmanifest", "/mark-96.png", "/favicon.ico", "/favicon-32.png", "/icon-192.png"] });
