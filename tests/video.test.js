import { describe, it, expect } from "vitest";
import { isVideo, parseIso6709, parseProbe, videoTime, utcToLocal } from "../server/video.js";

describe("what counts as a video", () => {
  it("by the phone's mime type or the file's name", () => {
    expect(isVideo("clip.MOV", "")).toBe(true); expect(isVideo("x.bin", "video/mp4")).toBe(true);
    expect(isVideo("photo.jpg", "image/jpeg")).toBe(false); expect(isVideo("photo.heic", "")).toBe(false);
  });
});

describe("reading a phone video's metadata", () => {
  it("ISO 6709 locations, Apple and Android flavours", () => {
    expect(parseIso6709("+37.7619-122.4194+010.000/")).toEqual({ lat: 37.7619, lng: -122.4194 });
    expect(parseIso6709("+01.2807+103.8504/")).toEqual({ lat: 1.2807, lng: 103.8504 });
    expect(parseIso6709("+99.0+10.0/")).toBeNull(); expect(parseIso6709("")).toBeNull();
  });
  it("ffprobe output: duration, size with rotation applied, tags", () => {
    const p = parseProbe({ format: { duration: "12.480000", tags: { creation_time: "2026-03-14T00:40:12.000000Z", "com.apple.quicktime.creationdate": "2026-03-14T08:40:12+0800", "com.apple.quicktime.location.ISO6709": "+01.2807+103.8504/" } },
      streams: [{ codec_type: "video", codec_name: "hevc", width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }, { codec_type: "audio" }] });
    expect(p).toMatchObject({ duration: 12.48, width: 1080, height: 1920, codec: "hevc", hasAudio: true, creationTime: "2026-03-14T00:40:12.000000Z", localCreation: "2026-03-14T08:40:12+0800", gps: { lat: 1.2807, lng: 103.8504 } });
    expect(parseProbe({ streams: [{ codec_type: "video", width: 640, height: 480, tags: { rotate: "180" } }], format: {} })).toMatchObject({ width: 640, height: 480, duration: null, gps: null, hasAudio: false });
    expect(parseProbe({ format: { tags: { creation_time: "2026-03-14T00:40:12.000000Z;2026-03-14T00:40:12Z" } }, streams: [] }).creationTime).toBe("2026-03-14T00:40:12.000000Z");
    expect(parseProbe({ format: {}, streams: [{ codec_type: "video", width: 1, height: 1, tags: { creation_time: "2026-03-14T00:40:12Z" } }] }).creationTime).toBe("2026-03-14T00:40:12Z");
  });
  it("when it was shot, in its own local time", () => {
    expect(videoTime({ localCreation: "2026-03-14T08:40:12+0800" })).toEqual({ t: "2026-03-14T08:40:12+08:00", tz: "video" });
    expect(videoTime({ localCreation: "2026-03-14T08:40:12.123-07:00" })).toEqual({ t: "2026-03-14T08:40:12-07:00", tz: "video" });
    expect(videoTime({ creationTime: "2026-03-14T00:40:12.000000Z", gps: { lat: 1.2807, lng: 103.8504 } })).toEqual({ t: "2026-03-14T08:40:12+08:00", tz: "gps" });   // Singapore
    expect(videoTime({ creationTime: "2026-03-14T00:40:12Z" })).toEqual({ t: "2026-03-14T00:40:12+00:00", tz: "unknown" });
    expect(videoTime({ creationTime: "1904-01-01T00:00:00Z" })).toBeNull();
    expect(videoTime({})).toBeNull();
    expect(utcToLocal(Date.UTC(2026, 6, 1, 12, 0, 0), "America/Los_Angeles")).toBe("2026-07-01T05:00:00-07:00");
  });
});
