import { swConfig } from "./scripts/sw-config.mjs";
export default swConfig({ entry: "src/sw/admin.js", dist: "dist-admin", base: "/admin/", extra: ["/admin/manifest.webmanifest", "/admin/icon.svg", "/admin/icon-192.png", "/admin/icon-512.png"] });
