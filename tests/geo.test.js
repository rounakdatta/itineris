import { describe, it, expect, vi } from "vitest";
import { searchPlaces, currentPosition } from "../admin/lib/geo.js";

describe("place search", () => {
  it("asks Nominatim once, with the query encoded, and returns numbers + a short name", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => [
      { lat: "37.7614", lon: "-122.4118", name: "Tartine Manufactory", display_name: "Tartine Manufactory, 595, Alabama Street, Mission District, San Francisco, California, United States" },
      { lat: "1.2830", lon: "103.8440", name: "", display_name: "Maxwell Food Centre, Maxwell Road, Singapore" },
      { lat: "nope", lon: "1" },
    ] }));
    const r = await searchPlaces("  tartine manufactory ", { fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=en&q=tartine%20manufactory");
    expect(r).toEqual([
      { lat: 37.7614, lng: -122.4118, name: "Tartine Manufactory", label: expect.stringContaining("Alabama Street") },
      { lat: 1.283, lng: 103.844, name: "Maxwell Food Centre", label: "Maxwell Food Centre, Maxwell Road, Singapore" },
    ]);
  });
  it("an empty query never hits the network; a failure is a readable error", async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 429 }));
    expect(await searchPlaces("   ", { fetch })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    await expect(searchPlaces("x", { fetch })).rejects.toThrow("Place search failed (429)");
  });
});

describe("device location", () => {
  it("resolves rounded coordinates and accuracy", async () => {
    const geo = { getCurrentPosition: (ok) => ok({ coords: { latitude: 37.76141234, longitude: -122.41181234, accuracy: 12.4 } }) };
    expect(await currentPosition({ geo })).toEqual({ lat: 37.761412, lng: -122.411812, accuracy: 12 });
  });
  it("explains a denial, and a device without geolocation", async () => {
    await expect(currentPosition({ geo: { getCurrentPosition: (_, fail) => fail({ code: 1 }) } })).rejects.toThrow(/denied/);
    await expect(currentPosition({ geo: null })).rejects.toThrow(/can't share/);
  });
});
