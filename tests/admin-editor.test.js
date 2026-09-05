import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";

vi.mock("../admin/lib/api.js", async (orig) => {
  const m = await orig();
  return { ...m, api: { ...m.api,
    patch: vi.fn(async (id, body) => ({ id, ...body, galleries: ["g1"], media: {}, tags: body.tags })),
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
