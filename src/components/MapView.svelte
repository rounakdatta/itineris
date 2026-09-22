<script>
  import { onMount, untrack } from "svelte";
  import { trip } from "../lib/trip.svelte.js";
  import { momentsFC, tracksFC, bboxOf, hasCoords, tagColorExpression, fitPadding } from "../lib/data.js";
  import { legsOf, legsFC } from "../lib/route.js";
  import { here } from "../lib/here.svelte.js";

  let container;
  let map = null;
  let ready = $state(false);

  const EMPTY = { type: "FeatureCollection", features: [] };

  // MapLibre is ~1 MB; it is loaded here, not at startup, so the strip, wall and
  // stories render while it is still on its way over a slow link.
  onMount(() => {
    let cancelled = false;
    (async () => {
      const [{ default: maplibregl }] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")]);
      if (cancelled) return;
      map = new maplibregl.Map({
        container,
        style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
        // A neutral start; the first fitBounds takes it to the photos. Never a
        // particular city: a gallery with no locations must not look like one.
        center: [20, 15],
        zoom: 1.2,
        attributionControl: { compact: true },
      });

      // Zoom buttons everywhere except a touchscreen, where they cost space and
      // pinch does the job. The test is for coarse, NOT for fine: `pointer: none`
      // is a device with no pointing device at all -- a keyboard, a TV remote --
      // and that is precisely the visitor who cannot zoom without the buttons.
      if (!globalThis.matchMedia?.("(pointer: coarse)")?.matches) {
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      }

      map.on("load", () => {
        // The walk between stops, under everything else: a thread the eye can
        // follow when it looks for it and ignore when it does not. Round caps
        // on a zero-length dash are how you draw dots rather than ticks, and
        // the whole thing is deliberately dim -- it is the connective tissue
        // of the trip, not one of its subjects.
        map.addSource("legs", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "legs-line",
          type: "line",
          source: "legs",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#ffffff",
            "line-opacity": 0.5,
            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.8, 16, 2.6],
            "line-dasharray": [0, 2.2],
          },
        });
        // The distance, halfway along. maplibre hides a label that would
        // collide with another, which is exactly the behaviour wanted: on a
        // dense trip the threads still read even when the numbers cannot all
        // fit, and nothing overlaps.
        map.addLayer({
          id: "legs-label",
          type: "symbol",
          source: "legs",
          layout: {
            "symbol-placement": "line-center",
            "text-field": ["get", "label"],
            "text-size": 11,
            "text-font": ["Noto Sans Regular"],
            "text-letter-spacing": 0.02,
            "text-padding": 6,
            "text-allow-overlap": false,
            "text-ignore-placement": false,
          },
          paint: {
            "text-color": "rgba(255,255,255,0.92)",
            "text-halo-color": "rgba(0,0,0,0.75)",
            "text-halo-width": 1.4,
          },
        });

        map.addSource("tracks", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "tracks-line",
          type: "line",
          source: "tracks",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2, 16, 5],
            "line-opacity": 0.85,
          },
        });

        map.addSource("moments", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "moments-halo",
          type: "circle",
          source: "moments",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 8, 16, 16],
            "circle-color": tagColorExpression(),
            "circle-opacity": 0.22,
          },
        });
        map.addLayer({
          id: "moments-dot",
          type: "circle",
          source: "moments",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 7],
            "circle-color": tagColorExpression(),
            "circle-stroke-color": "#0b0d10",
            "circle-stroke-width": 1.5,
          },
        });
        map.addLayer({
          id: "moments-active",
          type: "circle",
          source: "moments",
          filter: ["==", ["get", "id"], "__none__"],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 9, 16, 14],
            "circle-color": "#ffffff",
            "circle-stroke-color": tagColorExpression(),
            "circle-stroke-width": 3,
          },
        });

        // A dot is a few pixels; a thumb is not. Look for one in a generous box
        // around the tap instead of requiring a direct hit.
        map.on("click", (e) => {
          const pad = 18;
          const hits = map.queryRenderedFeatures(
            [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]],
            { layers: ["moments-dot"] }
          );
          const id = hits?.[0]?.properties?.id;
          // A tap on a pin opens its story; a tap on bare map clears the focus.
          if (!id) trip.focusId = null;
          else trip.openStory(id);
        });
        // Test hook: tiles loaded and nothing pending. Screenshots wait for it.
        map.on("idle", () => { container.dataset.idle = "1"; });
        map.on("movestart", () => { container.dataset.idle = "0"; });
        map.on("dataloading", () => { container.dataset.idle = "0"; });

        map.on("mouseenter", "moments-dot", () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "moments-dot", () => (map.getCanvas().style.cursor = ""));

        // The visitor's own position, when they ask for it: a soft halo under a blue dot.
        map.addSource("me", { type: "geojson", data: EMPTY });
        map.addLayer({ id: "me-halo", type: "circle", source: "me", paint: { "circle-radius": 18, "circle-color": "#4c8dff", "circle-opacity": 0.18 } });
        map.addLayer({ id: "me-dot", type: "circle", source: "me", paint: { "circle-radius": 6.5, "circle-color": "#4c8dff", "circle-stroke-width": 2.5, "circle-stroke-color": "#fff" } });

        ready = true;
      });

    })();
    return () => {
      cancelled = true;
      map?.remove();
      map = null;
    };
  });

  // Selection -> layer data. The map instance is created once and never torn
  // down; state changes only ever push new data into existing sources.
  $effect(() => {
    const moments = trip.visibleMoments;
    const tracks = trip.visibleTracks;
    if (!ready || !map) return;
    map.getSource("moments")?.setData(momentsFC(moments));
    map.getSource("tracks")?.setData(tracksFC(tracks));
    // Opt-in per gallery, and only over what is currently shown -- filtering
    // to one tag should re-thread the stops that remain, not leave a line
    // hanging to a pin that is no longer there.
    const legs = trip.route ? legsOf(moments) : [];
    map.getSource("legs")?.setData(legs.length ? legsFC(legs) : EMPTY);
    // What it drew, readable from outside: a test that only looked at the
    // rendered canvas could not tell "no legs because the gallery said so"
    // from "no legs because the layer never got any data".
    if (container) container.dataset.legs = String(legs.length);
  });

  // Focus -> camera. flyTo, never a re-render.
  $effect(() => {
    const f = trip.focused;
    if (!ready || !map || !f) return;
    map.setFilter("moments-active", ["==", ["get", "id"], hasCoords(f) ? f.id : "__none__"]);
    if (!hasCoords(f)) return;
    map.flyTo({
      center: [f.lng, f.lat],
      zoom: Math.max(map.getZoom(), 14.5),
      speed: 0.9,
      curve: 1.4,
      essential: true,
    });
  });

  // Where the visitor is: the dot follows every fix, the camera only the first
  // one (moving it later would fight whatever they are looking at).
  $effect(() => {
    const { placed, lat, lng, fixes } = here;
    if (container) container.dataset.me = placed ? "1" : "0";   // test hook, like data-idle
    if (!ready || !map || !map.getSource?.("me")) return;
    map.getSource("me").setData(placed ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: {} }] } : EMPTY);
    if (placed && fixes === 1) map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15), speed: 1.1, essential: true });
  });

  $effect(() => {
    if (trip.focusId === null && ready && map) {
      map.setFilter("moments-active", ["==", ["get", "id"], "__none__"]);
    }
  });

  // The whole selection on screen at once. Unlike Google's, this map is
  // full-bleed, so the padding has to clear the dock at the bottom itself.
  function fitAll() {
    const box = bboxOf(trip.visibleMoments, trip.visibleTracks);
    if (!box) return;
    map.fitBounds(
      [[box[0], box[1]], [box[2], box[3]]],
      { padding: fitPadding(map.getContainer?.()?.clientWidth ?? 0), maxZoom: 15, duration: 900 }
    );
  }

  // Filter changed, or data arrived -> refit. Depends on the INPUTS (filters,
  // which gallery is loaded), not on the derived selection, so it does not
  // re-fire on every recomputation. `trip.loaded`/`galleryId` matter because a
  // cached style can make the map ready before the gallery JSON has landed.
  $effect(() => {
    trip.facets;
    trip.loaded;
    trip.galleryId;
    if (!ready || !map) return;
    untrack(fitAll);
  });

  // Opening a story flies the camera to one pin; closing it brings the whole
  // trip back, so the map is never left stranded on the last place you looked
  // at with the rest of the gallery off screen. (Same rule as GoogleMapView.)
  let storyWasOpen = false;
  $effect(() => {
    const open = trip.storyOpen;
    if (!ready || !map) { storyWasOpen = open; return; }
    untrack(() => {
      if (storyWasOpen && !open) fitAll();
      storyWasOpen = open;
    });
  });
</script>

<div class="map" bind:this={container}></div>

<style>
  .map {
    position: absolute;
    inset: 0;
    background: #0b0d10;
  }
  .map :global(.maplibregl-ctrl-attrib) {
    font-size: 10px;
    background: rgba(11, 13, 16, 0.7);
  }
  /* Attribution and zoom controls sit above the timeline, whatever height it is. */
  .map :global(.maplibregl-ctrl-bottom-right) { bottom: var(--dock-h); }
  .map :global(.maplibregl-ctrl-bottom-left) { bottom: var(--dock-h); }
  .map :global(.maplibregl-ctrl-attrib a) { color: #8b9dc3; }
  .map :global(.maplibregl-ctrl-group) {
    background: rgba(20, 24, 30, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .map :global(.maplibregl-ctrl-group button + button) { border-top-color: rgba(255,255,255,0.08); }
  .map :global(.maplibregl-ctrl-icon) { filter: invert(1) opacity(0.75); }
</style>
