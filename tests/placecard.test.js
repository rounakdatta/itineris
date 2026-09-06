import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import PlaceCard from "../src/components/PlaceCard.svelte";
import { trip } from "../src/lib/trip.svelte.js";
import { moments, tracks } from "./fixtures.js";

beforeEach(() => {
  trip.moments = [...structuredClone(moments), { ...structuredClone(moments[0]), id: "a2", t: "2026-03-14T09:10:00+08:00", caption: "Second round", tags: ["food", "coffee"] }];
  trip.tracks = structuredClone(tracks); trip.status = "ready"; trip.view = "map"; trip.facets = []; trip.focusId = null; trip.storyIndex = -1;
});

describe("PlaceCard", () => {
  it("nothing focused, nothing shown; a focused pin shows the place, its photos, and a Google Maps link", async () => {
    render(PlaceCard);
    expect(screen.queryByRole("complementary")).toBeNull();
    trip.focus("a"); await tick();
    const card = screen.getByRole("complementary", { name: "Place: Chinatown" });
    expect(card).toHaveTextContent("14 Mar"); expect(card).toHaveTextContent("08:40–09:10"); expect(card).toHaveTextContent("2 photos");
    expect(card).toHaveTextContent("food"); expect(card).toHaveTextContent("coffee");
    expect(card.querySelectorAll(".thumb")).toHaveLength(2);
    const link = screen.getByRole("link", { name: /Google Maps/ });
    expect(link).toHaveAttribute("href", "https://www.google.com/maps/search/Chinatown/@1.28,103.84,17z");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
  it("shows what Google says about the place, Claude.ai-style, and prefers Google's own link", async () => {
    trip.moments = trip.moments.map((m) => (m.id === "b" ? { ...m, google: { placeId: "ChIJmax", rating: 4.4, ratingCount: 12873, type: "Hawker centre", mapsUri: "https://maps.google.com/?cid=9" } } : m));
    render(PlaceCard); trip.focus("b"); await tick();
    const card = screen.getByRole("complementary");
    expect(card.querySelector(".google")).toHaveTextContent("4.4★(12,873)·Hawker centre");
    expect(screen.getByRole("link", { name: /Google Maps/ })).toHaveAttribute("href", "https://maps.google.com/?cid=9");
    trip.focus("a"); await tick();
    expect(screen.getByRole("complementary").querySelector(".google")).toBeNull();
  });
  it("uses the exact link when the photo has one", async () => {
    trip.moments = trip.moments.map((m) => (m.id === "b" ? { ...m, mapsUrl: "https://maps.google.com/?cid=42" } : m));
    render(PlaceCard); trip.focus("b"); await tick();
    expect(screen.getByRole("link", { name: /Google Maps/ })).toHaveAttribute("href", "https://maps.google.com/?cid=42");
  });
  it("a photo without a place gets no card at all (it would only say Photo, the date and Story)", async () => {
    render(PlaceCard); trip.focus("d"); await tick();
    expect(screen.queryByRole("complementary")).toBeNull();
    // ...but a name alone is enough for a card, even with nothing from Google
    trip.focus("c"); await tick();
    expect(screen.getByRole("complementary", { name: "Place: Merlion" })).toBeInTheDocument();
    // ...and so is a Google Maps link on an unnamed photo
    trip.moments = trip.moments.map((m) => (m.id === "d" ? { ...m, mapsUrl: "https://maps.google.com/?cid=42" } : m)); trip.focus("d"); await tick();
    expect(screen.getByRole("complementary", { name: "Place: Photo" })).toBeInTheDocument();
  });
  it("tapping a photo or Story opens the story; ✕ puts the card away; it hides while the story plays and on the wall", async () => {
    render(PlaceCard); trip.focus("a"); await tick();
    await fireEvent.click(screen.getByRole("button", { name: /Open 09:10/ }));
    expect(trip.storyMoment.id).toBe("a2");
    expect(screen.queryByRole("complementary")).toBeNull();      // hidden while the story is open
    trip.closeStory(); await tick();
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "▶ Story" }));
    expect(trip.storyMoment.id).toBe("a2");                      // focus followed the story
    trip.closeStory(); await tick();
    trip.view = "wall"; await tick();
    expect(screen.queryByRole("complementary")).toBeNull();
    trip.view = "map"; await tick();
    await fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(trip.focusId).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});
