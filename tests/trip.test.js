import { describe, it, expect, beforeEach } from "vitest";
import { trip } from "../src/lib/trip.svelte.js";
import { moments, tracks } from "./fixtures.js";

beforeEach(() => {
  trip.moments = structuredClone(moments);
  trip.tracks = structuredClone(tracks);
  trip.facets = []; trip.focusId = null; trip.storyIndex = -1; trip.view = "map";
});

describe("one selection, every renderer", () => {
  it("filters moments and tracks together", () => {
    trip.toggleFacet("activities");
    expect(trip.visibleMoments.map((m) => m.id)).toEqual(["c"]);
    expect(trip.visibleTracks.map((t) => t.id)).toEqual(["t1", "t2"]);
    trip.toggleFacet("activities");
    expect(trip.visibleMoments.length).toBe(4);
  });
});

describe("a story is one place's photos", () => {
  // Chinatown at 08:40 and again at 13:00, with Maxwell (12:10) in between:
  // Chinatown's story is its two photos back to back, then Maxwell's begins.
  beforeEach(() => { trip.moments = [...structuredClone(moments), { ...structuredClone(moments[0]), id: "a2", t: "2026-03-14T13:00:00+08:00", caption: "Back for more" }]; });
  it("groups the story by place, in the order places were first visited", () => {
    trip.openStory("a");
    expect(trip.storyGroup.map((m) => m.id)).toEqual(["a", "a2"]); expect(trip.storyPos).toBe(0);
    expect(trip.step(1)).toBe(true); expect(trip.storyMoment.id).toBe("a2"); expect(trip.storyPos).toBe(1);   // same place, skipping Maxwell in time
    expect(trip.step(1)).toBe(true); expect(trip.storyMoment.id).toBe("b");    // next place starts
    expect(trip.storyGroup.map((m) => m.id)).toEqual(["b"]);
    expect(trip.step(-1)).toBe(true); expect(trip.storyMoment.id).toBe("a2");  // back lands on the previous place's LAST photo
    expect(trip.upcoming(1, 3).map((m) => m.id)).toEqual(["b", "c", "d"]);
  });
  it("a photo with no place is a story of one; the last place's end closes", () => {
    trip.openStory("d");
    expect(trip.storyGroup.map((m) => m.id)).toEqual(["d"]);
    expect(trip.step(1)).toBe(false);
    expect(trip.step(-1)).toBe(true); expect(trip.storyMoment.id).toBe("c");
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
