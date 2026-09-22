// The walk between places: a dotted thread from one stop to the next, with how
// far it was.
//
// It is a CONNECTOR, not a routed path. A real pavement-following route needs
// a billable directions service and a server-side cache, and what it would buy
// is the shape of the street rather than the shape of the day. The thread says
// "and then we walked over here", which is the thing a person reading somebody
// else's trip actually wants; the distance is honest about being the distance
// between the two points. If routed geometry is ever added, it drops straight
// in: a leg is already just a list of points.

import { hasCoords, placeKey } from "./data.js";

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

// A leg per hop. Zero-length hops are dropped: two places that resolve to the
// same spot would draw a dot on a dot and label it "0 m".
export function legsOf(moments) {
  const stops = stopsOf(moments);
  const legs = [];
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1], to = stops[i];
    const metres = metresBetween(from, to);
    if (!(metres > 1)) continue;
    legs.push({
      id: `${from.key}→${to.key}#${i}`,
      from, to, metres,
      label: prettyDistance(metres),
      mid: { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 },
    });
  }
  return legs;
}

// One GeoJSON feature per leg, for the engine that draws from a source.
export const legsFC = (legs) => ({
  type: "FeatureCollection",
  features: legs.map((l) => ({
    type: "Feature",
    id: l.id,
    properties: { label: l.label, metres: Math.round(l.metres) },
    geometry: { type: "LineString", coordinates: [[l.from.lng, l.from.lat], [l.to.lng, l.to.lat]] },
  })),
});
