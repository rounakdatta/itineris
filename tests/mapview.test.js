import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import maplibregl from "maplibre-gl";
import MapView from "../src/components/MapView.svelte";
import { trip } from "../src/lib/trip.svelte.js";
import { moments, tracks } from "./fixtures.js";

const flush = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => { maplibregl.Map.instances.length = 0; trip.moments = []; trip.tracks = []; trip.status = "loading"; trip.galleryId = null; trip.facets = []; trip.day = null; trip.focusId = null; trip.storyIndex = -1; });

describe("MapView", () => {
  it("starts on a neutral world view, not on a particular city", async () => {
    render(MapView); await flush();
    const map = maplibregl.Map.instances[0];
    expect(map.options.zoom).toBeLessThan(3);
  });
  it("fits the photos even when the map is ready before the data arrives", async () => {
    render(MapView); await flush(); await tick();
    const map = maplibregl.Map.instances[0];
    expect(map.camera.filter((c) => c[0] === "fitBounds")).toHaveLength(0);          // nothing to fit yet, and no error
    trip.moments = structuredClone(moments); trip.tracks = structuredClone(tracks); trip.galleryId = "g1"; trip.status = "ready";
    await tick(); await flush();
    expect(map.camera.some((c) => c[0] === "fitBounds")).toBe(true);
    expect(map.sources.moments.data.features.map((f) => f.id)).toEqual(["a", "b", "c"]);   // d has no GPS and stays off the map
  });
  it("refits when a different gallery loads", async () => {
    trip.moments = structuredClone(moments); trip.tracks = structuredClone(tracks); trip.galleryId = "g1"; trip.status = "ready";
    render(MapView); await flush(); await tick();
    const map = maplibregl.Map.instances[0];
    const before = map.camera.filter((c) => c[0] === "fitBounds").length;
    trip.galleryId = "g2"; await tick(); await flush();
    expect(map.camera.filter((c) => c[0] === "fitBounds").length).toBeGreaterThan(before);
  });
});

describe("tapping pins", () => {
  it("first tap focuses (place card), second opens the story; bare map clears the focus", async () => {
    trip.moments = structuredClone(moments); trip.tracks = structuredClone(tracks); trip.galleryId = "g1"; trip.status = "ready";
    render(MapView); await flush(); await tick();
    const map = maplibregl.Map.instances[0];
    const click = map.handlers.click[0];
    map.queryRenderedFeatures = () => [{ properties: { id: "b" } }];
    click({ point: { x: 10, y: 10 } });
    expect(trip.focusId).toBe("b"); expect(trip.storyOpen).toBe(false);
    click({ point: { x: 10, y: 10 } });
    expect(trip.storyMoment.id).toBe("b");
    trip.closeStory();
    map.queryRenderedFeatures = () => [];
    click({ point: { x: 200, y: 200 } });
    expect(trip.focusId).toBeNull();
  });
});
