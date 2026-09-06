import { describe, it, expect } from "vitest";
import { normalizeStyle, validateStyle, captionVars, isDefaultStyle, luminance, DEFAULT_STYLE, FONTS } from "../server/caption.js";

describe("caption style: the shared model", () => {
  it("normalizes anything odd to the default, and clamps the position clear of the chrome", () => {
    expect(normalizeStyle(null)).toEqual(DEFAULT_STYLE);
    expect(normalizeStyle({ font: "comic", size: 9, bg: "purple", ink: "red", align: "middle" })).toEqual(DEFAULT_STYLE);
    expect(normalizeStyle({ x: -1, y: 2 })).toMatchObject({ x: 0.06, y: 0.92 });
    expect(normalizeStyle({ x: "0.3", y: "0.5" })).toMatchObject({ x: 0.3, y: 0.5 });
    expect(normalizeStyle({ font: "constructor" }).font).toBe("clean");   // prototype keys are not fonts
    expect(normalizeStyle({ bg: "#FF5D73" }).bg).toBe("#ff5d73");
  });
  it("validates strictly for the server: bad values are errors, unknown keys are dropped", () => {
    expect(validateStyle({ x: 0.2, y: 0.7, font: "script", bg: "dark", extra: 1 })).toEqual({ style: { ...DEFAULT_STYLE, x: 0.2, y: 0.7, font: "script", bg: "dark" } });
    expect(validateStyle({ font: "comic" }).error).toMatch(/font must be one of/);
    expect(validateStyle({ x: "0.5" }).error).toMatch(/x must be a number/);
    expect(validateStyle({ y: 1.5 }).error).toMatch(/y must be a number/);
    expect(validateStyle({ bg: "purple" }).error).toMatch(/bg must be/);
    expect(validateStyle({ bg: "#abc" }).error).toMatch(/bg must be/);
    expect(validateStyle({ size: "xxl" }).error).toMatch(/size must be/);
    expect(validateStyle({ ink: "blue" }).error).toMatch(/ink must be/);
    expect(validateStyle({ align: "justify" }).error).toMatch(/align must be/);
    expect(validateStyle([]).error).toMatch(/object/); expect(validateStyle("x").error).toMatch(/object/);
    expect(validateStyle({ x: 0.001 }).style.x).toBe(0.06);   // clamped, not refused
  });
  it("paints readable ink: shadow under bare text, solid ink on a pill, contrast on a colour", () => {
    expect(captionVars(null)).toContain("--cap-bg:transparent"); expect(captionVars(null)).toContain("--cap-ink:#fff"); expect(captionVars(null)).toMatch(/--cap-shadow:0 1px 2px rgba\(0,0,0/);
    expect(captionVars({ ink: "dark" })).toContain("--cap-ink:#111"); expect(captionVars({ ink: "dark" })).toMatch(/rgba\(255,255,255/);
    expect(captionVars({ bg: "dark" })).toContain("--cap-shadow:none"); expect(captionVars({ bg: "dark" })).toContain("--cap-ink:#fff");
    expect(captionVars({ bg: "light" })).toContain("--cap-ink:#111");
    expect(captionVars({ bg: "#ffb020" })).toContain("--cap-ink:#111");   // amber is bright: dark ink
    expect(captionVars({ bg: "#8b5cf6" })).toContain("--cap-ink:#fff");   // violet is dark: light ink
    expect(luminance("#ffffff")).toBeCloseTo(1); expect(luminance("#000000")).toBe(0);
  });
  it("positions and faces come through as custom properties", () => {
    const v = captionVars({ x: 0.2, y: 0.5, font: "poster", size: "xl", align: "left" });
    expect(v).toContain("--cap-x:20.00%"); expect(v).toContain("--cap-y:50.00%"); expect(v).toContain("--cap-align:left");
    expect(v).toContain("Bebas Neue"); expect(v).toContain("--cap-transform:uppercase"); expect(v).toContain(`--cap-size:${(1.7 * FONTS.poster.scale).toFixed(3)}`);
    expect(captionVars({ font: "script" })).toContain("Caveat");
  });
  it("knows the default look when it sees it", () => {
    expect(isDefaultStyle(null)).toBe(true); expect(isDefaultStyle({ x: 0.5 })).toBe(true); expect(isDefaultStyle({ font: "serif" })).toBe(false);
  });
});
