import { describe, it, expect } from "vitest";
import { pictureBox, clampPan, zoomAbout, isZoomed, MAX_ZOOM, coverLoss, shouldContain, COVER_LIMIT } from "../src/lib/zoom.js";

// A phone-shaped frame, and the two shapes of photo that land in it.
const FRAME = { width: 390, height: 844 };
const PORTRAIT = { w: 900, h: 1200 };    // covers: filled, cropped top and bottom
const LANDSCAPE = { w: 1600, h: 900 };   // contains: letterboxed, bands above and below

describe("where the picture actually is", () => {
  it("fills the frame when it covers", () => {
    const b = pictureBox(FRAME, PORTRAIT, false);
    expect(b.iw).toBeCloseTo(633, 0);     // 844/1200 * 900
    expect(b.ih).toBeCloseTo(844, 0);
    expect(b.iw).toBeGreaterThanOrEqual(b.W); // no gap either side
  });
  it("is letterboxed when it is contained", () => {
    const b = pictureBox(FRAME, LANDSCAPE, true);
    expect(b.iw).toBeCloseTo(390, 0);
    expect(b.ih).toBeCloseTo(219, 0);     // 390/1600 * 900 -- bands above and below
  });
  it("falls back to the frame when the photo's size is unknown", () => {
    expect(pictureBox(FRAME, undefined, false)).toEqual({ W: 390, H: 844, iw: 390, ih: 844 });
  });
  it("has no opinion about a frame with no size", () => {
    expect(pictureBox({ width: 0, height: 0 }, PORTRAIT, false)).toBeNull();
  });
});

describe("panning stops at the picture's edge", () => {
  const cover = pictureBox(FRAME, PORTRAIT, false);
  const contain = pictureBox(FRAME, LANDSCAPE, true);
  it("knows a covering photo is already cropped sideways at 1:1", () => {
    // 900x1200 in a 390x844 frame covers by overflowing 243px horizontally.
    // Vertically it fits exactly, so there is nothing to pan into.
    expect(clampPan(cover, 1, 300, 300)).toEqual({ x: 121.5, y: 0 });
  });
  it("lets you reach the edge and no further", () => {
    const max = (cover.iw * 3 - cover.W) / 2;      // ~755
    expect(clampPan(cover, 3, 9999, 0).x).toBeCloseTo(max, 5);
    expect(clampPan(cover, 3, -9999, 0).x).toBeCloseTo(-max, 5);
    expect(clampPan(cover, 3, max / 2, 0).x).toBeCloseTo(max / 2, 5); // inside, untouched
  });
  it("pins a letterboxed photo's short axis to the middle", () => {
    // 219px tall in an 844px frame: even at 2x there is nothing to pan into.
    expect(clampPan(contain, 2, 0, 400).y).toBe(0);
    // ...but once it is taller than the frame it pans like anything else.
    expect(clampPan(contain, 5, 0, 9999).y).toBeGreaterThan(0);
  });
  it("shrugs at a picture it knows nothing about", () => {
    expect(clampPan(null, 2, 40, 50)).toEqual({ x: 40, y: 50 });
  });
});

describe("a pinch keeps the photo under your fingers", () => {
  const box = pictureBox(FRAME, PORTRAIT, false);
  const at = (state, pt) => ({           // where a point of the picture lands on screen
    x: pt.x * state.z + state.x,
    y: pt.y * state.z + state.y,
  });
  it("holds the anchor still", () => {
    // Pinch about a point up and to the left of centre.
    const anchor = { x: -80, y: -200 };
    const start = { z: 1, x: 0, y: 0 };
    const picturePoint = { x: (anchor.x - start.x) / start.z, y: (anchor.y - start.y) / start.z };
    const end = zoomAbout(box, start, 2.5, anchor);
    const landed = at(end, picturePoint);
    expect(landed.x).toBeCloseTo(anchor.x, 5);
    expect(landed.y).toBeCloseTo(anchor.y, 5);
  });
  it("holds it still on the second pinch too, from an already-panned state", () => {
    const start = { z: 2.5, x: 120, y: -60 };
    const anchor = { x: 40, y: 90 };
    const picturePoint = { x: (anchor.x - start.x) / start.z, y: (anchor.y - start.y) / start.z };
    const landed = at(zoomAbout(box, start, 4, anchor), picturePoint);
    expect(landed.x).toBeCloseTo(anchor.x, 5);
    expect(landed.y).toBeCloseTo(anchor.y, 5);
  });
  it("centres itself when there is no anchor", () => {
    expect(zoomAbout(box, { z: 1, x: 0, y: 0 }, 2)).toEqual({ z: 2, x: 0, y: 0 });
  });
  it("never goes below 1:1, however hard you pinch in", () => {
    expect(zoomAbout(box, { z: 2, x: 30, y: 30 }, 0.2, { x: 50, y: 50 }).z).toBe(1);
    // ...and coming back to 1:1 always lands square, never off-centre.
    expect(zoomAbout(box, { z: 2, x: 200, y: 200 }, 1, { x: 100, y: 0 })).toEqual({ z: 1, x: 0, y: 0 });
  });
  it("stops at a sensible ceiling rather than dissolving into pixels", () => {
    expect(zoomAbout(box, { z: 4, x: 0, y: 0 }, 400, { x: 0, y: 0 }).z).toBe(MAX_ZOOM);
  });
  it("still refuses to show a gap when the anchor is right at the edge", () => {
    // Anchor in the far corner: the naive maths wants to pull the picture's
    // edge inside the frame, and the clamp has to stop it.
    const end = zoomAbout(box, { z: 1, x: 0, y: 0 }, 3, { x: 195, y: 422 });
    expect(Math.abs(end.x)).toBeLessThanOrEqual((box.iw * end.z - box.W) / 2 + 1e-9);
    expect(Math.abs(end.y)).toBeLessThanOrEqual((box.ih * end.z - box.H) / 2 + 1e-9);
  });
  it("survives a nonsense scale", () => {
    expect(zoomAbout(box, { z: 1, x: 0, y: 0 }, NaN, { x: 0, y: 0 }).z).toBe(1);
  });
});

describe("what counts as zoomed", () => {
  it("ignores the rounding dust a pinch leaves behind", () => {
    expect(isZoomed(1)).toBe(false);
    expect(isZoomed(1.004)).toBe(false);   // a finger twitch is not a zoom
    expect(isZoomed(1.2)).toBe(true);
  });
});

describe("how a picture should meet the frame", () => {
  const PHONE = 390 / 844;          // 0.462
  const DESKTOP_CARD = 430 / 860;   // 0.500 — the story card on a wide screen

  it("measures what cover actually throws away", () => {
    // These are the real aspects out of one gallery, and the real losses.
    expect(coverLoss(PHONE, 9 / 16)).toBeCloseTo(0.179, 2);     // a phone photo
    expect(coverLoss(PHONE, 3 / 4)).toBeCloseTo(0.384, 2);
    expect(coverLoss(PHONE, 1)).toBeCloseTo(0.538, 2);          // a 2x2 collage
    expect(coverLoss(PHONE, 2.111)).toBeCloseTo(0.781, 2);      // a true panorama
    expect(coverLoss(PHONE, PHONE)).toBe(0);                    // an exact fit loses nothing
  });
  it("does not care which way round the mismatch is", () => {
    expect(coverLoss(0.5, 2)).toBeCloseTo(coverLoss(2, 0.5), 10);
  });
  it("shrugs at a picture whose size is unknown", () => {
    for (const bad of [0, undefined, NaN, -1]) expect(coverLoss(PHONE, bad)).toBe(0);
  });

  it("lets a phone photo fill the screen, which is the whole point of a story", () => {
    expect(shouldContain(PHONE, 9 / 16)).toBe(false);
    expect(shouldContain(DESKTOP_CARD, 9 / 16)).toBe(false);
  });
  it("shows a square collage whole rather than re-composing it", () => {
    // The old rule was `width > height`: a 1:1 collage was "not landscape" and
    // lost 54% of itself, whole faces included.
    expect(shouldContain(PHONE, 1)).toBe(true);
    expect(shouldContain(PHONE, 1200 / 1600)).toBe(true);
    expect(shouldContain(PHONE, 2.111)).toBe(true);
  });
  it("rescues a very tall panorama too, which orientation never would", () => {
    expect(shouldContain(PHONE, 0.3)).toBe(true);
  });
  it("decides from the frame in front of it, not a constant", () => {
    // The same picture in a taller frame keeps more of itself, so the answer
    // has to be recomputed per device and per orientation.
    expect(shouldContain(0.462, 0.62)).toBe(true);
    expect(shouldContain(0.600, 0.62)).toBe(false);
  });
});
