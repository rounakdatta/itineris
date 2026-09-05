import { mount } from "svelte";
import App from "./App.svelte";
import "./admin.css";

export default mount(App, { target: document.getElementById("app") });

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/" }).catch(() => {});
}
