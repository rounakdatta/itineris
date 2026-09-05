import "@testing-library/jest-dom/vitest";
import { vi, afterEach } from "vitest";
import { cleanup } from "@testing-library/svelte";

// Testing Library only auto-cleans when `afterEach` is a global; make it explicit
// so components from one test can never leak into the next.
afterEach(cleanup);

// MapLibre needs WebGL, which jsdom does not have. Components that import it
// get this stand-in; behaviour that depends on the real map is covered by the
// browser harness (scripts/e2e.mjs) instead.
vi.mock("maplibre-gl", () => {
  class Map {
    static instances = [];
    constructor(opts) { this.options = opts; this.handlers = {}; this.sources = {}; this.filters = {}; this.camera = []; Map.instances.push(this); }
    getStyle() { return { sources: {} }; }
    on(ev, a, b) { const fn = b ?? a; (this.handlers[ev] ??= []).push(fn); if (ev === "load") queueMicrotask(() => fn()); return this; }
    addControl() { return this; }
    addSource(id, src) { this.sources[id] = { data: src.data, setData: (d) => (this.sources[id].data = d) }; }
    getSource(id) { return this.sources[id]; }
    addLayer() {}
    setFilter(id, f) { this.filters[id] = f; }
    flyTo(o) { this.camera.push(["flyTo", o]); }
    fitBounds(b, o) { this.camera.push(["fitBounds", b, o]); }
    getZoom() { return 12; }
    getCanvas() { return { style: {} }; }
    queryRenderedFeatures() { return []; }
    remove() {}
  }
  class NavigationControl {}
  class Marker {
    constructor() { this.pos = null; this.handlers = {}; }
    setLngLat(p) { this.pos = Array.isArray(p) ? { lng: p[0], lat: p[1] } : p; return this; }
    getLngLat() { return this.pos; }
    addTo() { return this; }
    remove() { return this; }
    on(ev, fn) { (this.handlers[ev] ??= []).push(fn); return this; }
  }
  Map.prototype.easeTo = function (o) { this.camera.push(["easeTo", o]); };
  return { default: { Map, NavigationControl, Marker }, Map, NavigationControl, Marker };
});
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
