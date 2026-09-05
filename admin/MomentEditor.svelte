<script>
  import { api, mediaUrl } from "./lib/api.js";

  let { moment, suggestions = [], onSaved, onDeleted, onClose } = $props();

  let caption = $state(moment.caption ?? "");
  let place = $state(moment.place ?? "");
  let tags = $state([...moment.tags]);
  let lat = $state(moment.lat ?? "");
  let lng = $state(moment.lng ?? "");
  let t = $state(moment.t);
  let tagDraft = $state("");
  let saving = $state(false);
  let error = $state(null);
  let confirmDelete = $state(false);

  const dirty = $derived(
    caption !== (moment.caption ?? "") || place !== (moment.place ?? "") || tags.join() !== moment.tags.join() ||
    String(lat) !== String(moment.lat ?? "") || String(lng) !== String(moment.lng ?? "") || t !== moment.t
  );
  const offered = $derived(suggestions.filter((s) => !tags.includes(s) && (!tagDraft || s.includes(tagDraft.toLowerCase()))).slice(0, 12));

  function addTag(raw) {
    const v = raw.trim().toLowerCase().replace(/[,#]/g, "");
    if (v && !tags.includes(v)) tags = [...tags, v];
    tagDraft = "";
  }
  function onTagKey(e) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagDraft); }
    else if (e.key === "Backspace" && !tagDraft && tags.length) tags = tags.slice(0, -1);
  }

  async function save() {
    saving = true; error = null;
    try {
      const body = { caption, place, tags, t };
      const hasLat = lat !== "" && lat !== null, hasLng = lng !== "" && lng !== null;
      if (hasLat !== hasLng) throw new Error("Give both latitude and longitude, or neither.");
      body.lat = hasLat ? +lat : null; body.lng = hasLng ? +lng : null;
      onSaved?.(await api.patch(moment.id, body));
      onClose?.();
    } catch (e) { error = e.message; } finally { saving = false; }
  }
  async function remove() {
    saving = true; error = null;
    try { await api.remove(moment.id); onDeleted?.(moment.id); }
    catch (e) { error = e.message; } finally { saving = false; }
  }
</script>

<div class="scrim" onclick={onClose} role="presentation"></div>
<aside class="sheet" role="dialog" aria-label="Edit moment">
  <div class="grab"></div>
  <div class="top">
    <img src={mediaUrl(moment.media.src)} alt="" />
    <div class="meta">
      <div class="muted small">{moment.filename ?? moment.id}{#if moment.camera} · {moment.camera}{/if}</div>
      <div class="muted small">{moment.media.w}×{moment.media.h}{#if moment.uploadedBy} · by {moment.uploadedBy}{/if}</div>
      {#if moment.tz === "unknown"}<span class="badge warn">time zone unknown — check the time</span>{/if}
      {#if moment.lat === null}<span class="badge warn">no GPS — add a location</span>{/if}
    </div>
  </div>

  <label>Caption<textarea rows="2" bind:value={caption} placeholder="What was this?"></textarea></label>
  <label>Place<input bind:value={place} placeholder="Chinatown Complex" /></label>

  <label>Tags
    <div class="chips" onclick={(e) => e.currentTarget.querySelector("input")?.focus()} role="presentation">
      {#each tags as tag (tag)}
        <button type="button" class="chip" onclick={() => (tags = tags.filter((x) => x !== tag))} title="remove">{tag} ✕</button>
      {/each}
      <input class="chipin" bind:value={tagDraft} onkeydown={onTagKey} onblur={() => tagDraft && addTag(tagDraft)} placeholder={tags.length ? "" : "food, run, night…"} />
    </div>
  </label>
  {#if offered.length}
    <div class="offer">
      {#each offered as s (s)}<button type="button" class="chip ghost" onclick={() => addTag(s)}>+ {s}</button>{/each}
    </div>
  {/if}

  <div class="row">
    <label>Latitude<input inputmode="decimal" bind:value={lat} placeholder="1.2829" /></label>
    <label>Longitude<input inputmode="decimal" bind:value={lng} placeholder="103.8443" /></label>
  </div>
  <label>Time <span class="muted small">(local, with offset)</span><input bind:value={t} spellcheck="false" /></label>

  {#if error}<p class="err">{error}</p>{/if}

  <div class="actions">
    {#if confirmDelete}
      <button class="btn danger" disabled={saving} onclick={remove}>Delete for real (the original file is kept)</button>
      <button class="btn" onclick={() => (confirmDelete = false)}>Keep</button>
    {:else}
      <button class="btn danger" disabled={saving} onclick={() => (confirmDelete = true)}>Delete</button>
      <span class="spacer"></span>
      <button class="btn" onclick={onClose}>Cancel</button>
      <button class="btn primary" disabled={saving || !dirty} onclick={save}>{saving ? "Saving…" : "Save"}</button>
    {/if}
  </div>
</aside>

<style>
  .scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); z-index: 20; }
  .sheet {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 21; max-height: 92vh; overflow-y: auto;
    background: var(--panel); border-radius: 18px 18px 0 0; padding: 8px 16px max(16px, env(safe-area-inset-bottom));
    box-shadow: 0 -20px 60px rgba(0, 0, 0, 0.6);
  }
  @media (min-width: 760px) {
    .sheet { left: 50%; right: auto; bottom: 50%; translate: -50% 50%; width: 560px; max-height: 88vh; border-radius: 18px; }
  }
  .grab { width: 40px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.2); margin: 4px auto 12px; }
  .top { display: flex; gap: 12px; margin-bottom: 14px; }
  .top img { width: 96px; height: 128px; object-fit: cover; border-radius: 10px; flex: 0 0 auto; background: var(--bg); }
  .meta { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; min-width: 0; }
  .small { font-size: 12px; overflow-wrap: anywhere; }
  label { display: block; font-size: 12px; color: var(--muted); margin: 10px 0 0; }
  label input, label textarea { margin-top: 5px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 5px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); cursor: text; }
  .chip { padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); background: rgba(255, 255, 255, 0.08); color: var(--text); font-size: 13px; }
  .chip.ghost { background: transparent; color: var(--muted); }
  .chipin { flex: 1 1 90px; min-width: 90px; border: 0; background: transparent; padding: 4px 2px; }
  .offer { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .err { color: var(--danger); font-size: 13px; }
  .actions { display: flex; gap: 8px; align-items: center; margin-top: 18px; flex-wrap: wrap; }
  .spacer { flex: 1; }
</style>
