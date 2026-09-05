<script>
  import { trip } from "../lib/trip.svelte.js";
  import { clockOf, dayKey, mediaUrl } from "../lib/data.js";

  // Group by the photo's own local day, so the wall reads chronologically.
  const groups = $derived(
    trip.visibleMoments.reduce((acc, m) => {
      const k = dayKey(m.t);
      (acc[k] ??= []).push(m);
      return acc;
    }, {})
  );
  const label = $derived(
    Object.fromEntries(trip.days.map((d) => [d.key, d.label]))
  );
</script>

<div class="wall">
  {#each Object.entries(groups) as [key, items] (key)}
    <h2>{label[key] ?? key}<span>{key}</span></h2>
    <div class="grid">
      {#each items as m (m.id)}
        <button class="cell" onclick={() => trip.openStory(m.id)} title={m.caption}>
          <img src={mediaUrl(m.media.thumb ?? m.media.src)} alt={m.caption} loading="lazy" />
          <span class="t">{clockOf(m.t)}</span>
        </button>
      {/each}
    </div>
  {/each}
  {#if trip.visibleMoments.length === 0}
    <p class="empty">Nothing matches this filter.</p>
  {/if}
</div>

<style>
  .wall {
    position: absolute;
    inset: 0;
    z-index: 10;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--bg);
    padding: calc(max(8px, env(safe-area-inset-top)) + 96px) 12px calc(72px + env(safe-area-inset-bottom));
    -webkit-overflow-scrolling: touch;
  }
  h2 {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 22px 2px 10px;
    font-size: 14px;
    font-weight: 600;
  }
  h2 span { font-size: 11px; color: var(--muted); font-weight: 400; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
    gap: 6px;
  }
  .cell {
    position: relative;
    aspect-ratio: 3 / 4;
    padding: 0;
    border: 0;
    border-radius: 8px;
    overflow: hidden;
    background: #14181e;
    cursor: pointer;
  }
  .cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cell:hover img { opacity: 0.85; }
  .t {
    position: absolute;
    left: 6px;
    bottom: 5px;
    font-size: 10px;
    color: #fff;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
    font-variant-numeric: tabular-nums;
  }
  .empty { color: var(--muted); padding: 40px 4px; }
</style>
