<script>
  import { dayKey, clockOf, mediaUrl } from "./lib/api.js";

  let { moments, selectedId = null, selectMode = false, selection, onSelect } = $props();

  // Newest day first -- what you just uploaded is what you want to tag.
  const groups = $derived(
    Object.entries(moments.reduce((acc, m) => { (acc[dayKey(m.t)] ??= []).push(m); return acc; }, {}))
      .sort(([a], [b]) => (a < b ? 1 : -1))
  );
</script>

{#each groups as [day, items] (day)}
  <h2>{day} <span class="muted">{items.length}</span></h2>
  <div class="grid" role="list">
    {#each items as m (m.id)}
      <button
        class="cell" role="listitem" data-id={m.id}
        class:on={m.id === selectedId && !selectMode}
        class:picked={selectMode && selection?.has(m.id)}
        onclick={() => onSelect(m.id)}
        aria-pressed={selectMode ? selection?.has(m.id) : undefined}
        aria-label={`${clockOf(m.t)} ${m.place || m.caption || m.filename || m.id}`}
        title={m.caption || m.filename || m.id}
      >
        <img src={mediaUrl(m.media.thumb ?? m.media.src)} alt="" loading="lazy" />
        <span class="t">{clockOf(m.t)}</span>
        <span class="flags">
          {#if m.galleries?.length === 0}<i class="flag private" title="not in any gallery — private">🔒</i>{/if}
          {#if m.tags.length === 0}<i class="flag" title="untagged">#</i>{/if}
          {#if m.lat === null || m.lng === null}<i class="flag" title="no location">⌖</i>{/if}
          {#if m.tz === "unknown"}<i class="flag" title="time zone unknown">⏱</i>{/if}
        </span>
        {#if selectMode}<span class="check" aria-hidden="true">{selection?.has(m.id) ? "✓" : ""}</span>{/if}
        {#if m.tags.length}<span class="tags">{m.tags.join(" · ")}</span>{/if}
      </button>
    {/each}
  </div>
{/each}
{#if moments.length === 0}
  <p class="muted">Nothing here yet.</p>
{/if}

<style>
  h2 { display: flex; gap: 8px; align-items: baseline; font-size: 14px; font-weight: 600; margin: 18px 2px 8px; }
  h2 .muted { font-size: 12px; font-weight: 400; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 6px; }
  .cell { position: relative; aspect-ratio: 3 / 4; padding: 0; border: 2px solid transparent; border-radius: 10px; overflow: hidden; background: var(--panel); text-align: left; }
  .cell.on { border-color: var(--accent); }
  .cell.picked { border-color: var(--ok); }
  .cell.picked img { opacity: 0.6; }
  .cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .t { position: absolute; left: 7px; bottom: 6px; font-size: 11px; color: #fff; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9); font-variant-numeric: tabular-nums; }
  .flags { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; }
  .flag { font-style: normal; font-size: 11px; line-height: 1; padding: 3px 5px; border-radius: 6px; background: rgba(255, 179, 71, 0.9); color: #1a1000; font-weight: 700; }
  .flag.private { background: rgba(20, 24, 30, 0.85); color: #fff; }
  .check { position: absolute; left: 6px; top: 6px; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #fff; background: rgba(0, 0, 0, 0.45); color: #fff; display: grid; place-items: center; font-size: 13px; font-weight: 700; }
  .picked .check { background: var(--ok); border-color: var(--ok); color: #05261c; }
  .tags { position: absolute; left: 0; right: 0; top: 0; padding: 26px 7px 0; font-size: 10px; color: #fff; background: linear-gradient(to bottom, rgba(0,0,0,.6), transparent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
</style>
