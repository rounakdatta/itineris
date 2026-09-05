<script>
  import { api } from "./lib/api.js";

  let { selection, galleries, suggestions = [], onDone, onExit } = $props();
  let busy = $state(false);
  let error = $state(null);
  let mode = $state(null);      // null | "gallery" | "ungallery" | "tag" | "delete"
  let pick = $state("");
  let tag = $state("");

  const ids = $derived([...selection]);

  async function run(fn) {
    busy = true; error = null;
    try { await fn(); onDone?.(); mode = null; }
    catch (e) { error = e.message; }
    finally { busy = false; }
  }
  const addToGallery = () => run(async () => {
    let gid = pick;
    if (gid === "__new__") {
      const title = window.prompt("Name the new gallery");
      if (!title?.trim()) return;
      gid = (await api.createGallery({ title: title.trim() })).id;
    }
    if (!gid) return;
    await api.patchGallery(gid, { add: ids });
  });
  const removeFromGallery = () => run(() => api.patchGallery(pick, { remove: ids }));
  const addTag = () => run(() => api.bulk(ids, { addTags: [tag] }));
  const remove = () => run(async () => { for (const id of ids) await api.remove(id); selection.clear(); });
</script>

<div class="bulk" role="region" aria-label="Bulk actions">
  <div class="row">
    <strong>{ids.length} selected</strong>
    <span class="spacer"></span>
    {#if !mode}
      <button class="btn small" onclick={() => { mode = "gallery"; pick = galleries[0]?.id ?? "__new__"; }}>Add to gallery</button>
      {#if galleries.length}<button class="btn small" onclick={() => { mode = "ungallery"; pick = galleries[0].id; }}>Remove from gallery</button>{/if}
      <button class="btn small" onclick={() => { mode = "tag"; tag = ""; }}>Tag</button>
      <button class="btn small danger" onclick={() => (mode = "delete")}>Delete</button>
      <button class="btn small" onclick={onExit}>Cancel</button>
    {:else if mode === "gallery"}
      <select bind:value={pick} aria-label="Gallery">
        {#each galleries as g (g.id)}<option value={g.id}>{g.title}</option>{/each}
        <option value="__new__">New gallery…</option>
      </select>
      <button class="btn small primary" disabled={busy} onclick={addToGallery}>Add</button>
      <button class="btn small" onclick={() => (mode = null)}>Back</button>
    {:else if mode === "ungallery"}
      <select bind:value={pick} aria-label="Gallery">{#each galleries as g (g.id)}<option value={g.id}>{g.title}</option>{/each}</select>
      <button class="btn small primary" disabled={busy} onclick={removeFromGallery}>Remove</button>
      <button class="btn small" onclick={() => (mode = null)}>Back</button>
    {:else if mode === "tag"}
      <input list="bulk-tags" bind:value={tag} placeholder="tag" aria-label="Tag to add" onkeydown={(e) => e.key === "Enter" && tag.trim() && addTag()} />
      <datalist id="bulk-tags">{#each suggestions as s (s)}<option value={s}></option>{/each}</datalist>
      <button class="btn small primary" disabled={busy || !tag.trim()} onclick={addTag}>Add tag</button>
      <button class="btn small" onclick={() => (mode = null)}>Back</button>
    {:else if mode === "delete"}
      <span class="muted small">Delete {ids.length} from the journal? Originals are kept.</span>
      <button class="btn small danger" disabled={busy} onclick={remove}>Delete</button>
      <button class="btn small" onclick={() => (mode = null)}>Keep</button>
    {/if}
  </div>
  {#if error}<p class="err">{error}</p>{/if}
</div>

<style>
  .bulk {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 15;
    padding: 12px 14px max(12px, env(safe-area-inset-bottom));
    background: rgba(20, 24, 30, 0.96); backdrop-filter: blur(14px); border-top: 1px solid var(--line);
  }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; max-width: 960px; margin: 0 auto; }
  .spacer { flex: 1; }
  .btn.small { padding: 7px 12px; font-size: 14px; }
  select, input { width: auto; max-width: 48vw; padding: 7px 10px; }
  .err { color: var(--danger); margin: 8px 0 0; font-size: 13px; }
  .small { font-size: 13px; }
</style>
