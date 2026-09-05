import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import FacetBar from "../src/components/FacetBar.svelte";
import { trip } from "../src/lib/trip.svelte.js";
import { moments, tracks } from "./fixtures.js";

beforeEach(() => { trip.moments = structuredClone(moments); trip.tracks = structuredClone(tracks); trip.facets = []; trip.day = null; });

describe("FacetBar", () => {
  it("renders a chip per facet with counts that ignore the facet filter", async () => {
    render(FacetBar);
    const spots = screen.getByRole("button", { name: /Spots/ });
    const acts = screen.getByRole("button", { name: /Activities/ });
    expect(spots).toHaveTextContent("2");          // a, b
    expect(acts).toHaveTextContent("3");           // c + two tracks
    await fireEvent.click(acts);
    expect(trip.facets).toEqual(["activities"]);
    expect(spots).toHaveTextContent("2");          // count did not collapse
  });
});
