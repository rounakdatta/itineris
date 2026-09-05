import { describe, it, expect } from "vitest";
import { splitIso, joinIso, OFFSETS, galleryUrl, storyUrl } from "../admin/lib/api.js";

describe("time editing helpers", () => {
  it("split keeps seconds and offset apart from what the picker edits", () => {
    expect(splitIso("2026-03-14T08:40:12+08:00")).toEqual({ local: "2026-03-14T08:40", seconds: ":12", offset: "+08:00" });
    expect(splitIso("2026-03-14T08:40-05:30")).toEqual({ local: "2026-03-14T08:40", seconds: ":00", offset: "-05:30" });
    expect(splitIso("garbage")).toEqual({ local: "", seconds: ":00", offset: "+00:00" });
  });
  it("join round-trips", () => {
    expect(joinIso(splitIso("2026-03-14T08:40:12+08:00"))).toBe("2026-03-14T08:40:12+08:00");
    expect(OFFSETS).toContain("+05:30");
  });
  it("share links", () => {
    expect(galleryUrl("abc")).toMatch(/\/g\/abc$/);
    expect(storyUrl("abc", "m1")).toMatch(/\/g\/abc#m\/m1$/);
    expect(storyUrl(null, "m1")).toMatch(/\/#m\/m1$/);
  });
});
