import { momentMatches, trackMatches } from "./data.js";

const GALLERY_PATH = /^\/g\/([a-z0-9-]{4,40})\/?$/;

// Single source of truth. Map, timeline, wall and story are all just
// different renderers over `visibleMoments` / `visibleTracks`.
class Trip {
  moments = $state([]);
  tracks = $state([]);
  galleryId = $state(null);
  title = $state("");
  description = $state("");
  // loading | ready | landing (no gallery at /) | notfound (bad token) | error
  status = $state("loading");
  error = $state(null);
  fromCache = $state(false);   // the service worker served a saved copy
  mapEngine = $state("maplibre");   // "maplibre" | "google" -- which map is drawing (see lib/config.js)

  // --- selection ---
  facets = $state([]);      // active facet ids; empty means "everything"
  view = $state("map");     // "map" | "wall"
  focusId = $state(null);   // moment the map is centred on
  storyIndex = $state(-1);  // -1 means the story viewer is closed

  loaded = $derived(this.status === "ready");

  visibleMoments = $derived(
    this.moments
      .filter((m) => momentMatches(m, this.facets))
      .sort((a, b) => (a.t < b.t ? -1 : 1))
  );

  visibleTracks = $derived(this.tracks.filter((t) => trackMatches(t, this.facets)));

  focused = $derived(this.moments.find((m) => m.id === this.focusId) ?? null);
  storyMoment = $derived(this.visibleMoments[this.storyIndex] ?? null);
  storyOpen = $derived(this.storyIndex >= 0 && this.storyIndex < this.visibleMoments.length);

  // Which gallery to show comes from the URL: /g/<token>, or whatever
  // data/home.json nominates for "/". The full library is never fetched --
  // the public site only ever sees per-gallery projections.
  async load(loc = globalThis.location) {
    this.status = "loading";
    this.error = null;
    this.fromCache = false;
    const cached = (r) => r.headers?.get?.("x-itineris-cache") === "fallback";
    try {
      let id = loc?.pathname?.match(GALLERY_PATH)?.[1] ?? null;
      if (!id) {
        const r = await fetch("/data/home.json");
        if (r.status === 404) { this.status = "landing"; return; }
        if (!r.ok) throw new Error(r.status === 503 ? "You're offline and this gallery isn't saved on this device." : `home.json: HTTP ${r.status}`);
        if (cached(r)) this.fromCache = true;
        id = (await r.json()).gallery;
      }
      const r = await fetch(`/data/galleries/${id}.json`);
      if (r.status === 404) { this.status = "notfound"; return; }
      if (!r.ok) throw new Error(r.status === 503 ? "You're offline and this gallery isn't saved on this device." : `gallery: HTTP ${r.status}`);
      if (cached(r)) this.fromCache = true;
      const g = await r.json();
      this.galleryId = g.id;
      this.title = g.title ?? "";
      this.description = g.description ?? "";
      this.moments = g.moments ?? [];
      this.tracks = g.tracks ?? [];
      this.status = "ready";
    } catch (e) {
      this.error = e.message ?? String(e);
      this.status = "error";
    }
  }

  toggleFacet(id) {
    const anchor = this.storyMoment?.id;
    this.facets = this.facets.includes(id) ? this.facets.filter((f) => f !== id) : [...this.facets, id];
    this.restoreStory(anchor);
  }

  clearFacets() {
    const anchor = this.storyMoment?.id;
    this.facets = [];
    this.restoreStory(anchor);
  }

  focus(id) {
    this.focusId = id;
  }

  openStory(id) {
    const i = this.visibleMoments.findIndex((m) => m.id === id);
    if (i >= 0) {
      this.storyIndex = i;
      this.focusId = id;
    }
  }

  closeStory() {
    this.storyIndex = -1;
  }

  // Returns false when there is nowhere left to go, so the viewer can close itself.
  step(delta) {
    const next = this.storyIndex + delta;
    if (next < 0 || next >= this.visibleMoments.length) return false;
    this.storyIndex = next;
    this.focusId = this.visibleMoments[next].id;
    return true;
  }

  // Filtering while the story is open would otherwise strand the index on
  // whatever slid into that slot. Anchor on the id captured BEFORE the change.
  restoreStory(anchorId) {
    if (this.storyIndex < 0) return;
    const i = anchorId ? this.visibleMoments.findIndex((m) => m.id === anchorId) : -1;
    this.storyIndex = i;
    if (i >= 0) this.focusId = anchorId;
  }
}

export const trip = new Trip();
