<script>
  import { onMount } from "svelte";
  import { trip } from "./lib/trip.svelte.js";
  import { applyHash, syncHash } from "./lib/router.js";
  import { hasAnyCoords } from "./lib/data.js";
  import MapView from "./components/MapView.svelte";
  import PhotoWall from "./components/PhotoWall.svelte";
  import FacetBar from "./components/FacetBar.svelte";
  import Timeline from "./components/Timeline.svelte";
  import Story from "./components/Story.svelte";
  import GoogleMapView from "./components/GoogleMapView.svelte";
  import { loadConfig, chooseMapEngine } from "./lib/config.js";
  import { here } from "./lib/here.svelte.js";

  let online = $state(typeof navigator === "undefined" ? true : navigator.onLine !== false);
  // Which map draws the gallery, decided once per page load from /config.json:
  // Google Maps when a key is configured and we are online, MapLibre otherwise
  // (and whenever Google's script fails). null until known, so neither engine
  // is downloaded for nothing.
  let config = $state(null);
  let engine = $state(null);
  let routed = $state(false);   // the initial hash has been applied (see the URL effect below)
  function useMapLibre(why) { if (why) console.warn("Google Maps unavailable, drawing with MapLibre:", why); engine = "maplibre"; trip.mapEngine = "maplibre"; }

  onMount(() => {
    loadConfig().then((c) => { config = c; engine = chooseMapEngine(c, navigator.onLine !== false); trip.mapEngine = engine; });
    trip.load().then(() => {
      if (!trip.loaded) return;
      // The map is the view. Only when no photo or route has a location -- the
      // map would be an empty globe -- does the photo wall stand in for it.
      // (There is no toggle: the data decides.)
      if (!hasAnyCoords(trip.moments, trip.tracks)) trip.view = "wall";
      applyHash(trip, location.hash);
      routed = true;
    });
    const onPop = () => applyHash(trip, location.hash);
    const up = () => { online = true; if (trip.fromCache) trip.load(); }, down = () => (online = false);
    window.addEventListener("popstate", onPop); window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("popstate", onPop); window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  });

  // Keep the URL honest about what is on screen (see router.js) -- but only
  // once the URL has been read. Until the initial hash is applied the URL is
  // the truth and the state is not: a shared "#m/<id>" link arrives before the
  // gallery has loaded, and the first flush after loading would otherwise see
  // "no story open" and write that back over the link.
  $effect(() => { if (routed && trip.loaded) syncHash(trip); });

  $effect(() => {
    document.title = trip.title ? `${trip.title} · itineris` : "itineris";
  });
</script>

<main>
  <!--
    The map is mounted once for the life of the app (per engine) and the wall
    overlays it instead of replacing it, so the map instance -- and its camera
    position -- survives every view switch.
  -->
  {#if engine === "google"}
    <GoogleMapView {config} onFail={(e) => useMapLibre(e?.message)} />
  {:else if engine === "maplibre"}
    <MapView />
  {/if}

  {#if trip.view === "wall" && trip.loaded}
    <PhotoWall />
  {/if}

  {#if trip.loaded}
    <div class="chrome" class:hidden={trip.storyOpen} class:wall={trip.view === "wall"}>
      <div class="top">
        <h1 class="brand"><span class="word">itineris</span>{#if trip.title}<span class="sep" aria-hidden="true">·</span><span class="title">{trip.title}</span>{/if}</h1>
        {#if !online || trip.fromCache}<span class="pill" role="status">{online ? "Saved copy" : "Offline"}</span>{/if}
        {#if !hasAnyCoords(trip.moments, trip.tracks)}<span class="pill muted" role="status">No locations yet</span>{/if}
        {#if here.status === "denied"}<span class="pill muted" role="status">Location is blocked for this site</span>
        {:else if here.status === "error"}<span class="pill muted" role="status">Couldn't find you</span>
        {:else if here.status === "unavailable"}<span class="pill muted" role="status">No location on this device</span>{/if}
        {#if trip.view === "map"}
          <!-- Ask for the browser's location only on this tap, and only show it while it is on. -->
          <button
            class="locate" class:on={here.status === "on"} class:asking={here.status === "asking"}
            onclick={() => here.toggle()}
            aria-pressed={here.on}
            aria-label={here.on ? "Hide my location" : "Show my location"}
            title={here.on ? "Hide my location" : "Show my location"}
          >
            <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
              <circle cx="12" cy="12" r="3.1" fill="currentColor" />
              <circle cx="12" cy="12" r="6.9" fill="none" stroke="currentColor" stroke-width="1.6" />
              <path d="M12 1.6v3.1M12 19.3v3.1M1.6 12h3.1M19.3 12h3.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </button>
        {/if}
      </div>
      <FacetBar />
    </div>
    <Timeline />
  {/if}

  {#if trip.status === "loading"}
    <p class="status" role="status">Loading…</p>
  {:else if trip.status === "landing"}
    <section class="card">
      <h1 class="word big">itineris</h1>
      <p>A travel journal, shared by link. Ask for one.</p>
    </section>
  {:else if trip.status === "notfound"}
    <section class="card">
      <h1 class="word big">itineris</h1>
      <p>This link doesn't point to a gallery any more.</p>
    </section>
  {:else if trip.status === "error"}
    <section class="card">
      <h1 class="word big">itineris</h1>
      <p class="error">Could not load: {trip.error}</p>
      <button class="toggle" onclick={() => trip.load()}>Try again</button>
    </section>
  {/if}

  <Story />
</main>

<style>
  main { position: fixed; inset: 0; overflow: hidden; }

  .chrome {
    position: absolute; top: 0; left: 0; right: 0; z-index: 20;
    padding-top: max(8px, env(safe-area-inset-top));
    background: linear-gradient(to bottom, rgba(11, 13, 16, 0.92), rgba(11, 13, 16, 0.55) 65%, transparent);
    pointer-events: none;
  }
  .chrome > * { pointer-events: auto; }
  .chrome.hidden { visibility: hidden; }
  .chrome.wall { background: var(--bg); border-bottom: 1px solid var(--line); }
  /* The worker's "Updated · Reload" pill: above the timeline dock, not on it. */
  :global(#itineris-update) { bottom: 112px !important; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 4px 12px 2px 14px; }
  .brand { display: flex; align-items: baseline; gap: 8px; min-width: 0; margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
  .word { color: #fff; }
  .sep { color: var(--muted); font-weight: 400; }
  .title { color: var(--muted); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .toggle {
    flex: 0 0 auto; padding: 7px 14px; border-radius: 999px; border: 1px solid var(--line);
    background: var(--panel); backdrop-filter: blur(12px); color: var(--text); cursor: pointer;
  }
  .locate {
    flex: 0 0 auto; width: 38px; height: 38px; display: grid; place-items: center; padding: 0;
    border-radius: 50%; border: 1px solid var(--line); background: var(--panel); backdrop-filter: blur(12px);
    color: var(--text); cursor: pointer;
  }
  .locate.on { background: #4c8dff; border-color: #4c8dff; color: #fff; }
  .locate.asking { animation: locating 1.1s ease-in-out infinite; }
  @keyframes locating { 50% { opacity: 0.45; } }
  @media (prefers-reduced-motion: reduce) { .locate.asking { animation: none; } }

  .pill { flex: 0 0 auto; font-size: 11px; padding: 3px 9px; border-radius: 999px; background: color-mix(in srgb, #ffb347 22%, transparent); color: #ffb347; }
  .pill.muted { background: rgba(255, 255, 255, 0.08); color: var(--muted); }

  .status { position: absolute; left: 50%; top: 50%; translate: -50% -50%; z-index: 30; color: var(--muted); font-size: 13px; }
  .card {
    position: absolute; left: 50%; top: 50%; translate: -50% -50%; z-index: 30;
    width: min(360px, 86vw); padding: 26px 24px; border-radius: 16px; text-align: center;
    background: var(--panel); border: 1px solid var(--line); backdrop-filter: blur(16px); color: var(--muted);
  }
  .card p { margin: 8px 0 14px; }
  .big { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
  .error { color: #ff8080; }
</style>
