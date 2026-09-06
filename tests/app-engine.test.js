import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/svelte";

class FakeMap { constructor(el, opts) { this.el = el; this.opts = opts; this.h = {}; this.zoom = opts.zoom; } addListener(ev, fn) { (this.h[ev] ??= []).push(fn); } fitBounds() {} panTo() {} setZoom() {} getZoom() { return 2; } }
class FakeMarker { constructor(o) { Object.assign(this, o); } addListener() {} }
const G = { importLibrary: async (n) => (n === "maps" ? { Map: FakeMap } : { AdvancedMarkerElement: FakeMarker }), Polyline: class { setMap() {} getMap() { return null; } }, LatLngBounds: class {}, event: { addListenerOnce: (m, e, fn) => fn() } };
let gmapsOk = true;
vi.mock("../src/lib/gmaps.js", () => ({ loadGoogleMaps: async () => { if (!gmapsOk) throw new Error("no"); return G; }, onAuthFailure: () => {}, watchMapErrors: () => () => {} }));
import App from "../src/App.svelte";
import { trip } from "../src/lib/trip.svelte.js";

const routes = (cfg) => vi.fn(async (url) => {
  if (url === "/config.json") return cfg ? { ok: true, status: 200, json: async () => cfg } : { ok: false, status: 404 };
  return { ok: false, status: 404 };
});
const until = async (fn, ms = 1500) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 10)); } return fn(); };
beforeEach(() => { trip.status = "loading"; trip.moments = []; trip.mapEngine = "maplibre"; gmapsOk = true; });

describe("which map the app draws", () => {
  it("a configured key means Google Maps", async () => {
    vi.stubGlobal("fetch", routes({ googleMapsApiKey: "k" }));
    const { container } = render(App);
    expect(await until(() => container.querySelector('.map[data-engine="google"]'))).toBeTruthy();
    expect(trip.mapEngine).toBe("google");
    expect(container.querySelector(".map:not([data-engine])")).toBeNull();
  });
  it("no config means MapLibre, and the site works exactly as before", async () => {
    vi.stubGlobal("fetch", routes(null));
    const { container } = render(App);
    expect(await until(() => container.querySelector(".map:not([data-engine])"))).toBeTruthy();
    expect(trip.mapEngine).toBe("maplibre");
  });
  it("Google failing to load falls back to MapLibre instead of a blank map", async () => {
    gmapsOk = false;
    vi.stubGlobal("fetch", routes({ googleMapsApiKey: "k" }));
    const { container } = render(App);
    expect(await until(() => container.querySelector(".map:not([data-engine])"))).toBeTruthy();
    expect(trip.mapEngine).toBe("maplibre");
  });
});
