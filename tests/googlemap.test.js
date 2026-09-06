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
  trip.moments = structuredClone(moments); trip.tracks = structuredClone(tracks); trip.status = "ready"; trip.galleryId = "g1"; trip.facets = []; trip.focusId = null; trip.storyIndex = -1; trip.view = "map";
});

import { resetSeen, markSeen } from "../src/lib/seen.svelte.js";
const byTitle = (t) => FakeMarker.all.find((m) => m.title === t);
const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

describe("GoogleMapView", () => {
  beforeEach(() => { resetSeen(); trip.moments = [...trip.moments.map((m) => (m.id === "b" ? { ...m, google: { placeId: "ChIJmax", rating: 4.4, ratingCount: 12873, type: "Hawker centre", mapsUri: "https://maps.google.com/?cid=1" } } : m)), { ...structuredClone(moments[0]), id: "a2", t: "2026-03-14T09:10:00+08:00" }]; });

  it("draws Google's map with one story-ring pin per place, a count badge, a rating chip where Google knows the place, a line per route", async () => {
    render(GoogleMapView, { config, onFail: vi.fn() }); await flush(); await tick(); await flush();
    const map = FakeMap.instances[0];
    expect(map.opts).toMatchObject({ mapId: "DEMO_MAP_ID", disableDefaultUI: true, clickableIcons: true, gestureHandling: "greedy" });
    expect(map.el.dataset.engine).toBe("google");
    expect(FakeMarker.all.map((m) => m.title)).toEqual(["Chinatown", "Maxwell", "Merlion"]);      // a + a2 share Chinatown; d has no GPS
    const chinatown = byTitle("Chinatown"), maxwell = byTitle("Maxwell");
    expect(chinatown.position).toEqual({ lat: 1.28, lng: 103.84 });
    expect(chinatown.content.querySelector(".ring img").getAttribute("src")).toBe("/media/a-t.webp");
    expect(chinatown.content.querySelector(".ring .n").textContent).toBe("2");
    expect(chinatown.content.querySelector(".chip").textContent).toBe("Chinatown");            // the name, always
    expect(maxwell.content.querySelector(".chip").textContent).toBe("Maxwell4.4★");            // plus the rating when Google knows it
    expect(maxwell.content.querySelector(".chip .nm").textContent).toBe("Maxwell");
    expect(chinatown.content.classList.contains("has-chip")).toBe(true);
    expect(maxwell.content.querySelector(".ring").classList.contains("seen")).toBe(false);
    expect(FakePolyline.all).toHaveLength(2);
    expect(map.camera.some((c) => c[0] === "fitBounds")).toBe(true);
  });
  it("tap the ring: the story opens at once; tap the chip: the place card (then the story); bare map clears", async () => {
    render(GoogleMapView, { config, onFail: vi.fn() }); await flush(); await tick(); await flush();
    const map = FakeMap.instances[0], maxwell = byTitle("Maxwell");
    click(maxwell.content.querySelector(".chip")); await tick();
    expect(trip.focusId).toBe("b"); expect(trip.storyOpen).toBe(false);
    expect(maxwell.content.classList.contains("on")).toBe(true); expect(maxwell.zIndex).toBe(1000);
    expect(map.camera.some((c) => c[0] === "panTo" && c[1].lat === 1.2803)).toBe(true);
    click(maxwell.content.querySelector(".chip")); await tick();
    expect(trip.storyMoment.id).toBe("b");
    trip.closeStory(); await tick();
    click(byTitle("Chinatown").content.querySelector(".ring")); await tick();
    expect(trip.storyOpen).toBe(true); expect(trip.storyMoment.id).toBe("a");                   // straight into the story
    trip.closeStory();
    map.fire("click", {}); await tick();
    expect(trip.focusId).toBeNull(); expect(maxwell.content.classList.contains("on")).toBe(false);
  });
  it("the ring goes quiet once every photo behind it has been seen", async () => {
    render(GoogleMapView, { config, onFail: vi.fn() }); await flush(); await tick(); await flush();
    const ring = byTitle("Chinatown").content.querySelector(".ring");
    markSeen("a"); await tick();
    expect(ring.classList.contains("seen")).toBe(false);
    markSeen("a2"); await tick();
    expect(ring.classList.contains("seen")).toBe(true);
    expect(byTitle("Maxwell").content.querySelector(".ring").classList.contains("seen")).toBe(false);
  });
  it("a filter hides places and brings them back; a new gallery refits", async () => {
    render(GoogleMapView, { config, onFail: vi.fn() }); await flush(); await tick(); await flush();
    const map = FakeMap.instances[0];
    trip.facets = ["activities"]; await tick();
    expect(FakeMarker.all.filter((m) => m.map).map((m) => m.title)).toEqual(["Merlion"]);
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
    expect(mapErrorFn).toBeNull();
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
