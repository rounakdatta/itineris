import { describe, it, expect } from "vitest";
import { FACETS, daysOf, dayKey, clockOf, momentMatches, trackMatches, bboxOf, momentsFC, tracksFC, hasCoords, hasAnyCoords, storySrc, storyBytes, fmtDuration, placeLink, placeGroup, groupByPlace, placeKey } from "../src/lib/data.js";
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

describe("Google Maps links out", () => {
  it("prefers the exact link, else searches the name at the spot, else the spot, else the name", () => {
    expect(placeLink({ ...moments[0], mapsUrl: "https://maps.google.com/?cid=5" })).toBe("https://maps.google.com/?cid=5");
    expect(placeLink(moments[0])).toBe("https://www.google.com/maps/search/Chinatown/@1.28,103.84,17z");
    expect(placeLink({ ...moments[0], place: "" })).toBe("https://www.google.com/maps/search/?api=1&query=1.28,103.84");
    expect(placeLink({ ...moments[3], place: "Lau Pa Sat" })).toBe("https://www.google.com/maps/search/?api=1&query=Lau%20Pa%20Sat");
    expect(placeLink(moments[3])).toBeNull();
    expect(placeLink(null)).toBeNull();
  });
  it("groups a place's photos; a nameless photo stands alone", () => {
    const ms = [...moments, { ...moments[0], id: "a2", t: "2026-03-14T09:10:00+08:00" }];
    expect(placeGroup(ms, ms[0]).map((m) => m.id)).toEqual(["a", "a2"]);
    expect(placeGroup(ms, moments[3]).map((m) => m.id)).toEqual(["d"]);
    expect(placeGroup([], moments[0]).map((m) => m.id)).toEqual(["a"]);
  });
});

describe("one pin per place", () => {
  it("groups located photos by Google place first, then by name; keeps the first spot, thumbnail and Google details", () => {
    const ms = [...moments, { ...moments[0], id: "a2", t: "2026-03-14T09:10:00+08:00" }, { ...moments[3], id: "e", lat: 1.29, lng: 103.86, place: "" },
      { ...moments[1], id: "b2", place: "Maxwell Hawker", google: { placeId: "ChIJmax", rating: 4.4 } }, { ...moments[1], id: "b3", place: "", google: { placeId: "ChIJmax", rating: 4.4 } }];
    const g = groupByPlace(ms);
    expect(g.map((x) => [x.key, x.moments.length])).toEqual([["chinatown", 2], ["maxwell", 1], ["merlion", 1], ["#e", 1], ["g:ChIJmax", 2]]);   // d has no coords: no pin
    expect(g[0].first.id).toBe("a"); expect(g[4].google).toMatchObject({ placeId: "ChIJmax" }); expect(g[4].name).toBe("Maxwell Hawker");
    expect(placeKey({ place: "  Lau Pa Sat ", id: "z" })).toBe("lau pa sat"); expect(placeKey({ place: "", id: "z" })).toBe("#z");
    expect(placeKey({ place: "Anything", google: { placeId: "ChIJx" }, id: "y" })).toBe("g:ChIJx");
  });
  it("Google's own place link wins over everything", () => {
    expect(placeLink({ ...moments[0], mapsUrl: "https://maps.google.com/?cid=5", google: { placeId: "x", mapsUri: "https://maps.google.com/?cid=777" } })).toBe("https://maps.google.com/?cid=777");
  });
});

describe("videos", () => {
  const video = { type: "video", src: "media/v-1280.mp4", poster: "media/v-1600.webp", medium: "media/v-960.webp", thumb: "media/v-400.webp", duration: 75.4 };
  it("the story shows the poster tier and streams the file itself", () => {
    expect(storySrc(video)).toBe("/media/v-960.webp");
    expect(storyBytes(video)).toBe("/media/v-1280.mp4");
    expect(fmtDuration(75.4)).toBe("1:15"); expect(fmtDuration(5)).toBe("0:05"); expect(fmtDuration(undefined)).toBe("");
  });
});
