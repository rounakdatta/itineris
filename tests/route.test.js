import { describe, it, expect } from "vitest";
import { metresBetween, prettyDistance, stopsOf, legsOf, legsFC } from "../src/lib/route.js";

const at = (t, place, lat, lng) => ({ id: `m${t}`, t: `2026-03-14T${t}:00+08:00`, place, lat, lng, tags: [], media: {} });

describe("how far it was", () => {
  it("measures a short walk the way a map would", () => {
    // Maxwell Food Centre to Chinatown Complex: about 400 m along Smith Street.
    expect(metresBetween({ lat: 1.2803, lng: 103.8447 }, { lat: 1.2836, lng: 103.8434 })).toBeCloseTo(392, -1);
  });
  it("...and a long one, across enough latitude to catch a flat-earth formula", () => {
    // Singapore to Bengaluru, ~3150 km.
    const d = metresBetween({ lat: 1.3521, lng: 103.8198 }, { lat: 12.9716, lng: 77.5946 });
    expect(d / 1000).toBeGreaterThan(3100);
    expect(d / 1000).toBeLessThan(3200);
  });
  it("is zero between a place and itself, and unbothered by nothing", () => {
    expect(metresBetween({ lat: 1.3, lng: 103.8 }, { lat: 1.3, lng: 103.8 })).toBe(0);
    expect(metresBetween(null, { lat: 1, lng: 1 })).toBe(0);
  });
});

describe("saying it the way a person would", () => {
  it("uses kilometres for a walk, which is how people say it", () => {
    expect(prettyDistance(400)).toBe("0.4 km");
    expect(prettyDistance(1250)).toBe("1.3 km");
    expect(prettyDistance(9940)).toBe("9.9 km");
  });
  it("drops to metres under a hundred, where a decimal kilometre is uglier and vaguer", () => {
    expect(prettyDistance(80)).toBe("80 m");
    expect(prettyDistance(12)).toBe("10 m");
  });
  it("drops the decimal past ten kilometres, where it is noise", () => {
    expect(prettyDistance(23400)).toBe("23 km");
    expect(prettyDistance(3150000)).toBe("3150 km");
  });
  it("says nothing about nonsense", () => {
    for (const bad of [NaN, undefined, -5]) expect(prettyDistance(bad)).toBe("");
  });
});

describe("the stops, in the order they happened", () => {
  const trip = [
    at("12", "Lunch", 1.2836, 103.8434),
    at("09", "Maxwell", 1.2803, 103.8447),
    at("10", "Maxwell", 1.2803, 103.8447),      // same place again
    at("15", "Barrage", 1.2805, 103.8712),
    { ...at("16", "", 0, 0), lat: null, lng: null },   // no location: not a stop
  ];
  it("follows time, not the order they happen to be listed in", () => {
    expect(stopsOf(trip).map((s) => s.name)).toEqual(["Maxwell", "Lunch", "Barrage"]);
  });
  it("collapses staying put, but not coming back", () => {
    const there_and_back = [at("09", "A", 1.28, 103.84), at("10", "B", 1.29, 103.85), at("11", "A", 1.28, 103.84)];
    expect(stopsOf(there_and_back).map((s) => s.name)).toEqual(["A", "B", "A"]);
  });
  it("ignores photos with no location, which belong to no stop", () => {
    expect(stopsOf(trip).every((s) => Number.isFinite(s.lat))).toBe(true);
  });
});

describe("the legs between them", () => {
  const trip = [at("09", "Maxwell", 1.2803, 103.8447), at("12", "Lunch", 1.2836, 103.8434), at("15", "Barrage", 1.2805, 103.8712)];
  it("is one leg per hop, each carrying how far it was", () => {
    const legs = legsOf(trip);
    expect(legs).toHaveLength(2);
    expect(legs[0].label).toBe("0.4 km");
    expect(legs[0].from.name).toBe("Maxwell");
    expect(legs[0].to.name).toBe("Lunch");
  });
  it("puts the label halfway along, where the thread is", () => {
    const [leg] = legsOf(trip);
    expect(leg.mid.lat).toBeCloseTo((1.2803 + 1.2836) / 2, 6);
    expect(leg.mid.lng).toBeCloseTo((103.8447 + 103.8434) / 2, 6);
  });
  it("draws nothing for a trip that never left, or one with a single stop", () => {
    expect(legsOf([at("09", "A", 1.28, 103.84)])).toEqual([]);
    expect(legsOf([])).toEqual([]);
    // Two names that resolve to the same spot would be a dot on a dot
    // labelled "0 m".
    expect(legsOf([at("09", "A", 1.28, 103.84), at("10", "B", 1.28, 103.84)])).toEqual([]);
  });
  it("gives each leg a stable id, so a redraw does not rebuild the map", () => {
    expect(legsOf(trip).map((l) => l.id)).toEqual(legsOf(trip).map((l) => l.id));
    expect(new Set(legsOf(trip).map((l) => l.id)).size).toBe(2);
  });
  it("hands the engine a feature per leg, with the label already worked out", () => {
    const fc = legsFC(legsOf(trip));
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].geometry.coordinates).toEqual([[103.8447, 1.2803], [103.8434, 1.2836]]);
    expect(fc.features[0].properties).toEqual({ label: "0.4 km", metres: 394 });
  });
});
