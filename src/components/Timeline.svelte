<script>
  import { trip } from "../lib/trip.svelte.js";
  import { clockOf, TAG_COLOR } from "../lib/data.js";

  let strip;

  // Keep the focused moment scrolled into view when the map or story drives focus.
  $effect(() => {
    const id = trip.focusId;
    if (!id || !strip) return;
    strip.querySelector(`[data-id="${id}"]`)?.scrollIntoView({
      behavior: "smooth", inline: "center", block: "nearest",
    });
  });
</script>

<div class="dock">
  <div class="days">
    <button class="day" class:on={trip.day === null} onclick={() => (trip.day = null)}>
      Whole trip
    </button>
    {#each trip.days as d}
      <button class="day" class:on={trip.day === d.key} onclick={() => trip.setDay(d.key)}>
        {d.label}<span class="n">{d.count}</span>
      </button>
    {/each}
  </div>

  <div class="strip" bind:this={strip}>
    {#each trip.visibleMoments as m (m.id)}
      <button
        class="tick"
        class:on={trip.focusId === m.id}
        data-id={m.id}
        style:--accent={TAG_COLOR[m.tags[0]] ?? "#e6e6e6"}
        onclick={() => trip.focus(m.id)}
        ondblclick={() => trip.openStory(m.id)}
        title={`${m.place} — ${m.caption}`}
      >
        <img src={m.media.src} alt="" loading="lazy" />
        <span class="t">{clockOf(m.t)}</span>
      </button>
    {/each}
    {#if trip.visibleMoments.length === 0}
      <p class="empty">Nothing matches this filter.</p>
    {/if}
  </div>
</div>

<style>
  .dock {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    padding: 12px 0 max(10px, env(safe-area-inset-bottom));
    background: linear-gradient(to top, rgba(11, 13, 16, 0.94) 40%, transparent);
  }
  .days {
    display: flex;
    gap: 6px;
    padding: 0 12px 10px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .days::-webkit-scrollbar { display: none; }
  .day {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 11px;
    border-radius: 999px;
    border: 1px solid transparent;
    background: rgba(255, 255, 255, 0.06);
    color: var(--muted);
    cursor: pointer;
  }
  .day.on { background: rgba(255, 255, 255, 0.16); color: #fff; border-color: var(--line); }
  .n { font-size: 11px; opacity: 0.6; font-variant-numeric: tabular-nums; }

  .strip {
    display: flex;
    gap: 8px;
    padding: 0 12px;
    overflow-x: auto;
    scrollbar-width: none;
    scroll-padding: 0 12px;
  }
  .strip::-webkit-scrollbar { display: none; }
  .tick {
    flex: 0 0 auto;
    position: relative;
    width: 54px;
    height: 72px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 9px;
    overflow: hidden;
    background: #14181e;
    cursor: pointer;
    opacity: 0.62;
    transition: opacity 160ms, transform 160ms, border-color 160ms;
  }
  .tick.on {
    opacity: 1;
    border-color: var(--accent);
    transform: translateY(-4px);
  }
  .tick img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .t {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    font-size: 10px;
    padding: 8px 0 3px;
    color: #fff;
    background: linear-gradient(to top, rgba(0,0,0,0.75), transparent);
    font-variant-numeric: tabular-nums;
  }
  .empty { margin: 0; padding: 24px 4px; color: var(--muted); font-size: 13px; }
</style>
