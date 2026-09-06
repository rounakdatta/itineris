import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import Story from "../src/components/Story.svelte";
import { trip } from "../src/lib/trip.svelte.js";
import { moments, tracks } from "./fixtures.js";
import { seen, resetSeen } from "../src/lib/seen.svelte.js";

beforeEach(() => { trip.moments = structuredClone(moments); trip.tracks = structuredClone(tracks); trip.facets = []; trip.focusId = null; trip.storyIndex = -1; });
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
    expect(d).toHaveTextContent("14 Mar"); expect(d).not.toHaveTextContent("Day 1"); expect(d).toHaveTextContent("Chinatown"); expect(d).toHaveTextContent("08:40");
    expect(d).toHaveTextContent("Kaya toast"); expect(d).toHaveTextContent("food");
    expect(d.querySelector("img.media").getAttribute("src")).toBe("/media/a.webp");   // absolute: works under /g/<token> too
    trip.openStory("d"); await tick();
    expect(screen.getByRole("dialog").querySelector(".caption")).toBeNull();
    expect(screen.getByRole("dialog").querySelector(".tags")).toBeNull();
  });
  it("the place in the header opens Google Maps in a new tab, without acting as a tap on the story", async () => {
    trip.moments = trip.moments.map((m) => (m.id === "a" ? { ...m, mapsUrl: "https://maps.google.com/?cid=7" } : m));
    trip.openStory("a"); render(Story);
    const link = screen.getByRole("link", { name: /Chinatown/ });
    expect(link).toHaveAttribute("href", "https://maps.google.com/?cid=7");
    expect(link).toHaveAttribute("target", "_blank");
    await fireEvent.pointerDown(link, { clientX: 100, clientY: 60, pointerId: 1 });
    await fireEvent.pointerUp(dialog(), { clientX: 100, clientY: 60, pointerId: 1 });
    expect(trip.storyMoment.id).toBe("a");                        // not a tap: still on the same photo
    trip.openStory("b"); await tick();
    expect(screen.getByRole("link", { name: /Maxwell/ })).toHaveAttribute("href", "https://www.google.com/maps/search/Maxwell/@1.2803,103.8449,17z");
  });
  it("shows Google's rating next to the place, and marks each photo seen as it is shown", async () => {
    resetSeen();
    trip.moments = trip.moments.map((m) => (m.id === "a" ? { ...m, google: { placeId: "x", rating: 4.6, ratingCount: 2005 } } : m));
    trip.openStory("a"); render(Story);
    expect(dialog().querySelector(".rate")).toHaveTextContent("4.6★");
    expect(seen.has("a")).toBe(true); expect(seen.has("b")).toBe(false);
    trip.step(1); await tick();
    expect(seen.has("b")).toBe(true);
    expect(dialog().querySelector(".rate")).toBeNull();
  });
  it("a landscape photo is shown whole over a blurred copy", async () => {
    trip.openStory("b"); render(Story);
    const d = dialog();
    expect(d.querySelector("img.media")).toHaveClass("contain");
    expect(d.querySelector("img.backdrop")).not.toBeNull();
    trip.openStory("a"); await tick();
    expect(screen.getByRole("dialog").querySelector("img.backdrop")).toBeNull();
  });
  // Each fixture photo is its own place, so every step here is a "Next stop"
  // handoff; the touch after it skips the handoff, the one after that navigates.
  const skip = async (d) => { await fireEvent.pointerDown(d, { clientX: 200, clientY: 300, pointerId: 9 }); await tick(); await new Promise((r) => setTimeout(r, 450)); await tick(); };
  it("tap right = next, tap left = previous", async () => {
    trip.openStory("a"); render(Story);
    const d = dialog();
    await gesture(d, [300, 400], [300, 400], 1);
    expect(trip.storyMoment.id).toBe("b");
    await skip(d);
    await gesture(d, [30, 400], [30, 400], 1);
    expect(trip.storyMoment.id).toBe("a");
  });
  it("swipe left = next, swipe right = previous, swipe down = close", async () => {
    trip.openStory("a"); render(Story);
    const d = dialog();
    await gesture(d, [300, 400], [120, 405]);
    expect(trip.storyMoment.id).toBe("b");
    await skip(d);
    await gesture(d, [100, 400], [290, 395]);
    expect(trip.storyMoment.id).toBe("a");
    await skip(d);
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
  it("progress bars: one per photo AT THIS PLACE (not the whole trip), earlier ones full; the count says so too", async () => {
    // Chinatown twice, with Maxwell in between in time: the story is Chinatown's two, in order.
    trip.moments = [...trip.moments, { ...structuredClone(moments[0]), id: "a2", t: "2026-03-14T13:00:00+08:00", caption: "Back for more" }];
    trip.openStory("a2"); render(Story);
    const d = screen.getByRole("dialog");
    const fills = [...d.querySelectorAll(".fill")].map((f) => f.style.width);
    expect(fills.length).toBe(2);
    expect(fills[0]).toBe("100%"); expect(fills[1]).toBe("0%");
    expect(d.querySelector(".hint")).toHaveTextContent("2 / 2");
    trip.closeStory(); trip.openStory("c"); await tick();
    expect([...d.querySelectorAll(".fill")]).toHaveLength(1);   // a place with one photo: one bar, no other shop's pointer
  });
});

describe("Story: Next stop (crossing to another place)", () => {
  // Chinatown twice (a, a2) with Maxwell (b) in between in time.
  beforeEach(() => { trip.moments = [...structuredClone(moments), { ...structuredClone(moments[0]), id: "a2", t: "2026-03-14T13:00:00+08:00", caption: "Back for more" }]; trip.handoff = false; });
  it("stepping within a place is plain; stepping into the next place hands over: postcard, pill naming the pin, map flag", async () => {
    trip.openStory("a"); render(Story);
    const d = dialog();
    await gesture(d, [300, 400], [300, 400], 1);
    expect(trip.storyMoment.id).toBe("a2"); expect(d).not.toHaveClass("handoff"); expect(document.querySelector(".handoff-veil")).toBeNull(); expect(trip.handoff).toBe(false);
    await gesture(d, [300, 400], [300, 400], 1);
    expect(trip.storyMoment.id).toBe("b"); expect(d).toHaveClass("handoff"); expect(trip.handoff).toBe(true);
    const pill = document.querySelector(".handoff-veil");
    expect(pill).toHaveTextContent(/Next stop/); expect(pill).toHaveTextContent(/Maxwell/); expect(pill).toHaveTextContent(/1 photo/);
    expect(pill.querySelector(".avatar img").getAttribute("src")).toBe("/media/b.webp");
    // the new place's bars are already its own
    expect(d.querySelectorAll(".fill")).toHaveLength(1);
  });
  it("a touch anywhere skips the handoff; the story is already on the new place", async () => {
    trip.openStory("a2"); render(Story);
    const d = dialog();
    await gesture(d, [300, 400], [300, 400], 1);
    expect(d).toHaveClass("handoff");
    await fireEvent.pointerDown(document.querySelector(".handoff-veil"), { clientX: 200, clientY: 600, pointerId: 2 }); await tick();
    expect(d).not.toHaveClass("handoff"); expect(trip.handoff).toBe(false); expect(trip.storyMoment.id).toBe("b");
    // while the card expands back, a tap is swallowed (the card is still small and moving)...
    expect(document.querySelector(".handoff-veil.quiet")).not.toBeNull();
    await gesture(d, [300, 400], [300, 400], 1);
    expect(trip.storyMoment.id).toBe("b");
    await new Promise((r) => setTimeout(r, 450)); await tick();
    expect(document.querySelector(".handoff-veil")).toBeNull();
    // ...then taps navigate again; a tap on the postcard itself skips too, without counting as next/previous
    await gesture(d, [300, 400], [300, 400], 1);   // -> c, handoff
    expect(trip.storyMoment.id).toBe("c"); expect(d).toHaveClass("handoff");
    await gesture(d, [300, 400], [300, 400], 1);
    expect(trip.storyMoment.id).toBe("c"); expect(d).not.toHaveClass("handoff");
  });
  it("left alone, the handoff ends by itself and the story plays on; closing clears it", async () => {
    trip.openStory("a2"); render(Story);
    const d = dialog();
    await gesture(d, [300, 400], [300, 400], 1);
    expect(d).toHaveClass("handoff");
    await new Promise((r) => setTimeout(r, 2000)); await tick();   // 1.4 s handoff + 0.4 s expand
    expect(d).not.toHaveClass("handoff"); expect(trip.handoff).toBe(false); expect(trip.storyMoment.id).toBe("b"); expect(document.querySelector(".handoff-veil")).toBeNull();
    await gesture(d, [300, 400], [300, 400], 1);   // -> c, handoff again
    expect(trip.handoff).toBe(true);
    await fireEvent.keyDown(window, { key: "Escape" }); await tick();
    expect(trip.storyOpen).toBe(false); expect(trip.handoff).toBe(false);
  });
});

describe("Story: videos", () => {
  const video = { id: "v", t: "2026-03-15T10:00:00+08:00", lat: 1.29, lng: 103.86, place: "Clarke Quay", caption: "River lights", tags: ["night"], media: { type: "video", src: "media/v-1280.mp4", poster: "media/v-1600.webp", medium: "media/v-960.webp", thumb: "media/v-400.webp", duration: 12.5, w: 1280, h: 720 } };
  beforeEach(() => { trip.moments = [...structuredClone(moments), video]; });
  it("plays the video, muted until asked, over its poster; the bar follows the video; the end moves on", async () => {
    trip.openStory("v"); render(Story);
    const d = dialog();
    const v = d.querySelector("video.media");
    expect(v).not.toBeNull();
    expect(v.getAttribute("src")).toBe("/media/v-1280.mp4"); expect(v.getAttribute("poster")).toBe("/media/v-960.webp");
    expect(v.muted).toBe(true); expect(v.hasAttribute("playsinline")).toBe(true); expect(v.hasAttribute("autoplay")).toBe(true);
    expect(d.querySelector(".dur")).toHaveTextContent("0:13");   // 12.5 s, rounded
    expect(d.querySelector("img.placeholder").getAttribute("src")).toBe("/media/v-400.webp");
    expect(v).not.toHaveClass("loaded");
    await fireEvent.loadedData(v); await tick();
    expect(v).toHaveClass("loaded");
    Object.defineProperty(v, "duration", { value: 10, configurable: true }); Object.defineProperty(v, "currentTime", { value: 5, configurable: true, writable: true });
    await fireEvent.timeUpdate(v); await tick();
    const fills = [...d.querySelectorAll(".fill")];
    expect(fills[trip.storyPos].style.width).toBe("50%");                      // the video's own progress, not a 5 s timer
    await fireEvent.click(screen.getByRole("button", { name: "Turn sound on" })); await tick();
    expect(screen.getByRole("button", { name: "Turn sound off" })).toBeInTheDocument();   // the state toggled
    expect(v.muted).toBe(false);                                                            // ...and reached the element
    await fireEvent.ended(v); await tick();
    expect(trip.storyMoment.id).toBe("d");                                     // the end of the video moves the story on
  });
  it("a photo after a video gets its own image again", async () => {
    trip.openStory("v"); render(Story);                                       // in time order the video sits before d
    await fireEvent.ended(dialog().querySelector("video.media")); await tick();
    expect(trip.storyMoment.id).toBe("d");
    expect(dialog().querySelector("video.media")).toBeNull(); expect(dialog().querySelector("img.media")).not.toBeNull();
  });
});
