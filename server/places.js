// What Google knows about a place -- rating, how many rated it, what kind of
// place it is, the canonical Google Maps link -- looked up ONCE per place on
// the server (Places API (New) Text Search, biased to the photo's spot) and
// published with the gallery, so visitors never call Google for it. Google's
// terms: place IDs may be kept forever, everything else for 30 days -- hence
// the monthly refresh. Free tier is 1,000 such lookups a month.
const ENDPOINT = process.env.ITINERIS_PLACES_ENDPOINT ?? "https://places.googleapis.com/v1/places:searchText";
export const FIELD_MASK = "places.id,places.displayName,places.rating,places.userRatingCount,places.primaryTypeDisplayName,places.googleMapsUri,places.location";
export const MAX_DISTANCE_M = 300;   // a match further than this from the photo is a different place
export const STALE_DAYS = 29;

export function distanceM(a, b) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Resolves to the place, to `null` when Google has nothing plausible nearby,
// and rejects with an Error carrying `status` when the API refuses (key,
// billing, API not enabled): callers stop the batch on those.
export async function lookupPlace({ name, lat, lng }, { key, fetch: f = globalThis.fetch, endpoint = ENDPOINT, timeout = 8000 } = {}) {
  const query = (name ?? "").trim();
  if (!key || !query) return null;
  const located = Number.isFinite(lat) && Number.isFinite(lng);
  const body = { textQuery: query, maxResultCount: 3, languageCode: "en", ...(located ? { locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 500 } } } : {}) };
  const res = await f(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key, "x-goog-fieldmask": FIELD_MASK }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  if (!res.ok) {
    let msg = ""; try { msg = (await res.json())?.error?.message ?? ""; } catch { /* no body */ }
    throw Object.assign(new Error(`Places API ${res.status}${msg ? `: ${msg}` : ""}`), { status: res.status });
  }
  const { places = [] } = await res.json();
  const near = places.find((p) => !located || (p.location && distanceM({ lat, lng }, { lat: p.location.latitude, lng: p.location.longitude }) <= MAX_DISTANCE_M));
  if (!near?.id) return null;
  return {
    placeId: near.id,
    name: near.displayName?.text ?? null,
    rating: Number.isFinite(near.rating) ? near.rating : null,
    ratingCount: Number.isFinite(near.userRatingCount) ? near.userRatingCount : null,
    type: near.primaryTypeDisplayName?.text ?? null,
    mapsUri: near.googleMapsUri ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

export const isStale = (g, now = Date.now()) => !g?.fetchedAt || now - Date.parse(g.fetchedAt) > STALE_DAYS * 86400e3;
// A placed, named photo that was never looked up (google absent), or whose
// lookup is older than Google lets us keep it. `google: {placeId: null}` is a
// remembered "nothing there", retried monthly like everything else.
export const needsLookup = (m, now = Date.now()) =>
  (m.media?.type ?? "photo") === "photo" && Number.isFinite(m.lat) && Number.isFinite(m.lng) && !!(m.place ?? "").trim() && (m.google === undefined || isStale(m.google, now));
