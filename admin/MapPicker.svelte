<script>
  import { onMount } from "svelte";
  import { currentPosition } from "./lib/geo.js";
  import PlaceSearch from "./PlaceSearch.svelte";

  // Where a photo is: pick a place (PlaceSearch: your places, Google or OSM
  // search, a pasted link), use the device's position, or tap/drag the map.
  // `hint` centres the map when the photo has no coordinates yet.
  // Callbacks: onChange(lat, lng); onPlace(name); onLink(mapsUrl|null);
  // onPick(place|null) -- the whole picked place (with its Google Place ID), or
  // null when the spot was chosen by hand, so a stale pin never lingers.
  let { lat = null, lng = null, hint = null, known = [], placesEnabled = false, onChange, onPlace, onLink, onPick } = $props();
  let container;
  let map, marker;
  let locating = $state(false);
  let note = $state(null);

  onMount(() => {
    let cancelled = false;
    (async () => {
    const [{ default: maplibregl }] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")]);
    if (cancelled) return;
    const has = Number.isFinite(lat) && Number.isFinite(lng);
    const center = has ? [lng, lat] : hint ? [hint.lng, hint.lat] : [103.85, 1.29];
    map = new maplibregl.Map({ container, style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json", center, zoom: has || hint ? 14 : 10, attributionControl: { compact: true } });
    marker = new maplibregl.Marker({ draggable: true, color: "#7aa2f7" });
    if (has) marker.setLngLat(center).addTo(map);
    const byHand = (a, b) => { onLink?.(null); onPick?.(null); onChange?.(+a.toFixed(6), +b.toFixed(6)); };
    marker.on("dragend", () => { const p = marker.getLngLat(); byHand(p.lat, p.lng); });
    map.on("click", (e) => { marker.setLngLat(e.lngLat).addTo(map); byHand(e.lngLat.lat, e.lngLat.lng); });
    })();
    return () => { cancelled = true; map?.remove(); };
  });

  // Coordinates typed into the fields move the pin.
  $effect(() => {
    if (!map || !marker) return;
    if (Number.isFinite(lat) && Number.isFinite(lng)) { marker.setLngLat([lng, lat]).addTo(map); map.easeTo({ center: [lng, lat], duration: 300 }); }
    else marker.remove();
  });

  function picked(p) {
    note = null;
    onLink?.(p.mapsUrl ?? null);
    onPick?.(p);
    onChange?.(p.lat, p.lng);
    if (p.name) onPlace?.(p.name);
    map?.easeTo({ center: [p.lng, p.lat], zoom: p.placeId ? 16 : 15, duration: 400 });
  }
  async function locate() {
    if (locating) return;
    locating = true; note = null;
    try { const p = await currentPosition(); onLink?.(null); onPick?.(null); onChange?.(p.lat, p.lng); note = `Your location, ±${p.accuracy} m — drag the pin if it's off.`; map?.easeTo({ center: [p.lng, p.lat], zoom: 16, duration: 400 }); }
    catch (e) { note = e.message; }
    finally { locating = false; }
  }
</script>

<div class="pick">
  <PlaceSearch {known} {placesEnabled} bias={Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : hint ? { lat: hint.lat, lng: hint.lng } : null} onPick={picked} />
  <div class="tools">
    <button type="button" class="btn tiny" onclick={locate} disabled={locating} title="Use this device's current position">{locating ? "Locating…" : "📍 My location"}</button>
    {#if note}<span class="muted note" role="status">{note}</span>{/if}
  </div>
  <div class="picker" bind:this={container} role="application" aria-label="Map: tap to set the location"></div>
</div>

<style>
  .pick { display: grid; gap: 8px; }
  .tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .btn.tiny { padding: 6px 9px; font-size: 12px; white-space: nowrap; }
  .note { font-size: 12px; }
  .picker { height: 220px; border-radius: 12px; overflow: hidden; background: #0b0d10; border: 1px solid var(--line); }
  .picker :global(.maplibregl-ctrl-attrib) { font-size: 9px; background: rgba(11, 13, 16, 0.7); }
</style>