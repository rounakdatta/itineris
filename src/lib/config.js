// Runtime settings the deployment provides (Helm values -> ConfigMap ->
// /config.json), fetched once at startup. Absent, unreachable or malformed
// means defaults: the site works with no configuration at all.
export const DEFAULTS = { googleMapsApiKey: "", googleMapsMapId: "" };

export async function loadConfig(fetchFn = globalThis.fetch) {
  try {
    const r = await fetchFn("/config.json", { cache: "no-cache" });
    if (!r.ok) return { ...DEFAULTS };
    const j = await r.json();
    return { ...DEFAULTS, ...(j && typeof j === "object" && !Array.isArray(j) ? j : {}) };
  } catch { return { ...DEFAULTS }; }
}

// Which map draws the gallery. Google Maps when a key is configured and we are
// online -- its map cannot be cached, by Google's terms -- else MapLibre with
// Carto tiles, which "Save for offline" can keep. Decided once per page load.
export const chooseMapEngine = (config, online = true) => (config?.googleMapsApiKey && online ? "google" : "maplibre");
