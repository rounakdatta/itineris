// Registers the service worker and, when a NEW version takes over while a page
// is open, offers a reload. The first install (no previous controller) is not
// an update and shows nothing.
export function registerServiceWorker(url, { scope, label = "Updated · Reload" } = {}) {
  if (!("serviceWorker" in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register(url, scope ? { scope } : undefined).then((reg) => {
    // Long-lived tabs (a story left open on a shelf) still learn about updates.
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    // controllerchange fires as activation starts; wait for it to finish (old
    // caches gone, new shell ready) before suggesting a reload.
    const w = navigator.serviceWorker.controller;
    if (!w || w.state === "activated") showReloadToast(label);
    else w.addEventListener("statechange", () => { if (w.state === "activated") showReloadToast(label); });
  });
}

export function showReloadToast(label) {
  if (document.getElementById("itineris-update")) return;
  const b = document.createElement("button");
  b.id = "itineris-update";
  b.type = "button";
  b.textContent = label;
  b.setAttribute("aria-live", "polite");
  b.style.cssText = "position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:100;padding:10px 16px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:#14181e;color:#fff;font:14px system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);cursor:pointer";
  b.onclick = () => location.reload();
  document.body.appendChild(b);
  return b;
}
