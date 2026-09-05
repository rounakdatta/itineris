// Generates a seed trip so the UI is buildable before any real ingest exists.
// The shapes written here are the contract: swap the files, keep the schema.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = (p) => resolve(root, p);

const PLACES = {
  chinatown:   { name: "Chinatown",              lat: 1.2829, lng: 103.8443 },
  maxwell:     { name: "Maxwell Food Centre",    lat: 1.2803, lng: 103.8449 },
  laupasat:    { name: "Lau Pa Sat",             lat: 1.2807, lng: 103.8504 },
  merlion:     { name: "Merlion Park",           lat: 1.2868, lng: 103.8545 },
  mbs:         { name: "Marina Bay Sands",       lat: 1.2834, lng: 103.8607 },
  gardens:     { name: "Gardens by the Bay",     lat: 1.2816, lng: 103.8636 },
  sentosa:     { name: "Siloso Beach",           lat: 1.2560, lng: 103.8110 },
  eastcoast:   { name: "East Coast Park",        lat: 1.3010, lng: 103.9120 },
  littleindia: { name: "Little India",           lat: 1.3067, lng: 103.8517 },
  tiongbahru:  { name: "Tiong Bahru",            lat: 1.2857, lng: 103.8270 },
  botanic:     { name: "Botanic Gardens",        lat: 1.3138, lng: 103.8159 },
  hajilane:    { name: "Haji Lane",              lat: 1.3016, lng: 103.8590 },
  jewel:       { name: "Jewel Changi",           lat: 1.3601, lng: 103.9890 },
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

const jitter = (n, amt) => n + (Math.random() - 0.5) * amt;

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
const PALETTES = [
  ["#0f2027", "#2c5364"], ["#42275a", "#734b6d"], ["#1f4037", "#99f2c8"],
  ["#414d0b", "#727a17"], ["#5f2c82", "#49a09d"], ["#232526", "#414345"],
  ["#3a1c71", "#d76d77"], ["#134e5e", "#71b280"], ["#4b1248", "#f0c27b"],
];
const esc = (s) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

mkdirSync(out("public/media"), { recursive: true });
moments.forEach((m, i) => {
  const [a, b] = PALETTES[i % PALETTES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">
    <stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/>
  </linearGradient></defs>
  <rect width="1080" height="1920" fill="url(#g)"/>
  <circle cx="820" cy="430" r="230" fill="#fff" opacity="0.06"/>
  <circle cx="240" cy="1380" r="330" fill="#fff" opacity="0.05"/>
  <text x="72" y="1660" fill="#fff" opacity="0.95" font-family="system-ui,sans-serif" font-size="58" font-weight="600">${esc(m.place)}</text>
  <text x="72" y="1732" fill="#fff" opacity="0.6" font-family="system-ui,sans-serif" font-size="38">${esc(m.id)} &#183; ${esc(m.tags.join(", "))}</text>
</svg>`;
  writeFileSync(out(`public/media/${m.id}.svg`), svg);
});

mkdirSync(out("public/data"), { recursive: true });
writeFileSync(out("public/data/moments.json"), JSON.stringify(moments, null, 2));
writeFileSync(out("public/data/tracks.json"), JSON.stringify(tracks, null, 2));
console.log(`seeded ${moments.length} moments, ${tracks.length} tracks, ${moments.length} placeholder media`);
