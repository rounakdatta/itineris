import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import { SvelteSet } from "svelte/reactivity";

vi.mock("../admin/lib/api.js", async (orig) => {
  const m = await orig();
  return { ...m, api: { ...m.api, bulk: vi.fn(async () => ({ updated: 2 })), patchGallery: vi.fn(async () => ({})), createGallery: vi.fn(async (b) => ({ id: "newgallery12", ...b })), remove: vi.fn(async () => ({})) } };
});
import { api } from "../admin/lib/api.js";
import BulkBar from "../admin/BulkBar.svelte";
import MomentList from "../admin/MomentList.svelte";

const galleries = [{ id: "g1", title: "Home", home: true }, { id: "g2", title: "Friends" }];
beforeEach(() => vi.clearAllMocks());

describe("BulkBar", () => {
  it("tags the whole selection", async () => {
    const selection = new SvelteSet(["a", "b"]); const onDone = vi.fn();
    render(BulkBar, { selection, galleries, suggestions: ["food"], onDone, onExit: () => {} });
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Tag" }));
    await fireEvent.input(screen.getByLabelText("Tag to add"), { target: { value: "food" } });
    await fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.bulk).toHaveBeenCalledWith(["a", "b"], { addTags: ["food"] });
    expect(onDone).toHaveBeenCalled();
  });
  it("adds the selection to a gallery, or a brand new one", async () => {
    const selection = new SvelteSet(["a", "b"]);
    render(BulkBar, { selection, galleries, onDone: () => {}, onExit: () => {} });
    await fireEvent.click(screen.getByRole("button", { name: "Add to gallery" }));
    const sel = screen.getByLabelText("Gallery");
    await fireEvent.change(sel, { target: { value: "g2" } });
    await fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.patchGallery).toHaveBeenCalledWith("g2", { add: ["a", "b"] });
    vi.stubGlobal("prompt", () => "Trip mates");
    await fireEvent.click(screen.getByRole("button", { name: "Add to gallery" }));
    await fireEvent.change(screen.getByLabelText("Gallery"), { target: { value: "__new__" } });
    await fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.createGallery).toHaveBeenCalledWith({ title: "Trip mates" });
    expect(api.patchGallery).toHaveBeenLastCalledWith("newgallery12", { add: ["a", "b"] });
  });
  it("delete asks first", async () => {
    const selection = new SvelteSet(["a"]);
    render(BulkBar, { selection, galleries, onDone: () => {}, onExit: () => {} });
    await fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/Originals are kept/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.remove).toHaveBeenCalledWith("a");
  });
});

describe("MomentList", () => {
  const ms = [
    { id: "a", t: "2026-03-14T08:40:00+08:00", lat: 1, lng: 2, tags: ["food"], galleries: ["g1"], media: { src: "media/a.webp" } },
    { id: "b", t: "2026-03-14T09:40:00+08:00", lat: null, lng: null, tags: [], galleries: [], media: { src: "media/b.webp" }, tz: "unknown" },
  ];
  it("flags private, untagged, unplaced and unknown-zone photos", () => {
    render(MomentList, { moments: ms, onSelect: () => {} });
    expect(screen.getByTitle(/private/)).toBeInTheDocument();
    expect(screen.getByTitle("untagged")).toBeInTheDocument();
    expect(screen.getByTitle("no location")).toBeInTheDocument();
    expect(screen.getByTitle("time zone unknown")).toBeInTheDocument();
  });
  it("select mode reports toggles through onSelect and shows checks", async () => {
    const selection = new SvelteSet(["a"]); const onSelect = vi.fn();
    render(MomentList, { moments: ms, selectMode: true, selection, onSelect });
    const cells = screen.getAllByRole("listitem");
    expect(cells[0]).toHaveAttribute("aria-pressed", "true");
    await fireEvent.click(cells[1]);
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});
