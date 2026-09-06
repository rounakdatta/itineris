import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/svelte";
import { tick } from "svelte";

// Just enough of google.maps for GoogleMapView: what it constructs and calls.
class FakeMap { constructor(el, opts) { this.el = el; this.opts = opts; this.zoom = opts.zoom; this.h = {}; this.camera = []; FakeMap.instances.push(this); } addListener(ev, fn) { (this.h[ev] ??= []).push(fn); } fire(ev, e) { (this.h[ev] ?? []).forEach((f) => f(e)); } fitBounds(b, pad) { this.camera.push(["fitBounds", b, pad]); } panTo(c) { this.camera.push(["panTo", c]); } setZoom(z) { this.zoom = z; this.camera.push(["setZoom", z]); } getZoom() { return this.zoom; } }
FakeMap.instances = [];
class FakeMarker { constructor(o) { Object.assign(this, o); this.h = {}; FakeMarker.all.push(this); } addListener(ev, fn) { (this.h[ev] ??= []).push(fn); } click() { (this.h.click ?? []).forEach((f) => f()); } }
FakeMarker.all = [];
class FakePolyline { constructor(o) { this.o = o; this.map = o.map; FakePolyline.all.push(this); } setMap(m) { this.map = m; } getMap() { return this.map; } }
FakePolyline.all = [];
class FakeBounds { constructor(sw, ne) { this.sw = sw; this.ne = ne; } }
const G = { importLibrary: async (n) => (n === "maps" ? { Map: FakeMap } : { AdvancedMarkerElement: FakeMarker }), Polyline: FakePolyline, LatLngBounds: FakeBounds, event: { addListenerOnce: (m, ev, fn) => fn() } };
let loadImpl;
let mapErrorFn = null;
vi.mock("../src/lib/gmaps.js", () => ({ loadGoogleMaps: (...a) => loadImpl(...a), onAuthFailure: vi.fn(), watchMapErrors: (fn) => { mapErrorFn = fn; return () => { mapErrorFn = null; }; } }));
import GoogleMapView from "../src/components/GoogleMapView.svelte";
import { trip } from "../src/lib/trip.svelte.js";
import { moments, tracks } from "./fixtures.js";

const flush = () => new Promise((r) => setTimeout(r, 0));
const config = { googleMapsApiKey: "k", googleMapsMapId: "" };
beforeEach(() => {
  FakeMap.instances.length = 0; FakeMarker.all.length = 0; FakePolyline.all.length = 0;
  loadImpl = async () => G;
  trip.moments = structuredClone(moments); trip.tracks = structuredClone(tracks); trip.status = "ready"; trip.galleryId = "g1"; trip.facets = []; trip.day = null; trip.focusId = null; trip.storyIndex = -1; trip.view = "map";
});

describe("GoogleMapView", () => {
  it("draws Google's map with the configured key, a photo pin per located photo, a line per route", async () => {
    render(GoogleMapView, { config, onFail: vi.fn() }); await flush(); await tick(); await flush();
    const map = FakeMap.instances[0];
    expect(map.opts).toMatchObject({ mapId: "DEMO_MAP_ID", disableDefaultUI: true, clickableIcons: true, gestureHandling: "greedy" });
    expect(map.el.dataset.engine).toBe("google");
    expect(FakeMarker.all.map((m) => m.title)).toEqual(["Chinatown", "Maxwell", "Merlion"]);      // d has no GPS
    expect(FakeMarker.all[0].position).toEqual({ lat: 1.28, lng: 103.84 });
    expect(FakeMarker.all[0].content.querySelector("img").getAttribute("src")).toBe("/media/a-t.webp");
    expect(FakeMarker.all[0].content.style.getPropertyValue("--ring")).not.toBe("");
    expect(FakePolyline.all).toHaveLength(2);
    expect(FakePolyline.all[0].o.path[0]).toEqual({ lat: 1.28, lng: 103.85 });
    expect(map.camera.some((c) => c[0] === "fitBounds")).toBe(true);                        // fitted to the photos
  });
  it("first tap on a pin focuses (card + bigger pin), second opens the story; bare map clears", async () => {
    render(GoogleMapView, { config, onFail: vi.fn() }); await flush(); await tick(); await flush();
    const map = FakeMap.instances[0], b = FakeMarker.all[1];
    b.click(); await tick();
    expect(trip.focusId).toBe("b"); expect(trip.storyOpen).toBe(false);
    expect(b.content.classList.contains("on")).toBe(true); expect(b.zIndex).toBe(1000);
    expect(map.camera.some((c) => c[0] === "panTo" && c[1].lat === 1.2803)).toBe(true);
    expect(map.zoom).toBeGreaterThanOrEqual(15);
    b.click(); await tick();
    expect(trip.storyMoment.id).toBe("b");
    trip.closeStory();
    map.fire("click", {}); await tick();
    expect(trip.focusId).toBeNull(); expect(b.content.classList.contains("on")).toBe(false);
    map.fire("click", { placeId: "ChIJ..." }); await tick();                                  // Google's own place: leave ours alone
  });
  it("a filter hides pins and routes and brings them back; a new gallery refits", async () => {
    render(GoogleMapView, { config, onFail: vi.fn() }); await flush(); await tick(); await flush();
    const map = FakeMap.instances[0];
    trip.facets = ["activities"]; await tick();
    expect(FakeMarker.all.filter((m) => m.map).map((m) => m.title)).toEqual(["Merlion"]);     // run only
    expect(FakePolyline.all.every((l) => l.map)).toBe(true);
    trip.facets = ["spots"]; await tick();
    expect(FakeMarker.all.filter((m) => m.map).map((m) => m.title)).toEqual(["Chinatown", "Maxwell"]);
    expect(FakePolyline.all.every((l) => l.map === null)).toBe(true);
    const fits = map.camera.filter((c) => c[0] === "fitBounds").length;
    trip.facets = []; trip.galleryId = "g2"; await tick();
    expect(map.camera.filter((c) => c[0] === "fitBounds").length).toBeGreaterThan(fits);
    expect(FakeMarker.all.every((m) => m.map)).toBe(true);
  });
  it("Google's own fatal error (billing off, wrong referrer) makes it hand over to MapLibre, once", async () => {
    const onFail = vi.fn();
    const { unmount } = render(GoogleMapView, { config, onFail }); await flush(); await tick(); await flush();
    expect(FakeMap.instances).toHaveLength(1);
    mapErrorFn(new Error("Google Maps: BillingNotEnabledMapError")); mapErrorFn(new Error("Google Maps: BillingNotEnabledMapError"));
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onFail.mock.calls[0][0].message).toMatch(/BillingNotEnabled/);
    unmount();
    expect(mapErrorFn).toBeNull();                                  // stopped watching on teardown
  });
  it("when Google cannot load, it says so instead of leaving a blank map", async () => {
    loadImpl = async () => { throw new Error("Google Maps refused this API key"); };
    const onFail = vi.fn();
    render(GoogleMapView, { config, onFail }); await flush(); await tick();
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onFail.mock.calls[0][0].message).toMatch(/refused/);
    expect(FakeMap.instances).toHaveLength(0);
  });
});
