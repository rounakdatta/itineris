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
    await fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
    const sel = screen.getByLabelText("Gallery");
    await fireEvent.change(sel, { target: { value: "g2" } });
    await fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.patchGallery).toHaveBeenCalledWith("g2", { add: ["a", "b"] });
  });
  it("names a brand new gallery in the bar, not in an operating-system prompt", async () => {
    const selection = new SvelteSet(["a", "b"]);
    // window.prompt would answer even if the field were never rendered, so the
    // test would pass against exactly the thing this replaced.
    vi.stubGlobal("prompt", () => { throw new Error("window.prompt is not a design"); });
    render(BulkBar, { selection, galleries, onDone: () => {}, onExit: () => {} });
    await fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
    await fireEvent.change(screen.getByLabelText("Gallery"), { target: { value: "__new__" } });
    const create = screen.getByRole("button", { name: "Create with 2" });
    expect(create).toBeDisabled();                       // nothing to name it yet
    await fireEvent.input(screen.getByLabelText("New gallery name"), { target: { value: " Trip mates " } });
    await fireEvent.click(screen.getByRole("button", { name: "Create with 2" }));
    await new Promise((r) => setTimeout(r, 0));
    // Created WITH the photos in it: a new gallery that comes out empty, and
    // has to be filled by a second trip through the same selection, is a
    // chore nobody should be handed.
    expect(api.createGallery).toHaveBeenCalledWith({ title: "Trip mates", momentIds: ["a", "b"] });
    expect(api.patchGallery).not.toHaveBeenCalled();
  });
  it("sets one location on the whole selection", async () => {
    const selection = new SvelteSet(["a", "b"]);
    render(BulkBar, { selection, galleries, onDone: () => {}, onExit: () => {} });
    await fireEvent.click(screen.getByRole("button", { name: "Location" }));
    expect(screen.getByText(/Pin all 2 to one place/)).toBeInTheDocument();
    await fireEvent.input(screen.getByLabelText("Latitude"), { target: { value: "37.7749" } });
    await fireEvent.input(screen.getByLabelText("Longitude"), { target: { value: "-122.4194" } });
    await fireEvent.click(screen.getByRole("button", { name: "Apply to 2" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.bulk).toHaveBeenCalledWith(["a", "b"], { lat: 37.7749, lng: -122.4194 });
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
  it("marks what is exceptional about a photo, and nothing that is ordinary", () => {
    render(MomentList, { moments: [...ms, { id: "c", t: "2026-03-14T10:40:00+08:00", lat: null, lng: null, tags: [], galleries: ["g1", "g2"], media: { src: "media/c.webp", type: "video" } }], onSelect: () => {} });
    // Published somewhere: worth saying, and it says how many.
    expect(screen.getByTitle("in 1 gallery")).toBeInTheDocument();
    expect(screen.getByTitle("in 2 galleries")).toBeInTheDocument();
    expect(screen.getByTitle("video")).toBeInTheDocument();
    // Untagged, unplaced, private and unknown-zone are the state EVERY photo
    // arrives in. Badging them painted three chips on every tile of a fresh
    // library and told nobody anything; the counts live in the toolbar now,
    // where they are also filters.
    for (const gone of [/private/, /untagged/, /no location/, /time zone/]) expect(screen.queryByTitle(gone)).toBeNull();
  });
  it("shows how many people looked at each photo, and marks the best-watched one", () => {
    const seen = [
      { ...ms[0], id: "a", views: 3 },
      { ...ms[1], id: "b", views: 11 },
      { ...ms[1], id: "c", t: "2026-03-14T10:40:00+08:00", views: 0 },
    ];
    const { container } = render(MomentList, { moments: seen, onSelect: () => {} });
    const counts = [...container.querySelectorAll(".seen")].map((e) => e.textContent.trim());
    // Nobody has opened the third: no "0", because a zero on a photo reads as
    // a verdict rather than a count.
    expect(counts).toEqual(["3", "11"]);
    expect(screen.getByTitle(/best-watched/)).toHaveTextContent("11");
    expect(container.querySelectorAll(".seen.best")).toHaveLength(1);
  });
  it("...and marks nothing when every photo has been watched the same amount", () => {
    // There is no "most viewed" then, and marking them all would be the same
    // noise as badging every tile with what they have in common.
    const { container } = render(MomentList, { moments: [{ ...ms[0], id: "a", views: 4 }, { ...ms[1], id: "b", views: 4 }], onSelect: () => {} });
    expect(screen.queryByTitle(/best-watched/)).toBeNull();
    expect(container.querySelectorAll(".seen")).toHaveLength(2);
    expect(container.querySelectorAll(".seen.best")).toHaveLength(0);
  });
  it("heads each day with a date somebody would say out loud", () => {
    render(MomentList, { moments: ms, onSelect: () => {} });
    expect(screen.getByRole("heading", { name: /Sat 14 Mar/ })).toBeInTheDocument();
    expect(screen.queryByText("2026-03-14")).toBeNull();
  });
  it("select mode reports toggles through onSelect and shows checks", async () => {
    const selection = new SvelteSet(["a"]); const onSelect = vi.fn();
    render(MomentList, { moments: ms, selectMode: true, selection, onSelect });
    // The cells are buttons, not list items: a <button> cannot be a listitem,
    // and listitem does not support aria-pressed -- which is the state that
    // tells a screen reader whether a photo is selected.
    expect(screen.getByLabelText(/08:40/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/09:40/)).toHaveAttribute("aria-pressed", "false");
    await fireEvent.click(screen.getByLabelText(/09:40/));
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});

describe("BulkBar: location", () => {
  it("one spot, optionally one place name, for the whole selection", async () => {
    const selection = new SvelteSet(["a", "b"]);
    render(BulkBar, { selection, galleries, onDone: () => {}, onExit: () => {} });
    await fireEvent.click(screen.getByRole("button", { name: "Location" }));
    await fireEvent.input(screen.getByLabelText("Latitude"), { target: { value: "37.7614" } });
    await fireEvent.input(screen.getByLabelText("Longitude"), { target: { value: "-122.4118" } });
    await fireEvent.input(screen.getByLabelText("Place name"), { target: { value: " Tartine Manufactory " } });
    await fireEvent.click(screen.getByRole("button", { name: "Apply to 2" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.bulk).toHaveBeenCalledWith(["a", "b"], { lat: 37.7614, lng: -122.4118, place: "Tartine Manufactory" });
  });
});
