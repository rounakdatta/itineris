// The walk between places: a dotted thread from one stop to the next, with how
// far it actually was.
//
// "How far" means the WALK, not the gap. The first version of this drew a
// straight line and labelled it with the distance between the two points,
// which is displacement, not distance -- on a street grid the real walk is
// routinely a third longer, and a number that is confidently wrong is worse
// than no number. Walking routes are fetched once, server-side, and published
// with the gallery (see server/walk.js); this module is the geometry both map
// engines share.
//
// Until a leg has been routed it still draws -- the sequence is worth showing
// -- as a straight thread with NO distance on it. An unrouted leg says
// nothing rather than something untrue.

import { hasCoords, placeKey } from "./place.js";

const R = 6371008.8;   // mean Earth radius, metres
const rad = (d) => (d * Math.PI) / 180;

// Great-circle distance in metres. Haversine rather than equirectangular
// because a trip can cross a lot of latitude and being wrong about a flight is
// as bad as being wrong about a walk.
export function metresBetween(a, b) {
  if (!a || !b) return 0;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// "0.4 km" -- kilometres to one decimal, which is how people say a walk. Metres
// only under 100, where "0.1 km" would be both uglier and less precise, and
// whole kilometres over ten, where the decimal is noise.
export function prettyDistance(metres) {
  const m = Number(metres);
  if (!Number.isFinite(m) || m < 0) return "";
  if (m < 100) return `${Math.round(m / 10) * 10} m`;
  const km = m / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

// The stops in the order they were visited, one entry per place, consecutive
// repeats collapsed -- going A, B, A is three stops and two legs, because that
// is what happened.
export function stopsOf(moments) {
  const placed = moments.filter(hasCoords).slice().sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const stops = [];
  for (const m of placed) {
    const key = placeKey(m);
    const last = stops[stops.length - 1];
    if (last && last.key === key) continue;
    stops.push({ key, lat: m.lat, lng: m.lng, name: (m.place ?? "").trim(), at: m.t });
  }
  return stops;
}

// The cache key for one hop. Five decimals is about a metre -- close enough
// that two photos at the same doorway share a lookup, far enough that two ends
// of a street do not.
const round5 = (n) => Math.round(n * 1e5) / 1e5;
export const walkKey = (from, to) => `${round5(from.lat)},${round5(from.lng)}>${round5(to.lat)},${round5(to.lng)}`;

// Google's encoded polyline, back into coordinates. Published encoded because
// a routed walk is a hundred points and a gallery is a dozen walks: the string
// is a tenth of the size, and the decoder is twenty lines.
export function decodePolyline(encoded) {
  const out = [];
  if (typeof encoded !== "string" || !encoded) return out;
  let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0, shift = 0, b;
      do {
        b = encoded.charCodeAt(i++) - 63;
        if (Number.isNaN(b)) return out;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += d; else lng += d;
    }
    out.push([lng / 1e5, lat / 1e5]);
  }
  return out;
}

// The places in the order they were first reached, numbered from one.
//
// A place visited twice keeps its FIRST number: the pin is one pin, and "this
// was the third stop" is a thing you can say about a place, while "this was
// the third and the seventh" is not something anybody wants on a badge. The
// thread still shows the return trip.
//
// Computed over whatever is currently shown, so narrowing the selection
// renumbers the stops to match the threads that remain.
export function stopOrder(moments) {
  const order = new Map();
  const placed = moments.filter(hasCoords).slice().sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  for (const m of placed) {
    const key = placeKey(m);
    if (!order.has(key)) order.set(key, order.size + 1);
  }
  return order;
}

// The numbered stops as points, for the engine that draws from a source.
export const stopsFC = (moments) => {
  const order = stopOrder(moments);
  const seen = new Set();
  const features = [];
  for (const s of stopsOf(moments)) {
    if (seen.has(s.key)) continue;
    seen.add(s.key);
    features.push({
      type: "Feature",
      id: s.key,
      properties: { key: s.key, n: order.get(s.key), label: String(order.get(s.key)) },
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
    });
  }
  return { type: "FeatureCollection", features };
};

// A leg per hop. Zero-length hops are dropped: two places that resolve to the
// same spot would draw a dot on a dot and label it "0 m".
//
// `walks` is what the server managed to route, keyed by walkKey. A leg with a
// walk follows the streets and says how far that was; a leg without one is a
// straight thread and says nothing.
export function legsOf(moments, walks = {}) {
  const stops = stopsOf(moments);
  const legs = [];
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1], to = stops[i];
    if (!(metresBetween(from, to) > 1)) continue;
    const walk = walks?.[walkKey(from, to)] ?? null;
    const path = walk?.p ? decodePolyline(walk.p) : null;
    const routed = !!(walk && Number.isFinite(walk.m) && path && path.length > 1);
    legs.push({
      id: `${from.key}→${to.key}#${i}`,
      from, to,
      routed,
      metres: routed ? walk.m : metresBetween(from, to),
      // Only a routed leg carries a number. Displacement labelled as distance
      // is the thing this replaced.
      label: routed ? prettyDistance(walk.m) : "",
      path: routed ? path : [[from.lng, from.lat], [to.lng, to.lat]],
      mid: routed ? midOf(path) : { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 },
    });
  }
  return legs;
}

// Halfway ALONG the path, by distance -- not the midpoint of the straight line,
// which on a dog-leg route lands in the middle of a block the walk never went
// near.
export function midOf(path) {
  if (!path?.length) return { lat: 0, lng: 0 };
  let total = 0;
  const seg = [];
  for (let i = 1; i < path.length; i++) {
    const d = metresBetween({ lat: path[i - 1][1], lng: path[i - 1][0] }, { lat: path[i][1], lng: path[i][0] });
    seg.push(d); total += d;
  }
  let run = 0;
  for (let i = 0; i < seg.length; i++) {
    if (run + seg[i] >= total / 2) {
      const f = seg[i] > 0 ? (total / 2 - run) / seg[i] : 0;
      const a = path[i], b = path[i + 1];
      return { lat: a[1] + (b[1] - a[1]) * f, lng: a[0] + (b[0] - a[0]) * f };
    }
    run += seg[i];
  }
  const last = path[path.length - 1];
  return { lat: last[1], lng: last[0] };
}

// One GeoJSON feature per leg, for the engine that draws from a source.
export const legsFC = (legs) => ({
  type: "FeatureCollection",
  features: legs.map((l) => ({
    type: "Feature",
    id: l.id,
    properties: { label: l.label, metres: Math.round(l.metres), routed: l.routed },
    geometry: { type: "LineString", coordinates: l.path },
  })),
});

// --- how the thread is drawn ------------------------------------------------
// One identity for both engines, so a colour cannot be right on one map and
// invisible on the other. White shipped once and scored a contrast ratio of
// 1.1 against Google's real tiles -- the line was not faint, it was absent --
// so this is measured, not chosen by eye. See tests/route.test.js, which holds
// the basemap samples and fails anything that does not clear the floor.
export const LEG_INK = "#b45309";      // deep amber: the one candidate that cleared 3.0 on every basemap
export const LEG_CASING = "#ffffff";   // a rim, because contrast against the AVERAGE background is not contrast against all of it
export const LEG_LABEL_INK = "#ffe8c7";

// The backgrounds this has to survive, sampled off a real screenshot of the
// deployed map (47% of it was the first of these) and off the dark style.
export const BASEMAPS = {
  googleLand: [240, 240, 240],
  googleRoad: [255, 255, 255],
  googlePark: [200, 225, 200],
  googleWater: [170, 210, 230],
  maplibreDark: [26, 29, 35],
};

const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lumaOf = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrast = (a, b) => {
  const l1 = lumaOf(a), l2 = lumaOf(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};
export const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
