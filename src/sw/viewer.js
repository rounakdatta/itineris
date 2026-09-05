import { installSw } from "./core.js";
installSw(self, { app: "viewer", version: __VERSION__, precache: __PRECACHE__, keep: __KEEP__, indexUrl: "/index.html", scope: "/", dataPrefixes: ["/data/"] });
