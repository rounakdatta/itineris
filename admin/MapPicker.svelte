<script>
  import { onMount } from "svelte";
  import { searchPlaces, currentPosition } from "./lib/geo.js";

  // Tap or drag to place the photo; or search a place by name; or use where
  // the device is right now. `hint` centres the map somewhere sensible when
  // the photo has no coordinates yet -- usually a neighbour's location.
  // `onPlace` (optional) receives the chosen place's name.
  let { lat = null, lng = null, hint = null, onChange, onPlace } = $props();
  let container;
  let map, marker;
  let q = $state("");
  let results = $state([]);
  let searching = $state(false);
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
    marker.on("dragend", () => { const p = marker.getLngLat(); onChange?.(+p.lat.toFixed(6), +p.lng.toFixed(6)); });
    map.on("click", (e) => { marker.setLngLat(e.lngLat).addTo(map); onChange?.(+e.lngLat.lat.toFixed(6), +e.lngLat.lng.toFixed(6)); });
    })();
    return () => { cancelled = true; map?.remove(); };
  });

  // Coordinates typed into the fields move the pin.
  $effect(() => {
    if (!map || !marker) return;
    if (Number.isFinite(lat) && Number.isFinite(lng)) { marker.setLngLat([lng, lat]).addTo(map); map.easeTo({ center: [lng, lat], duration: 300 }); }
    else marker.remove();
  });

  async function search() {
    if (!q.trim() || searching) return;
    searching = true; note = null;
    try { results = await searchPlaces(q); if (!results.length) note = `Nothing found for “${q.trim()}”`; }
    catch (e) { note = e.message; }
    finally { searching = false; }
  }
  function choose(r) {
    results = []; q = r.name;
    onChange?.(r.lat, r.lng);
    onPlace?.(r.name);
    map?.easeTo({ center: [r.lng, r.lat], zoom: 15, duration: 400 });
  }
  async function locate() {
    if (locating) return;
    locating = true; note = null;
    try { const p = await currentPosition(); onChange?.(p.lat, p.lng); note = `Your location, ±${p.accuracy} m — drag the pin if it's off.`; map?.easeTo({ center: [p.lng, p.lat], zoom: 16, duration: 400 }); }
    catch (e) { note = e.message; }
    finally { locating = false; }
  }
</script>

<div class="pick">
  <div class="tools">
    <input class="q" type="search" bind:value={q} placeholder="Search a place — “Tartine Manufactory”" aria-label="Search a place"
      onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }} />
    <button type="button" class="btn tiny" onclick={search} disabled={searching || !q.trim()}>{searching ? "…" : "Search"}</button>
    <button type="button" class="btn tiny" onclick={locate} disabled={locating} title="Use this device's current position">{locating ? "Locating…" : "📍 My location"}</button>
  </div>
  {#if results.length}
    <ul class="results" role="listbox" aria-label="Places found">
      {#each results as r (r.label)}
        <li><button type="button" role="option" aria-selected="false" onclick={() => choose(r)}><strong>{r.name}</strong><span class="muted">{r.label}</span></button></li>
      {/each}
    </ul>
    <p class="muted credit">Search by OpenStreetMap Nominatim</p>
  {/if}
  {#if note}<p class="muted note" role="status">{note}</p>{/if}
  <div class="picker" bind:this={container} role="application" aria-label="Map: tap to set the location"></div>
</div>

<style>
  .pick { display: grid; gap: 8px; }
  .tools { display: flex; gap: 6px; align-items: center; }
  .tools .q { flex: 1; min-width: 0; width: auto; max-width: none; padding: 7px 10px; }
  .btn.tiny { padding: 6px 9px; font-size: 12px; white-space: nowrap; }
  .results { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: 190px; overflow: auto; }
  .results button { width: 100%; text-align: left; display: grid; gap: 2px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: inherit; font: inherit; cursor: pointer; }
  .results button:hover, .results button:focus-visible { border-color: var(--accent); }
  .results strong { font-size: 13px; }
  .results .muted { font-size: 11px; line-height: 1.35; }
  .credit { margin: -2px 0 0; font-size: 10px; }
  .note { margin: 0; font-size: 12px; }
  .picker { height: 220px; border-radius: 12px; overflow: hidden; background: #0b0d10; border: 1px solid var(--line); }
  .picker :global(.maplibregl-ctrl-attrib) { font-size: 9px; background: rgba(11, 13, 16, 0.7); }
</style>
