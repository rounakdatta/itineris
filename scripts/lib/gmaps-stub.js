// A stand-in for https://maps.googleapis.com/maps/api/js, served to the browser
// by the e2e in place of the real script (no key, no network). It implements
// exactly the surface GoogleMapView uses -- Map, AdvancedMarkerElement,
// Polyline, LatLngBounds, importLibrary, the callback -- and lays markers out
// in a grid inside the map element so they can be tapped. It proves OUR
// integration (config -> loader -> pins -> gestures), not Google's rendering.
export const GMAPS_STUB = `
(() => {
  window.__gmapsStubUrl = document.currentScript && document.currentScript.src;
  class LatLngBounds { constructor(sw, ne) { this.sw = sw; this.ne = ne; } extend() { return this; } }
  class GMap {
    constructor(el, opts) { this.el = el; this.opts = opts; this.zoom = opts.zoom == null ? 2 : opts.zoom; this.h = {}; el.dataset.gstub = "1"; el.style.background = "#e5e3df"; setTimeout(() => this.fire("idle"), 30); }
    addListener(ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); return { remove() {} }; }
    fire(ev, e) { (this.h[ev] || []).forEach((f) => f(e)); }
    fitBounds(b) { this.lastFit = b; setTimeout(() => this.fire("idle"), 20); }
    panTo(c) { this.center = c; } setZoom(z) { this.zoom = z; } getZoom() { return this.zoom; } moveCamera() {}
  }
  class Polyline { constructor(o) { this.o = o; this._map = o.map || null; } setMap(m) { this._map = m; } getMap() { return this._map; } setPath() {} }
  let n = 0;
  class AdvancedMarkerElement {
    constructor(o) { this.content = o.content; this.position = o.position; this.title = o.title; this.zIndex = o.zIndex; this.h = {}; this._map = null; this.i = n++; this.map = o.map; }
    set map(m) {
      this._map = m;
      if (!m) { this.content.remove(); return; }
      const c = this.content;
      // A grid with room for a ring + a NAMED chip per cell (content up to ~170 px wide, 68 px tall shifted 46 px down), so no pin ever sits on another.
      c.style.position = "absolute"; c.style.left = (24 + (this.i % 3) * 135) + "px"; c.style.top = (200 + Math.floor(this.i / 3) * 125) + "px";
      c.dataset.gmarker = "1";
      if (!c.__wired) { c.__wired = true; c.addEventListener("click", () => (this.h.click || []).forEach((f) => f())); }
      m.el.appendChild(c);
    }
    get map() { return this._map; }
    addListener(ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); return { remove() {} }; }
  }
  const libs = { maps: { Map: GMap, Polyline, LatLngBounds }, marker: { AdvancedMarkerElement } };
  window.google = { maps: { importLibrary: async (name) => libs[name] || {}, Map: GMap, Polyline, LatLngBounds, event: { addListenerOnce: (m, ev, fn) => setTimeout(fn, 25) } } };
  const cb = new URL(window.__gmapsStubUrl).searchParams.get("callback");
  if (cb && window[cb]) window[cb]();
})();
`;
