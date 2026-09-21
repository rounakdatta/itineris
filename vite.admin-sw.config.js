import { swConfig } from "./scripts/sw-config.mjs";
export default swConfig({ entry: "src/sw/admin.js", dist: "dist-admin", base: "/creator/", extra: ["/creator/manifest.webmanifest", "/creator/mark-96.png", "/creator/favicon.ico", "/creator/favicon-32.png", "/creator/icon-192.png"] });
