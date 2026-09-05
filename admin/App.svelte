<script>
  import { onMount } from "svelte";
  import { api } from "./lib/api.js";
  import { TAG_COLOR } from "../src/lib/data.js";
  import Uploader from "./Uploader.svelte";
  import MomentList from "./MomentList.svelte";
  import MomentEditor from "./MomentEditor.svelte";

  let me = $state(null);
  let moments = $state([]);
  let error = $state(null);
  let editingId = $state(null);

  const editing = $derived(moments.find((m) => m.id === editingId) ?? null);
  // Tag suggestions: what the viewer already colours, plus everything used so far.
  const suggestions = $derived([...new Set([...Object.keys(TAG_COLOR), ...moments.flatMap((m) => m.tags)])].sort());
  const untagged = $derived(moments.filter((m) => m.tags.length === 0).length);
  const unplaced = $derived(moments.filter((m) => m.lat === null || m.lng === null).length);

  async function refresh() {
    try { moments = await api.moments(); error = null; } catch (e) { error = e.message; }
  }
  onMount(async () => {
    try { me = await api.me(); await refresh(); } catch (e) { error = e.message; }
  });

  function onUploaded(result) {
    refresh();
    // Land on the first new photo so tagging starts immediately.
    if (result.created?.length) editingId = result.created[0].id;
  }
  function onSaved(m) { moments = moments.map((x) => (x.id === m.id ? m : x)); }
  function onDeleted(id) { moments = moments.filter((x) => x.id !== id); editingId = null; }
</script>

<header>
  <div>
    <strong>itineris</strong> <span class="muted">admin</span>
    {#if me}<span class="muted who">· {me.email}</span>{/if}
  </div>
  <a class="muted" href="/" target="_blank" rel="noopener">view site ↗</a>
</header>

<main>
  {#if error}
    <p class="error">{error}</p>
  {/if}

  <Uploader onDone={onUploaded} />

  <section class="stats">
    <span>{moments.length} moments</span>
    {#if untagged}<span class="badge warn">{untagged} untagged</span>{/if}
    {#if unplaced}<span class="badge warn">{unplaced} without location</span>{/if}
  </section>

  <MomentList {moments} selectedId={editingId} onSelect={(id) => (editingId = id)} />
</main>

{#if editing}
  {#key editing.id}
    <MomentEditor moment={editing} {suggestions} {onSaved} {onDeleted} onClose={() => (editingId = null)} />
  {/key}
{/if}

<style>
  header {
    position: sticky; top: 0; z-index: 5;
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: max(12px, env(safe-area-inset-top)) 16px 12px;
    background: rgba(11, 13, 16, 0.92); backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--line);
  }
  header a { text-decoration: none; font-size: 13px; }
  .who { font-size: 13px; }
  main { max-width: 900px; margin: 0 auto; padding: 14px 14px 40px; }
  .stats { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 18px 2px 8px; color: var(--muted); font-size: 13px; }
  .error { padding: 10px 14px; border-radius: 10px; background: color-mix(in srgb, var(--danger) 18%, transparent); color: var(--danger); }
</style>
