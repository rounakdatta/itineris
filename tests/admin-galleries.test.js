import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";

vi.mock("../admin/lib/api.js", async (orig) => {
  const m = await orig();
  return { ...m, api: { ...m.api, createGallery: vi.fn(async (b) => ({ id: "newgallery12", ...b })), patchGallery: vi.fn(async () => ({})), removeGallery: vi.fn(async () => ({})) } };
});
import { api } from "../admin/lib/api.js";
import GalleryList from "../admin/GalleryList.svelte";

beforeEach(() => vi.clearAllMocks());
const galleries = [{ id: "sg2026demo", title: "Singapore", description: "", home: true, count: 20, trackCount: 3, trackIds: ["t1"] }];

describe("GalleryList", () => {
  it("creates a gallery; the first one becomes home", async () => {
    const onChange = vi.fn();
    render(GalleryList, { galleries: [], onChange });
    await fireEvent.click(screen.getByRole("button", { name: "New gallery" }));
    await fireEvent.input(screen.getByLabelText("Title"), { target: { value: "Friends" } });
    await fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.createGallery).toHaveBeenCalledWith({ title: "Friends", description: "", home: true });
    expect(onChange).toHaveBeenCalled();
  });
  it("shows the share link, counts and home badge; toggles home and routes", async () => {
    render(GalleryList, { galleries, tracks: [{ id: "t1", name: "Bay loop" }, { id: "t2", name: "East Coast" }], onChange: () => {} });
    expect(screen.getByText(/\/g\/sg2026demo$/)).toBeInTheDocument();
    expect(screen.getByText(/20 photos · 3 routes/)).toBeInTheDocument();
    expect(screen.getByText(/home · shown at \//)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Unset home" }));
    expect(api.patchGallery).toHaveBeenCalledWith("sg2026demo", { home: false });
    await fireEvent.click(screen.getByRole("button", { name: "East Coast" }));
    expect(api.patchGallery).toHaveBeenLastCalledWith("sg2026demo", { addTracks: ["t2"] });
  });
  it("delete asks and explains that photos stay", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(GalleryList, { galleries, onChange: () => {} });
    await fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(globalThis.confirm.mock.calls[0][0]).toMatch(/Photos stay/);
    expect(api.removeGallery).toHaveBeenCalledWith("sg2026demo");
  });
});
