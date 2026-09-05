// Mounts the whole admin: catches anything that only breaks when the pieces
// meet (an effect that loops, a missing prop), which no component test sees.
import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/svelte";

vi.mock("../admin/lib/api.js", async (orig) => {
  const m = await orig();
  return { ...m, api: { ...m.api,
    me: vi.fn(async () => ({ email: "t@example.com" })),
    libraryWithMeta: vi.fn(async () => ({ fromCache: false, body: {
      moments: [{ id: "m1", t: "2026-03-14T08:40:00+08:00", lat: 1, lng: 2, place: "Chinatown", caption: "", tags: ["food"], galleries: ["g1"], media: { src: "media/a.webp", thumb: "media/a-t.webp", w: 1, h: 1 } }],
      tracks: [], galleries: [{ id: "g1", title: "Home", home: true, count: 1, trackCount: 0, momentIds: ["m1"], trackIds: [] }],
    } })),
    library: vi.fn(async () => ({
      moments: [{ id: "m1", t: "2026-03-14T08:40:00+08:00", lat: 1, lng: 2, place: "Chinatown", caption: "", tags: ["food"], galleries: ["g1"], media: { src: "media/a.webp", thumb: "media/a-t.webp", w: 1, h: 1 } }],
      tracks: [], galleries: [{ id: "g1", title: "Home", home: true, count: 1, trackCount: 0, momentIds: ["m1"], trackIds: [] }],
    })),
  } };
});
import App from "../admin/App.svelte";

describe("admin App", () => {
  it("mounts, loads the library, shows tabs, upload surface and no queue", async () => {
    render(App);
    await waitFor(() => expect(screen.getByText(/t@example.com/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Photos/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Galleries/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add photos" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(1));
    expect(screen.queryByRole("status", { name: /Upload queue/ })).toBeNull();
  });
});
