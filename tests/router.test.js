import { describe, it, expect, beforeEach } from "vitest";
import { parseHash, buildHash, applyHash, syncHash } from "../src/lib/router.js";
import { trip } from "../src/lib/trip.svelte.js";
import { moments, tracks } from "./fixtures.js";

const popstate = () => new Promise((r) => window.addEventListener("popstate", r, { once: true }));
beforeEach(() => {
  trip.moments = structuredClone(moments); trip.tracks = structuredClone(tracks); trip.status = "ready";
  trip.facets = []; trip.view = "map"; trip.focusId = null; trip.storyIndex = -1;
  window.history.replaceState(null, "", "/");
});

describe("hash grammar", () => {
  it("round-trips", () => {
    expect(parseHash("#m/abc-1")).toEqual({ story: "abc-1" });
    expect(parseHash("#wall")).toEqual({ story: null });      // the wall is no longer a destination
    expect(parseHash("")).toEqual({ story: null });
    expect(parseHash("#/m/x")).toEqual({ story: "x" });
    expect(buildHash({ story: "x" })).toBe("#m/x");
    expect(buildHash({})).toBe("");
  });
});

describe("URL -> state", () => {
  it("opens the story named in the hash; an old #wall link only closes the story -- the view is the data's call", () => {
    applyHash(trip, "#m/b");
    expect(trip.storyMoment.id).toBe("b");
    applyHash(trip, "#wall");
    expect(trip.storyOpen).toBe(false); expect(trip.view).toBe("map");
    trip.view = "wall";                        // the fallback for a gallery with nothing located
    applyHash(trip, "");
    expect(trip.view).toBe("wall");            // an empty hash never forces the map: the app picks the default from the data
  });
  it("ignores an unknown story id without throwing", () => {
    applyHash(trip, "#m/nope");
    expect(trip.storyOpen).toBe(false);
  });
});

describe("state -> URL, and the back button", () => {
  it("opening pushes one entry, stepping replaces, closing pops it", async () => {
    const len0 = history.length;
    trip.openStory("a"); syncHash(trip);
    expect(location.hash).toBe("#m/a");
    expect(history.state?.itinerisStory).toBe(true);
    expect(history.length).toBe(len0 + 1);
    trip.step(1); syncHash(trip);
    expect(location.hash).toBe("#m/b");
    expect(history.length).toBe(len0 + 1);                 // replaced, not pushed
    const back = popstate();
    trip.closeStory(); syncHash(trip);                     // -> history.back()
    await back;
    expect(location.hash).toBe("");
  });
  it("the wall (the no-locations fallback) is not in the URL, and survives a story opened from it", async () => {
    trip.view = "wall"; syncHash(trip);
    expect(location.hash).toBe("");
    trip.openStory("c"); syncHash(trip);
    expect(location.hash).toBe("#m/c");
    const back = popstate();
    trip.closeStory(); syncHash(trip);
    await back;
    applyHash(trip, location.hash);                        // what App's popstate handler does
    expect(location.hash).toBe(""); expect(trip.view).toBe("wall"); expect(trip.storyOpen).toBe(false);
  });
  it("a shared story link did not push, so closing just clears the hash", () => {
    history.replaceState(null, "", "/#m/c");
    applyHash(trip, location.hash);
    expect(trip.storyMoment.id).toBe("c");
    syncHash(trip);                                        // already in sync: no-op
    expect(location.hash).toBe("#m/c");
    trip.closeStory(); syncHash(trip);
    expect(location.hash).toBe("");                        // replaced synchronously
  });
});
