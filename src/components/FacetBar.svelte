<script>
  import { trip } from "../lib/trip.svelte.js";
  import { FACETS, TAG_COLOR, dayKey, momentMatches, trackMatches } from "../lib/data.js";

  // Counts are computed against the day filter but NOT the facet filter, so the
  // numbers don't collapse to zero as soon as you select something.
  const scoped = $derived(trip.day ? trip.moments.filter((m) => dayKey(m.t) === trip.day) : trip.moments);
  const counts = $derived(
    Object.fromEntries(
      FACETS.map((f) => [
        f.id,
        scoped.filter((m) => momentMatches(m, [f.id])).length + trip.tracks.filter((t) => trackMatches(t, [f.id])).length,
      ])
    )
  );
</script>

<nav class="bar" aria-label="Filter">
  {#each FACETS as f (f.id)}
    {#if counts[f.id] > 0}
      <button
        class="chip"
        class:on={trip.facets.includes(f.id)}
        aria-pressed={trip.facets.includes(f.id)}
        style:--accent={TAG_COLOR[f.tags[0]] ?? "#e6e6e6"}
        onclick={() => trip.toggleFacet(f.id)}
      >
        <i class="dot" aria-hidden="true"></i>{f.label}<span class="n">{counts[f.id]}</span>
      </button>
    {/if}
  {/each}
</nav>

<style>
  .bar {
    display: flex; gap: 7px; padding: 6px 12px 14px;
    overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch;
  }
  .bar::-webkit-scrollbar { display: none; }
  .chip {
    flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px;
    min-height: 34px; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--line);
    background: var(--panel); color: var(--muted); cursor: pointer; backdrop-filter: blur(12px);
    transition: color 140ms, border-color 140ms, background 140ms;
  }
  .chip.on {
    color: #fff;
    border-color: color-mix(in srgb, var(--accent, #fff) 60%, transparent);
    background: color-mix(in srgb, var(--accent, #fff) 16%, var(--panel));
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent, #e6e6e6); }
  .chip:not(.on) .dot { opacity: 0.5; }
  .n { font-size: 11px; opacity: 0.6; font-variant-numeric: tabular-nums; }
</style>
