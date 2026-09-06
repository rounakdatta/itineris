import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
vi.mock("../admin/lib/api.js", async (orig) => {
  const m = await orig();
  return { ...m, api: { ...m.api, resolveLink: vi.fn(async () => ({ name: "Zahrat Lebnan - Defence St", lat: 24.471235, lng: 54.371235, cid: "5", mapsUrl: "https://maps.google.com/?cid=5" })) } };
});
import { api } from "../admin/lib/api.js";
import MapPicker from "../admin/MapPicker.svelte";

const flush = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => vi.restoreAllMocks());

describe("MapPicker", () => {
  it("finds a place by name (on Enter, one request) and hands back coordinates and the name", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => [
      { lat: "37.7614", lon: "-122.4118", name: "Tartine Manufactory", display_name: "Tartine Manufactory, 595, Alabama Street, San Francisco" },
      { lat: "37.7", lon: "-122.4", name: "Tartine Bakery", display_name: "Tartine Bakery, Guerrero Street, San Francisco" },
    ] });
    const onChange = vi.fn(), onPlace = vi.fn();
    render(MapPicker, { lat: null, lng: null, onChange, onPlace });
    const q = screen.getByLabelText("Search a place");
    await fireEvent.input(q, { target: { value: "tartine" } });
    await fireEvent.input(q, { target: { value: "tartine manuf" } });
    expect(fetch).not.toHaveBeenCalled();                      // never per keystroke
    await fireEvent.keyDown(q, { key: "Enter" }); await flush(); await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain("q=tartine%20manuf");
    expect(screen.getByRole("listbox", { name: "Places found" })).toBeInTheDocument();
    expect(screen.getByText(/OpenStreetMap Nominatim/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("option", { name: /Tartine Manufactory/ }));
    expect(onChange).toHaveBeenCalledWith(37.7614, -122.4118);
    expect(onPlace).toHaveBeenCalledWith("Tartine Manufactory");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(q.value).toBe("Tartine Manufactory");
  });
  it("a pasted Google Maps link is resolved by the server and hands back the exact place + link", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const onChange = vi.fn(), onPlace = vi.fn(), onLink = vi.fn();
    render(MapPicker, { lat: null, lng: null, onChange, onPlace, onLink });
    const q = screen.getByLabelText("Search a place");
    await fireEvent.input(q, { target: { value: "Zahrat Lebnan https://maps.app.goo.gl/AbC?g_st=ic" } });
    await fireEvent.keyDown(q, { key: "Enter" }); await flush(); await tick();
    expect(api.resolveLink).toHaveBeenCalledWith("https://maps.app.goo.gl/AbC?g_st=ic");
    expect(fetch).not.toHaveBeenCalled();                                    // not Nominatim
    expect(onChange).toHaveBeenCalledWith(24.471235, 54.371235);
    expect(onPlace).toHaveBeenCalledWith("Zahrat Lebnan - Defence St");
    expect(onLink).toHaveBeenCalledWith("https://maps.google.com/?cid=5");
    expect(screen.getByRole("status")).toHaveTextContent("From Google Maps: Zahrat Lebnan - Defence St");
    expect(q.value).toBe("Zahrat Lebnan - Defence St");
  });
  it("choosing a spot any other way clears the exact link", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => [{ lat: "1", lon: "2", name: "Somewhere", display_name: "Somewhere, Else" }] });
    const onLink = vi.fn();
    render(MapPicker, { lat: null, lng: null, onChange: vi.fn(), onLink });
    await fireEvent.input(screen.getByLabelText("Search a place"), { target: { value: "somewhere" } });
    await fireEvent.click(screen.getByRole("button", { name: "Search" })); await flush(); await tick();
    await fireEvent.click(screen.getByRole("option", { name: /Somewhere/ }));
    expect(onLink).toHaveBeenCalledWith(null);
  });
  it("says when nothing was found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => [] });
    render(MapPicker, { lat: null, lng: null, onChange: vi.fn() });
    await fireEvent.input(screen.getByLabelText("Search a place"), { target: { value: "zzzz" } });
    await fireEvent.click(screen.getByRole("button", { name: "Search" })); await flush(); await tick();
    expect(screen.getByRole("status")).toHaveTextContent("Nothing found for “zzzz”");
  });
  it("uses the device's location, and says how precise it is", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok) => ok({ coords: { latitude: 1.2831, longitude: 103.8441, accuracy: 20 } }) } });
    const onChange = vi.fn();
    render(MapPicker, { lat: null, lng: null, onChange });
    await fireEvent.click(screen.getByRole("button", { name: /My location/ })); await flush(); await tick();
    expect(onChange).toHaveBeenCalledWith(1.2831, 103.8441);
    expect(screen.getByRole("status")).toHaveTextContent("±20 m");
  });
  it("a denied permission is explained, not swallowed", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (_, fail) => fail({ code: 1 }) } });
    render(MapPicker, { lat: null, lng: null, onChange: vi.fn() });
    await fireEvent.click(screen.getByRole("button", { name: /My location/ })); await flush(); await tick();
    expect(screen.getByRole("status")).toHaveTextContent(/denied/);
  });
});
