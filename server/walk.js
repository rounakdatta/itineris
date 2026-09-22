// How far it actually was between two stops, and which way the walk went.
//
// Google's Routes API, server-side, once per pair of points, cached on the
// volume and published with the gallery. The browser never calls it: a viewer
// opening a gallery costs nothing, and a leg is looked up once however many
// people see it.
//
// The LEGACY Directions API is not enabled on this project and will not be --
// Google's own reply to it says to use the Routes API instead, which is what
// this is. The same key the Places lookups use (Places API New), so there is
// one key to keep alive rather than two.

const ENDPOINT = process.env.ITINERIS_ROUTES_ENDPOINT ?? "https://routes.googleapis.com/directions/v2:computeRoutes";
// Just the two things worth publishing. A field mask is required, and asking
// for less is the difference between a cheap request and an expensive one.
export const ROUTE_MASK = "routes.distanceMeters,routes.polyline.encodedPolyline";

// Far enough apart that a walking route is not a sensible question -- somebody
// flew, or took a train across the country. The thread still draws; it just
// does not pretend anybody walked it.
export const MAX_WALK_M = 25_000;

export async function walkBetween(from, to, { key, fetch: f = globalThis.fetch, endpoint = ENDPOINT, timeout = 8000 } = {}) {
  if (!key) return null;
  for (const p of [from, to]) if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng)) return null;
  const body = {
    origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
    destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
    travelMode: "WALK",
    // Nothing here is time-critical and the number should be stable between
    // one viewer and the next, so no live traffic and no departure time.
    languageCode: "en",
    units: "METRIC",
  };
  const res = await f(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key, "x-goog-fieldmask": ROUTE_MASK },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    let msg = ""; try { msg = (await res.json())?.error?.message ?? ""; } catch { /* no body */ }
    throw Object.assign(new Error(`Routes API ${res.status}${msg ? `: ${msg}` : ""}`), { status: res.status });
  }
  const route = (await res.json())?.routes?.[0];
  const m = route?.distanceMeters, p = route?.polyline?.encodedPolyline;
  // No walking route between these two points (across water, or nothing
  // Google will route on foot). That is an answer, not a failure: remember it
  // so the sweep does not ask again every six hours.
  if (!Number.isFinite(m) || typeof p !== "string" || !p) return { m: null, p: null, at: new Date().toISOString() };
  return { m, p, at: new Date().toISOString() };
}
