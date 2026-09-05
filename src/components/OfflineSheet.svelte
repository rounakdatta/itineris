<script>
  import { trip } from "../lib/trip.svelte.js";
  import { planDownload, saveGallery, forgetGallery, savedInfo, fmtBytes, canSave, getTileTemplate } from "../lib/offline.js";

  // Stamped at build time; lets "which version is your phone running?" be answered.
  const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

  let open = $state(false);
  let busy = $state(false);
  let progress = $state(null);
  let info = $state(null);
  let error = $state(null);

  const gallery = $derived({ id: trip.galleryId, moments: trip.moments, tracks: trip.tracks });
  const plan = $derived(open ? planDownload(gallery) : null);
  $effect(() => { if (open) info = savedInfo(trip.galleryId); });

  async function save() {
    busy = true; error = null;
    try { info = await saveGallery(gallery, { onProgress: (p) => (progress = p) }); }
    catch (e) { error = e.message; }
    finally { busy = false; progress = null; }
  }
  async function forget() { busy = true; try { await forgetGallery(gallery); info = null; } finally { busy = false; } }
  const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
</script>

{#if canSave()}
  <button class="save" class:on={!!savedInfo(trip.galleryId)} onclick={() => (open = true)} aria-label="Save for offline" title="Save for offline">⤓</button>
{/if}

{#if open}
  <div class="scrim" onclick={() => (open = false)} role="presentation"></div>
  <aside class="sheet" role="dialog" aria-modal="true" aria-label="Offline">
    <div class="grab" aria-hidden="true"></div>
    <h2>Take this gallery with you</h2>
    {#if info}
      <p>Saved {ago(info.at)} — {info.media} photos{#if info.tiles}, map to zoom {info.zmax}{/if}, {fmtBytes(info.bytes)}{#if info.failed} · {info.failed} could not be fetched{/if}. It opens without a connection.</p>
    {:else}
      <p>Downloads every photo{#if plan?.tiles.length}{" "}and the map of the area ({plan.tiles.length} tiles){/if} to this device, so the gallery works on a plane or abroad without data.</p>
    {/if}
    {#if plan && !info}<p class="muted small">{plan.media.length} images{#if !getTileTemplate()} · map not yet ready, photos only{/if}</p>{/if}
    {#if progress}
      <div class="bar" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}><div class="fill" style:width="{progress.total ? (progress.done / progress.total) * 100 : 0}%"></div></div>
      <p class="muted small">{progress.done} / {progress.total} · {fmtBytes(progress.bytes)}</p>
    {/if}
    {#if error}<p class="err">{error}</p>{/if}
    <div class="actions">
      {#if info}
        <button class="btn" disabled={busy} onclick={save}>{busy ? "Updating…" : "Update"}</button>
        <button class="btn danger" disabled={busy} onclick={forget}>Remove</button>
      {:else}
        <button class="btn primary" disabled={busy} onclick={save}>{busy ? "Saving…" : "Save for offline"}</button>
      {/if}
      <span class="spacer"></span>
      <button class="btn" onclick={() => (open = false)}>Close</button>
      <span class="muted small version">itineris {APP_VERSION}</span>
    </div>
  </aside>
{/if}

<style>
  .save {
    flex: 0 0 auto; width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--line);
    background: var(--panel); backdrop-filter: blur(12px); color: var(--text); cursor: pointer; font-size: 16px; display: grid; place-items: center;
  }
  .save.on { color: #4dd4ac; border-color: color-mix(in srgb, #4dd4ac 50%, transparent); }
  .scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); z-index: 30; }
  .sheet {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 31;
    background: var(--panel); border-radius: 18px 18px 0 0; padding: 8px 18px max(18px, env(safe-area-inset-bottom));
    box-shadow: 0 -20px 60px rgba(0, 0, 0, 0.6); color: var(--text);
  }
  @media (min-width: 760px) { .sheet { left: 50%; right: auto; bottom: 50%; translate: -50% 50%; width: 440px; border-radius: 18px; } }
  .grab { width: 40px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.2); margin: 4px auto 12px; }
  h2 { margin: 0 0 8px; font-size: 17px; }
  p { margin: 0 0 10px; line-height: 1.5; }
  .small { font-size: 12px; }
  .version { margin-left: auto; align-self: center; opacity: 0.6; }
  .bar { height: 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
  .fill { height: 100%; background: #4dd4ac; transition: width 120ms linear; }
  .err { color: #ff8080; }
  .actions { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
  .spacer { flex: 1; }
  .btn { padding: 9px 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--text); cursor: pointer; }
  .btn.primary { background: #4dd4ac; border-color: #4dd4ac; color: #05261c; font-weight: 600; }
  .btn.danger { color: #ff8080; }
  .btn:disabled { opacity: 0.5; }
</style>
