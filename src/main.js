import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";

export default mount(App, { target: document.getElementById("app") });

// Offline shell: the worker precaches the app and caches data, photos and map
// tiles as you browse; "Save for offline" fills it deliberately.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
