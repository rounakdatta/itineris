import { describe, it, expect, beforeEach, vi } from "vitest";
import { trip } from "../src/lib/trip.svelte.js";

const gallery = { id: "abc123abc123", title: "Friends", description: "d", moments: [{ id: "x", t: "2026-03-14T08:40:00+08:00", lat: 1, lng: 2, place: "", caption: "", tags: [], media: { src: "media/x.webp", w: 1, h: 1 } }], tracks: [] };
function mockFetch(routes) {
  return vi.fn(async (url) => {
    const r = routes[url];
    if (!r) return { ok: false, status: 404 };
    if (typeof r === "number") return { ok: r < 400, status: r, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => r };
  });
}
beforeEach(() => { trip.status = "loading"; trip.moments = []; trip.title = ""; });

describe("which gallery to show", () => {
  it("/g/<token> fetches only that gallery", async () => {
    const f = mockFetch({ "/data/galleries/abc123abc123.json": gallery }); vi.stubGlobal("fetch", f);
    await trip.load({ pathname: "/g/abc123abc123" });
    expect(trip.status).toBe("ready"); expect(trip.title).toBe("Friends"); expect(trip.moments.length).toBe(1);
    expect(f.mock.calls.map((c) => c[0])).toEqual(["/data/galleries/abc123abc123.json"]);
  });
  it("/ follows home.json", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/data/home.json": { gallery: "abc123abc123" }, "/data/galleries/abc123abc123.json": gallery }));
    await trip.load({ pathname: "/" });
    expect(trip.status).toBe("ready"); expect(trip.galleryId).toBe("abc123abc123");
  });
  it("/ without a home gallery is the landing page, never a listing", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    await trip.load({ pathname: "/" });
    expect(trip.status).toBe("landing");
  });
  it("a dead link is notfound", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    await trip.load({ pathname: "/g/zzzzzzzzzzzz" });
    expect(trip.status).toBe("notfound");
  });
  it("server trouble is an error with a reason", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/data/home.json": 500 }));
    await trip.load({ pathname: "/" });
    expect(trip.status).toBe("error"); expect(trip.error).toMatch(/500/);
  });
  it("a path that is not a gallery route falls back to home", async () => {
    const f = mockFetch({ "/data/home.json": { gallery: "abc123abc123" }, "/data/galleries/abc123abc123.json": gallery }); vi.stubGlobal("fetch", f);
    await trip.load({ pathname: "/anything/else" });
    expect(f.mock.calls[0][0]).toBe("/data/home.json");
  });
});
