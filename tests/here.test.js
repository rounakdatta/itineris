import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { here } from "../src/lib/here.svelte.js";

// A stand-in for the browser's geolocation: nothing happens until the code asks.
function install() {
  const geo = {
    asked: 0, cleared: [], opts: null, ok: null, fail: null, nextId: 7,
    watchPosition(ok, fail, opts) { geo.asked += 1; geo.ok = ok; geo.fail = fail; geo.opts = opts; return geo.nextId; },
    clearWatch(id) { geo.cleared.push(id); },
  };
  Object.defineProperty(navigator, "geolocation", { value: geo, configurable: true });
  return geo;
}
const fix = (geo, latitude = 1.28, longitude = 103.84, accuracy = 12) => geo.ok({ coords: { latitude, longitude, accuracy } });

beforeEach(() => install());
afterEach(() => { here.stop(); Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true }); });

describe("the visitor's own position", () => {
  it("asks for nothing until it is started", () => {
    const geo = install();
    expect(here.status).toBe("off"); expect(here.placed).toBe(false); expect(geo.asked).toBe(0);
  });
  it("watching: asking, then every fix, with the camera cue on the first only", () => {
    const geo = install();
    here.start();
    expect(here.status).toBe("asking"); expect(here.on).toBe(true); expect(geo.asked).toBe(1);
    expect(geo.opts).toMatchObject({ enableHighAccuracy: true });
    fix(geo);
    expect(here.status).toBe("on"); expect(here.placed).toBe(true);
    expect([here.lat, here.lng, here.accuracy, here.fixes]).toEqual([1.28, 103.84, 12, 1]);
    fix(geo, 1.3, 103.9, 40);
    expect([here.lat, here.lng, here.accuracy, here.fixes]).toEqual([1.3, 103.9, 40, 2]);
    here.start();   // already watching: no second prompt
    expect(geo.asked).toBe(1);
  });
  it("stopping forgets the position and lets the watch go", () => {
    const geo = install();
    here.start(); fix(geo);
    here.stop();
    expect(geo.cleared).toEqual([7]);
    expect(here.status).toBe("off"); expect(here.placed).toBe(false);
    expect([here.lat, here.lng, here.accuracy, here.fixes]).toEqual([null, null, null, 0]);
  });
  it("toggle turns it on and off", () => {
    const geo = install();
    here.toggle(); expect(here.on).toBe(true);
    fix(geo); here.toggle();
    expect(here.status).toBe("off"); expect(geo.cleared).toHaveLength(1);
  });
  it("a refusal says so, and is not mistaken for a failure", () => {
    const geo = install();
    here.start(); geo.fail({ code: 1, message: "User denied Geolocation" });
    expect(here.status).toBe("denied"); expect(here.on).toBe(false); expect(here.placed).toBe(false);
    expect(geo.cleared).toEqual([7]);
  });
  it("a failure to find it says something else", () => {
    const geo = install();
    here.start(); geo.fail({ code: 2, message: "Position unavailable" });
    expect(here.status).toBe("error");
  });
  it("a device with no geolocation at all says so instead of throwing", () => {
    Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });
    expect(here.available).toBe(false);
    here.start();
    expect(here.status).toBe("unavailable"); expect(here.on).toBe(false);
  });
});
