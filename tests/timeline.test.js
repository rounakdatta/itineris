import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import Timeline from "../src/components/Timeline.svelte";
import { trip } from "../src/lib/trip.svelte.js";
import { moments, tracks } from "./fixtures.js";

beforeEach(() => { trip.moments = structuredClone(moments); trip.tracks = structuredClone(tracks); trip.facets = []; trip.day = null; trip.focusId = null; trip.storyIndex = -1; });

describe("Timeline", () => {
  it("first tap focuses, second tap on the same photo opens it", async () => {
    render(Timeline);
    const tick = screen.getByRole("button", { name: /08:40 Chinatown/ });
    await fireEvent.click(tick);
    expect(trip.focusId).toBe("a"); expect(trip.storyOpen).toBe(false);
    expect(tick).toHaveClass("on");
    expect(tick.querySelector("img").getAttribute("src")).toBe("/media/a-t.webp");
    await fireEvent.click(tick);
    expect(trip.storyOpen).toBe(true); expect(trip.storyMoment.id).toBe("a");
  });
  it("day chips carry the date and reflect selection", async () => {
    render(Timeline);
    const day1 = screen.getByRole("button", { name: /Day 1/ });
    expect(day1).toHaveTextContent("14 Mar");
    expect(day1).toHaveAttribute("aria-pressed", "false");
    await fireEvent.click(day1);
    expect(trip.day).toBe("2026-03-14"); expect(day1).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", { name: /^\d\d:\d\d/ }).length).toBe(2);
  });
});
