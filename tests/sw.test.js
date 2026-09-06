import { describe, it, expect } from "vitest";
import { classify, normalizeTileKey, tilesFor, fillTemplate, zoomToFit } from "../src/sw/strategies.js";
import { planDownload, setTileTemplate } from "../src/lib/offline.js";
import { partitionAssets } from "../scripts/lib/sw-assets.mjs";
import { moments, tracks } from "./fixtures.js";

const origin = "https://itineris.taptappers.club";
const viewer = { origin, scope: "/", dataPrefixes: ["/data/"] };
const admin = { origin, scope: "/admin/", apiPaths: ["/admin/api/library", "/admin/api/me"] };

describe("what each request is", () => {
  it("viewer", () => {
    expect(classify(`${origin}/`, viewer)).toBe("navigation");
    expect(classify(`${origin}/g/abc123abc123`, viewer)).toBe("navigation");
    expect(classify(`${origin}/assets/index-abc.js`, viewer)).toBe("shell");
    expect(classify(`${origin}/manifest.webmanifest`, viewer)).toBe("shell");
    expect(classify(`${origin}/data/home.json`, viewer)).toBe("data");
    expect(classify(`${origin}/data/galleries/x.json`, viewer)).toBe("data");
    expect(classify(`${origin}/media/abc-400.webp`, viewer)).toBe("media");
    expect(classify(`${origin}/admin/api/me`, viewer)).toBe("network");   // not ours
    expect(classify("https://tiles-c.basemaps.cartocdn.com/vectortiles/carto.streets/v1/12/3/2.mvt", viewer)).toBe("tiles");
    expect(classify("https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json", viewer)).toBe("tiles");
    expect(classify("https://tiles.basemaps.cartocdn.com/fonts/Montserrat%20Medium/0-255.pbf", viewer)).toBe("tiles");
    expect(classify("https://example.com/x", viewer)).toBe("network");
  });
  it("admin", () => {
    expect(classify(`${origin}/admin/`, admin)).toBe("navigation");
    expect(classify(`${origin}/admin/assets/index-abc.js`, admin)).toBe("shell");
    expect(classify(`${origin}/admin/api/library`, admin)).toBe("data");
    expect(classify(`${origin}/admin/api/me`, admin)).toBe("data");
    expect(classify(`${origin}/admin/api/moments`, admin)).toBe("network");   // mutations and lists we don't cache
    expect(classify(`${origin}/media/abc-400.webp`, admin)).toBe("media");     // thumbnails, shared cache
    expect(classify(`${origin}/data/home.json`, admin)).toBe("network");      // outside its scope
  });
});

describe("what a new worker downloads before it can take over", () => {
  it("the app, not the megabyte of MapLibre", () => {
    const { precache, heavy } = partitionAssets(["/assets/index-a.js", "/assets/index-b.css", "/assets/maplibre-c.js", "/assets/maplibre-gl-d.css", "/assets/maplibre-gl-e.js"]);
    expect(precache).toEqual(["/assets/index-a.js", "/assets/index-b.css"]);
    expect(heavy).toHaveLength(3);
  });
});

describe("tiles", () => {
  it("round-robin hosts collapse to one cache key", () => {
    for (const h of ["a", "b", "c", "d"]) expect(normalizeTileKey(`https://tiles-${h}.basemaps.cartocdn.com/v/1/2/3.mvt`)).toBe("https://tiles-a.basemaps.cartocdn.com/v/1/2/3.mvt");
    expect(normalizeTileKey("https://tiles.basemaps.cartocdn.com/fonts/x.pbf")).toBe("https://tiles.basemaps.cartocdn.com/fonts/x.pbf");
  });
  it("enumerates the tiles covering a bbox and stops at the cap", () => {
    expect(tilesFor([-180, -85, 180, 85], 0, 0).tiles).toEqual([{ z: 0, x: 0, y: 0 }]);
    const sg = [103.6, 1.2, 104.05, 1.47];
    const { tiles, stoppedAt } = tilesFor(sg, 10, 14);
    expect(stoppedAt).toBeNull();
    expect(tiles.filter((t) => t.z === 10).length).toBeGreaterThanOrEqual(2);
    expect(tiles.filter((t) => t.z === 14).length).toBeGreaterThan(50);
    expect(tiles.length).toBeLessThan(2500);
    const capped = tilesFor(sg, 10, 14, 50);
    expect(capped.stoppedAt).not.toBeNull(); expect(capped.tiles.length).toBeLessThanOrEqual(50);
    expect(fillTemplate("https://t/{z}/{x}/{y}.mvt", { z: 1, x: 2, y: 3 })).toBe("https://t/1/2/3.mvt");
  });
  it("zoom to fit is sane", () => {
    expect(zoomToFit([103.6, 1.2, 104.05, 1.47])).toBeGreaterThanOrEqual(9);
    expect(zoomToFit([103.6, 1.2, 104.05, 1.47])).toBeLessThanOrEqual(12);
    expect(zoomToFit([-180, -85, 180, 85])).toBe(0);
  });
});

describe("planning a download", () => {
  it("lists every image once, absolute, and no tiles without a template", () => {
    setTileTemplate(null);
    const plan = planDownload({ moments: [...moments, { id: "v", lat: 1, lng: 2, media: { type: "video", src: "media/v-1280.mp4", poster: "media/v-1600.webp", medium: "media/v-960.webp", thumb: "media/v-400.webp" } }], tracks });
    expect(plan.media).toContain("/media/a.webp"); expect(plan.media).toContain("/media/a-t.webp");
    expect(plan.media).toContain("/media/v-1280.mp4"); expect(plan.media).toContain("/media/v-960.webp"); expect(plan.media).toContain("/media/v-400.webp");   // a video: its file, poster tier and thumb
    expect(new Set(plan.media).size).toBe(plan.media.length);
    expect(plan.tiles).toEqual([]);
  });
  it("adds tiles for the area once the map told us where tiles live", () => {
    setTileTemplate("https://tiles-b.basemaps.cartocdn.com/v/{z}/{x}/{y}.mvt");
    const plan = planDownload({ moments, tracks });
    expect(plan.tiles.length).toBeGreaterThan(10);
    expect(plan.tiles.every((u) => u.startsWith("https://tiles-a."))).toBe(true);
    expect(plan.zmax).toBe(14);
  });
});
