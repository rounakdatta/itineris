import { installSw } from "./core.js";
// The admin reads its library through two GETs; everything else it does is a
// mutation and goes straight to the server (or into the upload queue).
installSw(self, { app: "creator", version: __VERSION__, precache: __PRECACHE__, keep: __KEEP__, indexUrl: "/creator/index.html", scope: "/creator/", apiPaths: ["/creator/api/library", "/creator/api/me"] });
