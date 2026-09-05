import { mount } from "svelte";
import App from "./App.svelte";
import "./admin.css";

export default mount(App, { target: document.getElementById("app") });

import { registerServiceWorker } from "../src/lib/sw-client.js";
if (import.meta.env.PROD) registerServiceWorker("/admin/sw.js", { scope: "/admin/" });
