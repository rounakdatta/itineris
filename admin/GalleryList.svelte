<script>
  import { api, galleryUrl, copyText } from "./lib/api.js";

  let { galleries, tracks = [], onChange, onShow } = $props();
  let creating = $state(false);
  let title = $state("");
  let description = $state("");
  let editingId = $state(null);
  let busy = $state(false);
  let error = $state(null);
  let copied = $state(null);

  async function run(fn) { busy = true; error = null; try { await fn(); onChange?.(); } catch (e) { error = e.message; } finally { busy = false; } }
  const create = () => run(async () => { await api.createGallery({ title, description, home: galleries.length === 0 }); title = ""; description = ""; creating = false; });
  const save = (g) => run(async () => { await api.patchGallery(g.id, { title, description }); editingId = null; });
  const setHome = (g) => run(() => api.patchGallery(g.id, { home: !g.home }));
  const remove = (g) => { if (window.confirm(`Delete “${g.title}”? Its link stops working. Photos stay in the library.`)) run(() => api.removeGallery(g.id)); };
  const toggleTrack = (g, tid) => run(() => api.patchGallery(g.id, (g.trackIds ?? []).includes(tid) ? { removeTracks: [tid] } : { addTracks: [tid] }));
  async function copy(g) { copied = (await copyText(galleryUrl(g.id))) ? g.id : "fail"; setTimeout(() => (copied = null), 1600); }
</script>

<section class="intro">
  <p class="muted">A gallery is a link. Put any subset of photos in it, share the link with one group, make another for another group. Photos can be in as many as you like, and uploads are private until they're in one.</p>
  {#if !creating}
    <button class="btn primary" onclick={() => (creating = true)}>New gallery</button>
  {:else}
    <form class="new" onsubmit={(e) => { e.preventDefault(); if (title.trim()) create(); }}>
      <input bind:value={title} placeholder="Title — e.g. Singapore, for the family" maxlength="120" aria-label="Title" />
      <input bind:value={description} placeholder="A line of description (optional)" maxlength="1000" aria-label="Description" />
      <div class="actions"><button class="btn primary" type="submit" disabled={busy || !title.trim()}>Create</button><button class="btn" type="button" onclick={() => (creating = false)}>Cancel</button></div>
    </form>
  {/if}
  {#if error}<p class="err" role="alert">{error}</p>{/if}
</section>

{#each galleries as g (g.id)}
  <article class="gallery" class:home={g.home}>
    {#if editingId === g.id}
      <form class="edit" onsubmit={(e) => { e.preventDefault(); save(g); }}>
        <input bind:value={title} maxlength="120" aria-label="Title" />
        <input bind:value={description} maxlength="1000" placeholder="Description" aria-label="Description" />
        <div class="actions"><button class="btn primary" type="submit" disabled={busy || !title.trim()}>Save</button><button class="btn" type="button" onclick={() => (editingId = null)}>Cancel</button></div>
      </form>
    {:else}
      <div class="head">
        <div>
          <h3>{g.title} {#if g.home}<span class="badge">home · shown at /</span>{/if}</h3>
          {#if g.description}<p class="muted desc">{g.description}</p>{/if}
          <p class="muted small">{g.count} photo{g.count === 1 ? "" : "s"}{#if g.trackCount}{" · "}{g.trackCount} route{g.trackCount === 1 ? "" : "s"}{/if}</p>
        </div>
      </div>
      <div class="link">
        <code>{galleryUrl(g.id)}</code>
        <button class="btn small" onclick={() => copy(g)}>{copied === g.id ? "Copied" : copied === "fail" ? "Copy failed" : "Copy link"}</button>
        <a class="btn small" href={galleryUrl(g.id)} target="_blank" rel="noopener">Open ↗</a>
      </div>
      {#if tracks.length}
        <div class="tracks">
          <span class="muted small">Routes:</span>
          {#each tracks as t (t.id)}
            <button class="chip" class:on={(g.trackIds ?? []).includes(t.id)} aria-pressed={(g.trackIds ?? []).includes(t.id)} onclick={() => toggleTrack(g, t.id)}>{t.name ?? t.id}</button>
          {/each}
        </div>
      {/if}
      <div class="actions">
        <button class="btn small" onclick={() => onShow?.(g.id)}>Show photos</button>
        <button class="btn small" onclick={() => { editingId = g.id; title = g.title; description = g.description ?? ""; }}>Edit</button>
        <button class="btn small" onclick={() => setHome(g)} disabled={busy}>{g.home ? "Unset home" : "Make home"}</button>
        <span class="spacer"></span>
        <button class="btn small danger" onclick={() => remove(g)} disabled={busy}>Delete</button>
      </div>
    {/if}
  </article>
{/each}

<style>
  .intro { margin: 8px 2px 18px; }
  .intro p { margin: 0 0 12px; }
  .new, .edit { display: grid; gap: 8px; }
  .gallery { padding: 14px; border-radius: 14px; background: var(--panel); border: 1px solid var(--line); margin-bottom: 12px; }
  .gallery.home { border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
  h3 { margin: 0 0 4px; font-size: 16px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .desc { margin: 0 0 4px; }
  .small { font-size: 13px; margin: 0; }
  .link { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0; }
  code { font-size: 12px; padding: 6px 8px; border-radius: 8px; background: var(--bg); color: var(--muted); overflow-wrap: anywhere; flex: 1 1 200px; }
  .tracks { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; }
  .chip { padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--muted); font-size: 13px; }
  .chip.on { background: rgba(77, 212, 172, 0.16); border-color: var(--ok); color: #fff; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .btn.small { padding: 7px 12px; font-size: 14px; text-decoration: none; }
  .spacer { flex: 1; }
  .badge { font-size: 11px; text-transform: none; letter-spacing: 0; }
  .err { color: var(--danger); }
</style>
