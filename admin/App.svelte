<script>
  import { onMount } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { api } from "./lib/api.js";
  import { TAG_COLOR } from "../src/lib/data.js";
  import Uploader from "./Uploader.svelte";
  import MomentList from "./MomentList.svelte";
  import MomentEditor from "./MomentEditor.svelte";
  import GalleryList from "./GalleryList.svelte";
  import BulkBar from "./BulkBar.svelte";

  let me = $state(null);
  let moments = $state([]);
  let tracks = $state([]);
  let galleries = $state([]);
  let error = $state(null);
  let tab = $state("photos");          // photos | galleries
  let filter = $state("all");          // all | private | <galleryId>
  let editingId = $state(null);
  let selectMode = $state(false);
  const selection = new SvelteSet();

  const editing = $derived(moments.find((m) => m.id === editingId) ?? null);
  const suggestions = $derived([...new Set([...Object.keys(TAG_COLOR), ...moments.flatMap((m) => m.tags)])].sort());
  const untagged = $derived(moments.filter((m) => m.tags.length === 0).length);
  const unplaced = $derived(moments.filter((m) => m.lat === null || m.lng === null).length);
  const privateCount = $derived(moments.filter((m) => m.galleries.length === 0).length);
  const currentGallery = $derived(galleries.find((g) => g.id === filter) ?? null);
  const shown = $derived(
    filter === "all" ? moments
    : filter === "private" ? moments.filter((m) => m.galleries.length === 0)
    : moments.filter((m) => m.galleries.includes(filter))
  );
  // For "use the previous/next photo's location" in the editor.
  const neighbours = $derived.by(() => {
    if (!editing) return { prev: null, next: null };
    const sorted = [...moments].sort((a, b) => (a.t < b.t ? -1 : 1));
    const i = sorted.findIndex((m) => m.id === editing.id);
    const placed = (m) => m && m.lat !== null && m.lng !== null;
    return { prev: sorted.slice(0, i).reverse().find(placed) ?? null, next: sorted.slice(i + 1).find(placed) ?? null };
  });

  async function refresh() {
    try {
      const lib = await api.library();
      moments = lib.moments; tracks = lib.tracks; galleries = lib.galleries;
      error = null;
    } catch (e) { error = e.message; }
  }
  onMount(async () => {
    try { me = await api.me(); await refresh(); } catch (e) { error = e.message; }
  });

  function onUploaded(result) {
    refresh();
    if (result.created?.length) editingId = result.created[0].id;
  }
  function onSaved(m) { moments = moments.map((x) => (x.id === m.id ? m : x)); }
  function onDeleted(id) { moments = moments.filter((x) => x.id !== id); editingId = null; selection.delete(id); }
  function toggleSelect(id) { selection.has(id) ? selection.delete(id) : selection.add(id); }
  function exitSelect() { selectMode = false; selection.clear(); }
  // Leaving the current context ends selection mode: a stale selection under a
  // different filter or tab is how the wrong photos get bulk-edited.
  function showGallery(id) { exitSelect(); filter = id; tab = "photos"; }
  function switchTab(t) { exitSelect(); tab = t; }

  $effect(() => {
    // Escape backs out of whatever is open.
    const onKey = (e) => { if (e.key === "Escape") { if (editingId) editingId = null; else if (selectMode) exitSelect(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
</script>

<header>
  <div class="brand">
    <strong>itineris</strong> <span class="muted">admin</span>
    {#if me}<span class="muted who">· {me.email}</span>{/if}
  </div>
  <a class="muted small" href="/" target="_blank" rel="noopener">view site ↗</a>
</header>

<nav class="tabs" aria-label="Sections">
  <button class:on={tab === "photos"} aria-pressed={tab === "photos"} onclick={() => switchTab("photos")}>Photos <span class="n">{moments.length}</span></button>
  <button class:on={tab === "galleries"} aria-pressed={tab === "galleries"} onclick={() => switchTab("galleries")}>Galleries <span class="n">{galleries.length}</span></button>
</nav>

<main>
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if tab === "photos"}
    <Uploader onDone={onUploaded} gallery={currentGallery} />

    <section class="toolbar">
      <label class="filter">
        <span class="muted small">Show</span>
        <select bind:value={filter} onchange={exitSelect} aria-label="Filter photos">
          <option value="all">All photos ({moments.length})</option>
          <option value="private">Not in any gallery ({privateCount})</option>
          {#each galleries as g (g.id)}<option value={g.id}>{g.title} ({g.count})</option>{/each}
        </select>
      </label>
      <span class="spacer"></span>
      {#if untagged}<span class="badge warn">{untagged} untagged</span>{/if}
      {#if unplaced}<span class="badge warn">{unplaced} no location</span>{/if}
      <button class="btn small" class:on={selectMode} aria-pressed={selectMode} onclick={() => (selectMode ? exitSelect() : (selectMode = true))}>{selectMode ? "Done" : "Select"}</button>
    </section>

    {#if currentGallery}
      <p class="hint muted small">Showing <strong>{currentGallery.title}</strong>. Photos you add now go straight into it.</p>
    {/if}

    <MomentList moments={shown} selectedId={editingId} {selectMode} {selection}
      onSelect={(id) => (selectMode ? toggleSelect(id) : (editingId = id))} />
  {:else}
    <GalleryList {galleries} {tracks} onChange={refresh} onShow={showGallery} />
  {/if}
</main>

{#if selectMode && selection.size}
  <BulkBar {selection} {galleries} {suggestions} onDone={() => { refresh(); }} onExit={exitSelect} />
{/if}

{#if editing}
  {#key editing.id}
    <MomentEditor moment={editing} {galleries} {suggestions} {neighbours} {onSaved} {onDeleted} onClose={() => (editingId = null)} />
  {/key}
{/if}

<style>
  header {
    position: sticky; top: 0; z-index: 5;
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: max(12px, env(safe-area-inset-top)) 16px 10px;
    background: rgba(11, 13, 16, 0.92); backdrop-filter: blur(12px);
  }
  header a { text-decoration: none; }
  .who { font-size: 13px; }
  .tabs {
    position: sticky; top: 0; z-index: 4; display: flex; gap: 4px; padding: 0 12px 8px;
    background: rgba(11, 13, 16, 0.92); backdrop-filter: blur(12px); border-bottom: 1px solid var(--line);
  }
  .tabs button { padding: 8px 14px; border-radius: 10px; border: 1px solid transparent; background: transparent; color: var(--muted); }
  .tabs button.on { background: var(--panel); color: #fff; border-color: var(--line); }
  .n { font-size: 11px; opacity: 0.6; }
  main { max-width: 960px; margin: 0 auto; padding: 14px 14px 120px; }
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 18px 2px 8px; }
  .filter { display: flex; align-items: center; gap: 8px; }
  .filter select { width: auto; max-width: 60vw; padding: 7px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--text); }
  .spacer { flex: 1; }
  .btn.small { padding: 7px 12px; }
  .btn.on { background: rgba(255, 255, 255, 0.16); color: #fff; }
  .hint { margin: 0 2px 8px; }
  .small { font-size: 13px; }
  .error { padding: 10px 14px; border-radius: 10px; background: color-mix(in srgb, var(--danger) 18%, transparent); color: var(--danger); }
</style>
