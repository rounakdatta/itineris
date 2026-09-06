<script>
  // One tap on a pin or a strip thumbnail: what is this place? The card shows
  // the place's photos, when, what kind, and hands off to the story or to
  // Google Maps. A second tap (or the card's own button) opens the story.
  import { trip } from "../lib/trip.svelte.js";
  import { clockOf, dayKey, dateLabel, mediaUrl, placeLink, placeGroup, hasPlaceInfo, TAG_COLOR } from "../lib/data.js";

  const m = $derived(trip.focused);
  const shown = $derived(placeGroup(trip.visibleMoments, m));
  const title = $derived(m ? m.place?.trim() || m.caption?.trim() || "Photo" : "");
  const link = $derived(placeLink(m));
  const day = $derived(m ? dateLabel(dayKey(m.t)) : "");
  const times = $derived.by(() => {
    if (!shown.length) return "";
    const a = clockOf(shown[0].t), b = clockOf(shown[shown.length - 1].t);
    return a === b ? a : `${a}–${b}`;
  });
  const tags = $derived([...new Set(shown.flatMap((x) => x.tags ?? []))]);
  // What Google says about the place: from any photo of the group that carries it.
  const google = $derived(m ? (m.google?.placeId ? m.google : shown.find((x) => x.google?.placeId)?.google ?? null) : null);
  // No card for a bare photo: it would say "Photo", the date and Story -- nothing
  // the story itself does not say. Those open on the first tap instead.
  const open = $derived(!!m && hasPlaceInfo(m) && trip.loaded && !trip.storyOpen && trip.view === "map");
</script>

{#if open}
  <aside class="place-card" aria-label={`Place: ${title}`}>
    <div class="thumbs">
      {#each shown.slice(0, 6) as x (x.id)}
        <button class="thumb" class:on={x.id === m?.id} onclick={() => trip.openStory(x.id)} aria-label={`Open ${clockOf(x.t)} ${x.caption || x.place || ""}`.trim()}>
          <img src={mediaUrl(x.media.thumb ?? x.media.src)} alt="" loading="lazy" />
          {#if x.media.type === "video"}<span class="vid" aria-hidden="true">▶</span>{/if}
        </button>
      {/each}
      {#if shown.length > 6}<span class="more">+{shown.length - 6}</span>{/if}
    </div>
    <div class="body">
      <div class="head">
        <h2>{title}</h2>
        <button class="close" onclick={() => (trip.focusId = null)} aria-label="Close">✕</button>
      </div>
      {#if google && Number.isFinite(google.rating)}
        <p class="google"><b>{google.rating.toFixed(1)}</b><i aria-hidden="true">★</i>{#if google.ratingCount}<span class="cnt">({google.ratingCount.toLocaleString("en")})</span>{/if}{#if google.type}<span class="dot">·</span><span class="type">{google.type}</span>{/if}</p>
      {/if}
      <p class="meta">
        {#if day}<span>{day}</span>{/if}
        <span>{times}</span>
        {#if shown.length > 1}<span>{shown.length} photos</span>{/if}
        {#each tags as t (t)}<span class="tag"><i style:background={TAG_COLOR[t] ?? "#e6e6e6"}></i>{t}</span>{/each}
      </p>
      {#if shown.length === 1 && m?.caption && m?.place}<p class="cap">{m.caption}</p>{/if}
      <div class="actions">
        <button class="act primary" onclick={() => trip.openStory(m.id)}>▶ Story</button>
        {#if link}
          <a class="act" href={link} target="_blank" rel="noopener noreferrer" title="Open in Google Maps">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>
            Google Maps ↗
          </a>
        {/if}
      </div>
    </div>
  </aside>
{/if}

<style>
  .place-card {
    position: absolute; left: 12px; right: 12px; bottom: 112px; z-index: 22;
    margin: 0 auto; max-width: 440px; padding: 10px 12px 12px;
    display: grid; gap: 10px;
    background: rgba(14, 17, 22, 0.94); backdrop-filter: blur(16px);
    border: 1px solid var(--line); border-radius: 16px; color: var(--text);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
    animation: rise 220ms cubic-bezier(.2,.8,.2,1);
  }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  .thumbs { display: flex; gap: 6px; align-items: center; overflow-x: auto; scrollbar-width: none; }
  .thumbs::-webkit-scrollbar { display: none; }
  .thumb { flex: 0 0 auto; width: 58px; height: 58px; padding: 0; border-radius: 10px; overflow: hidden; border: 2px solid transparent; background: #14181e; cursor: pointer; opacity: 0.85; }
  .thumb.on { border-color: #fff; opacity: 1; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .thumb .vid { position: absolute; right: 3px; bottom: 3px; width: 16px; height: 16px; border-radius: 50%; background: rgba(0, 0, 0, 0.65); color: #fff; font-size: 8px; display: grid; place-items: center; }
  .thumb { position: relative; }
  .more { flex: 0 0 auto; font-size: 12px; color: var(--muted); padding: 0 6px; }
  .body { display: grid; gap: 6px; min-width: 0; }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  h2 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -0.01em; color: #fff; line-height: 1.25; }
  .close { flex: 0 0 auto; width: 28px; height: 28px; border-radius: 50%; border: 0; background: rgba(255, 255, 255, 0.08); color: var(--muted); cursor: pointer; display: grid; place-items: center; font-size: 12px; }
  .google { margin: -2px 0 0; display: flex; align-items: center; gap: 4px; font-size: 13px; color: var(--muted); }
  .google b { color: #fff; font-weight: 650; }
  .google i { font-style: normal; color: #f4b400; font-size: 12px; margin-right: 2px; }
  .google .dot { opacity: 0.6; }
  .meta { margin: 0; display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12px; color: var(--muted); align-items: center; }
  .tag { display: inline-flex; align-items: center; gap: 5px; text-transform: uppercase; letter-spacing: 0.04em; font-size: 10.5px; }
  .tag i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
  .cap { margin: 0; font-size: 13px; line-height: 1.4; color: var(--text); }
  .actions { display: flex; gap: 8px; margin-top: 2px; }
  .act {
    display: inline-flex; align-items: center; gap: 6px; padding: 8px 13px; border-radius: 999px; font-size: 13px; font-weight: 500;
    border: 1px solid var(--line); background: rgba(255, 255, 255, 0.06); color: #fff; text-decoration: none; cursor: pointer;
  }
  .act.primary { background: #fff; color: #0b0d10; border-color: #fff; }
  @media (min-width: 760px) { .place-card { left: 16px; right: auto; width: 380px; bottom: 114px; } }
</style>
