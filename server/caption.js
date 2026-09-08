// Caption styling, shared by the story (viewer), the admin's live preview and
// the server's validation -- so what the editor shows is exactly what visitors
// get. A curated set, not a design tool: a dozen faces in three moods, four
// sizes, a transparent/dark/light/coloured pill, light or dark ink, an angle,
// and a position the author drags to (fractions of the story frame).
//
// The moods make the picker a choice rather than a list: the plain faces, the
// classic ones a print gets captioned with, and the playful ones a photo gets
// stickered with. Every non-system face is bundled (src/assets/fonts, licences
// alongside) so a caption looks the same on every phone and offline. `scale`
// and `leading` even out how big and how airy each face actually looks at the
// same size setting -- set by rendering them all at caption size and looking,
// not by guessing.
const has = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
export const GROUPS = [
  { id: "plain", label: "Plain" },
  { id: "classic", label: "Classic" },
  { id: "playful", label: "Playful" },
];
export const FONTS = {
  clean:     { group: "plain",   label: "Clean",     family: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif', weight: 600 },
  grotesk:   { group: "plain",   label: "Grotesk",   family: '"Space Grotesk", "Helvetica Neue", Arial, sans-serif', weight: 500, spacing: "-0.005em" },
  mono:      { group: "plain",   label: "Mono",      family: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace', weight: 500, scale: 0.95 },
  editorial: { group: "classic", label: "Editorial", family: '"Playfair Display", "Iowan Old Style", Georgia, "Times New Roman", serif', weight: 700, scale: 1.05 },
  elegant:   { group: "classic", label: "Elegant",   family: '"Cormorant Garamond", "Palatino Linotype", Palatino, Georgia, serif', weight: 400, italic: true, scale: 1.3 },
  caps:      { group: "classic", label: "Caps",      family: 'Cinzel, "Trajan Pro", "Times New Roman", serif', weight: 400, upper: true, spacing: "0.1em", scale: 1.02 },
  poster:    { group: "classic", label: "Poster",    family: '"Bebas Neue", Impact, "Arial Narrow", "Roboto Condensed", sans-serif', weight: 400, upper: true, spacing: "0.05em", scale: 1.35 },
  rounded:   { group: "playful", label: "Rounded",   family: '"Baloo 2", "Comic Neue", "Trebuchet MS", sans-serif', weight: 800, scale: 0.98 },
  marker:    { group: "playful", label: "Marker",    family: '"Permanent Marker", "Segoe Print", "Bradley Hand", cursive', weight: 400, scale: 1.06, leading: 1.34 },
  retro:     { group: "playful", label: "Retro",     family: 'Pacifico, "Brush Script MT", cursive', weight: 400, scale: 1.12, leading: 1.5 },
  punchy:    { group: "playful", label: "Punchy",    family: 'Shrikhand, "Playfair Display", Georgia, serif', weight: 400, scale: 0.95, leading: 1.34 },
  tall:      { group: "playful", label: "Tall",      family: '"Amatic SC", Haettenschweiler, "Arial Narrow", sans-serif', weight: 700, scale: 1.55, spacing: "0.02em", leading: 1.12 },
};
// 0.13.0's faces, kept working: the handwriting was childish and the system
// serif is bettered by Playfair, so both point to their replacements.
export const LEGACY_FONTS = { script: "elegant", serif: "editorial" };
export const fontKey = (k) => (has(FONTS, k) ? k : has(LEGACY_FONTS, k) ? LEGACY_FONTS[k] : null);
export const SIZES = { s: 0.78, m: 1, l: 1.3, xl: 1.7 };
export const ACCENTS = ["#ff5d73", "#ffb020", "#3ecf8e", "#4cc9f0", "#8b5cf6", "#ff8fab"];
export const ALIGNS = ["left", "center", "right"];
export const INKS = ["light", "dark"];
export const DEFAULT_STYLE = Object.freeze({ x: 0.5, y: 0.82, rot: 0, font: "clean", size: "m", bg: "none", ink: "light", align: "center" });
// Where the caption's centre may sit: clear of the bars/header at the top and the tags at the bottom.
export const X_RANGE = [0.06, 0.94];
export const Y_RANGE = [0.12, 0.92];
export const ROT_RANGE = [-180, 180];   // any angle: a tilted caption is half of photo captioning
// A photo can carry a few captions -- a place in one corner, a joke on the
// subject, a time. More than a handful and it stops being a photograph, and the
// tap targets in the editor stop being usable.
export const MAX_CAPTIONS = 5;
export const MAX_CAPTION_TEXT = 2000;
const HEX = /^#[0-9a-f]{6}$/i;
export const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
export const isBg = (bg) => typeof bg === "string" && (bg === "none" || bg === "dark" || bg === "light" || HEX.test(bg));

// Lenient, for rendering: anything odd falls back to the default.
export function normalizeStyle(raw) {
  const s = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const num = (v, d, range) => (v !== null && v !== "" && Number.isFinite(+v) ? clamp(+v, range) : d);
  return {
    x: num(s.x, DEFAULT_STYLE.x, X_RANGE),
    y: num(s.y, DEFAULT_STYLE.y, Y_RANGE),
    rot: num(s.rot, DEFAULT_STYLE.rot, ROT_RANGE),
    font: fontKey(s.font) ?? DEFAULT_STYLE.font,
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
  if ("rot" in raw) {
    const v = +raw.rot;
    if (typeof raw.rot !== "number" || !Number.isFinite(v) || v < ROT_RANGE[0] || v > ROT_RANGE[1]) return { error: "rot must be a number of degrees from -180 to 180" };
    out.rot = +v.toFixed(1);
  }
  // A legacy face name (0.13.0's script/serif) is accepted and stored as its replacement.
  if ("font" in raw) { const k = fontKey(raw.font); if (!k) return { error: `font must be one of ${Object.keys(FONTS).join(", ")}` }; out.font = k; }
  if ("size" in raw) { if (!has(SIZES, raw.size)) return { error: `size must be one of ${Object.keys(SIZES).join(", ")}` }; out.size = raw.size; }
  if ("bg" in raw) { if (!isBg(raw.bg)) return { error: "bg must be none, dark, light or a #rrggbb colour" }; out.bg = raw.bg.toLowerCase(); }
  if ("ink" in raw) { if (!INKS.includes(raw.ink)) return { error: "ink must be light or dark" }; out.ink = raw.ink; }
  if ("align" in raw) { if (!ALIGNS.includes(raw.align)) return { error: "align must be left, center or right" }; out.align = raw.align; }
  return { style: out };
}

// The style half of a stored caption ({ text, ...style } -> { ...style }).
export const styleOf = ({ text, ...style }) => style;   // eslint-disable-line no-unused-vars

// Every caption on a moment, in paint order, whatever shape it was stored in:
// the `captions` list when there is one, else the single `caption` +
// `captionStyle` that 0.13.0 wrote.
export function captionsOf(m) {
  const list = Array.isArray(m?.captions) ? m.captions : null;
  if (list?.length) {
    return list
      .filter((c) => c && typeof c.text === "string" && c.text.trim())
      .slice(0, MAX_CAPTIONS)
      .map((c) => ({ text: c.text.trim(), ...normalizeStyle(c) }));
  }
  const text = typeof m?.caption === "string" ? m.caption.trim() : "";
  return text ? [{ text, ...normalizeStyle(m?.captionStyle) }] : [];
}

// Strict, for the server. An entry with no text is not a caption and is dropped;
// anything else wrong is an error naming the entry.
export function validateCaptions(raw) {
  if (!Array.isArray(raw)) return { error: "must be an array" };
  if (raw.length > MAX_CAPTIONS) return { error: `at most ${MAX_CAPTIONS} captions on one photo` };
  const captions = [];
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { error: `[${i}] must be an object` };
    if (typeof item.text !== "string") return { error: `[${i}].text must be a string` };
    const text = item.text.trim().slice(0, MAX_CAPTION_TEXT);
    if (!text) continue;
    const { style, error } = validateStyle(item);
    if (error) return { error: `[${i}]: ${error}` };
    captions.push({ text, ...style });
  }
  return { captions };
}

// Where a new caption should land: the first one where the single one used to
// sit, each next one a step above the last, wearing the same face -- a series
// on one photo should look like a series.
export function nextCaption(existing = [], text = "") {
  const last = existing[existing.length - 1];
  if (!last) return { text, ...DEFAULT_STYLE };
  const style = normalizeStyle(last);
  return { text, ...style, y: +clamp(style.y - 0.14, Y_RANGE).toFixed(4), rot: 0 };
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
    `--cap-x:${(s.x * 100).toFixed(2)}%`, `--cap-y:${(s.y * 100).toFixed(2)}%`, `--cap-rot:${s.rot}deg`,
    `--cap-font:${f.family}`, `--cap-weight:${f.weight}`, `--cap-style:${f.italic ? "italic" : "normal"}`, `--cap-size:${(SIZES[s.size] * (f.scale ?? 1)).toFixed(3)}`,
    `--cap-transform:${f.upper ? "uppercase" : "none"}`, `--cap-spacing:${f.spacing ?? "normal"}`,
    `--cap-align:${s.align}`, `--cap-leading:${f.leading ?? 1.28}`, `--cap-bg:${bg}`, `--cap-ink:${ink}`, `--cap-shadow:${shadow}`, `--cap-pad:${pad}`,
  ].join(";");
}
