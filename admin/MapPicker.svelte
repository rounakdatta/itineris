<script>
  import { onMount } from "svelte";

  // Tap or drag to place the photo. `hint` centres the map somewhere sensible
  // when the photo has no coordinates yet -- usually a neighbour's location.
  let { lat = null, lng = null, hint = null, onChange } = $props();
  let container;
  let map, marker;

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
</script>

<div class="picker" bind:this={container} role="application" aria-label="Map: tap to set the location"></div>

<style>
  .picker { height: 220px; border-radius: 12px; overflow: hidden; background: #0b0d10; border: 1px solid var(--line); }
  .picker :global(.maplibregl-ctrl-attrib) { font-size: 9px; background: rgba(11, 13, 16, 0.7); }
</style>
