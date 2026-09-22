<script>
  import { api, galleryUrl, galleryPath, copyText } from "./lib/api.js";
  import { slugProblem, cleanSlug, slugFrom } from "../server/slug.js";
  import { short, exact } from "../server/count.js";

  // `momentCount` / `openNow`: arriving here from the nudge on the Photos tab,
  // with photos waiting and no gallery yet. The form opens already offering to
  // start the gallery with everything -- a first gallery that comes out empty
  // is a dead end, and "now go back and select them" is a chore nobody should
  // have to be told about.
  let { galleries, tracks = [], momentIds = [], openNow = false, onChange, onShow } = $props();
  const momentCount = $derived(momentIds.length);
  let creating = $state(false);
  let withAll = $state(true);
  // Off by default: a gallery of photos taken in one room does not want a
  // thread drawn across it, and an option that arrives switched on is an
  // option somebody has to notice and undo.
  let route = $state(false);
  let title = $state("");
  let description = $state("");
  // The gallery's own name in the URL. Never filled in automatically: a link
  // somebody is going to share should be one they chose.
  let slug = $state("");
  const slugIssue = $derived(slug.trim() ? slugProblem(slug) : null);
  let editingId = $state(null);
  let busy = $state(false);
  let error = $state(null);
  let copied = $state(null);     // the gallery whose link is on the clipboard
  let copyFailed = $state(null); // ...or the one whose copy the browser refused

  // `title`/`description` are shared by the new-gallery form and the edit form,
  // so both have to be seeded when they open: editing a gallery and cancelling
  // used to leave its title sitting in the New gallery form.
  function startCreate() { title = ""; description = ""; slug = ""; withAll = true; route = false; creating = true; }
  // Opening straight into the form when that is what the last tap asked for --
  // once. Re-reading the condition after the gallery was made found
  // `galleries` still empty for the moment before the refresh landed, and
  // helpfully opened a second, empty form on top of the result.
  let obliged = false;
  $effect(() => { if (openNow && !obliged) { obliged = true; startCreate(); } });
  function startEdit(g) { title = g.title; description = g.description ?? ""; slug = g.slug ?? ""; route = g.route === true; editingId = g.id; }

  async function run(fn) { busy = true; error = null; try { await fn(); onChange?.(); } catch (e) { error = e.message; } finally { busy = false; } }
  const create = () => run(async () => {
    await api.createGallery({ title, description, slug: cleanSlug(slug) || null, home: galleries.length === 0, ...(withAll && momentCount ? { momentIds } : {}) });
    title = ""; description = ""; slug = ""; creating = false;
  });
  const save = (g) => run(async () => { await api.patchGallery(g.id, { title, description, slug: cleanSlug(slug) || null, route }); editingId = null; });
  const setHome = (g) => run(() => api.patchGallery(g.id, { home: !g.home }));
  const remove = (g) => { if (window.confirm(`Delete “${g.title}”? Its link stops working. Photos stay in the library.`)) run(() => api.removeGallery(g.id)); };
  const toggleTrack = (g, tid) => run(() => api.patchGallery(g.id, (g.trackIds ?? []).includes(tid) ? { removeTracks: [tid] } : { addTracks: [tid] }));
  async function copy(g) {
    const ok = await copyText(galleryUrl(g));
    copied = ok ? g.id : null; copyFailed = ok ? null : g.id;
    setTimeout(() => { copied = null; copyFailed = null; }, 1600);
  }
</script>

{#snippet routeField()}
  <label class="opt">
    <input type="checkbox" bind:checked={route} />
    <span>
      Draw the walk between places
      <span class="muted small">A dotted thread from each stop to the next, with how far it was.</span>
    </span>
  </label>
{/snippet}

{#snippet slugField()}
  <label class="slug">
    <span class="muted small">Its own web address (optional)</span>
    <span class="row">
      <span class="host">{location.host}/</span>
      <input bind:value={slug} maxlength="40" spellcheck="false" autocapitalize="none" autocorrect="off"
        placeholder={slugFrom(title) || "singaporeeats"} aria-label="Web address" aria-invalid={!!slugIssue} />
    </span>
    {#if slugIssue}
      <span class="err small" role="alert">{slugIssue}</span>
    {:else}
      <span class="muted small">The /g/… link keeps working either way, so nothing you have already shared breaks.</span>
    {/if}
  </label>
{/snippet}

<section class="intro" class:blank={!galleries.length && !creating}>
  {#if !galleries.length && !creating}
    <!-- The same shape as the Photos tab's first screen: a mark, one line of
         what this is, one thing to do. The five-sentence paragraph that used
         to be here explained galleries to somebody who had not made one yet
         and could not picture the thing being explained. -->
    <svg class="mark" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
      <path d="M9.4 7.3h9.1a1.6 1.6 0 0 1 1.6 1.6v7.8a1.6 1.6 0 0 1-1.6 1.6H9.4a1.6 1.6 0 0 1-1.6-1.6V8.9a1.6 1.6 0 0 1 1.6-1.6Z" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M4.9 15.6a1.6 1.6 0 0 1-1.1-1.5V6.3a1.6 1.6 0 0 1 1.6-1.6h9.1a1.6 1.6 0 0 1 1.5 1.1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
    <h2>A gallery is a link</h2>
    <p class="muted">Put photos in one, share the link. Make another for another group — a photo can be in as many as you like.</p>
    <button class="btn primary" onclick={startCreate}>{momentCount ? "Make your first gallery" : "New gallery"}</button>
  {:else if !creating}
    <p class="muted">A gallery is a link. Put any subset of photos in it, share the link with one group, make another for another group. Photos can be in as many as you like, and uploads are private until they're in one.</p>
    <button class="btn primary" onclick={startCreate}>New gallery</button>
  {:else}
    <form class="new" onsubmit={(e) => { e.preventDefault(); if (title.trim()) create(); }}>
      <input bind:value={title} placeholder="Title — e.g. Singapore, for the family" maxlength="120" aria-label="Title" />
      <input bind:value={description} placeholder="A line of description (optional)" maxlength="1000" aria-label="Description" />
      {@render slugField()}
      {@render routeField()}
      {#if momentCount}
        <label class="opt"><input type="checkbox" bind:checked={withAll} /> <span>Start it with all {momentCount} photo{momentCount === 1 ? "" : "s"}{#if galleries.length}{" you have"}{/if}</span></label>
      {/if}
      <div class="actions"><button class="btn primary" type="submit" disabled={busy || !title.trim() || !!slugIssue}>Create</button><button class="btn" type="button" onclick={() => (creating = false)}>Cancel</button></div>
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
        {@render slugField()}
        {@render routeField()}
        <div class="actions"><button class="btn primary" type="submit" disabled={busy || !title.trim() || !!slugIssue}>Save</button><button class="btn" type="button" onclick={() => (editingId = null)}>Cancel</button></div>
      </form>
    {:else}
      <div class="head">
        <div>
          <h3>{g.title} {#if g.home}<span class="badge">home · shown at /</span>{/if}</h3>
          {#if g.description}<p class="muted desc">{g.description}</p>{/if}
          <p class="muted small">{g.count} photo{g.count === 1 ? "" : "s"}{#if g.trackCount}{" · "}{g.trackCount} route{g.trackCount === 1 ? "" : "s"}{/if}{#if g.views}{" · "}<span class="views" title={exact(g.views)}><svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M1.8 12S5.9 5.4 12 5.4 22.2 12 22.2 12 18.1 18.6 12 18.6 1.8 12 1.8 12Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /><circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.8" /></svg>{short(g.views)}<span class="sr"> {g.views === 1 ? "view" : "views"}</span></span>{/if}</p>
        </div>
      </div>
      <!-- The link IS the gallery: it is what somebody came here to make and
           the only thing they will ever send anyone. It gets the emphasis,
           and the host is dimmed so the name they chose is what reads. -->
      <div class="link">
        <code><span class="host">{location.host}/</span><span class="path">{galleryPath(g).slice(1)}</span></code>
        <button class="btn small primary" onclick={() => copy(g)}>{copied === g.id ? "Copied ✓" : copyFailed === g.id ? "Copy failed" : "Copy link"}</button>
        <a class="btn small" href={galleryUrl(g)} target="_blank" rel="noopener">Open ↗</a>
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
        <button class="btn small" onclick={() => startEdit(g)}>Edit</button>
        <button class="btn small" onclick={() => setHome(g)} disabled={busy}>{g.home ? "Unset home" : "Make home"}</button>
        <span class="spacer"></span>
        <button class="btn small danger quiet" onclick={() => remove(g)} disabled={busy}>Delete</button>
      </div>
    {/if}
  </article>
{/each}

<style>
  .intro { margin: 8px 2px 18px; }
  .intro p { margin: 0 0 12px; }
  .intro.blank { margin: 34px auto 18px; max-width: 30em; text-align: center; padding: 34px 20px 30px; border: 1.5px dashed var(--line); border-radius: 14px; background: var(--panel); }
  .intro.blank .mark { color: var(--accent); opacity: 0.9; margin-bottom: 10px; }
  .intro.blank h2 { margin: 0 0 6px; font-size: 19px; font-weight: 600; letter-spacing: -0.01em; }
  .intro.blank p { margin: 0 auto 18px; max-width: 26em; }
  .opt { display: flex; align-items: flex-start; gap: 8px; margin: 2px 0 0; color: var(--text); font-size: 13px; cursor: pointer; }
  .opt input { width: 16px; height: 16px; accent-color: var(--accent); flex: 0 0 auto; margin-top: 1px; }
  .opt .small { display: block; margin-top: 2px; }
  .new, .edit { display: grid; gap: 8px; }
  .slug { display: grid; gap: 4px; margin: 2px 0 0; }
  .slug .row { display: flex; align-items: stretch; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); overflow: hidden; }
  .slug .host { display: flex; align-items: center; padding: 0 2px 0 10px; color: var(--muted); font-size: 13px; white-space: nowrap; }
  .slug input { border: 0; background: transparent; border-radius: 0; flex: 1; min-width: 0; }
  .slug input[aria-invalid="true"] { color: var(--danger); }
  .slug .err { color: var(--danger); }
  .gallery { padding: 14px; border-radius: 14px; background: var(--panel); border: 1px solid var(--line); margin-bottom: 12px; }
  .gallery.home { border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
  h3 { margin: 0 0 4px; font-size: 16px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .desc { margin: 0 0 4px; }
  .small { font-size: 13px; margin: 0; }
  .link { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0; }
  code { font-size: 13px; padding: 7px 10px; border-radius: 8px; background: var(--bg); border: 1px solid var(--line); overflow-wrap: anywhere; flex: 1 1 220px; min-width: 0; line-height: 1.35; }
  code .host { color: var(--muted); }
  code .path { color: var(--text); font-weight: 600; }
  .tracks { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; }
  .chip { padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--muted); font-size: 13px; }
  .chip.on { background: rgba(77, 212, 172, 0.16); border-color: var(--ok); color: #fff; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .btn.small { padding: 7px 12px; font-size: 14px; text-decoration: none; }
  .spacer { flex: 1 1 auto; }
  /* The only irreversible thing on the card. When the row wraps on a phone it
     was landing on a line of its own, full size, as the most prominent button
     in a card whose point is a link you copy. */
  .btn.danger.quiet { border-color: transparent; opacity: 0.75; margin-left: auto; }
  .btn.danger.quiet:hover { border-color: color-mix(in srgb, var(--danger) 45%, transparent); opacity: 1; }
  .badge { font-size: 11px; text-transform: none; letter-spacing: 0; }
  .err { color: var(--danger); }
  /* The same eye the viewer shows, so a creator recognises their own number.
     Absent at zero rather than showing "0 views" on a gallery nobody has
     opened yet -- that reads as a verdict. */
  .views { display: inline-flex; align-items: center; gap: 4px; vertical-align: -2px; font-variant-numeric: tabular-nums; }
  .views svg { opacity: 0.75; }
  .sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
