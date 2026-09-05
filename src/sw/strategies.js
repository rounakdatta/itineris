// Pure decisions for the service workers, kept free of `self` so they can be
// unit-tested. Which cache a request belongs to, how a map tile is keyed, and
// which tiles cover a gallery.

// Carto hands out tiles round-robin across tiles-a..d; one cache key per tile
// or an offline map would miss three times out of four.
export const TILE_HOSTS = /^https:\/\/(tiles(-[a-d])?\.basemaps\.cartocdn\.com|basemaps\.cartocdn\.com)\//;
export const normalizeTileKey = (url) => url.replace(/^https:\/\/tiles-[a-d]\.basemaps\.cartocdn\.com\//, "https://tiles-a.basemaps.cartocdn.com/");

// -> "shell" | "data" | "media" | "tiles" | "navigation" | "network"
export function classify(url, { origin, scope = "/", dataPrefixes = [], apiPaths = [] }) {
  const u = new URL(url, origin);
  if (u.origin !== origin) return TILE_HOSTS.test(u.href) ? "tiles" : "network";
  const p = u.pathname;
  if (p.startsWith("/media/")) return "media";                       // shared by both apps
  if (!p.startsWith(scope)) return "network";
  if (scope === "/" && p.startsWith("/admin")) return "network";     // the admin has its own worker
  if (p.startsWith(`${scope}assets/`) || p === `${scope}sw.js` || /\.(webmanifest|png|svg|ico)$/.test(p)) return "shell";
  if (dataPrefixes.some((d) => p.startsWith(d))) return "data";
  if (apiPaths.some((a) => p === a)) return "data";
  if (p.startsWith(`${scope}api/`)) return "network";
  return "navigation";
}

// Slippy-map maths.
const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
const clampLat = (lat) => Math.max(-85.05, Math.min(85.05, lat));

// Zoom at which a bbox roughly fits a phone-width viewport.
export function zoomToFit([w, s, e, n], px = 390) {
  const spanLon = Math.max(1e-6, e - w), spanLat = Math.max(1e-6, n - s);
  const z = Math.min(Math.log2((360 / spanLon) * (px / 256)), Math.log2((170 / spanLat) * (px / 256)));
  return Math.max(0, Math.min(14, Math.floor(z)));
}

// Every tile covering the bbox from zmin to zmax, stopping at the zoom where the
// count would exceed `cap` (a city-scale trip is a few hundred tiles at z14).
export function tilesFor([w, s, e, n], zmin, zmax, cap = 2500) {
  const tiles = [];
  let stoppedAt = null;
  for (let z = zmin; z <= zmax; z++) {
    const max = 2 ** z - 1;
    const x0 = Math.max(0, lon2x(w, z)), x1 = Math.min(max, lon2x(e, z)), y0 = Math.max(0, lat2y(clampLat(n), z)), y1 = Math.min(max, lat2y(clampLat(s), z));
    const count = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (tiles.length + count > cap) { stoppedAt = z; break; }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push({ z, x, y });
  }
  return { tiles, stoppedAt };
}
export const fillTemplate = (t, { z, x, y }) => t.replace("{z}", z).replace("{x}", x).replace("{y}", y);
