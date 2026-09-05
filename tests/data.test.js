import { describe, it, expect } from "vitest";
import { FACETS, daysOf, dayKey, clockOf, momentMatches, trackMatches, bboxOf, momentsFC, tracksFC, hasCoords, hasAnyCoords, storySrc } from "../src/lib/data.js";
import { moments, tracks } from "./fixtures.js";

describe("time helpers never touch the host zone", () => {
  it("slice the photo's own local day and clock", () => {
    expect(dayKey("2026-03-14T08:40:00+08:00")).toBe("2026-03-14");
    expect(clockOf("2026-03-14T08:40:00+08:00")).toBe("08:40");
    // 23:30 in +08:00 is 15:30 UTC; the day must still be the local one.
    expect(dayKey("2026-03-14T23:30:00+08:00")).toBe("2026-03-14");
  });
  it("derives days in order with counts", () => {
    expect(daysOf(moments).map((d) => [d.label, d.count])).toEqual([["Day 1", 2], ["Day 2", 2]]);
  });
});

describe("facets", () => {
  it("empty selection means everything", () => {
    expect(moments.every((m) => momentMatches(m, []))).toBe(true);
    expect(tracks.every((t) => trackMatches(t, []))).toBe(true);
  });
  it("a facet with no modes shows no routes", () => {
    const spots = FACETS.find((f) => f.id === "spots");
    expect(spots.modes).toEqual([]);
    expect(tracks.filter((t) => trackMatches(t, ["spots"]))).toEqual([]);
  });
  it("activities selects runs and rides, moments and tracks alike", () => {
    expect(moments.filter((m) => momentMatches(m, ["activities"])).map((m) => m.id)).toEqual(["c"]);
    expect(tracks.filter((t) => trackMatches(t, ["activities"])).map((t) => t.id)).toEqual(["t1", "t2"]);
  });
  it("selecting every facet equals selecting none", () => {
    const all = FACETS.map((f) => f.id);
    expect(moments.filter((m) => momentMatches(m, all)).length).toBe(moments.filter((m) => m.tags.length > 0).length);
  });
});

describe("geometry tolerates moments without GPS", () => {
  it("hasCoords", () => {
    expect(hasCoords(moments[0])).toBe(true);
    expect(hasCoords(moments[3])).toBe(false);
  });
  it("bbox and feature collections skip them", () => {
    const box = bboxOf(moments, []);
    expect(box[0]).toBeGreaterThan(103.8); expect(box[3]).toBeLessThan(1.3);
    expect(momentsFC(moments).features.map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(tracksFC(tracks).features[0].properties.color).toMatch(/^#/);
  });
  it("knows when nothing at all is placed", () => {
    expect(hasAnyCoords(moments, tracks)).toBe(true);
    expect(hasAnyCoords([moments[3]], [])).toBe(false);
    expect(hasAnyCoords([], tracks)).toBe(true);
  });
  it("picks the phone tier when there is one", () => {
    expect(storySrc({ src: "media/x.webp", medium: "media/x-960.webp" })).toBe("/media/x-960.webp");
    expect(storySrc({ src: "media/x.webp" })).toBe("/media/x.webp");
  });
  it("bbox of nothing is null", () => {
    expect(bboxOf([], [])).toBeNull();
  });
});
