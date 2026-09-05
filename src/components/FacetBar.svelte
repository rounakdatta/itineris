<script>
  import { trip } from "../lib/trip.svelte.js";
  import { FACETS, TAG_COLOR, dayKey, momentMatches, trackMatches } from "../lib/data.js";

  // Counts are computed against the day filter but NOT the facet filter, so the
  // numbers don't collapse to zero as soon as you select something.
  const scoped = $derived(
    trip.day ? trip.moments.filter((m) => dayKey(m.t) === trip.day) : trip.moments
  );
  const counts = $derived(
    Object.fromEntries(
      FACETS.map((f) => [
        f.id,
        scoped.filter((m) => momentMatches(m, [f.id])).length +
          trip.tracks.filter((t) => trackMatches(t, [f.id])).length,
      ])
    )
  );
</script>

<nav class="bar">
  <button
    class="chip"
    class:on={trip.facets.length === 0}
    onclick={() => trip.clearFacets()}
  >All</button>

  {#each FACETS as f}
    {#if counts[f.id] > 0}
      <button
        class="chip"
        class:on={trip.facets.includes(f.id)}
        style:--accent={TAG_COLOR[f.tags[0]] ?? "#e6e6e6"}
        onclick={() => trip.toggleFacet(f.id)}
      >
        <i class="dot"></i>{f.label}<span class="n">{counts[f.id]}</span>
      </button>
    {/if}
  {/each}
</nav>

<style>
  .bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 20;
    display: flex;
    gap: 7px;
    padding: max(10px, env(safe-area-inset-top)) 12px 12px;
    overflow-x: auto;
    scrollbar-width: none;
    background: linear-gradient(to bottom, rgba(11, 13, 16, 0.9), transparent);
    -webkit-overflow-scrolling: touch;
  }
  .bar::-webkit-scrollbar { display: none; }
  .chip {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--muted);
    cursor: pointer;
    backdrop-filter: blur(12px);
    transition: color 140ms, border-color 140ms, background 140ms;
  }
  .chip.on {
    color: #fff;
    border-color: color-mix(in srgb, var(--accent, #fff) 60%, transparent);
    background: color-mix(in srgb, var(--accent, #fff) 16%, var(--panel));
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent, #e6e6e6);
  }
  .chip:not(.on) .dot { opacity: 0.5; }
  .n { font-size: 11px; opacity: 0.6; font-variant-numeric: tabular-nums; }
</style>
