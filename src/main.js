import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";

export default mount(App, { target: document.getElementById("app") });

// Offline shell: the worker serves the app from cache and caches data, photos
// and map tiles as you browse; "Save for offline" fills it deliberately. When a
// new version takes over mid-session the page offers a reload.
import { registerServiceWorker } from "./lib/sw-client.js";
if (import.meta.env.PROD) registerServiceWorker("/sw.js");
