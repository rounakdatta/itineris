// Where a photo was taken, when the file cannot say. Phones strip GPS from
// photos handed to a website, so the admin offers two substitutes: the place's
// name (OpenStreetMap's Nominatim, one request per search, never per keystroke
// -- its usage policy) and the device's own position (usually right when
// photos are uploaded from where they were taken).

export async function searchPlaces(q, { fetch: f = globalThis.fetch, lang = "en" } = {}) {
  const query = q.trim();
  if (!query) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=${encodeURIComponent(lang)}&q=${encodeURIComponent(query)}`;
  const r = await f(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`Place search failed (${r.status})`);
  const rows = await r.json();
  return rows
    .filter((x) => Number.isFinite(+x.lat) && Number.isFinite(+x.lon))
    .map((x) => ({ lat: +(+x.lat).toFixed(6), lng: +(+x.lon).toFixed(6), name: x.name || String(x.display_name ?? "").split(",")[0].trim(), label: String(x.display_name ?? "") }));
}

export function currentPosition({ geo = globalThis.navigator?.geolocation, timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!geo) return reject(new Error("This device can't share its location"));
    geo.getCurrentPosition(
      (p) => resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), accuracy: Math.round(p.coords.accuracy ?? 0) }),
      (e) => reject(new Error(e?.code === 1 ? "Location access was denied — allow it for this site and try again" : e?.code === 2 ? "Location unavailable right now" : "Locating timed out — try again outdoors or on Wi-Fi")),
      { enableHighAccuracy: true, timeout, maximumAge: 120000 },
    );
  });
}
