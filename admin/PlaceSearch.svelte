<script>
  // "Which place is this?" -- answered one of four ways, all landing in onPick:
  //   - one of YOUR places (already in the journal): the way several photos
  //     end up on ONE pin, and it costs nothing;
  //   - a Google Places search (name, address, rating) when the server has a key,
  //     else OpenStreetMap;
  //   - a pasted Google Maps link (resolved by the server).
  // A pick is { name, lat, lng, placeId, mapsUrl, google }.
  import { api } from "./lib/api.js";
  import { searchPlaces as osmSearch } from "./lib/geo.js";
  import { extractMapsUrl } from "../server/links.js";

  let { known = [], bias = null, placesEnabled = false, compact = false, onPick } = $props();
  let q = $state("");
  let results = $state([]);
  let searching = $state(false);
  let note = $state(null);

  const fromGoogle = (r) => ({ name: r.name ?? "", lat: r.lat, lng: r.lng, placeId: r.placeId ?? null, mapsUrl: r.mapsUri ?? null, address: r.address ?? null,
    google: r.placeId ? { placeId: r.placeId, rating: r.rating ?? null, ratingCount: r.ratingCount ?? null, type: r.type ?? null, mapsUri: r.mapsUri ?? null } : null });

  async function search() {
    if (!q.trim() || searching) return;
    searching = true; note = null; results = [];
    try {
      const link = extractMapsUrl(q);
      if (link) {
        const r = await api.resolveLink(link);
        if (!Number.isFinite(r.lat)) { note = r.name ? `Found “${r.name}” but no coordinates in that link — search its name instead` : "That link has no place in it"; return; }
        q = "";
        onPick?.({ name: r.name ?? "", lat: r.lat, lng: r.lng, placeId: null, mapsUrl: r.mapsUrl ?? link, google: null });
        note = `From Google Maps${r.name ? `: ${r.name}` : ""}`;
        return;
      }
      if (placesEnabled) {
        const { places } = await api.searchPlaces(q, bias);
        results = places.map(fromGoogle);
      } else {
        results = (await osmSearch(q)).map((r) => ({ name: r.name, lat: r.lat, lng: r.lng, placeId: null, mapsUrl: null, address: r.label, google: null }));
      }
      if (!results.length) note = `Nothing found for “${q.trim()}”`;
    } catch (e) { note = e.message; }
    finally { searching = false; }
  }
  function pick(r) { results = []; q = ""; note = null; onPick?.(r); }
</script>

<div class="ps" class:compact>
  <div class="tools">
    <input class="q" type="search" bind:value={q} placeholder={placesEnabled ? "Search Google Maps — “Yamo”, or paste a link" : "Search a place, or paste a Google Maps link"} aria-label="Search a place"
      onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }} />
    <button type="button" class="btn tiny" onclick={search} disabled={searching || !q.trim()}>{searching ? "…" : "Search"}</button>
  </div>
  {#if results.length}
    <ul class="results" role="listbox" aria-label="Places found">
      {#each results as r (r.placeId ?? `${r.lat},${r.lng},${r.name}`)}
        <li><button type="button" role="option" aria-selected="false" onclick={() => pick(r)}>
          <span class="head"><strong>{r.name}</strong>{#if Number.isFinite(r.google?.rating)}<span class="rate">{r.google.rating.toFixed(1)}<i aria-hidden="true">★</i>{#if r.google.ratingCount}<span class="cnt">({r.google.ratingCount.toLocaleString("en")})</span>{/if}</span>{/if}</span>
          {#if r.address}<span class="muted">{r.address}</span>{/if}
        </button></li>
      {/each}
    </ul>
    <p class="muted credit">{placesEnabled ? "Google" : "Search by OpenStreetMap Nominatim"}</p>
  {/if}
  {#if note}<p class="muted note" role="status">{note}</p>{/if}
  {#if known.length}
    <div class="known">
      <span class="muted lbl">Your places</span>
      <div class="chips">
        {#each known.slice(0, compact ? 6 : 10) as k (k.key)}
          <button type="button" class="kchip" onclick={() => pick({ name: k.name, lat: k.lat, lng: k.lng, placeId: k.placeId ?? null, mapsUrl: k.mapsUrl ?? null, google: k.google ?? null })} title={`${k.name} · ${k.count} photo${k.count === 1 ? "" : "s"}`}>
            <span class="nm">{k.name}</span>{#if Number.isFinite(k.google?.rating)}<span class="r">{k.google.rating.toFixed(1)}★</span>{/if}<span class="n">{k.count}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .ps { display: grid; gap: 8px; text-align: left; }
  .tools { display: flex; gap: 6px; align-items: center; }
  .tools .q { flex: 1; min-width: 0; width: auto; max-width: none; padding: 7px 10px; }
  .btn.tiny { padding: 6px 9px; font-size: 12px; white-space: nowrap; }
  .results { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: 210px; overflow: auto; }
  .results button { width: 100%; text-align: left; display: grid; gap: 2px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: inherit; font: inherit; cursor: pointer; }
  .results button:hover, .results button:focus-visible { border-color: var(--accent); }
  .head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .head strong { font-size: 13px; }
  .rate { font-size: 12px; font-weight: 700; } .rate i { font-style: normal; color: #f4b400; font-size: 11px; margin: 0 2px; } .rate .cnt { font-weight: 400; color: var(--muted); }
  .results .muted { font-size: 11px; line-height: 1.35; }
  .credit { margin: -2px 0 0; font-size: 10px; }
  .note { margin: 0; font-size: 12px; }
  .known { display: grid; gap: 6px; }
  .lbl { font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .kchip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 5px 9px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--text); font: inherit; font-size: 12px; cursor: pointer; }
  .kchip:hover { border-color: var(--accent); }
  .kchip .nm { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kchip .r { font-weight: 700; color: #f4b400; }
  .kchip .n { font-size: 10px; color: var(--muted); }
  .compact .results { max-height: 170px; }
</style>
