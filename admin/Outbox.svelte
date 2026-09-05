<script>
  // The upload surface. Picking photos is instant and local; the network is
  // somebody else's problem, handled by the Outbox in the background.
  // NB: not named `state` -- a prop called state turns `$state(...)` into a store subscription.
  import { currentPosition } from "./lib/geo.js";

  let { outbox, queue, gallery = null, onEdit } = $props();
  let input;
  let over = $state(false);
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
    if (uploading) return { kind: "busy", text: `Uploading ${total - waiting.length - rejected.length} of ${total} · ${Math.round((uploading.progress ?? 0) * 100)}%` };
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
    const files = [...fileList].filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|avif)$/i.test(f.name));
    if (!files.length) return;
    await outbox.add(files, { galleries: gallery ? [gallery.id] : [] });
    if (input) input.value = "";
  }
  const signIn = () => location.reload();   // a full navigation goes through tinyauth; the queue is in IndexedDB and survives
</script>

<section
  class="drop" class:over
  ondragover={(e) => { e.preventDefault(); over = true; }}
  ondragleave={() => (over = false)}
  ondrop={(e) => { e.preventDefault(); over = false; pick(e.dataTransfer.files); }}
>
  <!-- `multiple` + accept="image/*" gives camera-or-gallery on a phone and a
       normal picker on desktop, in one control. -->
  <input bind:this={input} type="file" accept="image/*" multiple hidden onchange={(e) => pick(e.target.files)} data-testid="file-input" />
  <button class="btn primary" onclick={() => input.click()}>{gallery ? `Add photos to “${gallery.title}”` : "Add photos"}</button>
  <p class="muted hint">or drop them here · works offline — photos queue on this device and upload when they can{gallery ? "" : " · new photos stay private until they're in a gallery"}</p>
  <p class="muted hint small">Phones usually strip GPS from photos picked in a browser. Photos without a location show ⌖ — set it in the editor, or select several and use <em>Set location</em>.</p>

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
              {#if urls.get(it.id)}<img src={urls.get(it.id)} alt="" />{:else}<span class="noimg">📷</span>{/if}
              {#if it.state === "uploading"}
                <span class="bar"><span class="fill" style:width="{Math.round((it.progress ?? 0) * 100)}%"></span></span>
              {:else if it.state === "rejected"}
                <span class="flag err" title={it.error}>!</span>
              {:else if it.attempts > 0}
                <span class="flag" title={`retrying (${it.attempts} attempt${it.attempts === 1 ? "" : "s"}): ${it.error ?? ""}`}>↻</span>
              {:else}
                <span class="flag wait" title="waiting">⏳</span>
              {/if}
              {#if !Number.isFinite(it.meta?.lat) || !Number.isFinite(it.meta?.lng)}<span class="flag loc" title="No location in this photo's metadata">⌖</span>{/if}
              {#if it.meta?.tags?.length}<span class="tags">{it.meta.tags.join(" · ")}</span>{/if}
            </button>
            <button class="remove" onclick={() => outbox.remove(it.id)} aria-label={`Remove ${it.name} from the queue`}>✕</button>
          </div>
        {/each}
      </div>
      {#if noLoc}
        <p class="muted small">⌖ {noLoc === total ? (total === 1 ? "This photo has" : "These photos have") : `${noLoc} of these have`} no location in the file — phones remove GPS from photos picked in a browser. Tap a photo to place it, or if you're still there:</p>
        <p class="small"><button class="btn small" onclick={useMyLocation} disabled={locBusy}>{locBusy ? "Locating…" : `📍 Use my location for ${noLoc === total ? (total === 1 ? "it" : "all") : `these ${noLoc}`}`}</button></p>
      {/if}
      {#if locNote}<p class="muted small" role="status">{locNote}</p>{/if}
      {#if rejected.length}<p class="muted small">Refused files stay here so you can see why (tap one); remove them when done.</p>{/if}
    </div>
  {/if}
</section>

<style>
  .drop { border: 1.5px dashed var(--line); border-radius: 14px; padding: 22px 16px; text-align: center; background: var(--panel); transition: border-color 140ms, background 140ms; }
  .drop.over { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--panel)); }
  .hint { margin: 10px 0 0; font-size: 13px; }
  .hint.small { margin-top: 6px; font-size: 12px; }
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
  .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgba(255, 255, 255, 0.15); }
  .fill { display: block; height: 100%; background: var(--accent); transition: width 160ms linear; }
  .tags { position: absolute; left: 0; right: 0; bottom: 0; font-size: 9px; padding: 10px 5px 4px; color: #fff; background: linear-gradient(to top, rgba(0,0,0,.75), transparent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .remove { position: absolute; right: -6px; top: -6px; width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--line); background: var(--panel); color: var(--muted); font-size: 11px; display: grid; place-items: center; }
  .small { font-size: 12px; margin: 6px 0 0; }
</style>
