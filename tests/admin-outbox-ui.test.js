import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import Outbox from "../admin/Outbox.svelte";

const item = (o) => ({ id: o.id, name: o.id + ".jpg", type: "image/jpeg", size: 1, file: null, thumb: null, exif: {}, meta: { tags: o.tags ?? [], galleries: [], lat: o.lat ?? null, lng: o.lng ?? null }, state: o.state ?? "waiting", attempts: o.attempts ?? 0, error: o.error ?? null, progress: o.progress ?? 0 });
const fakeOutbox = () => ({ add: vi.fn(), retryNow: vi.fn(), remove: vi.fn(), updateMeta: vi.fn(async () => {}) });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Outbox UI", () => {
  it("offline: says so, counts the photos, offers Retry, tiles are tappable", async () => {
    const outbox = fakeOutbox(); const onEdit = vi.fn();
    render(Outbox, { outbox, queue: { items: [item({ id: "a", tags: ["food"] }), item({ id: "b" })], blocked: false, flushing: false, online: false }, onEdit });
    expect(screen.getByRole("status")).toHaveTextContent("Offline — 2 photos will upload when you're back");
    await fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    expect(outbox.retryNow).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "Edit queued photo a.jpg" }));
    expect(onEdit).toHaveBeenCalledWith("a");
    await fireEvent.click(screen.getByRole("button", { name: "Remove b.jpg from the queue" }));
    expect(outbox.remove).toHaveBeenCalledWith("b");
    expect(screen.getByText("food")).toBeInTheDocument();
  });
  it("retrying after failures is honest about it", () => {
    render(Outbox, { outbox: fakeOutbox(), queue: { items: [item({ id: "a", attempts: 3, error: "network error" })], blocked: false, flushing: false, online: true } });
    expect(screen.getByRole("status")).toHaveTextContent("Connection trouble — retrying 1 photo automatically");
    expect(screen.getByTitle(/retrying \(3 attempts\)/)).toBeInTheDocument();
  });
  it("uploading shows progress; a refusal shows the reason; signed-out offers sign in", () => {
    const { unmount } = render(Outbox, { outbox: fakeOutbox(), queue: { items: [item({ id: "a", state: "uploading", progress: 0.4 }), item({ id: "b" })], blocked: false, flushing: true, online: true } });
    expect(screen.getByRole("status")).toHaveTextContent("Uploading 1 of 2 · 40%");
    unmount();
    render(Outbox, { outbox: fakeOutbox(), queue: { items: [item({ id: "a", state: "rejected", error: "unsupported image format" })], blocked: false, flushing: false, online: true } });
    expect(screen.getByRole("status")).toHaveTextContent("1 photo was refused by the server");
    expect(screen.getAllByTitle("unsupported image format").length).toBeGreaterThan(0);
    render(Outbox, { outbox: fakeOutbox(), queue: { items: [item({ id: "z" })], blocked: true, flushing: false, online: true } });
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
  it("says which photos arrived without a location, and why", () => {
    const { container, unmount } = render(Outbox, { outbox: fakeOutbox(), queue: { items: [item({ id: "a", lat: 1.29, lng: 103.85 }), item({ id: "b" })], blocked: false, flushing: false, online: true } });
    expect(container.querySelectorAll(".tile .flag.loc")).toHaveLength(1);
    expect(screen.getByText(/1 of these has no location in the file/)).toHaveTextContent(/phones remove GPS/);
    unmount();
    render(Outbox, { outbox: fakeOutbox(), queue: { items: [item({ id: "a", lat: 1.29, lng: 103.85 })], blocked: false, flushing: false, online: true } });
    expect(screen.queryByText(/no location/)).toBeNull();
  });
  it("one tap places every unplaced queued photo at the device's location", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok) => ok({ coords: { latitude: 37.7614, longitude: -122.4118, accuracy: 9 } }) } });
    const outbox = fakeOutbox();
    render(Outbox, { outbox, queue: { items: [item({ id: "a", lat: 1.29, lng: 103.85 }), item({ id: "b" }), item({ id: "c" })], blocked: false, flushing: false, online: true } });
    await fireEvent.click(screen.getByRole("button", { name: "📍 Use my location for these 2" })); await flush();
    expect(outbox.updateMeta).toHaveBeenCalledTimes(2);
    expect(outbox.updateMeta).toHaveBeenCalledWith("b", { lat: 37.7614, lng: -122.4118, locEdited: true });
    expect(outbox.updateMeta).toHaveBeenCalledWith("c", { lat: 37.7614, lng: -122.4118, locEdited: true });
    expect(screen.getByText(/Placed 2 photos at your location \(±9 m\)/)).toBeInTheDocument();
  });
  it("a pinned place renames the button; without one, your places are offered and a pick is handed up", async () => {
    const onPick = vi.fn();
    const known = [{ key: "g:ChIJyamo", name: "Yamo", lat: 37.7619, lng: -122.4194, placeId: "ChIJyamo", mapsUrl: null, google: { placeId: "ChIJyamo", rating: 4.5 }, count: 2 }];
    const { unmount } = render(Outbox, { outbox: fakeOutbox(), queue: { items: [], blocked: false, flushing: false, online: true }, location: { name: "Zahrat Lebnan", lat: 1, lng: 2 }, known, onPick });
    expect(screen.getByRole("button", { name: "Add photos at “Zahrat Lebnan”" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Search a place")).toBeNull();
    unmount();
    render(Outbox, { outbox: fakeOutbox(), queue: { items: [], blocked: false, flushing: false, online: true }, known, onPick });
    expect(screen.getByLabelText("Search a place")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: /Yamo/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ placeId: "ChIJyamo", name: "Yamo", lat: 37.7619 }));
  });
  it("a queued video shows as one, and the long server-side step is named", () => {
    render(Outbox, { outbox: fakeOutbox(), queue: { items: [{ ...item({ id: "v", state: "uploading", progress: 1 }), type: "video/mp4", name: "clip.mp4" }, item({ id: "b" })], blocked: false, flushing: true, online: true } });
    expect(screen.getByRole("status")).toHaveTextContent("Uploading 1 of 2 · 100% · processing the video…");
    expect(document.querySelectorAll(".tile .vid")).toHaveLength(1);
    expect(screen.getByText("🎬")).toBeInTheDocument();
  });
  it("no queue, no panel", () => {
    render(Outbox, { outbox: fakeOutbox(), queue: { items: [], blocked: false, flushing: false, online: true } });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Add photos" })).toBeInTheDocument();
  });
});
