// What counts as "a place", shared by the viewer, the creator and the server.
//
// Lives here rather than in src/ for the same reason slug.js and caption.js do:
// the server needs it too -- to work out which hops a gallery's walking routes
// should be looked up for -- and one definition that both sides agree on is
// the only way those hops can match. No node imports, so the browser bundles it.

export const LOOSE = "~loose";

// Uploaded photos may carry no GPS; they still belong in the timeline, wall and
// story, just not on the map.
export const hasCoords = (m) => Number.isFinite(m.lat) && Number.isFinite(m.lng);

// No coordinates, no name, no Google place: a photo that belongs nowhere.
export const isLoose = (m) => !hasCoords(m) && !(m.place ?? "").trim() && !m.google?.placeId;

// The same Google place is one pin whatever it was called; else the name; else
// the photo alone -- a photo WITH coordinates but no name still earns its own
// pin, so it keeps a key of its own and never joins the loose ones.
export const placeKey = (m) => (isLoose(m) ? LOOSE : m.google?.placeId ? `g:${m.google.placeId}` : (m.place ?? "").trim().toLowerCase() || `#${m.id}`);
