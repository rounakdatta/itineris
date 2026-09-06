import { describe, it, expect } from "vitest";
import { isVideoFile } from "../admin/lib/thumbs.js";

describe("queued files", () => {
  it("videos are told apart by type or name", () => {
    expect(isVideoFile({ type: "video/quicktime", name: "IMG_1.MOV" })).toBe(true);
    expect(isVideoFile({ type: "", name: "clip.mp4" })).toBe(true);
    expect(isVideoFile({ type: "image/jpeg", name: "a.jpg" })).toBe(false);
  });
});
