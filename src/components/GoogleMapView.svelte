<script>
  // Google Maps as the map: Google's tiles, streets and shop labels; our photos
  // as pins, our routes drawn on top. Same contract as MapView (MapLibre): it
  // renders trip.visibleMoments / visibleTracks, follows trip.focused, refits
  // when the selection changes, and hands taps to the same two-step gesture.
  // Cannot work offline (Google's terms forbid caching tiles) -- App falls back
  // to MapView when there is no connection or the script fails.
  import { onMount, untrack } from "svelte";
  import { trip } from "../lib/trip.svelte.js";
  import { bboxOf, hasCoords, mediaUrl, MODE_COLOR, groupByPlace, placeKey } from "../lib/data.js";
  import { allSeen } from "../lib/seen.svelte.js";
  import { loadGoogleMaps, onAuthFailure, watchMapErrors } from "../lib/gmaps.js";

  let { config, onFail } = $props();
  let container;
  let g = null;        // the google.maps namespace
  let map = null;
  let Marker = null;   // AdvancedMarkerElement
  let ready = $state(false);
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
      for (const p of pins.values()) p.mk.map = null;
      for (const l of lines.values()) l.setMap(null);
      pins.clear(); lines.clear(); map = null;
    };
  });

  // One pin per place. The photo sits in an Instagram-style story ring --
  // bright until every photo behind it has been seen on this device -- and,
  // when Google knows the place, a small rating chip hangs under it (the
  // Claude.ai-style pin). Tap the ring: the story opens, straight away. Tap
  // the chip: the place card, with the details.
  const pins = new Map();   // group key -> { mk, sig, ring, chip }
  function pinFor(group) {
    const el = document.createElement("div");
    el.className = "gpin";
    el.dataset.place = group.key;
    const ring = document.createElement("button");
    ring.type = "button"; ring.className = "ring";
    ring.setAttribute("aria-label", `Open story: ${group.name || group.first.caption || "photo"}`);
    const img = document.createElement("img");
    img.src = mediaUrl(group.first.media.thumb ?? group.first.media.src); img.alt = ""; img.loading = "lazy"; img.draggable = false;
    ring.appendChild(img);
    if (group.moments.length > 1) { const n = document.createElement("span"); n.className = "n"; n.textContent = String(group.moments.length); ring.appendChild(n); }
    el.appendChild(ring);
    let chip = null;
    if (Number.isFinite(group.google?.rating)) {
      chip = document.createElement("button");
      chip.type = "button"; chip.className = "chip";
      chip.setAttribute("aria-label", `${group.name}: ${group.google.rating.toFixed(1)} stars on Google`);
      const b = document.createElement("b"); b.textContent = group.google.rating.toFixed(1);
      const star = document.createElement("i"); star.textContent = "★"; star.setAttribute("aria-hidden", "true");
      chip.append(b, star);
      el.appendChild(chip); el.classList.add("has-chip");
    }
    const mk = new Marker({ map, position: { lat: group.lat, lng: group.lng }, content: el, title: group.name, zIndex: 1, gmpClickable: true });
    ring.addEventListener("click", (e) => { e.stopPropagation(); trip.openStory(group.first.id); });
    chip?.addEventListener("click", (e) => { e.stopPropagation(); if (trip.focusId === group.first.id) trip.openStory(group.first.id); else trip.focus(group.first.id); });
    // Anything else on the pin (padding, badge): what is this place?
    mk.addListener("click", () => trip.focus(group.first.id));
    return { mk, ring, chip, sig: group.moments.map((x) => x.id).join(","), group };
  }

  // Selection -> pins and routes. A group whose photos changed is rebuilt;
  // one that merely left the selection is hidden and comes back as it was.
  $effect(() => {
    const groups = groupByPlace(trip.visibleMoments);
    const tracks = trip.visibleTracks;
    if (!ready || !map) return;
    const want = new Set();
    for (const grp of groups) {
      want.add(grp.key);
      let pin = pins.get(grp.key);
      const sig = grp.moments.map((x) => x.id).join(",");
      if (pin && pin.sig !== sig) { pin.mk.map = null; pins.delete(grp.key); pin = null; }
      if (!pin) { pin = pinFor(grp); pins.set(grp.key, pin); }
      else if (!pin.mk.map) pin.mk.map = map;
      pin.group = grp;
      pin.ring.classList.toggle("seen", allSeen(grp.moments));
    }
    for (const [key, pin] of pins) if (!want.has(key) && pin.mk.map) pin.mk.map = null;
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

  // Focus -> that place's pin grows and its chip turns dark; the camera goes there.
  $effect(() => {
    const f = trip.focused;
    if (!ready || !map) return;
    const key = f ? placeKey(f) : null;
    for (const [k, pin] of pins) { const on = k === key; pin.mk.content?.classList.toggle("on", on); pin.mk.zIndex = on ? 1000 : 1; }
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
  /* Pins are DOM nodes Google positions; they live outside Svelte's scoping.
     The marker anchors at the content's bottom centre: shift so the RING's
     centre sits on the spot (ring 44 + gap 4 + chip 20 = 68 tall). */
  :global(.gpin) { display: flex; flex-direction: column; align-items: center; gap: 4px; transform: translateY(22px); cursor: pointer; }
  :global(.gpin.has-chip) { transform: translateY(46px); }
  :global(.gpin .ring) {
    position: relative; width: 44px; height: 44px; padding: 3px; border: 0; border-radius: 50%; cursor: pointer;
    background: conic-gradient(from 200deg, #f9ce34, #ee2a7b, #6228d7, #f9ce34);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.95), 0 4px 14px rgba(238, 42, 123, 0.35);
    transition: transform 160ms, box-shadow 160ms;
  }
  :global(.gpin .ring img) { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block; border: 2px solid #fff; background: #14181e; pointer-events: none; }
  :global(.gpin .ring.seen) { background: #cfcfcf; box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.95), 0 3px 10px rgba(0, 0, 0, 0.25); }
  :global(.gpin .ring .n) {
    position: absolute; right: -5px; top: -5px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; border: 2px solid #fff;
    background: #111; color: #fff; font: 700 10.5px/14px system-ui, -apple-system, sans-serif; text-align: center; box-sizing: border-box;
  }
  :global(.gpin .chip) {
    display: inline-flex; align-items: center; gap: 3px; height: 20px; padding: 0 7px; border: 0; border-radius: 999px; cursor: pointer;
    background: #fff; color: #111; font: 700 11px/20px system-ui, -apple-system, sans-serif; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
    transition: background 160ms, color 160ms;
  }
  :global(.gpin .chip i) { font-style: normal; color: #f4b400; font-size: 10px; }
  :global(.gpin.on .ring) { transform: scale(1.18); }
  :global(.gpin.on .chip) { background: #111; color: #fff; }
  :global(.gpin.on .chip i) { color: #ffd54f; }
</style>
