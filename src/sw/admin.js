import { installSw } from "./core.js";
// The admin reads its library through two GETs; everything else it does is a
// mutation and goes straight to the server (or into the upload queue).
installSw(self, { app: "admin", version: __VERSION__, precache: __PRECACHE__, indexUrl: "/admin/index.html", scope: "/admin/", apiPaths: ["/admin/api/library", "/admin/api/me"] });
