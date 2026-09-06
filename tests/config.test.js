import { describe, it, expect, vi } from "vitest";
import { loadConfig, chooseMapEngine, DEFAULTS } from "../src/lib/config.js";

describe("runtime config", () => {
  it("reads /config.json without the HTTP cache and fills defaults", async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ googleMapsApiKey: "k" }) }));
    expect(await loadConfig(f)).toEqual({ googleMapsApiKey: "k", googleMapsMapId: "" });
    expect(f.mock.calls[0]).toEqual(["/config.json", { cache: "no-cache" }]);
  });
  it("404, garbage or no network all mean defaults", async () => {
    expect(await loadConfig(async () => ({ ok: false, status: 404 }))).toEqual(DEFAULTS);
    expect(await loadConfig(async () => ({ ok: true, json: async () => { throw new SyntaxError("<html>"); } }))).toEqual(DEFAULTS);
    expect(await loadConfig(async () => ({ ok: true, json: async () => [1, 2] }))).toEqual(DEFAULTS);
    expect(await loadConfig(async () => { throw new TypeError("Failed to fetch"); })).toEqual(DEFAULTS);
  });
  it("Google Maps only with a key and a connection", () => {
    expect(chooseMapEngine({ googleMapsApiKey: "k" }, true)).toBe("google");
    expect(chooseMapEngine({ googleMapsApiKey: "k" }, false)).toBe("maplibre");
    expect(chooseMapEngine({ googleMapsApiKey: "" }, true)).toBe("maplibre");
    expect(chooseMapEngine(null, true)).toBe("maplibre");
  });
});
