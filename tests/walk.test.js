import { describe, it, expect, vi } from "vitest";
import { walkBetween, ROUTE_MASK, MAX_WALK_M } from "../server/walk.js";
import { decodePolyline, walkKey, midOf, legsOf } from "../server/route.js";

const FROM = { lat: 12.925, lng: 77.573 }, TO = { lat: 12.928, lng: 77.58 };
const reply = (body, ok = true, status = 200) => vi.fn(async () => ({ ok, status, json: async () => body }));

describe("asking Google how far the walk was", () => {
  it("asks the Routes API for a walk, and for only what it publishes", async () => {
    const f = reply({ routes: [{ distanceMeters: 1140, polyline: { encodedPolyline: "abc" } }] });
    await walkBetween(FROM, TO, { key: "k", fetch: f });
    const [url, init] = f.mock.calls[0];
    expect(url).toContain("routes.googleapis.com");
    expect(init.headers["x-goog-fieldmask"]).toBe(ROUTE_MASK);
    expect(init.headers["x-goog-api-key"]).toBe("k");
    const body = JSON.parse(init.body);
    expect(body.travelMode).toBe("WALK");
    expect(body.origin.location.latLng).toEqual({ latitude: 12.925, longitude: 77.573 });
    // No traffic, no departure time: the number a viewer sees should not
    // depend on when they looked.
    expect(body).not.toHaveProperty("departureTime");
    expect(body).not.toHaveProperty("routingPreference");
  });
  it("brings back the real distance and the shape of the walk", async () => {
    const f = reply({ routes: [{ distanceMeters: 1140, polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC" } }] });
    const w = await walkBetween(FROM, TO, { key: "k", fetch: f });
    expect(w.m).toBe(1140);
    expect(decodePolyline(w.p)).toHaveLength(2);
    expect(w.at).toMatch(/^\d{4}-/);
  });
  it("remembers a definite 'no route' so the sweep stops asking", async () => {
    const w = await walkBetween(FROM, TO, { key: "k", fetch: reply({ routes: [] }) });
    expect(w).toMatchObject({ m: null, p: null });
    expect(w.at).toBeTruthy();
  });
  it("raises a refusal with its status, so a key problem stops the whole sweep", async () => {
    const f = reply({ error: { message: "API not enabled" } }, false, 403);
    await expect(walkBetween(FROM, TO, { key: "k", fetch: f })).rejects.toMatchObject({ status: 403, message: /Routes API 403.*not enabled/ });
  });
  it("does not call anybody without a key or without two real points", async () => {
    const f = reply({});
    expect(await walkBetween(FROM, TO, { key: "", fetch: f })).toBeNull();
    expect(await walkBetween({ lat: null, lng: null }, TO, { key: "k", fetch: f })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it("has a ceiling past which nobody walked it", () => {
    expect(MAX_WALK_M).toBeGreaterThan(5000);
    expect(MAX_WALK_M).toBeLessThan(100000);
  });
});

describe("a leg that has been routed, and one that has not", () => {
  const at = (t, place, lat, lng) => ({ id: `m${t}`, t: `2026-03-14T${t}:00+08:00`, place, lat, lng, tags: [], media: {} });
  const trip = [at("09", "A", 12.925, 77.573), at("10", "B", 12.928, 77.58)];
  const key = walkKey({ lat: 12.925, lng: 77.573 }, { lat: 12.928, lng: 77.58 });

  it("says how far the WALK was, not how far apart the two points are", () => {
    // 850 m apart; the walk is 1140 m. Labelling the gap as the distance is
    // the thing this replaced.
    const [straight] = legsOf(trip);
    expect(Math.round(straight.metres)).toBeLessThan(900);
    const [routed] = legsOf(trip, { [key]: { m: 1140, p: "ipwnAg`}xMuAsB{@_CcAeA" } });
    expect(routed.metres).toBe(1140);
    expect(routed.label).toBe("1.1 km");
    expect(routed.routed).toBe(true);
  });
  it("follows the streets rather than cutting across them", () => {
    const [routed] = legsOf(trip, { [key]: { m: 1140, p: "ipwnAg`}xMuAsB{@_CcAeA" } });
    expect(routed.path.length).toBeGreaterThan(2);
  });
  it("an unrouted leg still draws, and says NOTHING rather than something untrue", () => {
    const [straight] = legsOf(trip);
    expect(straight.routed).toBe(false);
    expect(straight.label).toBe("");
    expect(straight.path).toEqual([[77.573, 12.925], [77.58, 12.928]]);
  });
  it("...and so does one Google could find no walking route for", () => {
    const [none] = legsOf(trip, { [key]: { m: null, p: null } });
    expect(none.routed).toBe(false);
    expect(none.label).toBe("");
  });
  it("puts the label halfway ALONG the walk, not in the middle of the straight line", () => {
    // An L-shaped walk: the straight midpoint is in the middle of the block
    // the walk never entered.
    const L = [[77.57, 12.92], [77.58, 12.92], [77.58, 12.93]];
    const mid = midOf(L);
    const onPath = L.some(([lng, lat]) => Math.abs(lng - mid.lng) < 1e-9 || Math.abs(lat - mid.lat) < 1e-9);
    expect(onPath).toBe(true);
    expect(mid).not.toEqual({ lat: 12.925, lng: 77.575 });
  });
});
