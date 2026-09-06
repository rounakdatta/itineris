import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import Timeline from "../src/components/Timeline.svelte";
import { trip } from "../src/lib/trip.svelte.js";
import { moments, tracks } from "./fixtures.js";

beforeEach(() => { trip.moments = structuredClone(moments); trip.tracks = structuredClone(tracks); trip.facets = []; trip.focusId = null; trip.storyIndex = -1; });

describe("Timeline", () => {
  it("first tap focuses, second tap on the same photo opens it", async () => {
    render(Timeline);
    const tick = screen.getByRole("button", { name: /08:40 Chinatown/ });
    await fireEvent.click(tick);
    expect(trip.focusId).toBe("a"); expect(trip.storyOpen).toBe(false);
    expect(tick).toHaveClass("on");
    expect(tick.querySelector("img").getAttribute("src")).toBe("/media/a-t.webp");
    await fireEvent.click(tick);
    expect(trip.storyOpen).toBe(true); expect(trip.storyMoment.id).toBe("a");
  });
  it("a photo with no place opens on the FIRST tap: there is no card to show first", async () => {
    render(Timeline);
    await fireEvent.click(screen.getByRole("button", { name: /19:50/ }));
    expect(trip.storyOpen).toBe(true); expect(trip.storyMoment.id).toBe("d"); expect(trip.focusId).toBe("d");
  });
  it("no day chips: the strip is the whole dock", () => {
    render(Timeline);
    expect(screen.queryByRole("button", { name: /Whole trip|Day 1/ })).toBeNull();
    expect(screen.getAllByRole("button").length).toBe(moments.length);
  });
});
