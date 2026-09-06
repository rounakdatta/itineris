<script>
  import { trip } from "../lib/trip.svelte.js";
  import { clockOf, mediaUrl, TAG_COLOR } from "../lib/data.js";

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

<!-- The strip: every photo in the selection, in time order. No day chips: the
     date shows where a photo is open, and that is enough. -->
<div class="dock" class:hidden={trip.storyOpen} class:wall={trip.view === "wall"}>
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
        {#if m.media.type === "video"}<span class="vid" aria-hidden="true">▶</span>{/if}
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
  .vid { position: absolute; right: 4px; top: 4px; width: 16px; height: 16px; border-radius: 50%; background: rgba(0, 0, 0, 0.6); color: #fff; font-size: 8px; display: grid; place-items: center; }
  .open {
    position: absolute; left: 50%; top: 42%; translate: -50% -50%; font-size: 13px; color: #fff;
    width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
  }
  /* Nothing under the story needs painting while it plays. */
  .dock.hidden { visibility: hidden; }
  /* On the wall the grid IS the strip. */
  .dock.wall { display: none; }
  .empty { margin: 0; padding: 24px 4px; color: var(--muted); font-size: 13px; }
</style>
