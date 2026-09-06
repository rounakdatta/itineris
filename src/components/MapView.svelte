<script>
  import { onMount, untrack } from "svelte";
  import { trip } from "../lib/trip.svelte.js";
  import { momentsFC, tracksFC, bboxOf, hasCoords, tagColorExpression, hasPlaceInfo } from "../lib/data.js";
  import { setTileTemplate } from "../lib/offline.js";

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

      // Zoom buttons only where there is a mouse; on a phone they cost space and
      // pinch does the job.
      if (globalThis.matchMedia?.("(pointer: fine)")?.matches) {
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      }

      map.on("load", () => {
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
          // Like the strip: first tap says what this is (place card), the
          // second opens it. A tap on bare map puts the card away.
          if (!id) trip.focusId = null;
          else if (trip.focusId === id || !hasPlaceInfo(trip.visibleMoments.find((x) => x.id === id))) trip.openStory(id);
          else trip.focus(id);
        });
        // Test hook: tiles loaded and nothing pending. Screenshots wait for it.
        map.on("idle", () => { container.dataset.idle = "1"; });
        map.on("movestart", () => { container.dataset.idle = "0"; });
        map.on("dataloading", () => { container.dataset.idle = "0"; });

        map.on("mouseenter", "moments-dot", () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "moments-dot", () => (map.getCanvas().style.cursor = ""));

        ready = true;

        // Where the tiles come from, so "Save for offline" can fetch the same URLs
        // the map will ask for. The style names a TileJSON; resolve it once.
        (async () => {
          try {
            const src = map.getStyle()?.sources?.carto;
            const tiles = src?.tiles ?? (src?.url ? (await (await fetch(src.url)).json()).tiles : null);
            setTileTemplate(tiles?.[0] ?? null);
          } catch { setTileTemplate(null); }
        })();
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

  $effect(() => {
    if (trip.focusId === null && ready && map) {
      map.setFilter("moments-active", ["==", ["get", "id"], "__none__"]);
    }
  });

  // Filter changed, or data arrived -> refit. Depends on the INPUTS (filters,
  // which gallery is loaded), not on the derived selection, so it does not
  // re-fire on every recomputation. `trip.loaded`/`galleryId` matter because a
  // cached style can make the map ready before the gallery JSON has landed.
  $effect(() => {
    trip.facets;
    trip.loaded;
    trip.galleryId;
    if (!ready || !map) return;
    untrack(() => {
      const box = bboxOf(trip.visibleMoments, trip.visibleTracks);
      if (!box) return;
      map.fitBounds(
        [[box[0], box[1]], [box[2], box[3]]],
        { padding: { top: 90, bottom: 130, left: 40, right: 40 }, maxZoom: 15, duration: 900 }
      );
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
  /* Keep Traefik-free chrome clear of the dock: the attribution sits above the timeline. */
  .map :global(.maplibregl-ctrl-bottom-right) { bottom: 100px; }
  .map :global(.maplibregl-ctrl-bottom-left) { bottom: 100px; }
  .map :global(.maplibregl-ctrl-attrib a) { color: #8b9dc3; }
  .map :global(.maplibregl-ctrl-group) {
    background: rgba(20, 24, 30, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .map :global(.maplibregl-ctrl-group button + button) { border-top-color: rgba(255,255,255,0.08); }
  .map :global(.maplibregl-ctrl-icon) { filter: invert(1) opacity(0.75); }
</style>
