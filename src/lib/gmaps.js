// Loads the Google Maps JavaScript API once and resolves with `google.maps`.
// Rejects when the script cannot load, takes too long, or Google refuses the
// key before it finishes (window.gm_authFailure) -- so the caller can fall
// back to MapLibre instead of showing a blank map.
export const CALLBACK = "__itinerisGmapsReady";
let pending = null;

export function loadGoogleMaps({ key, timeout = 20000, win = globalThis } = {}) {
  if (win.google?.maps?.importLibrary) return Promise.resolve(win.google.maps);
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const s = win.document.createElement("script");
    let done = false;
    const finish = (err) => {
      if (done) return; done = true; clearTimeout(t); pending = null;
      if (err) { s.remove(); reject(err); } else resolve(win.google.maps);
    };
    const t = setTimeout(() => finish(new Error("Google Maps did not load in time")), timeout);
    win[CALLBACK] = () => finish(null);
    win.gm_authFailure = () => finish(new Error("Google Maps refused this API key"));
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&libraries=maps,marker&callback=${CALLBACK}`;
    s.async = true;
    s.onerror = () => finish(new Error("Google Maps script could not be loaded"));
    win.document.head.appendChild(s);
  });
  return pending;
}

// After the map is up, an invalid key still ends in gm_authFailure (Google
// checks asynchronously); route that to the caller too.
export function onAuthFailure(fn, win = globalThis) { win.gm_authFailure = fn; }

// Google announces every fatal map problem -- BillingNotEnabledMapError,
// RefererNotAllowedMapError, ApiNotActivatedMapError, ... -- with one
// console.error line, and for several of them never calls gm_authFailure; the
// map then sits behind Google's grey "can't load" overlay. Listen for that line
// so the app can draw MapLibre instead. Returns a function that stops watching.
const MAP_ERROR = /Google Maps JavaScript API error: (\w+MapError)/;
export function watchMapErrors(fn, con = globalThis.console) {
  const original = con.error;
  con.error = function (...args) {
    const m = args.map((a) => (typeof a === "string" ? a : a?.message ?? "")).join(" ").match(MAP_ERROR);
    if (m) fn(new Error(`Google Maps: ${m[1]}`));
    return original.apply(this, args);
  };
  return () => { if (con.error !== original) con.error = original; };
}
