import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";

vi.mock("../admin/lib/api.js", async (orig) => {
  const m = await orig();
  return { ...m, api: { ...m.api,
    patch: vi.fn(async (id, body) => ({ id, ...body, galleries: ["g1"], media: {}, tags: body.tags })),
    refreshGoogle: vi.fn(async (id) => ({ id, google: { placeId: "ChIJx", rating: 4.5, ratingCount: 762, type: "Museum", mapsUri: "https://maps.google.com/?cid=3" }, galleries: ["g1"] })),
    patchGallery: vi.fn(async () => ({})),
  } };
});
import { api } from "../admin/lib/api.js";
import MomentEditor from "../admin/MomentEditor.svelte";

const moment = { id: "m1", t: "2026-03-14T08:40:12+08:00", tz: "exif", lat: 1.28, lng: 103.84, place: "Chinatown", caption: "", tags: ["food"], galleries: ["g1"], media: { src: "media/x.webp", w: 1600, h: 1200 }, filename: "a.jpg" };
const galleries = [{ id: "g1", title: "Home", home: true }, { id: "g2", title: "Friends", home: false }];
beforeEach(() => { vi.clearAllMocks(); });

describe("MomentEditor", () => {
  it("shows the photo's local time in a native picker with its offset", () => {
    render(MomentEditor, { moment, galleries });
    expect(document.querySelector('input[type="datetime-local"]').value).toBe("2026-03-14T08:40");
    expect(document.querySelector("select").value).toBe("+08:00");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
  it("tags: Enter adds, chip removes, suggestions offered", async () => {
    render(MomentEditor, { moment, galleries, suggestions: ["food", "night", "run"] });
    const input = screen.getByLabelText("Add a tag");
    await fireEvent.input(input, { target: { value: "Night" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: "remove night" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
  it("saving writes fields and gallery membership changes", async () => {
    const onSaved = vi.fn();
    render(MomentEditor, { moment, galleries, onSaved, onClose: () => {} });
    await fireEvent.click(screen.getByLabelText(/Friends/));
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.patch).toHaveBeenCalledWith("m1", expect.objectContaining({ place: "Chinatown", tags: ["food"], lat: 1.28, lng: 103.84, t: "2026-03-14T08:40:12+08:00" }));
    expect(api.patchGallery).toHaveBeenCalledWith("g2", { add: ["m1"] });
    expect(onSaved.mock.calls[0][0].galleries.sort()).toEqual(["g1", "g2"]);
  });
  it("changing the offset rewrites the stored time", async () => {
    render(MomentEditor, { moment, galleries });
    await fireEvent.change(document.querySelector("select"), { target: { value: "+05:30" } });
    expect(document.querySelector("code")).toHaveTextContent("2026-03-14T08:40:12+05:30");
  });
  it("neighbour location buttons fill the coordinates", async () => {
    render(MomentEditor, { moment: { ...moment, lat: null, lng: null }, galleries, neighbours: { prev: { id: "p", lat: 1.3, lng: 103.9, place: "Merlion" }, next: null } });
    await fireEvent.click(screen.getByRole("button", { name: /use previous photo's/ }));
    expect(screen.getByPlaceholderText("1.2829").value).toBe("1.3");
    expect(screen.getByPlaceholderText("103.8443").value).toBe("103.9");
  });
  it("Pick on map mounts the picker", async () => {
    render(MomentEditor, { moment, galleries });
    await fireEvent.click(screen.getByRole("button", { name: "Pick on map" }));
    expect(screen.getByRole("application")).toBeInTheDocument();
  });
});

describe("MomentEditor: Google Maps link", () => {
  it("shows the exact link, sends it with the location, and drops it when the coordinates are typed over", async () => {
    const linked = { ...moment, mapsUrl: "https://maps.google.com/?cid=5" };
    const { unmount } = render(MomentEditor, { moment: linked, galleries, onSaved: vi.fn(), onClose: () => {} });
    expect(screen.getByRole("link", { name: /exact place on Google Maps/ })).toHaveAttribute("href", "https://maps.google.com/?cid=5");
    await fireEvent.input(screen.getByLabelText("Caption"), { target: { value: "Mezze" } });
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.patch).toHaveBeenCalledWith("m1", expect.objectContaining({ mapsUrl: "https://maps.google.com/?cid=5", lat: 1.28, lng: 103.84 }));
    unmount(); vi.clearAllMocks();
    render(MomentEditor, { moment: linked, galleries, onSaved: vi.fn(), onClose: () => {} });
    await fireEvent.input(screen.getByLabelText("Latitude"), { target: { value: "1.29" } });
    expect(screen.queryByRole("link", { name: /exact place on Google Maps/ })).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.patch).toHaveBeenCalledWith("m1", expect.objectContaining({ mapsUrl: null, lat: 1.29 }));
  });
});

describe("MomentEditor: what Google says", () => {
  it("shows the Google line when known, and ↻ asks the server to look again", async () => {
    const onSaved = vi.fn();
    render(MomentEditor, { moment: { ...moment, google: { placeId: "ChIJa", rating: 4.2, ratingCount: 120, type: "Cafe", mapsUri: "https://maps.google.com/?cid=2" } }, galleries, onSaved, onClose: () => {} });
    expect(screen.getByText("4.2")).toBeInTheDocument(); expect(screen.getByText(/\(120\)/)).toBeInTheDocument(); expect(screen.getByText(/Cafe/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "↻" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.refreshGoogle).toHaveBeenCalledWith("m1");
    expect(screen.getByText("4.5")).toBeInTheDocument(); expect(screen.getByText(/Museum/)).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalled();
  });
  it("says when nothing was looked up yet", () => {
    render(MomentEditor, { moment, galleries, onClose: () => {} });
    expect(screen.getByText(/Google: not looked up yet/)).toBeInTheDocument();
  });
});

describe("MomentEditor: pinned to a Google place", () => {
  it("picking one of your places pins the photo, and Save sends the Place ID", async () => {
    const known = [{ key: "g:ChIJyamo", name: "Yamo", lat: 37.7619, lng: -122.4194, placeId: "ChIJyamo", mapsUrl: "https://maps.google.com/?cid=77", google: { placeId: "ChIJyamo", rating: 4.5, name: "Yamo" }, count: 2 }];
    render(MomentEditor, { moment, galleries, known, onSaved: vi.fn(), onClose: () => {} });
    await fireEvent.click(screen.getByRole("button", { name: "Pick on map" }));
    await fireEvent.click(screen.getByRole("button", { name: /Yamo/ }));
    expect(screen.getByText(/Pinned to a Google place/)).toBeInTheDocument();
    expect(screen.getByLabelText("Place")).toHaveValue("Yamo");
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.patch).toHaveBeenCalledWith("m1", expect.objectContaining({ placeId: "ChIJyamo", lat: 37.7619, lng: -122.4194, place: "Yamo", mapsUrl: "https://maps.google.com/?cid=77" }));
  });
  it("Unpin clears the pin; typing coordinates does too", async () => {
    render(MomentEditor, { moment: { ...moment, placeId: "ChIJold", google: { placeId: "ChIJold", name: "Old Place", rating: 4 } }, galleries, onSaved: vi.fn(), onClose: () => {} });
    expect(screen.getByText(/Pinned to a Google place/)).toHaveTextContent("Old Place");
    await fireEvent.click(screen.getByRole("button", { name: "Unpin" }));
    expect(screen.queryByText(/Pinned to a Google place/)).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.patch).toHaveBeenCalledWith("m1", expect.objectContaining({ placeId: null }));
  });
});
