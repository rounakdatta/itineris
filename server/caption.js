// Caption styling, shared by the story (viewer), the admin's live preview and
// the server's validation -- so what the editor shows is exactly what visitors
// get. A small curated set, not a design tool: five faces, four sizes, a
// transparent/dark/light/coloured pill, light or dark ink, and a position the
// author drags to (fractions of the story frame).
export const FONTS = {
  clean:  { label: "Clean",  family: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif', weight: 600 },
  serif:  { label: "Serif",  family: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif', weight: 500 },
  mono:   { label: "Mono",   family: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace', weight: 500 },
  script: { label: "Script", family: 'Caveat, "Bradley Hand", "Segoe Script", "Comic Sans MS", cursive', weight: 700, scale: 1.3 },
  poster: { label: "Poster", family: '"Bebas Neue", Impact, "Arial Narrow", "Roboto Condensed", sans-serif', weight: 400, upper: true, spacing: "0.05em", scale: 1.35 },
};
export const SIZES = { s: 0.78, m: 1, l: 1.3, xl: 1.7 };
export const ACCENTS = ["#ff5d73", "#ffb020", "#3ecf8e", "#4cc9f0", "#8b5cf6", "#ff8fab"];
export const ALIGNS = ["left", "center", "right"];
export const INKS = ["light", "dark"];
export const DEFAULT_STYLE = Object.freeze({ x: 0.5, y: 0.82, font: "clean", size: "m", bg: "none", ink: "light", align: "center" });
// Where the caption's centre may sit: clear of the bars/header at the top and the tags at the bottom.
export const X_RANGE = [0.06, 0.94];
export const Y_RANGE = [0.12, 0.92];
const HEX = /^#[0-9a-f]{6}$/i;
const has = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
export const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
export const isBg = (bg) => typeof bg === "string" && (bg === "none" || bg === "dark" || bg === "light" || HEX.test(bg));

// Lenient, for rendering: anything odd falls back to the default.
export function normalizeStyle(raw) {
  const s = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const num = (v, d, range) => (v !== null && v !== "" && Number.isFinite(+v) ? clamp(+v, range) : d);
  return {
    x: num(s.x, DEFAULT_STYLE.x, X_RANGE),
    y: num(s.y, DEFAULT_STYLE.y, Y_RANGE),
    font: has(FONTS, s.font) ? s.font : DEFAULT_STYLE.font,
    size: has(SIZES, s.size) ? s.size : DEFAULT_STYLE.size,
    bg: isBg(s.bg) ? s.bg.toLowerCase() : DEFAULT_STYLE.bg,
    ink: INKS.includes(s.ink) ? s.ink : DEFAULT_STYLE.ink,
    align: ALIGNS.includes(s.align) ? s.align : DEFAULT_STYLE.align,
  };
}

// Strict, for the server: unknown keys are dropped, bad values are an error.
export function validateStyle(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "must be an object" };
  const out = { ...DEFAULT_STYLE };
  for (const k of ["x", "y"]) {
    if (!(k in raw)) continue;
    const v = +raw[k];
    if (typeof raw[k] !== "number" || !Number.isFinite(v) || v < 0 || v > 1) return { error: `${k} must be a number from 0 to 1` };
    out[k] = +clamp(v, k === "x" ? X_RANGE : Y_RANGE).toFixed(4);
  }
  if ("font" in raw) { if (!has(FONTS, raw.font)) return { error: `font must be one of ${Object.keys(FONTS).join(", ")}` }; out.font = raw.font; }
  if ("size" in raw) { if (!has(SIZES, raw.size)) return { error: `size must be one of ${Object.keys(SIZES).join(", ")}` }; out.size = raw.size; }
  if ("bg" in raw) { if (!isBg(raw.bg)) return { error: "bg must be none, dark, light or a #rrggbb colour" }; out.bg = raw.bg.toLowerCase(); }
  if ("ink" in raw) { if (!INKS.includes(raw.ink)) return { error: "ink must be light or dark" }; out.ink = raw.ink; }
  if ("align" in raw) { if (!ALIGNS.includes(raw.align)) return { error: "align must be left, center or right" }; out.align = raw.align; }
  return { style: out };
}

export function isDefaultStyle(raw) {
  const n = normalizeStyle(raw);
  return Object.keys(DEFAULT_STYLE).every((k) => n[k] === DEFAULT_STYLE[k]);
}

// Relative luminance of #rrggbb (0 = black, 1 = white), to pick readable ink on a coloured pill.
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [16, 8, 0].map((sh) => ((n >> sh) & 255) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// The custom properties Caption.svelte paints with. Readability is built in:
// no pill means a double text-shadow (dark under light ink, a light glow under
// dark ink); a pill means solid ink on a translucent or coloured ground.
export function captionVars(raw) {
  const s = normalizeStyle(raw);
  const f = FONTS[s.font];
  let bg = "transparent", ink = "#fff", shadow = "0 1px 2px rgba(0,0,0,.85), 0 2px 14px rgba(0,0,0,.55)", pad = "0.1em 0.25em";
  if (s.bg === "none") {
    if (s.ink === "dark") { ink = "#111"; shadow = "0 1px 2px rgba(255,255,255,.9), 0 0 16px rgba(255,255,255,.75)"; }
  } else {
    pad = "0.42em 0.8em"; shadow = "none";
    if (s.bg === "dark") { bg = "rgba(8, 9, 12, 0.66)"; ink = "#fff"; }
    else if (s.bg === "light") { bg = "rgba(255, 255, 255, 0.92)"; ink = "#111"; }
    else { bg = s.bg; ink = luminance(s.bg) > 0.5 ? "#111" : "#fff"; }
  }
  return [
    `--cap-x:${(s.x * 100).toFixed(2)}%`, `--cap-y:${(s.y * 100).toFixed(2)}%`,
    `--cap-font:${f.family}`, `--cap-weight:${f.weight}`, `--cap-size:${(SIZES[s.size] * (f.scale ?? 1)).toFixed(3)}`,
    `--cap-transform:${f.upper ? "uppercase" : "none"}`, `--cap-spacing:${f.spacing ?? "normal"}`,
    `--cap-align:${s.align}`, `--cap-bg:${bg}`, `--cap-ink:${ink}`, `--cap-shadow:${shadow}`, `--cap-pad:${pad}`,
  ].join(";");
}
