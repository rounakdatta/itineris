// Generates a seed trip so the UI is buildable before any real ingest exists.
// The shapes written here are the contract: swap the files, keep the schema.
import { writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { materializeGallery } from "../server/store.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = (p) => resolve(root, p);

const PLACES = {
  chinatown:   { name: "Chinatown",              lat: 1.2829, lng: 103.8443 },
  maxwell:     { name: "Maxwell Food Centre",    lat: 1.2803, lng: 103.8449, google: { placeId: "ChIJseedmaxwell", rating: 4.4, ratingCount: 12873, type: "Hawker centre" } },
  laupasat:    { name: "Lau Pa Sat",             lat: 1.2807, lng: 103.8504, google: { placeId: "ChIJseedlaupasat", rating: 4.3, ratingCount: 24154, type: "Hawker centre" } },
  merlion:     { name: "Merlion Park",           lat: 1.2868, lng: 103.8545 },
  mbs:         { name: "Marina Bay Sands",       lat: 1.2834, lng: 103.8607, google: { placeId: "ChIJseedmbs", rating: 4.6, ratingCount: 56321, type: "Hotel" } },
  gardens:     { name: "Gardens by the Bay",     lat: 1.2816, lng: 103.8636, google: { placeId: "ChIJseedgardens", rating: 4.7, ratingCount: 98032, type: "Garden" } },
  sentosa:     { name: "Siloso Beach",           lat: 1.2560, lng: 103.8110 },
  eastcoast:   { name: "East Coast Park",        lat: 1.3010, lng: 103.9120 },
  littleindia: { name: "Little India",           lat: 1.3067, lng: 103.8517 },
  tiongbahru:  { name: "Tiong Bahru",            lat: 1.2857, lng: 103.8270 },
  botanic:     { name: "Botanic Gardens",        lat: 1.3138, lng: 103.8159 },
  hajilane:    { name: "Haji Lane",              lat: 1.3016, lng: 103.8590 },
  jewel:       { name: "Jewel Changi",           lat: 1.3601, lng: 103.9890, google: { placeId: "ChIJseedjewel", rating: 4.7, ratingCount: 34210, type: "Shopping mall" } },
};

// tags are AUTHORED, never inferred. this is just the seed author's set.
const M = [
  ["2026-03-14T08:40+08:00", "chinatown",   ["food"],                 "Kaya toast and kopi-o at a corner shophouse"],
  ["2026-03-14T09:25+08:00", "chinatown",   ["experience"],           "Incense coils at Thian Hock Keng"],
  ["2026-03-14T12:10+08:00", "maxwell",     ["food"],                 "Tian Tian chicken rice. Worth the queue."],
  ["2026-03-14T15:30+08:00", "tiongbahru",  ["experience", "coffee"], "Art deco walkups and a very good flat white"],
  ["2026-03-14T19:45+08:00", "laupasat",    ["food", "night"],        "Satay street after the road closes"],
  ["2026-03-15T06:35+08:00", "merlion",     ["run"],                  "Sunrise over the bay, empty promenade"],
  ["2026-03-15T07:05+08:00", "mbs",         ["run"],                  "Halfway. Legs fine, humidity brutal."],
  ["2026-03-15T10:20+08:00", "gardens",     ["experience", "nature"], "Supertrees from underneath"],
  ["2026-03-15T13:00+08:00", "gardens",     ["food"],                 "Laksa at Satay by the Bay"],
  ["2026-03-15T19:50+08:00", "mbs",         ["experience", "night"],  "Spectra light show from the boardwalk"],
  ["2026-03-16T07:10+08:00", "eastcoast",   ["cycle"],                "Rented a bike at Bedok jetty"],
  ["2026-03-16T08:15+08:00", "eastcoast",   ["cycle", "nature"],      "Casuarina trees the whole way out"],
  ["2026-03-16T09:30+08:00", "eastcoast",   ["food"],                 "Breakfast stop: carrot cake, black"],
  ["2026-03-16T14:00+08:00", "sentosa",     ["experience"],           "Siloso, and the water is bathwater-warm"],
  ["2026-03-16T18:40+08:00", "sentosa",     ["nature"],               "Sunset from the boardwalk back"],
  ["2026-03-17T09:15+08:00", "botanic",     ["nature", "experience"], "Orchid garden before the heat"],
  ["2026-03-17T12:30+08:00", "littleindia", ["food"],                 "Banana leaf, too much of it"],
  ["2026-03-17T15:00+08:00", "littleindia", ["experience"],           "Tekka market, upstairs fabric stalls"],
  ["2026-03-17T17:20+08:00", "hajilane",    ["experience", "coffee"], "Murals and an iced kopi to finish"],
  ["2026-03-18T11:00+08:00", "jewel",       ["experience"],           "The Rain Vortex, on the way out"],
];

// Deterministic jitter (mulberry32) so every build and both images produce
// byte-identical seed data.
let rngState = 0x17153415 >>> 0;
const rand = () => { rngState = (rngState + 0x6d2b79f5) >>> 0; let t = rngState; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const jitter = (n, amt) => n + (rand() - 0.5) * amt;

function leg(from, to, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    pts.push([
      +jitter(from.lng + (to.lng - from.lng) * f, 0.0016).toFixed(6),
      +jitter(from.lat + (to.lat - from.lat) * f, 0.0016).toFixed(6),
    ]);
  }
  return pts;
}

function route(keys, perLeg = 14) {
  const g = [];
  for (let i = 0; i < keys.length - 1; i++) {
    g.push(...leg(PLACES[keys[i]], PLACES[keys[i + 1]], perLeg));
  }
  return g;
}

const moments = M.map(([t, placeKey, tags, caption], i) => {
  const p = PLACES[placeKey];
  const id = "m" + String(i + 1).padStart(3, "0");
  return {
    id,
    t,
    lat: +jitter(p.lat, 0.0018).toFixed(6),
    lng: +jitter(p.lng, 0.0018).toFixed(6),
    place: p.name,
    placeId: placeKey,
    caption,
    tags,
    media: { type: "photo", src: `media/${id}.svg`, w: 1080, h: 1920 },
    // Seed "Google" details are obviously fake and dated so a server with a key
    // replaces them with the real thing on first boot.
    ...(p.google ? { google: { ...p.google, mapsUri: null, fetchedAt: "2026-01-01T00:00:00Z" } } : {}),
  };
});

const tracks = [
  {
    id: "t001", mode: "run", name: "Marina Bay loop",
    t0: "2026-03-15T06:30+08:00", t1: "2026-03-15T07:18+08:00",
    stats: { distance_km: 7.8, elevation_m: 24, duration_min: 48 },
    geometry: route(["merlion", "mbs", "gardens", "mbs", "merlion"], 18),
  },
  {
    id: "t002", mode: "cycle", name: "East Coast Park out-and-back",
    t0: "2026-03-16T07:00+08:00", t1: "2026-03-16T09:40+08:00",
    stats: { distance_km: 24.3, elevation_m: 61, duration_min: 160 },
    geometry: route(["eastcoast", "jewel", "eastcoast"], 26),
  },
  {
    id: "t003", mode: "walk", name: "Chinatown wander",
    t0: "2026-03-14T08:30+08:00", t1: "2026-03-14T12:30+08:00",
    stats: { distance_km: 5.1, elevation_m: 12, duration_min: 240 },
    geometry: route(["chinatown", "maxwell", "tiongbahru", "laupasat"], 12),
  },
];

// Placeholder media so the story viewer has something with real dimensions.
//
// COMPOSITION CONSTRAINT: these are authored 9:16, but the wall cells and the
// timeline ticks are both 3:4 with `object-fit: cover`. Covering 9:16 into 3:4
// scales to width, so only the middle 1440px is ever on screen -- everything
// that identifies the frame has to live inside y 240..1680. (The previous
// version put its caption at y 1660-1732 and it got cropped to a sliver, which
// is what made the wall read as flat colour swatches.)
const SAFE_TOP = 240;
const SAFE_BOTTOM = 1680;

// Keyed off tags[0] -- the same field the map colours its dots by -- so a tile
// on the wall and its marker on the map read as the same thing.
const TAG_PALETTE = {
  food:       ["#2b1408", "#e8752f", "#ffc98a"],
  experience: ["#221443", "#8a5cd6", "#e3cdff"],
  nature:     ["#0b2f24", "#2f9e79", "#a8ecd3"],
  run:        ["#2e0f1d", "#e0426f", "#ffb3c9"],
  cycle:      ["#072b28", "#2fa896", "#a5ead9"],
  coffee:     ["#241811", "#b3814e", "#eccfab"],
  night:      ["#070c22", "#3f5ea8", "#b9caf5"],
};

const esc = (s) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

// A ridge line across the full width, filled down to the bottom edge.
const ridge = (y, amp, phase) => {
  const pts = [];
  for (let x = 0; x <= 1080; x += 120) {
    pts.push(`${x},${Math.round(y + Math.sin((x / 1080) * Math.PI * 2 + phase) * amp)}`);
  }
  return `M${pts.join(" L")} L1080,1920 L0,1920 Z`;
};

function placeholder(m, i) {
  const [deep, mid, light] = TAG_PALETTE[m.tags[0]] ?? TAG_PALETTE.experience;
  const isNight = m.tags.includes("night");

  // Deterministic per-moment variation, so reseeding doesn't reshuffle the art.
  const horizon = 1150 + ((i * 47) % 140);
  const sunX = 190 + ((i * 173) % 700);
  const sunY = horizon - 360 - ((i * 61) % 170);

  const stars = isNight
    ? Array.from({ length: 26 }, (_, s) => {
        const x = (s * 331) % 1060 + 10;
        const y = SAFE_TOP + ((s * 197) % (horizon - SAFE_TOP - 120));
        const r = 3 + ((s * 7) % 4);
        return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${(0.25 + ((s * 13) % 50) / 100).toFixed(2)}"/>`;
      }).join("")
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="${deep}"/>
      <stop offset="58%" stop-color="${mid}"/>
      <stop offset="100%" stop-color="${light}"/>
    </linearGradient>
    <radialGradient id="glow">
      <stop offset="0%" stop-color="#fff" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.62"/>
    </linearGradient>
  </defs>

  <rect width="1080" height="1920" fill="url(#sky)"/>
  ${stars}
  <circle cx="${sunX}" cy="${sunY}" r="430" fill="url(#glow)"/>
  <circle cx="${sunX}" cy="${sunY}" r="${isNight ? 74 : 104}" fill="#fff" opacity="${isNight ? 0.82 : 0.94}"/>

  <path d="${ridge(horizon, 46, i * 0.7)}" fill="${deep}" opacity="0.45"/>
  <path d="${ridge(horizon + 118, 62, i * 0.7 + 2.1)}" fill="${deep}" opacity="0.72"/>
  <path d="${ridge(horizon + 268, 38, i * 0.7 + 4.2)}" fill="${deep}" opacity="0.92"/>

  <rect y="1180" width="1080" height="740" fill="url(#scrim)"/>
  <!--
    Baseline sits clear of y~1525, where the wall cell and timeline tick paint
    their own time overlay. One line only: the id/tag line that used to live
    here landed right on top of that clock.
  -->
  <text x="140" y="${SAFE_BOTTOM - 240}" fill="#fff" opacity="0.97" font-family="system-ui,-apple-system,sans-serif" font-size="80" font-weight="600">${esc(m.place)}</text>
</svg>`;
}

// Everything lands under seed/ -- the single source both images copy from --
// and the PUBLIC parts are mirrored into public/ so `vite dev` serves them.
const GALLERY = {
  id: "sg2026demo", title: "Singapore, March 2026",
  description: "Five days: hawker centres, a bay run, an East Coast ride.",
  home: true, momentIds: moments.map((m) => m.id), trackIds: tracks.map((t) => t.id),
  createdAt: "2026-03-18T12:00:00+08:00", updatedAt: "2026-03-18T12:00:00+08:00",
};
rmSync(out("seed"), { recursive: true, force: true });
for (const d of ["seed/library", "seed/data/galleries", "seed/media"]) mkdirSync(out(d), { recursive: true });

// Two moments are real raster photos with the three copies the server makes
// (400/960/1600), so tests exercise the thumbnail -> medium -> large path,
// slow-network behaviour, and -- with the landscape one -- how a photo is
// composited over its blurred backdrop. Deterministic: LCG noise over a
// gradient, in 16 px blocks so the texture survives downscaling and a
// screenshot can tell "sharp" from "blurred" by adjacent-pixel contrast.
async function rasterPhoto(m, { w, h, seed }) {
  const px = Buffer.alloc(w * h * 3);
  let st = seed >>> 0;
  const rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 4294967296);
  const bw = Math.ceil(w / 16), bh = Math.ceil(h / 16);
  const blocks = Float32Array.from({ length: bw * bh }, () => (rnd() - 0.5) * 140);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3, n = blocks[(y >> 4) * bw + (x >> 4)] + (rnd() - 0.5) * 30;
    px[i] = Math.max(0, Math.min(255, 60 + (x / w) * 110 + n));
    px[i + 1] = Math.max(0, Math.min(255, 110 + (y / h) * 80 + n));
    px[i + 2] = Math.max(0, Math.min(255, 170 - (y / h) * 60 + n));
  }
  const base = sharp(px, { raw: { width: w, height: h, channels: 3 } });
  const sizes = { 1600: 82, 960: 80, 400: 74 };
  const info = {};
  for (const [size, quality] of Object.entries(sizes)) {
    info[size] = await base.clone().resize({ width: +size, height: +size, fit: "inside", withoutEnlargement: true }).webp({ quality }).toFile(out(`seed/media/${m.id}-${size}.webp`));
  }
  m.media = { type: "photo", src: `media/${m.id}-1600.webp`, w: info[1600].width, h: info[1600].height, medium: `media/${m.id}-960.webp`, thumb: `media/${m.id}-400.webp` };
}
await rasterPhoto(moments[12], { w: 1200, h: 1600, seed: 20260314 });   // portrait
await rasterPhoto(moments[4], { w: 1600, h: 1200, seed: 20260315 });    // landscape
moments.forEach((m, i) => { if (m.media.src.endsWith(".svg")) writeFileSync(out(`seed/media/${m.id}.svg`), placeholder(m, i)); });
writeFileSync(out("seed/library/moments.json"), JSON.stringify(moments, null, 2) + "\n");
writeFileSync(out("seed/library/tracks.json"), JSON.stringify(tracks, null, 2) + "\n");
writeFileSync(out("seed/library/galleries.json"), JSON.stringify([GALLERY], null, 2) + "\n");
writeFileSync(out("seed/data/home.json"), JSON.stringify({ gallery: GALLERY.id }, null, 2) + "\n");
writeFileSync(out(`seed/data/galleries/${GALLERY.id}.json`), JSON.stringify(materializeGallery(GALLERY, moments, tracks), null, 2) + "\n");

for (const d of ["public/data", "public/media"]) rmSync(out(d), { recursive: true, force: true });
cpSync(out("seed/data"), out("public/data"), { recursive: true });
cpSync(out("seed/media"), out("public/media"), { recursive: true });
console.log(`seeded ${moments.length} moments, ${tracks.length} tracks, 1 gallery (${GALLERY.id}, home) -> seed/ and public/`);
