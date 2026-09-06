import { describe, it, expect, beforeEach, vi } from "vitest";

// A fresh module per test: the loader memoises its one script.
const fresh = async () => { vi.resetModules(); return import("../src/lib/gmaps.js"); };
beforeEach(() => { delete window.google; document.querySelectorAll("script[src*='maps.googleapis.com']").forEach((s) => s.remove()); });
const injected = () => document.querySelector("script[src*='maps.googleapis.com']");

describe("Google's fatal map errors", () => {
  it("are recognised from the one console line Google prints, and only those", async () => {
    const { watchMapErrors } = await fresh();
    const con = { error: vi.fn() };
    const fn = vi.fn();
    const stop = watchMapErrors(fn, con);
    con.error("Google Maps JavaScript API error: BillingNotEnabledMapError\nhttps://developers.google.com/maps/documentation/javascript/error-messages#billing-not-enabled-map-error");
    con.error("some unrelated error", new Error("x"));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].message).toBe("Google Maps: BillingNotEnabledMapError");
    stop();
    con.error("Google Maps JavaScript API error: RefererNotAllowedMapError");
    expect(fn).toHaveBeenCalledTimes(1);                             // stopped watching
  });
  it("passes every message through to the original console.error", async () => {
    const { watchMapErrors } = await fresh();
    const original = vi.fn(); const con = { error: original };
    const stop = watchMapErrors(() => {}, con);
    con.error("a", 1); con.error("Google Maps JavaScript API error: InvalidKeyMapError");
    expect(original).toHaveBeenCalledTimes(2);
    stop(); expect(con.error).toBe(original);
  });
});

describe("Google Maps loader", () => {
  it("injects one async script with the key and the libraries we use, and resolves on Google's callback", async () => {
    const { loadGoogleMaps, CALLBACK } = await fresh();
    const p = loadGoogleMaps({ key: "k&y", win: window });
    const s = injected();
    expect(s.async).toBe(true);
    expect(s.src).toBe(`https://maps.googleapis.com/maps/api/js?key=k%26y&v=weekly&loading=async&libraries=maps,marker&callback=${CALLBACK}`);
    loadGoogleMaps({ key: "k&y", win: window });
    expect(document.querySelectorAll("script[src*='maps.googleapis.com']")).toHaveLength(1);   // memoised
    window.google = { maps: { importLibrary: async () => ({}) } };
    window[CALLBACK]();
    expect(await p).toBe(window.google.maps);
    expect(await loadGoogleMaps({ key: "other", win: window })).toBe(window.google.maps);      // already loaded: no second script
  });
  it("a script that fails to load rejects, so the caller can fall back", async () => {
    const { loadGoogleMaps } = await fresh();
    const p = loadGoogleMaps({ key: "k", win: window });
    injected().onerror();
    await expect(p).rejects.toThrow(/could not be loaded/);
    expect(injected()).toBeNull();
  });
  it("a refused key rejects too", async () => {
    const { loadGoogleMaps } = await fresh();
    const p = loadGoogleMaps({ key: "bad", win: window });
    window.gm_authFailure();
    await expect(p).rejects.toThrow(/refused/);
  });
  it("and so does a hang", async () => {
    vi.useFakeTimers();
    try {
      const { loadGoogleMaps } = await fresh();
      const p = loadGoogleMaps({ key: "k", win: window, timeout: 1000 });
      vi.advanceTimersByTime(1001);
      await expect(p).rejects.toThrow(/in time/);
    } finally { vi.useRealTimers(); }
  });
});
