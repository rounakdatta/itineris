import { describe, it, expect, vi } from "vitest";
import { isGoogleMapsUrl, extractMapsUrl, parseGoogleMapsUrl, resolveMapsLink } from "../server/links.js";

const FULL = "https://www.google.com/maps/place/Zahrat+Lebnan+-+Defence+St/@24.4699,54.3721,17z/data=!3m1!4b1!4m6!3m5!1s0x3e5e6666aaaa1111:0x1a2b3c4d5e6f!8m2!3d24.471236!4d54.371236!16s%2Fg%2F11abc?entry=ttu&g_ep=xyz";

describe("what counts as a Google Maps link", () => {
  it("accepts the share formats and the maps hosts, nothing else", () => {
    for (const ok of ["https://maps.app.goo.gl/AbCdEf", "https://goo.gl/maps/AbC", FULL, "https://maps.google.com/?cid=123", "https://www.google.co.uk/maps/@51.5,-0.1,12z", "https://google.com/maps?q=1,2", "https://consent.google.com/m?continue=https://www.google.com/maps/place/x/@1,2,3z"]) expect(isGoogleMapsUrl(ok), ok).toBe(true);
    for (const no of ["https://example.com/maps/place/x", "https://www.google.com/search?q=maps", "ftp://maps.app.goo.gl/x", "not a url", "https://evil.google.com.attacker.io/maps"]) expect(isGoogleMapsUrl(no), no).toBe(false);
  });
  it("finds the link inside shared text", () => {
    expect(extractMapsUrl("Zahrat Lebnan\nhttps://maps.app.goo.gl/AbC?g_st=ic")).toBe("https://maps.app.goo.gl/AbC?g_st=ic");
    expect(extractMapsUrl("see https://example.com/x and https://maps.google.com/?cid=5.")).toBe("https://maps.google.com/?cid=5");
    expect(extractMapsUrl("nothing here")).toBeNull();
  });
});

describe("reading a place out of a Google Maps URL", () => {
  it("a place URL: name, the place's own coordinates (not the viewport), and a stable link via its CID", () => {
    const p = parseGoogleMapsUrl(FULL);
    expect(p.name).toBe("Zahrat Lebnan - Defence St");
    expect([p.lat, p.lng]).toEqual([24.471236, 54.371236]);        // !3d/!4d win over @lat,lng
    expect(p.cid).toBe(BigInt("0x1a2b3c4d5e6f").toString());
    expect(p.mapsUrl).toBe(`https://maps.google.com/?cid=${p.cid}`);
  });
  it("a search-in-viewport URL keeps the query as the name and the viewport as the spot", () => {
    const p = parseGoogleMapsUrl("https://www.google.com/maps/search/Blue+Bottle+Coffee/@37.7764,-122.4233,16z?entry=ttu");
    expect(p).toMatchObject({ name: "Blue Bottle Coffee", lat: 37.7764, lng: -122.4233, cid: null, mapsUrl: "https://www.google.com/maps/search/Blue+Bottle+Coffee/@37.7764,-122.4233,16z" });
  });
  it("query forms", () => {
    expect(parseGoogleMapsUrl("https://www.google.com/maps?q=1.2831,103.8441")).toMatchObject({ lat: 1.2831, lng: 103.8441, name: null });
    expect(parseGoogleMapsUrl("https://www.google.com/maps/search/?api=1&query=1.2831,103.8441")).toMatchObject({ lat: 1.2831, lng: 103.8441 });
    expect(parseGoogleMapsUrl("https://maps.google.com/?q=Maxwell+Food+Centre")).toMatchObject({ name: "Maxwell Food Centre", lat: null, mapsUrl: "https://www.google.com/maps/search/?api=1&query=Maxwell%20Food%20Centre" });
    expect(parseGoogleMapsUrl("https://www.google.com/maps/@24.47,54.37,15z")).toMatchObject({ lat: 24.47, lng: 54.37, name: null });
    expect(parseGoogleMapsUrl("https://maps.google.com/?cid=987654321")).toMatchObject({ cid: "987654321", lat: null, mapsUrl: "https://maps.google.com/?cid=987654321" });
  });
  it("sees through the EU consent interstitial; rejects junk", () => {
    expect(parseGoogleMapsUrl(`https://consent.google.com/m?continue=${encodeURIComponent(FULL)}&gl=DE`).name).toBe("Zahrat Lebnan - Defence St");
    expect(parseGoogleMapsUrl("https://www.google.com/maps")).toBeNull();
    expect(parseGoogleMapsUrl("https://example.com/maps/place/x/@1,2,3z")).toBeNull();
    expect(parseGoogleMapsUrl("https://www.google.com/maps?q=999,999")).toBeNull();
  });
});

describe("resolving a shared link", () => {
  it("follows a short link to its place, once", async () => {
    const fetch = vi.fn(async () => ({ url: FULL, body: { cancel: async () => {} } }));
    const r = await resolveMapsLink("https://maps.app.goo.gl/AbC?g_st=ic", { fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://maps.app.goo.gl/AbC?g_st=ic");
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "follow" });
    expect(r.name).toBe("Zahrat Lebnan - Defence St");
  });
  it("a full link with coordinates needs no network at all", async () => {
    const fetch = vi.fn();
    expect((await resolveMapsLink(FULL, { fetch })).lat).toBe(24.471236);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("errors carry an HTTP status: 400 not a maps link, 502 unreachable, 422 no place", async () => {
    await expect(resolveMapsLink("https://example.com/x", { fetch: vi.fn() })).rejects.toMatchObject({ status: 400 });
    await expect(resolveMapsLink("https://maps.app.goo.gl/x", { fetch: vi.fn(async () => { throw new Error("ECONNRESET"); }) })).rejects.toMatchObject({ status: 502 });
    await expect(resolveMapsLink("https://maps.app.goo.gl/x", { fetch: vi.fn(async () => ({ url: "https://www.google.com/maps" })) })).rejects.toMatchObject({ status: 422 });
  });
});
