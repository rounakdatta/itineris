import { describe, it, expect, vi } from "vitest";
import { lookupPlace, needsLookup, isStale, distanceM, FIELD_MASK } from "../server/places.js";

const google = (places) => vi.fn(async () => ({ ok: true, json: async () => ({ places }) }));
const laupasat = { id: "ChIJlps", displayName: { text: "Lau Pa Sat" }, rating: 4.3, userRatingCount: 24154, primaryTypeDisplayName: { text: "Hawker centre" }, googleMapsUri: "https://maps.google.com/?cid=42", location: { latitude: 1.2807, longitude: 103.8504 } };

describe("asking Google about a place", () => {
  it("one Text Search, biased to the photo's spot, with exactly the fields we publish", async () => {
    const fetch = google([laupasat]);
    const r = await lookupPlace({ name: " Lau Pa Sat ", lat: 1.2806, lng: 103.8505 }, { key: "k", fetch, endpoint: "https://places.test/searchText" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://places.test/searchText");
    expect(init.headers["x-goog-api-key"]).toBe("k"); expect(init.headers["x-goog-fieldmask"]).toBe(FIELD_MASK);
    expect(JSON.parse(init.body)).toEqual({ textQuery: "Lau Pa Sat", maxResultCount: 3, languageCode: "en", locationBias: { circle: { center: { latitude: 1.2806, longitude: 103.8505 }, radius: 500 } } });
    expect(r).toMatchObject({ placeId: "ChIJlps", name: "Lau Pa Sat", rating: 4.3, ratingCount: 24154, type: "Hawker centre", mapsUri: "https://maps.google.com/?cid=42" });
    expect(Date.parse(r.fetchedAt)).toBeGreaterThan(0);
  });
  it("a match further than 300 m is a different place: null, remembered as 'nothing here'", async () => {
    const far = { ...laupasat, location: { latitude: 1.30, longitude: 103.90 } };
    expect(await lookupPlace({ name: "Lau Pa Sat", lat: 1.2806, lng: 103.8505 }, { key: "k", fetch: google([far]) })).toBeNull();
    expect(await lookupPlace({ name: "Lau Pa Sat", lat: 1.2806, lng: 103.8505 }, { key: "k", fetch: google([far, laupasat]) })).toMatchObject({ placeId: "ChIJlps" });   // the near one wins
    expect(await lookupPlace({ name: "Lau Pa Sat", lat: 1.2806, lng: 103.8505 }, { key: "k", fetch: google([]) })).toBeNull();
  });
  it("no key or no name: nothing is asked", async () => {
    const fetch = google([laupasat]);
    expect(await lookupPlace({ name: "x", lat: 1, lng: 2 }, { key: "", fetch })).toBeNull();
    expect(await lookupPlace({ name: "  ", lat: 1, lng: 2 }, { key: "k", fetch })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("a refusal carries the status and Google's reason", async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "Places API (New) has not been used in project 1 before or it is disabled." } }) }));
    await expect(lookupPlace({ name: "x", lat: 1, lng: 2 }, { key: "k", fetch })).rejects.toMatchObject({ status: 403, message: /not been used/ });
  });
  it("what needs a lookup: placed, named, never looked up or older than 29 days", () => {
    const now = Date.parse("2026-09-06T00:00:00Z");
    const m = { media: { type: "photo" }, lat: 1, lng: 2, place: "Lau Pa Sat" };
    expect(needsLookup(m, now)).toBe(true);
    expect(needsLookup({ ...m, place: "" }, now)).toBe(false);
    expect(needsLookup({ ...m, lat: null, lng: null }, now)).toBe(false);
    expect(needsLookup({ ...m, google: { placeId: "x", fetchedAt: "2026-09-01T00:00:00Z" } }, now)).toBe(false);
    expect(needsLookup({ ...m, google: { placeId: null, fetchedAt: "2026-09-01T00:00:00Z" } }, now)).toBe(false);   // remembered "nothing here"
    expect(needsLookup({ ...m, google: { placeId: "x", fetchedAt: "2026-07-01T00:00:00Z" } }, now)).toBe(true);    // stale: Google's 30-day rule
    expect(isStale({ fetchedAt: "2026-09-05T00:00:00Z" }, now)).toBe(false); expect(isStale(undefined, now)).toBe(true);
    expect(Math.round(distanceM({ lat: 1.2806, lng: 103.8505 }, { lat: 1.2807, lng: 103.8504 }))).toBeLessThan(20);
  });
});

import { searchPlaces, fetchPlaceDetails, DETAILS_MASK } from "../server/places.js";
describe("the admin's place search and details by id", () => {
  it("search returns a few candidates with address and rating, biased wide around the spot", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ places: [{ ...laupasat, formattedAddress: "18 Raffles Quay, Singapore" }, { id: "x2", displayName: { text: "Other" }, location: { latitude: 1, longitude: 2 } }] }) }));
    const r = await searchPlaces("lau pa", { lat: 1.28, lng: 103.85 }, { key: "k", fetch });
    const [, init] = fetch.mock.calls[0];
    expect(init.headers["x-goog-fieldmask"]).toContain("places.formattedAddress");
    expect(JSON.parse(init.body)).toMatchObject({ textQuery: "lau pa", maxResultCount: 5, locationBias: { circle: { center: { latitude: 1.28, longitude: 103.85 }, radius: 5000 } } });
    expect(r[0]).toMatchObject({ placeId: "ChIJlps", name: "Lau Pa Sat", address: "18 Raffles Quay, Singapore", rating: 4.3, ratingCount: 24154, lat: 1.2807, lng: 103.8504 });
    expect(r).toHaveLength(2);
    expect(await searchPlaces("", {}, { key: "k", fetch })).toEqual([]);
  });
  it("details by id: GET places/<id> with the singular field mask; 404 is 'gone'", async () => {
    const fetch = vi.fn(async (url) => (url.endsWith("/places/ChIJlps") ? { ok: true, status: 200, json: async () => ({ ...laupasat, formattedAddress: "18 Raffles Quay" }) } : { ok: false, status: 404, json: async () => ({}) }));
    const d = await fetchPlaceDetails("ChIJlps", { key: "k", fetch, base: "https://places.test/places" });
    expect(fetch.mock.calls[0][0]).toBe("https://places.test/places/ChIJlps");
    expect(fetch.mock.calls[0][1].headers["x-goog-fieldmask"]).toBe(DETAILS_MASK);
    expect(d).toMatchObject({ placeId: "ChIJlps", name: "Lau Pa Sat", rating: 4.3, address: "18 Raffles Quay", lat: 1.2807 });
    expect(await fetchPlaceDetails("ChIJgone", { key: "k", fetch, base: "https://places.test/places" })).toBeNull();
  });
  it("a photo pinned to a place needs its details until they match the pin", () => {
    const now = Date.parse("2026-09-06T00:00:00Z");
    const A = "ChIJaaaaaaaaaaaaaaaaaaaa", B = "ChIJbbbbbbbbbbbbbbbbbbbb";
    expect(needsLookup({ placeId: A, lat: 1, lng: 2, place: "" }, now)).toBe(true);
    expect(needsLookup({ placeId: A, google: { placeId: A, fetchedAt: "2026-09-05T00:00:00Z" } }, now)).toBe(false);
    expect(needsLookup({ placeId: A, google: { placeId: B, fetchedAt: "2026-09-05T00:00:00Z" } }, now)).toBe(true);
    expect(needsLookup({ placeId: "chinatown", lat: 1, lng: 2, place: "" }, now)).toBe(false);   // a seed's internal key is not a Place ID: name lookup rules apply
    expect(needsLookup({ placeId: "chinatown", lat: 1, lng: 2, place: "Chinatown" }, now)).toBe(true);
  });
});
