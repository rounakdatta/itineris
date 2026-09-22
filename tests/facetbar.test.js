import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/svelte";
import FacetBar from "../src/components/FacetBar.svelte";
import { trip } from "../src/lib/trip.svelte.js";

const photo = (id, tags) => ({ id, t: `2026-03-14T0${id}:00:00+08:00`, lat: 1.28, lng: 103.84, place: "P" + id, caption: "", tags, media: { src: `m${id}.webp`, w: 9, h: 16 } });

beforeEach(() => { trip.moments = []; trip.tracks = []; trip.facets = []; });

describe("a filter earns its place by being able to narrow something", () => {
  it("is not shown at all when it matches the whole gallery", () => {
    // A food walk: every photo is a "spot". Tapping "Spots 3" on a gallery of
    // 3 photos leaves the same 3 photos on the screen -- a control that does
    // nothing, taking a row of a phone screen to do it.
    trip.moments = [photo(1, ["food"]), photo(2, ["food"]), photo(3, ["coffee"])];
    const { container } = render(FacetBar);
    expect(container.querySelector("nav")).toBeNull();
  });
  it("is shown when it can leave something out", () => {
    trip.moments = [photo(1, ["food"]), photo(2, ["food"]), photo(3, [])];
    render(FacetBar);
    expect(screen.getByRole("button", { name: /Spots/ })).toHaveTextContent("2");
  });
  it("counts tracks as part of the whole, so a facet that hides them still earns its place", () => {
    // Every photo is a spot, but there is also a route: selecting Spots would
    // drop the route, so the filter does something after all.
    trip.moments = [photo(1, ["food"]), photo(2, ["food"])];
    trip.tracks = [{ id: "t1", mode: "run", name: "Bay loop", geometry: [[103.8, 1.2], [103.9, 1.3]] }];
    render(FacetBar);
    expect(screen.getByRole("button", { name: /Spots/ })).toBeInTheDocument();
  });
  it("shows nothing at all for a gallery with no tags anywhere", () => {
    trip.moments = [photo(1, []), photo(2, [])];
    const { container } = render(FacetBar);
    expect(container.querySelector("nav")).toBeNull();
  });
  it("keeps the ones that narrow and drops the ones that do not, together", () => {
    trip.moments = [photo(1, ["food"]), photo(2, ["food"]), photo(3, ["food"])];
    trip.tracks = [{ id: "t1", mode: "run", name: "Bay loop", geometry: [[103.8, 1.2], [103.9, 1.3]] }];
    render(FacetBar);
    // Spots: 3 of 4 -> narrows. Activities: 1 of 4 -> narrows. Both stay.
    expect(screen.getByRole("button", { name: /Spots/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Activities/ })).toBeInTheDocument();
  });
});
