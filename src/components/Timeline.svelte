<script>
  import { trip } from "../lib/trip.svelte.js";
  import { clockOf, dateLabel, mediaUrl, TAG_COLOR } from "../lib/data.js";

  let strip;

  // Keep the focused moment scrolled into view when the map or story drives focus.
  $effect(() => {
    const id = trip.focusId;
    if (!id || !strip) return;
    strip.querySelector(`[data-id="${id}"]`)?.scrollIntoView?.({ behavior: "smooth", inline: "center", block: "nearest" });
  });

  // First tap flies the map there; a second tap on the same photo opens it.
  // (Double-tap does not exist on a phone, and a single tap must not hijack the
  // map by opening full-screen.)
  function onTick(m) {
    if (trip.focusId === m.id) trip.openStory(m.id);
    else trip.focus(m.id);
  }
</script>

<div class="dock" class:hidden={trip.storyOpen} class:wall={trip.view === "wall"}>
  <div class="days" role="group" aria-label="Days">
    <button class="day" class:on={trip.day === null} aria-pressed={trip.day === null} onclick={() => (trip.day = null)}>
      Whole trip
    </button>
    {#each trip.days as d (d.key)}
      <button class="day" class:on={trip.day === d.key} aria-pressed={trip.day === d.key} onclick={() => trip.setDay(d.key)}>
        {d.label}<span class="date">{dateLabel(d.key)}</span><span class="n">{d.count}</span>
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
        onclick={() => onTick(m)}
        aria-label={`${clockOf(m.t)} ${m.place || m.caption || ""}`.trim()}
        title={trip.focusId === m.id ? "Open" : `${m.place}${m.caption ? " — " + m.caption : ""}`}
      >
        <img src={mediaUrl(m.media.thumb ?? m.media.src)} alt="" loading="lazy" />
        <span class="t">{clockOf(m.t)}</span>
        {#if trip.focusId === m.id}<span class="open" aria-hidden="true">▶</span>{/if}
      </button>
    {/each}
    {#if trip.visibleMoments.length === 0}
      <p class="empty">Nothing matches this filter.</p>
    {/if}
  </div>
</div>

<style>
  .dock {
    position: absolute; left: 0; right: 0; bottom: 0; z-index: 20;
    padding: 12px 0 max(10px, env(safe-area-inset-bottom));
    background: linear-gradient(to top, rgba(11, 13, 16, 0.94) 40%, transparent);
  }
  .days { display: flex; gap: 6px; padding: 0 12px 10px; overflow-x: auto; scrollbar-width: none; }
  .days::-webkit-scrollbar { display: none; }
  .day {
    flex: 0 0 auto; display: inline-flex; align-items: baseline; gap: 6px;
    min-height: 32px; padding: 5px 11px; border-radius: 999px; border: 1px solid transparent;
    background: rgba(255, 255, 255, 0.06); color: var(--muted); cursor: pointer;
  }
  .day.on { background: rgba(255, 255, 255, 0.16); color: #fff; border-color: var(--line); }
  .date { font-size: 11px; opacity: 0.7; }
  .n { font-size: 11px; opacity: 0.6; font-variant-numeric: tabular-nums; }

  .strip { display: flex; gap: 8px; padding: 0 12px; overflow-x: auto; scrollbar-width: none; scroll-padding: 0 12px; }
  .strip::-webkit-scrollbar { display: none; }
  .tick {
    flex: 0 0 auto; position: relative; width: 54px; height: 72px; padding: 0;
    border: 2px solid transparent; border-radius: 9px; overflow: hidden; background: #14181e; cursor: pointer;
    opacity: 0.62; transition: opacity 160ms, transform 160ms, border-color 160ms;
  }
  .tick.on { opacity: 1; border-color: var(--accent); transform: translateY(-4px); }
  .tick img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .t {
    position: absolute; left: 0; right: 0; bottom: 0; font-size: 10px; padding: 8px 0 3px; color: #fff;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.75), transparent); font-variant-numeric: tabular-nums;
  }
  .open {
    position: absolute; left: 50%; top: 42%; translate: -50% -50%; font-size: 13px; color: #fff;
    width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
  }
  /* Nothing under the story needs painting while it plays. */
  .dock.hidden { visibility: hidden; }
  /* On the wall the grid IS the strip: keep only the day chips, on a solid bar
     so cells scrolling underneath never show through. */
  .dock.wall { background: var(--bg); border-top: 1px solid var(--line); padding-top: 10px; }
  .dock.wall .strip, .dock.wall .empty { display: none; }
  .dock.wall .days { padding-bottom: 2px; }
  .empty { margin: 0; padding: 24px 4px; color: var(--muted); font-size: 13px; }
</style>
