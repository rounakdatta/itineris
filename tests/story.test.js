import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import Story from "../src/components/Story.svelte";
import { trip } from "../src/lib/trip.svelte.js";
import { moments, tracks } from "./fixtures.js";

beforeEach(() => { trip.moments = structuredClone(moments); trip.tracks = structuredClone(tracks); trip.facets = []; trip.day = null; trip.focusId = null; trip.storyIndex = -1; });
const dialog = () => { const d = screen.getByRole("dialog"); d.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 844, right: 390, bottom: 844 }); return d; };
const gesture = async (el, from, to, steps = 4) => {
  await fireEvent.pointerDown(el, { clientX: from[0], clientY: from[1], pointerId: 1 });
  for (let i = 1; i <= steps; i++) await fireEvent.pointerMove(el, { clientX: from[0] + ((to[0] - from[0]) * i) / steps, clientY: from[1] + ((to[1] - from[1]) * i) / steps, pointerId: 1 });
  await fireEvent.pointerUp(el, { clientX: to[0], clientY: to[1], pointerId: 1 });
};

describe("Story", () => {
  it("shows day, place, clock, caption and tags; hides empty rows", async () => {
    trip.openStory("a"); render(Story);
    const d = dialog();
    expect(d).toHaveTextContent("Day 1"); expect(d).toHaveTextContent("Chinatown"); expect(d).toHaveTextContent("08:40");
    expect(d).toHaveTextContent("Kaya toast"); expect(d).toHaveTextContent("food");
    expect(d.querySelector("img.media").getAttribute("src")).toBe("/media/a.webp");   // absolute: works under /g/<token> too
    trip.openStory("d"); await tick();
    expect(screen.getByRole("dialog").querySelector(".caption")).toBeNull();
    expect(screen.getByRole("dialog").querySelector(".tags")).toBeNull();
  });
  it("a landscape photo is shown whole over a blurred copy", async () => {
    trip.openStory("b"); render(Story);
    const d = dialog();
    expect(d.querySelector("img.media")).toHaveClass("contain");
    expect(d.querySelector("img.backdrop")).not.toBeNull();
    trip.openStory("a"); await tick();
    expect(screen.getByRole("dialog").querySelector("img.backdrop")).toBeNull();
  });
  it("tap right = next, tap left = previous", async () => {
    trip.openStory("a"); render(Story);
    const d = dialog();
    await gesture(d, [300, 400], [300, 400], 1);
    expect(trip.storyMoment.id).toBe("b");
    await gesture(d, [30, 400], [30, 400], 1);
    expect(trip.storyMoment.id).toBe("a");
  });
  it("swipe left = next, swipe right = previous, swipe down = close", async () => {
    trip.openStory("a"); render(Story);
    const d = dialog();
    await gesture(d, [300, 400], [120, 405]);
    expect(trip.storyMoment.id).toBe("b");
    await gesture(d, [100, 400], [290, 395]);
    expect(trip.storyMoment.id).toBe("a");
    await gesture(d, [200, 300], [205, 520]);
    expect(trip.storyOpen).toBe(false);
  });
  it("swiping past the last photo closes; Escape closes", async () => {
    trip.openStory("d"); render(Story);
    await gesture(dialog(), [300, 400], [100, 400]);
    expect(trip.storyOpen).toBe(false);
    trip.openStory("a"); await tick();
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(trip.storyOpen).toBe(false);
  });
  it("progress bars: one per visible photo, earlier ones full", () => {
    trip.openStory("c"); render(Story);
    const fills = [...screen.getByRole("dialog").querySelectorAll(".fill")].map((f) => f.style.width);
    expect(fills.length).toBe(4);
    expect(fills[0]).toBe("100%"); expect(fills[1]).toBe("100%"); expect(fills[3]).toBe("0%");
  });
});
