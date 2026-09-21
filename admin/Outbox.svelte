<script>
  // The upload surface. Picking photos is instant and local; the network is
  // somebody else's problem, handled by the Outbox in the background.
  // NB: not named `state` -- a prop called state turns `$state(...)` into a store subscription.
  import { currentPosition } from "./lib/geo.js";
  import PlaceSearch from "./PlaceSearch.svelte";

  // `location`: the place every photo added now is pinned to (picked below, or
  // shared in from Google Maps). `onPick` hands a picked place up to App.
  // `first`: this person has no photos at all yet. The panel is the whole
  // screen then, and everything it says has to earn its place -- somebody who
  // has not uploaded anything cannot use a caveat about offline queueing or a
  // box for pinning "the next photos" to a place.
  let { outbox, queue, gallery = null, location = null, known = [], placesEnabled = false, first = false, onEdit, onPick } = $props();
  let input;
  let over = $state(false);
  let pinOpen = $state(false);
  let urls = $state(new Map());

  const items = $derived(queue?.items ?? []);
  const uploading = $derived(items.find((i) => i.state === "uploading"));
  const rejected = $derived(items.filter((i) => i.state === "rejected"));
  const waiting = $derived(items.filter((i) => i.state === "waiting"));
  const total = $derived(items.length);
  // The file had no GPS -- phones strip it from photos picked in a browser --
  // so the server will not be able to place it either. Say so up front.
  const noGps = (i) => !Number.isFinite(i.meta?.lat) || !Number.isFinite(i.meta?.lng);
  const noLoc = $derived(items.filter(noGps).length);
  let locBusy = $state(false);
  let locNote = $state(null);
  // Photos are usually uploaded from where they were taken: one tap places
  // every unplaced photo in the queue at the device's position; the location
  // travels with the upload like any other edit.
  async function useMyLocation() {
    locBusy = true; locNote = null;
    try {
      const p = await currentPosition();
      const targets = items.filter(noGps);
      for (const it of targets) await outbox.updateMeta(it.id, { lat: p.lat, lng: p.lng, locEdited: true });
      locNote = `Placed ${targets.length} photo${targets.length === 1 ? "" : "s"} at your location (±${p.accuracy} m). Tap one to adjust.`;
    } catch (e) { locNote = e.message; }
    finally { locBusy = false; }
  }

  const status = $derived.by(() => {
    if (!total) return null;
    if (queue.blocked) return { kind: "blocked", text: "Signed out — sign in to continue uploading" };
    if (!queue.online) return { kind: "offline", text: `Offline — ${total} photo${total === 1 ? "" : "s"} will upload when you're back` };
    if (uploading) return { kind: "busy", text: `Uploading ${total - waiting.length - rejected.length} of ${total} · ${Math.round((uploading.progress ?? 0) * 100)}%${(uploading.progress ?? 0) >= 1 && (uploading.type ?? "").startsWith("video/") ? " · processing the video…" : ""}` };
    if (rejected.length && !waiting.length) return { kind: "rejected", text: `${rejected.length} photo${rejected.length === 1 ? " was" : "s were"} refused by the server` };
    const soon = waiting.filter((i) => i.attempts > 0).length;
    return { kind: "retrying", text: soon ? `Connection trouble — retrying ${total} photo${total === 1 ? "" : "s"} automatically` : `${total} waiting to upload` };
  });

  // Object URLs for on-device thumbnails, revoked when the item leaves the
  // queue. `live` is deliberately not reactive: an effect that read `urls` and
  // wrote it back would loop forever.
  const live = new Map();
  $effect(() => {
    const alive = new Set(items.map((i) => i.id));
    let changed = false;
    for (const [id, u] of live) if (!alive.has(id)) { URL.revokeObjectURL(u); live.delete(id); changed = true; }
    if (typeof URL.createObjectURL === "function") {
      for (const i of items) if (!live.has(i.id) && (i.thumb ?? i.file)) { live.set(i.id, URL.createObjectURL(i.thumb ?? i.file)); changed = true; }
    }
    if (changed) urls = new Map(live);
  });

  async function pick(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/") || /\.(jpe?g|png|webp|heic|heif|avif|mp4|m4v|mov|webm|mkv|3gp|3g2)$/i.test(f.name));
    if (!files.length) return;
    await outbox.add(files, { galleries: gallery ? [gallery.id] : [], location });
    if (input) input.value = "";
  }
  // A full navigation goes through tinyauth; the queue is in IndexedDB and survives.
  // `globalThis.location`, NOT `location`: this component takes a prop called
  // `location` (the place new photos are pinned to), which shadows the global --
  // the same trap as the `state` prop above, and it left this button throwing.
  const signIn = () => globalThis.location.reload();
</script>

<!-- Drag-and-drop is the extra; the button inside is the accessible way in, so
     this is a labelled region rather than anything that claims to be operable. -->
<section
  class="drop" class:over aria-label="Add photos"
  ondragover={(e) => { e.preventDefault(); over = true; }}
  ondragleave={() => (over = false)}
  ondrop={(e) => { e.preventDefault(); over = false; pick(e.dataTransfer.files); }}
>
  <!-- `multiple` + accept="image/*" gives camera-or-gallery on a phone and a
       normal picker on desktop, in one control. -->
  <input bind:this={input} type="file" accept="image/*,video/*" multiple hidden onchange={(e) => pick(e.target.files)} data-testid="file-input" />
  {#if first}
    <svg class="welcome" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
      <path d="M4 7.6h3.4l1.5-2.2h6.2l1.5 2.2H20v11H4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
      <circle cx="12" cy="12.8" r="3.4" fill="none" stroke="currentColor" stroke-width="1.5" />
    </svg>
    <h2>Start with a few photos</h2>
    <p class="muted hint">They stay private until you put them in a gallery.</p>
  {/if}
  <button class="btn primary" onclick={() => input.click()}>{location ? `Add photos at “${location.name || "this place"}”` : gallery ? `Add photos to “${gallery.title}”` : first ? "Choose photos" : "Add photos"}</button>
  {#if !first}
    <p class="muted hint">photos and videos · or drop them here{gallery ? "" : " · they stay private until they're in a gallery"}</p>
  {/if}
  <!-- Placing photos is the main chore -- phones strip GPS -- so the way in
       stays one tap away. It just does not need to sit open forever: the
       explanation and the search box together were taking a third of a phone
       screen above the photos they are about. -->
  {#if !location && !first}
    <button class="pinlink" aria-expanded={pinOpen} onclick={() => (pinOpen = !pinOpen)}>
      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>
      Pin the next photos to a place
    </button>
    {#if pinOpen}
      <p class="muted hint small">Phones usually strip GPS from photos picked in a browser. Pick a place and every photo you add now lands on that one pin.</p>
      <div class="pinrow">
        <PlaceSearch compact {known} {placesEnabled} onPick={(p) => onPick?.(p)} />
      </div>
    {/if}
  {/if}

  {#if status}
    <div class="queue" role="region" aria-label="Upload queue">
      <div class="status {status.kind}" role="status">
        <span class="dot" aria-hidden="true"></span>
        <span class="text">{status.text}</span>
        {#if status.kind === "blocked"}
          <button class="btn small primary" onclick={signIn}>Sign in</button>
        {:else if status.kind !== "busy"}
          <button class="btn small" onclick={() => outbox.retryNow()}>Retry now</button>
        {/if}
      </div>
      <div class="tiles">
        {#each items as it (it.id)}
          <div class="tile" class:rejected={it.state === "rejected"} class:uploading={it.state === "uploading"}>
            <button class="pick" onclick={() => onEdit?.(it.id)} aria-label={`Edit queued photo ${it.name}`} title={it.error ?? it.name}>
              {#if urls.get(it.id)}<img src={urls.get(it.id)} alt="" />{:else}<span class="noimg">{(it.type ?? "").startsWith("video/") ? "🎬" : "📷"}</span>{/if}
              {#if (it.type ?? "").startsWith("video/")}<span class="vid" aria-hidden="true">▶</span>{/if}
              {#if it.state === "uploading"}
                <span class="bar"><span class="fill" style:width="{Math.round((it.progress ?? 0) * 100)}%"></span></span>
              {:else if it.state === "rejected"}
                <span class="flag err" title={it.error}>!</span>
              {:else if it.attempts > 0}
                <span class="flag" title={`retrying (${it.attempts} attempt${it.attempts === 1 ? "" : "s"}): ${it.error ?? ""}`}>↻</span>
              {:else}
                <span class="flag wait" title="waiting">⏳</span>
              {/if}
              {#if !Number.isFinite(it.meta?.lat) || !Number.isFinite(it.meta?.lng)}<!-- Drawn, not U+2316: that crosshair is missing from many system fonts. -->
              <span class="flag loc" title="No location in this photo's metadata"><svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="2.6" /><path d="M12 1.6v3.6M12 18.8v3.6M1.6 12h3.6M18.8 12h3.6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" /></svg></span>{/if}
              {#if it.meta?.tags?.length}<span class="tags">{it.meta.tags.join(" · ")}</span>{/if}
            </button>
            <button class="remove" onclick={() => outbox.remove(it.id)} aria-label={`Remove ${it.name} from the queue`}>✕</button>
          </div>
        {/each}
      </div>
      {#if noLoc}
        <p class="muted small"><span class="cross" aria-hidden="true"><svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="2.6" /><path d="M12 1.6v3.6M12 18.8v3.6M1.6 12h3.6M18.8 12h3.6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" /></svg></span> {noLoc === total ? (total === 1 ? "This photo has" : "These photos have") : `${noLoc} of these ${noLoc === 1 ? "has" : "have"}`} no location in the file — phones remove GPS from photos picked in a browser. Tap a photo to place it, or if you're still there:</p>
        <p class="small"><button class="btn small" onclick={useMyLocation} disabled={locBusy}>{locBusy ? "Locating…" : `📍 Use my location for ${noLoc === total ? (total === 1 ? "it" : "all") : `these ${noLoc}`}`}</button></p>
      {/if}
      {#if locNote}<p class="muted small" role="status">{locNote}</p>{/if}
      {#if rejected.length}<p class="muted small">Refused files stay here so you can see why (tap one); remove them when done.</p>{/if}
    </div>
  {/if}
</section>

<style>
  .drop { border: 1.5px dashed var(--line); border-radius: 14px; padding: 18px 16px; text-align: center; background: var(--panel); transition: border-color 140ms, background 140ms; }
  /* The first-run panel is the only thing on the screen, so it gets room. */
  .drop:has(.welcome) { padding: 44px 20px 40px; }
  /* Once it is just a way to add more, it is a bar rather than a billboard:
     on a wide screen the button sat alone in the middle of 1400 empty pixels. */
  @media (min-width: 720px) {
    .drop:not(:has(.welcome)):not(:has(.queue)) {
      display: flex; align-items: center; justify-content: flex-start; gap: 14px;
      flex-wrap: wrap; text-align: left; padding: 12px 14px;
    }
    .drop:not(:has(.welcome)):not(:has(.queue)) .hint { margin: 0; flex: 1 1 auto; min-width: 0; }
    .drop:not(:has(.welcome)):not(:has(.queue)) .pinlink { margin: 0; }
    .drop:not(:has(.welcome)):not(:has(.queue)) .pinrow { flex: 1 0 100%; }
  }
  .welcome { color: var(--accent); opacity: 0.9; margin-bottom: 10px; }
  .pinlink {
    display: inline-flex; align-items: center; gap: 6px; margin-top: 4px;
    background: none; border: 0; padding: 4px 6px; border-radius: 8px;
    color: var(--muted); font: inherit; font-size: 13px; cursor: pointer;
  }
  .pinlink:hover, .pinlink[aria-expanded="true"] { color: var(--text); }
  .pinlink svg { opacity: 0.75; }
  .drop h2 { margin: 0 0 6px; font-size: 19px; font-weight: 600; letter-spacing: -0.01em; }
  .drop h2 + .hint { margin-bottom: 18px; }
  .drop.over { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--panel)); }
  .hint { margin: 10px 0 0; font-size: 13px; }
  .hint.small { margin-top: 6px; font-size: 12px; }
  .pinrow { margin: 10px auto 0; max-width: 460px; }
  .queue { margin-top: 16px; text-align: left; }
  .status { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; background: var(--bg); font-size: 14px; }
  .status .text { flex: 1; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: 0 0 auto; }
  .status.offline .dot { background: #ffb347; }
  .status.retrying .dot { background: #ffb347; animation: pulse 1.6s ease-in-out infinite; }
  .status.busy .dot { background: var(--accent); animation: pulse 1s ease-in-out infinite; }
  .status.blocked .dot, .status.rejected .dot { background: var(--danger); }
  @keyframes pulse { 50% { opacity: 0.3; } }
  .btn.small { padding: 6px 11px; font-size: 13px; }
  .tiles { display: flex; gap: 8px; overflow-x: auto; padding: 10px 2px 4px; scrollbar-width: none; }
  .tile { position: relative; flex: 0 0 auto; }
  .pick { position: relative; width: 78px; height: 104px; padding: 0; border: 2px solid transparent; border-radius: 10px; overflow: hidden; background: #0b0d10; display: block; }
  .tile.uploading .pick { border-color: var(--accent); }
  .tile.rejected .pick { border-color: var(--danger); }
  .pick img { width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0.9; }
  .noimg { display: grid; place-items: center; width: 100%; height: 100%; font-size: 24px; }
  .flag { position: absolute; left: 5px; top: 5px; font-size: 11px; line-height: 1; padding: 3px 5px; border-radius: 6px; background: rgba(0, 0, 0, 0.65); color: #fff; font-style: normal; }
  .flag.err { background: var(--danger); font-weight: 700; }
  .flag.loc { left: auto; right: 5px; font-size: 12px; color: #ffb347; }
  .flag svg { display: block; }   /* an inline svg would sit on the text baseline */
  .cross { display: inline-block; vertical-align: -1px; color: #ffb347; }
  .vid { position: absolute; right: 5px; bottom: 26px; width: 18px; height: 18px; border-radius: 50%; background: rgba(0, 0, 0, 0.65); color: #fff; font-size: 8px; display: grid; place-items: center; }
  .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgba(255, 255, 255, 0.15); }
  .fill { display: block; height: 100%; background: var(--accent); transition: width 160ms linear; }
  .tags { position: absolute; left: 0; right: 0; bottom: 0; font-size: 9px; padding: 10px 5px 4px; color: #fff; background: linear-gradient(to top, rgba(0,0,0,.75), transparent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .remove { position: absolute; right: -6px; top: -6px; width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--line); background: var(--panel); color: var(--muted); font-size: 11px; display: grid; place-items: center; }
  .small { font-size: 12px; margin: 6px 0 0; }
</style>
