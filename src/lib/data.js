// Facets are authored, not inferred. Adding an angle = adding a row here.
// `tags` match moments, `modes` match tracks. A facet with no modes shows no routes.
// Two angles, matching the two primitives: places you stopped, and ways you
// moved between them. No "All" chip -- an empty selection already means
// everything (see momentMatches/trackMatches), so deselecting both is "all".
export const FACETS = [
  { id: "spots",      label: "Spots",      tags: ["food", "experience", "nature", "coffee", "night"], modes: [] },
  { id: "activities", label: "Activities", tags: ["run", "cycle"],                                    modes: ["run", "cycle", "walk"] },
];

export const MODE_COLOR = {
  run:   "#ff5c8a",
  cycle: "#4dd4ac",
  walk:  "#8b9dc3",
};

// Timestamps are stored as ISO strings WITH offset ("2026-03-14T08:40+08:00").
// Slicing the date out keeps us in the photo's own local day and never touches
// the host timezone -- which is the entire bug class we want to avoid here.
export const dayKey = (iso) => iso.slice(0, 10);
export const clockOf = (iso) => iso.slice(11, 16);
// "2026-03-14" -> "14 Mar". Parsed as UTC midnight and formatted in UTC, so the
// host zone can never shift the date.
export const dateLabel = (key) => new Date(`${key}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function daysOf(moments) {
  const seen = new Map();
  for (const m of moments) {
    const k = dayKey(m.t);
    if (!seen.has(k)) seen.set(k, { key: k, count: 0, first: m.t });
    seen.get(k).count++;
  }
  return [...seen.values()].sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((d, i) => ({ ...d, index: i, label: `Day ${i + 1}` }));
}

export function momentMatches(moment, facetIds) {
  if (facetIds.length === 0) return true;
  return FACETS.some(
    (f) => facetIds.includes(f.id) && f.tags.some((t) => moment.tags.includes(t))
  );
}

export function trackMatches(track, facetIds) {
  if (facetIds.length === 0) return true;
  return FACETS.some((f) => facetIds.includes(f.id) && f.modes.includes(track.mode));
}

// Uploaded photos may carry no GPS; they still belong in the timeline, wall and
// story, just not on the map.
export const hasCoords = (m) => Number.isFinite(m.lat) && Number.isFinite(m.lng);
export const hasAnyCoords = (moments = [], tracks = []) => moments.some(hasCoords) || tracks.some((t) => (t.geometry?.length ?? 0) > 0);

// Phones display ~400-1200 physical px across; the 1600 tier is for big screens.
export const isSmallScreen = () => !(globalThis.matchMedia?.("(min-width: 760px)")?.matches ?? false);
// A photo is a *place* when it has something to say beyond itself: a name,
// a Google place, or a Google Maps link. A bare photo (no name, nothing from
// Google) gets no place card -- a tap opens it straight away.
export const hasPlaceInfo = (m) => !!(m && ((m.place ?? "").trim() || m.mapsUrl || m.google?.placeId));
export const isVideo = (media) => media?.type === "video";
// The image the story shows: the photo's medium/large tier, or a video's poster.
export const storySrc = (media) => mediaUrl(isVideo(media) ? media.medium ?? media.poster ?? media.thumb : isSmallScreen() ? media.medium ?? media.src : media.src);
// The bytes a story needs: a photo's displayed tier, or the video file itself.
export const storyBytes = (media) => mediaUrl(isVideo(media) ? media.src : isSmallScreen() ? media.medium ?? media.src : media.src);
export const fmtDuration = (s) => { if (!Number.isFinite(s)) return ""; const m = Math.floor(s / 60), r = Math.round(s % 60); return `${m}:${String(r).padStart(2, "0")}`; };

export function bboxOf(moments, tracks) {
  const pts = [
    ...moments.filter(hasCoords).map((m) => [m.lng, m.lat]),
    ...tracks.flatMap((t) => t.geometry),
  ];
  if (pts.length === 0) return null;
  return pts.reduce(
    (b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)],
    [Infinity, Infinity, -Infinity, -Infinity]
  );
}

export const momentsFC = (moments) => ({
  type: "FeatureCollection",
  features: moments.filter(hasCoords).map((m) => ({
    type: "Feature",
    id: m.id,
    geometry: { type: "Point", coordinates: [m.lng, m.lat] },
    properties: { id: m.id, place: m.place, primaryTag: m.tags[0] ?? "" },
  })),
});

export const tracksFC = (tracks) => ({
  type: "FeatureCollection",
  features: tracks.map((t) => ({
    type: "Feature",
    id: t.id,
    geometry: { type: "LineString", coordinates: t.geometry },
    properties: { id: t.id, mode: t.mode, color: MODE_COLOR[t.mode] ?? "#8b9dc3" },
  })),
});

export const TAG_COLOR = {
  food:       "#ffb347",
  experience: "#c792ea",
  nature:     "#4dd4ac",
  run:        "#ff5c8a",
  cycle:      "#4dd4ac",
  coffee:     "#d7a86e",
  night:      "#7aa2f7",
};

// MapLibre "match" expression built from the table above, so adding a tag
// colour never means editing a layer definition.
export const tagColorExpression = () => [
  "match", ["get", "primaryTag"],
  ...Object.entries(TAG_COLOR).flat(),
  "#e6e6e6",
];

// Media paths are stored relative ("media/x.webp") so the data is host-agnostic;
// the viewer is served at / and at /g/<token>, so they must resolve from the root
// or a gallery URL turns every thumbnail into /g/media/... -> the SPA shell.
export const mediaUrl = (rel) => (!rel || rel.startsWith("/") || /^https?:/.test(rel) ? rel : `/${rel}`);

// Where to send someone who wants this place in Google Maps: the exact link a
// shared Google Maps URL gave us, else a search that lands on the spot.
export function placeLink(m) {
  if (!m) return null;
  if (m.google?.mapsUri) return m.google.mapsUri;   // Google's own canonical link for the place
  if (m.mapsUrl) return m.mapsUrl;
  const name = (m.place ?? "").trim();
  if (hasCoords(m)) return name ? `https://www.google.com/maps/search/${encodeURIComponent(name)}/@${m.lat},${m.lng},17z` : `https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lng}`;
  return name ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}` : null;
}
// Every photo from the same named place, in time order; a nameless photo stands alone.
export function placeGroup(moments, m) {
  if (!m) return [];
  const key = placeKey(m);
  const g = key.startsWith("#") ? [m] : moments.filter((x) => placeKey(x) === key);
  return g.length ? g : [m];
}

// One pin per PLACE on the map: photos sharing a name collapse into a group
// (first photo's spot and thumbnail, count, whatever Google said about it).
// A photo without a name is its own place.
// The same Google place is one pin whatever it was called; else the name; else the photo alone.
export const placeKey = (m) => (m.google?.placeId ? `g:${m.google.placeId}` : (m.place ?? "").trim().toLowerCase() || `#${m.id}`);
export function groupByPlace(moments) {
  const groups = new Map();
  for (const m of moments) {
    if (!hasCoords(m)) continue;
    const key = placeKey(m);
    let g = groups.get(key);
    if (!g) { g = { key, name: (m.place ?? "").trim(), lat: m.lat, lng: m.lng, first: m, moments: [], google: null }; groups.set(key, g); }
    g.moments.push(m);
    if (!g.google && m.google?.placeId) g.google = m.google;
  }
  return [...groups.values()];
}
