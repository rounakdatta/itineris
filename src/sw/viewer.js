import { installSw } from "./core.js";
installSw(self, { app: "viewer", version: __VERSION__, precache: __PRECACHE__, indexUrl: "/index.html", scope: "/", dataPrefixes: ["/data/"] });
