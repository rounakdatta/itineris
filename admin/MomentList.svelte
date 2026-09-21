<script>
  import { dayKey, dayLabel, clockOf, stillUrl } from "./lib/api.js";

  let { moments, selectedId = null, selectMode = false, selection, onSelect } = $props();

  // Newest day first -- what you just uploaded is what you want to tag.
  const groups = $derived(
    Object.entries(moments.reduce((acc, m) => { (acc[dayKey(m.t)] ??= []).push(m); return acc; }, {}))
      .sort(([a], [b]) => (a < b ? 1 : -1))
  );
</script>

{#each groups as [day, items] (day)}
  <h2>{dayLabel(day)} <span class="muted">{items.length}</span></h2>
  <!-- A grid of labelled buttons, not a list: a <button> cannot carry
       role="listitem", and role="listitem" does not support aria-pressed, so
       the list semantics were costing the selection state its announcement. -->
  <div class="grid">
    {#each items as m (m.id)}
      <button
        class="cell" data-id={m.id}
        class:on={m.id === selectedId && !selectMode}
        class:picked={selectMode && selection?.has(m.id)}
        onclick={() => onSelect(m.id)}
        aria-pressed={selectMode ? selection?.has(m.id) : undefined}
        aria-label={`${clockOf(m.t)} ${m.place || m.caption || m.filename || m.id}`}
        title={m.caption || m.filename || m.id}
      >
        <img src={stillUrl(m.media, "thumb")} alt="" loading="lazy" />
        <span class="scrim" aria-hidden="true"></span>
        <span class="t">{clockOf(m.t)}</span>
        <!-- A tile flags what is EXCEPTIONAL about a photo, never what is
             ordinary. Untagged, unplaced and not-in-a-gallery are the state
             every photo arrives in, so badging them painted three orange
             chips on every tile of a fresh library and said nothing. Those
             counts live in the toolbar now, where they are also filters.
             What is left is what differs: a clip, and a photo that has
             actually been published somewhere. -->
        <span class="flags">
          {#if m.media?.type === "video"}
            <i class="flag vid" title="video"><svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M7 4.5v15l13-7.5z" /></svg></i>
          {/if}
          {#if m.galleries?.length}
            <i class="flag out" title={m.galleries.length === 1 ? "in 1 gallery" : `in ${m.galleries.length} galleries`}>
              <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path d="M4 12.8 9.2 18 20 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></svg>
              {#if m.galleries.length > 1}<b>{m.galleries.length}</b>{/if}
            </i>
          {/if}
        </span>
        {#if selectMode}<span class="check" aria-hidden="true">{selection?.has(m.id) ? "✓" : ""}</span>{/if}
        {#if m.tags.length}<span class="tags">{m.tags.join(" · ")}</span>{/if}
      </button>
    {/each}
  </div>
{/each}


<style>
  h2 { display: flex; gap: 8px; align-items: baseline; font-size: 14px; font-weight: 600; margin: 18px 2px 8px; }
  h2 .muted { font-size: 12px; font-weight: 400; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 6px; }
  .cell { position: relative; aspect-ratio: 3 / 4; padding: 0; border: 2px solid transparent; border-radius: 10px; overflow: hidden; background: var(--panel); text-align: left; }
  .cell.on { border-color: var(--accent); }
  .cell.picked { border-color: var(--ok); }
  .cell.picked img { opacity: 0.6; }
  .cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .t { position: absolute; left: 7px; bottom: 6px; font-size: 11px; color: rgba(255, 255, 255, 0.92); font-variant-numeric: tabular-nums; letter-spacing: 0.01em; }
  .flags { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; }
  .flag { display: inline-flex; align-items: center; gap: 3px; font-style: normal; font-size: 10px; line-height: 1; padding: 3px 5px; border-radius: 6px; background: rgba(12, 15, 20, 0.66); color: #fff; font-weight: 700; backdrop-filter: blur(4px); }
  .flag svg { display: block; }   /* an inline svg would sit on the text baseline and unbalance the pill */
  .flag.out { background: color-mix(in srgb, var(--ok) 82%, #0b0d10); color: #08130f; }
  /* The time was legible only because of a hard black text-shadow. A short
     gradient does the same job without smearing the bottom of the photo. */
  .scrim { position: absolute; inset: auto 0 0 0; height: 42%; background: linear-gradient(to top, rgba(0, 0, 0, 0.55), transparent); pointer-events: none; }
  .check { position: absolute; left: 6px; top: 6px; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #fff; background: rgba(0, 0, 0, 0.45); color: #fff; display: grid; place-items: center; font-size: 13px; font-weight: 700; }
  .picked .check { background: var(--ok); border-color: var(--ok); color: #05261c; }
  .tags { position: absolute; left: 0; right: 0; top: 0; padding: 26px 7px 0; font-size: 10px; color: #fff; background: linear-gradient(to bottom, rgba(0,0,0,.6), transparent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
</style>
