<script>
  import { onMount } from "svelte";
  import { trip } from "./lib/trip.svelte.js";
  import MapView from "./components/MapView.svelte";
  import PhotoWall from "./components/PhotoWall.svelte";
  import FacetBar from "./components/FacetBar.svelte";
  import Timeline from "./components/Timeline.svelte";
  import Story from "./components/Story.svelte";

  onMount(() => {
    trip.load();
  });
</script>

<main>
  <!--
    MapView is mounted once for the life of the app and never conditionally
    rendered. The wall overlays it instead of replacing it, so the MapLibre
    instance -- and its camera position -- survives every view switch.
  -->
  <MapView />

  {#if trip.view === "wall"}
    <PhotoWall />
  {/if}

  {#if trip.loaded}
    <FacetBar />
    <Timeline />

    <button
      class="toggle"
      onclick={() => (trip.view = trip.view === "map" ? "wall" : "map")}
      aria-label={trip.view === "map" ? "Show photo wall" : "Show map"}
    >
      {trip.view === "map" ? "Wall" : "Map"}
    </button>
  {/if}

  {#if trip.error}
    <p class="status error">Could not load trip data: {trip.error}</p>
  {:else if !trip.loaded}
    <p class="status">Loading trip…</p>
  {/if}

  <Story />
</main>

<style>
  main {
    position: fixed;
    inset: 0;
    overflow: hidden;
  }
  .toggle {
    position: absolute;
    right: 12px;
    top: calc(max(10px, env(safe-area-inset-top)) + 58px);
    z-index: 21;
    padding: 8px 14px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--panel);
    backdrop-filter: blur(12px);
    color: var(--text);
    cursor: pointer;
  }
  .status {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    z-index: 30;
    color: var(--muted);
    font-size: 13px;
  }
  .error { color: #ff8080; max-width: 80vw; text-align: center; }
</style>
