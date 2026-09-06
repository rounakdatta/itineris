// Mounts the whole admin: catches anything that only breaks when the pieces
// meet (an effect that loops, a missing prop), which no component test sees.
import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/svelte";

vi.mock("../admin/lib/api.js", async (orig) => {
  const m = await orig();
  return { ...m, api: { ...m.api,
    me: vi.fn(async () => ({ email: "t@example.com" })),
    resolveLink: vi.fn(async () => ({ name: "Zahrat Lebnan", lat: 24.471235, lng: 54.371235, cid: "5", mapsUrl: "https://maps.google.com/?cid=5" })),
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
import { api } from "../admin/lib/api.js";
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

describe("admin App: a place shared in from Google Maps", () => {
  it("reads the share-target parameters, resolves the link, and offers to place new photos there", async () => {
    window.history.replaceState(null, "", "/admin/?title=Zahrat%20Lebnan&text=Check%20this%20out%20https%3A%2F%2Fmaps.app.goo.gl%2FAbC%3Fg_st%3Dic");
    render(App);
    await waitFor(() => expect(api.resolveLink).toHaveBeenCalledWith("https://maps.app.goo.gl/AbC?g_st=ic"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add photos at “Zahrat Lebnan”" })).toBeInTheDocument());
    expect(screen.getByText(/photos you add now land here/i)).toBeInTheDocument();
    expect(window.location.search).toBe("");                       // the share is consumed, not re-read on reload
  });
});
