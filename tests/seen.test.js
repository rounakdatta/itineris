import { describe, it, expect, beforeEach } from "vitest";
import { seen, markSeen, allSeen, resetSeen } from "../src/lib/seen.svelte.js";

beforeEach(() => resetSeen());

describe("story rings: seen on this device", () => {
  it("marks, remembers across reloads, and knows when a whole place has been seen", () => {
    expect(allSeen([{ id: "a" }, { id: "b" }])).toBe(false);
    markSeen("a"); markSeen("a");
    expect(seen.has("a")).toBe(true); expect(allSeen([{ id: "a" }, { id: "b" }])).toBe(false);
    markSeen("b");
    expect(allSeen([{ id: "a" }, { id: "b" }])).toBe(true);
    expect(allSeen([])).toBe(false);
    expect(JSON.parse(localStorage.getItem("itineris:seen"))).toEqual(["a", "b"]);
    resetSeen(); expect(localStorage.getItem("itineris:seen")).toBeNull(); expect(seen.size).toBe(0);
  });
});
