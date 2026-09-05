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
  it("shows the thumbnail at once, fades the full image in, and the timer waits for it", async () => {
    trip.openStory("a"); render(Story);
    const d = dialog();
    const ph = d.querySelector("img.placeholder"), big = d.querySelector("img.media");
    expect(ph.getAttribute("src")).toBe("/media/a-t.webp");
    expect(big.getAttribute("src")).toBe("/media/a.webp");
    expect(big).not.toHaveClass("loaded"); expect(d.querySelector(".loading")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 120));
    expect(d.querySelectorAll(".fill")[0].style.width).toBe("0%");        // no advancing before the photo is there
    await fireEvent.load(big);
    expect(big).toHaveClass("loaded"); expect(d.querySelector(".loading")).toBeNull();
    await new Promise((r) => setTimeout(r, 160));
    expect(parseFloat(d.querySelectorAll(".fill")[0].style.width)).toBeGreaterThan(0);
  });
  it("a photo that fails to load says so instead of going dark, and the story moves on", async () => {
    trip.openStory("a"); render(Story);
    const d = dialog();
    await fireEvent.error(d.querySelector("img.media"));
    expect(d).toHaveTextContent("Couldn't load this photo");
    await new Promise((r) => setTimeout(r, 160));
    expect(parseFloat(d.querySelectorAll(".fill")[0].style.width)).toBeGreaterThan(0);
  });
  it("prefers the 960px tier on a small screen", () => {
    trip.moments = trip.moments.map((m) => (m.id === "a" ? { ...m, media: { ...m.media, medium: "media/a-960.webp" } } : m));
    trip.openStory("a"); render(Story);
    expect(dialog().querySelector("img.media").getAttribute("src")).toBe("/media/a-960.webp");
  });
  it("progress bars: one per visible photo, earlier ones full", () => {
    trip.openStory("c"); render(Story);
    const fills = [...screen.getByRole("dialog").querySelectorAll(".fill")].map((f) => f.style.width);
    expect(fills.length).toBe(4);
    expect(fills[0]).toBe("100%"); expect(fills[1]).toBe("100%"); expect(fills[3]).toBe("0%");
  });
});
