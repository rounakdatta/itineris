<script>
  import { api, mediaUrl, splitIso, joinIso, OFFSETS, storyUrl } from "./lib/api.js";
  import MapPicker from "./MapPicker.svelte";

  // `pending`: a queued photo that has not been uploaded yet. Same fields, but
  // saving writes to the on-device queue (onSaveLocal) instead of the server.
  let { moment, pending = false, galleries = [], suggestions = [], neighbours = { prev: null, next: null }, known = [], placesEnabled = false, onSaved, onSaveLocal, onDeleted, onClose } = $props();

  let caption = $state(moment.caption ?? "");
  let place = $state(moment.place ?? "");
  let tags = $state([...moment.tags]);
  let lat = $state(moment.lat ?? "");
  let lng = $state(moment.lng ?? "");
  let mapsUrl = $state(moment.mapsUrl ?? null);   // exact Google Maps link, when the spot came from one
  let placeId = $state(moment.placeId ?? moment.google?.placeId ?? null);   // pinned to this Google place (one pin with its siblings)
  const t0 = splitIso(moment.t);
  let local = $state(t0.local);
  let offset = $state(t0.offset);
  let inGalleries = $state([...(moment.galleries ?? [])]);
  let tagDraft = $state("");
  let saving = $state(false);
  let error = $state(null);
  let confirmDelete = $state(false);
  let showMap = $state(false);
  let google = $state(moment.google ?? null);
  let googleBusy = $state(false);
  let googleNote = $state(null);
  async function refreshGoogle() {
    googleBusy = true; googleNote = null;
    try { const r = await api.refreshGoogle(moment.id); google = r.google ?? null; if (r.placesError) googleNote = r.placesError; else if (!google?.placeId) googleNote = "Google has nothing by that name near this spot."; onSaved?.(r); }
    catch (e) { googleNote = e.message; }
    finally { googleBusy = false; }
  }

  const t = $derived(local && offset ? joinIso({ local, seconds: local === t0.local ? t0.seconds : ":00", offset }) : moment.t);
  const offsets = $derived(OFFSETS.includes(offset) ? OFFSETS : [...OFFSETS, offset].sort());
  const numLat = $derived(lat === "" || lat === null ? null : +lat);
  const numLng = $derived(lng === "" || lng === null ? null : +lng);
  const dirty = $derived(
    caption !== (moment.caption ?? "") || place !== (moment.place ?? "") || tags.join() !== moment.tags.join() ||
    String(lat) !== String(moment.lat ?? "") || String(lng) !== String(moment.lng ?? "") || t !== moment.t || (mapsUrl ?? null) !== (moment.mapsUrl ?? null) || (placeId ?? null) !== (moment.placeId ?? moment.google?.placeId ?? null) ||
    inGalleries.slice().sort().join() !== (moment.galleries ?? []).slice().sort().join()
  );
  const offered = $derived(suggestions.filter((s) => !tags.includes(s) && (!tagDraft || s.includes(tagDraft.toLowerCase()))).slice(0, 12));
  const homeGallery = $derived(galleries.find((g) => g.home));
  const viewerLink = $derived(inGalleries.length ? storyUrl(homeGallery && inGalleries.includes(homeGallery.id) ? null : inGalleries[0], moment.id) : null);

  function addTag(raw) {
    const v = raw.trim().toLowerCase().replace(/[,#]/g, "");
    if (v && !tags.includes(v)) tags = [...tags, v];
    tagDraft = "";
  }
  function onTagKey(e) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagDraft); }
    else if (e.key === "Backspace" && !tagDraft && tags.length) tags = tags.slice(0, -1);
  }
  function useLocation(m) { lat = m.lat; lng = m.lng; mapsUrl = m.mapsUrl ?? null; placeId = m.placeId ?? m.google?.placeId ?? null; }
  function pickPlace(p) { if (!p) { placeId = null; return; } placeId = p.placeId ?? null; if (p.google) google = p.google; }
  function toggleGallery(id) { inGalleries = inGalleries.includes(id) ? inGalleries.filter((x) => x !== id) : [...inGalleries, id]; }

  async function save() {
    saving = true; error = null;
    try {
      const hasLat = lat !== "" && lat !== null, hasLng = lng !== "" && lng !== null;
      if (hasLat !== hasLng) throw new Error("Give both latitude and longitude, or neither.");
      if (pending) {
        const locEdited = String(lat) !== String(moment.lat ?? "") || String(lng) !== String(moment.lng ?? "");
        await onSaveLocal?.({ caption, place, tags, galleries: inGalleries, lat: hasLat ? +lat : null, lng: hasLng ? +lng : null, mapsUrl: hasLat ? mapsUrl ?? null : null, placeId: hasLat ? placeId ?? null : null, t, locEdited: moment.locEdited || locEdited, timeEdited: moment.timeEdited || t !== moment.t });
        return;
      }
      const body = { caption, place, tags, t, lat: hasLat ? +lat : null, lng: hasLng ? +lng : null, mapsUrl: hasLat ? mapsUrl ?? null : null, placeId: hasLat ? placeId ?? null : null };
      let saved = await api.patch(moment.id, body);
      const before = new Set(moment.galleries ?? []), after = new Set(inGalleries);
      for (const gid of after) if (!before.has(gid)) await api.patchGallery(gid, { add: [moment.id] });
      for (const gid of before) if (!after.has(gid)) await api.patchGallery(gid, { remove: [moment.id] });
      saved = { ...saved, galleries: inGalleries };
      onSaved?.(saved);
      onClose?.();
    } catch (e) { error = e.message; } finally { saving = false; }
  }
  async function remove() {
    saving = true; error = null;
    try { if (!pending) await api.remove(moment.id); onDeleted?.(moment.id); }
    catch (e) { error = e.message; } finally { saving = false; }
  }
</script>

<div class="scrim" onclick={onClose} role="presentation"></div>
<aside class="sheet" role="dialog" aria-modal="true" aria-label="Edit moment">
  <div class="grab" aria-hidden="true"></div>
  <div class="top">
    <img src={pending ? moment.media.src : mediaUrl(moment.media.src)} alt="" />
    <div class="meta">
      <div class="muted small">{moment.filename ?? moment.id}{#if moment.camera} · {moment.camera}{/if}</div>
      {#if !pending}<div class="muted small">{moment.media.w}×{moment.media.h}{#if moment.uploadedBy} · by {moment.uploadedBy}{/if}</div>{/if}
      {#if pending}<span class="badge">waiting to upload — edits are kept on this device</span>{/if}
      {#if moment.tz === "unknown"}<span class="badge warn">time zone unknown — check the time</span>{/if}
      {#if moment.lat === null}<span class="badge warn">no GPS — set a location</span>{/if}
      {#if viewerLink && !pending}<a class="small" href={viewerLink} target="_blank" rel="noopener">open in viewer ↗</a>{/if}
      {#if !pending}
        <div class="google small">
          {#if google?.placeId}
            <span class="muted">Google:</span> <b>{Number.isFinite(google.rating) ? google.rating.toFixed(1) : "–"}</b><span class="star" aria-hidden="true">★</span>{#if google.ratingCount}<span class="muted"> ({google.ratingCount.toLocaleString("en")})</span>{/if}{#if google.type}<span class="muted"> · {google.type}</span>{/if}
            {#if google.mapsUri}<a href={google.mapsUri} target="_blank" rel="noopener">↗</a>{/if}
          {:else}
            <span class="muted">Google: {googleNote ?? "not looked up yet"}</span>
          {/if}
          <button type="button" class="btn tiny" disabled={googleBusy} onclick={refreshGoogle} title="Ask Google about this place again">{googleBusy ? "…" : "↻"}</button>
        </div>
        {#if googleNote && google?.placeId}<div class="muted small">{googleNote}</div>{/if}
      {/if}
    </div>
  </div>

  <label>Caption<textarea rows="2" bind:value={caption} placeholder="What was this?"></textarea></label>
  <label>Place<input bind:value={place} placeholder="Chinatown Complex" /></label>

  <label>Tags
    <div class="chips" onclick={(e) => e.currentTarget.querySelector("input")?.focus()} role="presentation">
      {#each tags as tag (tag)}
        <button type="button" class="chip" onclick={() => (tags = tags.filter((x) => x !== tag))} title="remove" aria-label={`remove ${tag}`}>{tag} ✕</button>
      {/each}
      <input class="chipin" bind:value={tagDraft} onkeydown={onTagKey} onblur={() => tagDraft && addTag(tagDraft)} placeholder={tags.length ? "" : "food, run, night…"} aria-label="Add a tag" />
    </div>
  </label>
  {#if offered.length}
    <div class="offer">{#each offered as s (s)}<button type="button" class="chip ghost" onclick={() => addTag(s)}>+ {s}</button>{/each}</div>
  {/if}

  <fieldset class="galleries">
    <legend>Galleries <span class="muted small">{inGalleries.length ? "" : "— not shared anywhere yet"}</span></legend>
    {#if galleries.length === 0}<p class="muted small">No galleries yet. Create one in the Galleries tab.</p>{/if}
    {#each galleries as g (g.id)}
      <label class="gal"><input type="checkbox" checked={inGalleries.includes(g.id)} onchange={() => toggleGallery(g.id)} /> {g.title}{#if g.home}<span class="muted small"> · home</span>{/if}</label>
    {/each}
  </fieldset>

  <div class="loc-head">
    <span class="lbl">Location</span>
    <span class="spacer"></span>
    {#if neighbours.prev}<button type="button" class="btn tiny" onclick={() => useLocation(neighbours.prev)} title={neighbours.prev.place || neighbours.prev.id}>← use previous photo's</button>{/if}
    {#if neighbours.next}<button type="button" class="btn tiny" onclick={() => useLocation(neighbours.next)} title={neighbours.next.place || neighbours.next.id}>use next photo's →</button>{/if}
    <button type="button" class="btn tiny" aria-pressed={showMap} onclick={() => (showMap = !showMap)}>{showMap ? "Hide map" : "Pick on map"}</button>
  </div>
  {#if showMap}
    <MapPicker lat={numLat} lng={numLng} hint={neighbours.prev ?? neighbours.next} {known} {placesEnabled} onChange={(a, b) => { lat = a; lng = b; }} onPlace={(name) => (place = name)} onLink={(u) => (mapsUrl = u)} onPick={pickPlace} />
  {/if}
  {#if placeId}
    <p class="muted small linked">Pinned to a Google place{#if google?.name} — <b>{google.name}</b>{/if}: photos here share one pin. <button type="button" class="btn tiny" onclick={() => { placeId = null; mapsUrl = null; }}>Unpin</button></p>
  {:else if mapsUrl}
    <p class="muted small linked"><a href={mapsUrl} target="_blank" rel="noopener">Linked to the exact place on Google Maps ↗</a> <button type="button" class="btn tiny" onclick={() => (mapsUrl = null)}>Unlink</button></p>
  {/if}
  <div class="row">
    <label>Latitude<input inputmode="decimal" bind:value={lat} placeholder="1.2829" oninput={() => { mapsUrl = null; placeId = null; }} /></label>
    <label>Longitude<input inputmode="decimal" bind:value={lng} placeholder="103.8443" oninput={() => { mapsUrl = null; placeId = null; }} /></label>
  </div>

  <div class="row">
    <label>Time <span class="muted small">(the photo's local time)</span><input type="datetime-local" bind:value={local} /></label>
    <label>Zone offset
      <select bind:value={offset}>{#each offsets as o (o)}<option value={o}>{o}</option>{/each}</select>
    </label>
  </div>
  <p class="muted tiny-note">Stored as <code>{t}</code></p>

  {#if error}<p class="err" role="alert">{error}</p>{/if}

  <div class="actions">
    {#if confirmDelete}
      <button class="btn danger" disabled={saving} onclick={remove}>{pending ? "Remove from the queue" : "Delete for real (the original file is kept)"}</button>
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
  @media (min-width: 760px) { .sheet { left: 50%; right: auto; bottom: 50%; translate: -50% 50%; width: 600px; max-height: 88vh; border-radius: 18px; } }
  .grab { width: 40px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.2); margin: 4px auto 12px; }
  .top { display: flex; gap: 12px; margin-bottom: 14px; }
  .top img { width: 96px; height: 128px; object-fit: cover; border-radius: 10px; flex: 0 0 auto; background: var(--bg); }
  .meta { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; min-width: 0; }
  .small { font-size: 12px; overflow-wrap: anywhere; }
  label, .lbl { display: block; font-size: 12px; color: var(--muted); margin: 10px 0 0; }
  label input, label textarea, label select { margin-top: 5px; }
  select { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--text); }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 5px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); cursor: text; }
  .chip { padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); background: rgba(255, 255, 255, 0.08); color: var(--text); font-size: 13px; }
  .chip.ghost { background: transparent; color: var(--muted); }
  .chipin { flex: 1 1 90px; min-width: 90px; border: 0; background: transparent; padding: 4px 2px; }
  .offer { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .galleries { margin: 14px 0 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; }
  .galleries legend { font-size: 12px; color: var(--muted); padding: 0 4px; }
  .gal { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-size: 14px; color: var(--text); }
  .gal input { width: auto; margin: 0; }
  .loc-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
  .btn.tiny { padding: 4px 9px; font-size: 12px; }
  .tiny-note { font-size: 12px; margin: 6px 0 0; }
  code { font-size: 12px; }
  .err { color: var(--danger); font-size: 13px; }
  .actions { display: flex; gap: 8px; align-items: center; margin-top: 18px; flex-wrap: wrap; }
  .spacer { flex: 1; }
  .linked { margin: 6px 2px 0; display: flex; align-items: center; gap: 8px; }
  .google { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
  .google .star { color: #f4b400; font-size: 11px; }
  .google a { text-decoration: none; }
  .linked a { color: var(--accent, #7aa2f7); }
</style>
