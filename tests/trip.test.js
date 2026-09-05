import { describe, it, expect, beforeEach } from "vitest";
import { trip } from "../src/lib/trip.svelte.js";
import { moments, tracks } from "./fixtures.js";

beforeEach(() => {
  trip.moments = structuredClone(moments);
  trip.tracks = structuredClone(tracks);
  trip.facets = []; trip.day = null; trip.focusId = null; trip.storyIndex = -1; trip.view = "map";
});

describe("one selection, every renderer", () => {
  it("filters moments and tracks together", () => {
    trip.toggleFacet("activities");
    expect(trip.visibleMoments.map((m) => m.id)).toEqual(["c"]);
    expect(trip.visibleTracks.map((t) => t.id)).toEqual(["t1", "t2"]);
    trip.toggleFacet("activities");
    expect(trip.visibleMoments.length).toBe(4);
  });
  it("day narrows both, and toggling the same day clears it", () => {
    trip.setDay("2026-03-15");
    expect(trip.visibleMoments.map((m) => m.id)).toEqual(["c", "d"]);
    expect(trip.visibleTracks.map((t) => t.id)).toEqual(["t1"]);
    trip.setDay("2026-03-15");
    expect(trip.day).toBeNull();
  });
});

describe("story navigation", () => {
  it("opens on a visible moment and steps within bounds", () => {
    trip.openStory("b");
    expect(trip.storyOpen).toBe(true);
    expect(trip.storyMoment.id).toBe("b");
    expect(trip.focusId).toBe("b");
    expect(trip.step(1)).toBe(true); expect(trip.storyMoment.id).toBe("c");
    expect(trip.step(1)).toBe(true); expect(trip.step(1)).toBe(false);   // past the end
    expect(trip.storyMoment.id).toBe("d");
    trip.closeStory();
    expect(trip.storyOpen).toBe(false);
  });
  it("does not open a moment the filter hides", () => {
    trip.toggleFacet("activities");
    trip.openStory("a");
    expect(trip.storyOpen).toBe(false);
  });
  it("re-anchors on the same photo when the filter changes underneath it", () => {
    trip.openStory("c");
    trip.toggleFacet("activities");            // c is still visible, now at index 0
    expect(trip.storyMoment.id).toBe("c");
    expect(trip.storyIndex).toBe(0);
    trip.toggleFacet("activities"); trip.toggleFacet("spots");   // c (run) is hidden by spots
    expect(trip.storyOpen).toBe(false);
  });
});
