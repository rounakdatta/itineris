<script>
  // Google Maps as the map: Google's tiles, streets and shop labels; our photos
  // as pins, our routes drawn on top. Same contract as MapView (MapLibre): it
  // renders trip.visibleMoments / visibleTracks, follows trip.focused, refits
  // when the selection changes, and hands taps to the same two-step gesture.
  // Cannot work offline (Google's terms forbid caching tiles) -- App falls back
  // to MapView when there is no connection or the script fails.
  import { onMount, untrack } from "svelte";
  import { trip } from "../lib/trip.svelte.js";
  import { bboxOf, hasCoords, mediaUrl, TAG_COLOR, MODE_COLOR } from "../lib/data.js";
  import { loadGoogleMaps, onAuthFailure, watchMapErrors } from "../lib/gmaps.js";

  let { config, onFail } = $props();
  let container;
  let g = null;        // the google.maps namespace
  let map = null;
  let Marker = null;   // AdvancedMarkerElement
  let ready = $state(false);
  const markers = new Map();   // moment id -> marker (kept while filtered out; shown again when back)
  const lines = new Map();     // track id -> polyline

  onMount(() => {
    let cancelled = false;
    let failed = false;
    const fail = (e) => { if (failed || cancelled) return; failed = true; onFail?.(e); };
    // Billing off, key restricted to another site, API not enabled: Google says
    // so once in the console and leaves a grey overlay. We would rather draw MapLibre.
    const unwatch = watchMapErrors(fail);
    (async () => {
      try {
        g = await loadGoogleMaps({ key: config.googleMapsApiKey });
        const [{ Map: GMap }, { AdvancedMarkerElement }] = await Promise.all([g.importLibrary("maps"), g.importLibrary("marker")]);
        if (cancelled) return;
        Marker = AdvancedMarkerElement;
        map = new GMap(container, {
          // A neutral start; the first fitBounds takes it to the photos.
          center: { lat: 15, lng: 20 },
          zoom: 2,
          mapId: config.googleMapsMapId || "DEMO_MAP_ID",   // AdvancedMarkerElement needs a vector map id
          disableDefaultUI: true,
          zoomControl: !!globalThis.matchMedia?.("(pointer: fine)")?.matches,
          gestureHandling: "greedy",
          clickableIcons: true,      // Google's own place labels stay tappable: that IS the point of Google Maps
          keyboardShortcuts: false,
        });
        onAuthFailure(() => fail(new Error("Google Maps refused this API key")));
        // A tap on bare map puts the place card away; a tap on one of Google's
        // places (e.placeId) opens Google's own card, so leave ours alone.
        map.addListener("click", (e) => { if (!e?.placeId) trip.focusId = null; });
        // Test hook, same as MapView: tiles loaded and nothing pending.
        map.addListener("idle", () => { container.dataset.idle = "1"; });
        map.addListener("dragstart", () => { container.dataset.idle = "0"; });
        map.addListener("zoom_changed", () => { container.dataset.idle = "0"; });
        ready = true;
      } catch (e) { fail(e); }
    })();
    return () => {
      cancelled = true;
      unwatch();
      for (const m of markers.values()) m.map = null;
      for (const l of lines.values()) l.setMap(null);
      markers.clear(); lines.clear(); map = null;
    };
  });

  function pinFor(m) {
    const el = document.createElement("div");
    el.className = "gpin";
    el.style.setProperty("--ring", TAG_COLOR[m.tags?.[0]] ?? "#e6e6e6");
    const img = document.createElement("img");
    img.src = mediaUrl(m.media.thumb ?? m.media.src); img.alt = ""; img.loading = "lazy"; img.draggable = false;
    el.appendChild(img);
    const mk = new Marker({ map, position: { lat: m.lat, lng: m.lng }, content: el, title: m.place || m.caption || "", zIndex: 1, gmpClickable: true });
    // Like the strip: first tap says what this is (place card), the second opens it.
    mk.addListener("click", () => { if (trip.focusId === m.id) trip.openStory(m.id); else trip.focus(m.id); });
    return mk;
  }

  // Selection -> pins and routes. Markers are created once and shown/hidden.
  $effect(() => {
    const moments = trip.visibleMoments;
    const tracks = trip.visibleTracks;
    if (!ready || !map) return;
    const want = new Set();
    for (const m of moments) {
      if (!hasCoords(m)) continue;
      want.add(m.id);
      const mk = markers.get(m.id);
      if (!mk) markers.set(m.id, pinFor(m));
      else if (!mk.map) mk.map = map;
    }
    for (const [id, mk] of markers) if (!want.has(id) && mk.map) mk.map = null;
    const wantT = new Set();
    for (const t of tracks) {
      if (!(t.geometry?.length > 1)) continue;
      wantT.add(t.id);
      let l = lines.get(t.id);
      if (!l) {
        l = new g.Polyline({ path: t.geometry.map(([lng, lat]) => ({ lat, lng })), strokeColor: MODE_COLOR[t.mode] ?? "#8b9dc3", strokeOpacity: 0.9, strokeWeight: 4, map });
        lines.set(t.id, l);
      } else if (!l.getMap?.() && l.map !== map) l.setMap(map);
    }
    for (const [id, l] of lines) if (!wantT.has(id)) l.setMap(null);
  });

  // Focus -> the pin grows, the camera goes there.
  $effect(() => {
    const f = trip.focused;
    if (!ready || !map) return;
    for (const [id, mk] of markers) { const on = !!f && id === f.id; mk.content?.classList.toggle("on", on); mk.zIndex = on ? 1000 : 1; }
    if (!f || !hasCoords(f)) return;
    map.panTo({ lat: f.lat, lng: f.lng });
    if (map.getZoom() < 15) map.setZoom(15);
  });

  // Filter changed, or data arrived -> refit (inputs only, like MapView).
  $effect(() => {
    trip.facets;
    trip.day;
    trip.loaded;
    trip.galleryId;
    if (!ready || !map) return;
    untrack(() => {
      const box = bboxOf(trip.visibleMoments, trip.visibleTracks);
      if (!box) return;
      map.fitBounds(new g.LatLngBounds({ lat: box[1], lng: box[0] }, { lat: box[3], lng: box[2] }), { top: 90, bottom: 40, left: 40, right: 40 });
      // A single spot would zoom to the rooftops; keep it street-level.
      g.event.addListenerOnce(map, "idle", () => { if (map.getZoom() > 16) map.setZoom(16); });
    });
  });
</script>

<div class="map" data-engine="google" bind:this={container}></div>

<style>
  /* Ends above the timeline dock so Google's logo and terms stay visible (they must). */
  .map { position: absolute; inset: 0 0 150px 0; background: #e5e3df; }
  /* Pins are DOM nodes Google positions; they live outside Svelte's scoping. */
  :global(.gpin) {
    width: 40px; height: 40px; border-radius: 50%; overflow: hidden; cursor: pointer;
    border: 3px solid var(--ring, #fff); background: #14181e;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    transform: translateY(50%);   /* the marker anchors at its bottom centre; centre the circle on the spot */
    transition: width 160ms, height 160ms, box-shadow 160ms;
  }
  :global(.gpin img) { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
  :global(.gpin.on) { width: 58px; height: 58px; border-color: #fff; box-shadow: 0 0 0 3px var(--ring, #fff), 0 8px 22px rgba(0, 0, 0, 0.45); }
</style>
