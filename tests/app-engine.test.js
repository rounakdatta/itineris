import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

// A story link someone shared ("…/#m/<id>") arrives on a page that has not
// loaded yet. The URL is the truth until the data is in; only then may the
// state start writing the URL. (The URL-sync effect used to run first and wipe
// the hash, so shared links opened the gallery, never the story.)
describe("a deep link on a cold load", () => {
  const gallery = { id: "g1", title: "T", moments: [
    { id: "m1", t: "2026-03-14T09:00:00+08:00", lat: 1.28, lng: 103.85, place: "A", tags: [], media: { src: "media/a.jpg", w: 100, h: 100 } },
    { id: "m2", t: "2026-03-14T10:00:00+08:00", lat: 1.29, lng: 103.86, place: "B", tags: [], media: { src: "media/b.jpg", w: 100, h: 100 } },
  ] };
  const site = () => vi.fn(async (url) => {
    if (url === "/data/home.json") return { ok: true, status: 200, headers: new Headers(), json: async () => ({ gallery: "g1" }) };
    if (url === "/data/galleries/g1.json") return { ok: true, status: 200, headers: new Headers(), json: async () => gallery };
    return { ok: false, status: 404 };
  });
  beforeEach(() => { trip.storyIndex = -1; trip.view = "map"; trip.facets = []; });
  afterEach(() => { history.replaceState(null, "", location.pathname); trip.storyIndex = -1; });
  it("opens that story, and the URL still says so", async () => {
    history.replaceState(null, "", "#m/m2");
    vi.stubGlobal("fetch", site());
    const { container } = render(App);
    expect(await until(() => trip.storyOpen)).toBeTruthy();
    expect(trip.storyMoment.id).toBe("m2");
    expect(location.hash).toBe("#m/m2");
    expect(container.querySelector(".story")).toBeTruthy();
  });
  it("#wall opens the wall, and stays #wall", async () => {
    history.replaceState(null, "", "#wall");
    vi.stubGlobal("fetch", site());
    render(App);
    expect(await until(() => trip.loaded && trip.view === "wall")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    expect(location.hash).toBe("#wall");
  });
  it("a link to a photo that is not in this gallery just opens the gallery, with a clean URL", async () => {
    history.replaceState(null, "", "#m/nope");
    vi.stubGlobal("fetch", site());
    render(App);
    expect(await until(() => trip.loaded)).toBeTruthy();
    expect(await until(() => location.hash === "")).toBeTruthy();
    expect(trip.storyOpen).toBe(false);
  });
});
