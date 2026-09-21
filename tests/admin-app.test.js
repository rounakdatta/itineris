// Mounts the whole admin: catches anything that only breaks when the pieces
// meet (an effect that loops, a missing prop), which no component test sees.
import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/svelte";

vi.mock("../admin/lib/api.js", async (orig) => {
  const m = await orig();
  return { ...m, api: { ...m.api,
    me: vi.fn(async () => ({ signedIn: true, google: true, email: "t@example.com", name: "T Example", owner: true })),
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
    // Signed in: the header names the account, with the address on hover.
    await waitFor(() => expect(screen.getByText("T Example")).toBeInTheDocument());
    expect(screen.getByText("T Example")).toHaveAttribute("title", "t@example.com");
    expect(screen.getByRole("button", { name: /Photos/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Galleries/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add photos" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByLabelText(/^\d\d:\d\d /).length).toBe(1));   // the one photo in the library, as a cell button
    expect(screen.queryByRole("status", { name: /Upload queue/ })).toBeNull();
  });
});

describe("admin App: what the first minutes look like", () => {
  const lib = (moments, galleries) => ({ fromCache: false, body: { moments, tracks: [], galleries } });
  // mockImplementationOnce QUEUES, so a call that never happens leaves its
  // answer waiting for the next test. These set the whole implementation.
  const setLib = (moments, galleries) => api.libraryWithMeta.mockImplementation(async () => lib(moments, galleries));
  const G1 = { id: "g1", title: "Home", home: true, count: 1, trackCount: 0, momentIds: ["m1"], trackIds: [] };
  const one = { id: "m1", t: "2026-03-14T08:40:00+08:00", lat: null, lng: null, place: "", caption: "", tags: [], galleries: [], media: { src: "media/a.webp", thumb: "media/a-t.webp", w: 1, h: 1 } };

  it("does not flash the first-run panel at somebody who has photos", async () => {
    // The library answers on a later tick. Reading an empty `moments` as
    // "this person has nothing" before it lands showed the big empty-state
    // invitation, then swapped it out, on every single load.
    let settle;
    api.libraryWithMeta.mockImplementation(() => new Promise((r) => { settle = () => r(lib([one], [G1])); }));
    render(App);
    await waitFor(() => expect(screen.getByText("T Example")).toBeInTheDocument());
    expect(screen.queryByText("Start with a few photos")).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose photos" })).toBeNull();
    settle();
    await waitFor(() => expect(screen.getAllByLabelText(/^\d\d:\d\d /).length).toBe(1));
    expect(screen.queryByText("Start with a few photos")).toBeNull();
  });

  it("invites a brand new person to add photos, with none of the chrome for photos they do not have", async () => {
    setLib([], []);
    render(App);
    await waitFor(() => expect(screen.getByText("Start with a few photos")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Choose photos" })).toBeInTheDocument();
    // A filter, a Select button and a "0 photos" count are chrome for content
    // that is not there. So is a nudge towards a gallery.
    expect(screen.queryByLabelText("Filter photos")).toBeNull();
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    expect(screen.queryByText(/no gallery yet/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Pin the next photos/ })).toBeNull();
  });

  it("points somebody with photos and no gallery at the thing the app is for", async () => {
    setLib([one], []);
    render(App);
    await waitFor(() => expect(screen.getByText(/no gallery yet/)).toBeInTheDocument());
    expect(screen.getByText(/stay private until they are in one/)).toBeInTheDocument();
    // ...and the button lands on an OPEN form, already offering to put the
    // photos in. A first gallery that comes out empty, with "now go back and
    // select them" left unsaid, is where somebody gives up.
    screen.getByRole("button", { name: "Make your first gallery" }).click();
    await waitFor(() => expect(screen.getByLabelText("Title")).toBeInTheDocument());
    const withAll = screen.getByRole("checkbox", { name: /Start it with all 1 photo/ });
    expect(withAll).toBeChecked();
  });

  it("counts what still needs doing as something you can tap, not as a warning", async () => {
    setLib([one, { ...one, id: "m2", t: "2026-03-14T09:40:00+08:00", tags: ["food"], lat: 1, lng: 2 }], [{ ...G1, count: 0, momentIds: [] }]);
    render(App);
    const chip = await screen.findByRole("button", { name: /1 untagged/ });
    await waitFor(() => expect(screen.getAllByLabelText(/^\d\d:\d\d /).length).toBe(2));
    chip.click();
    await waitFor(() => expect(screen.getAllByLabelText(/^\d\d:\d\d /).length).toBe(1));
    expect(chip).toHaveAttribute("aria-pressed", "true");
    chip.click();                                     // tapping again is the way back
    await waitFor(() => expect(screen.getAllByLabelText(/^\d\d:\d\d /).length).toBe(2));
  });
});

describe("admin App: a place shared in from Google Maps", () => {
  it("reads the share-target parameters, resolves the link, and offers to place new photos there", async () => {
    window.history.replaceState(null, "", "/creator/?title=Zahrat%20Lebnan&text=Check%20this%20out%20https%3A%2F%2Fmaps.app.goo.gl%2FAbC%3Fg_st%3Dic");
    render(App);
    await waitFor(() => expect(api.resolveLink).toHaveBeenCalledWith("https://maps.app.goo.gl/AbC?g_st=ic"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add photos at “Zahrat Lebnan”" })).toBeInTheDocument());
    expect(screen.getByText(/photos you add now land here/i)).toBeInTheDocument();
    expect(window.location.search).toBe("");                       // the share is consumed, not re-read on reload
  });
});
