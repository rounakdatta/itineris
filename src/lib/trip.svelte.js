import { daysOf, dayKey, momentMatches, trackMatches } from "./data.js";

// Single source of truth. Map, timeline, wall and story are all just
// different renderers over `visibleMoments` / `visibleTracks`.
class Trip {
  moments = $state([]);
  tracks = $state([]);
  loaded = $state(false);
  error = $state(null);

  // --- selection ---
  facets = $state([]);      // active facet ids; empty means "everything"
  day = $state(null);       // dayKey string, or null for the whole trip
  view = $state("map");     // "map" | "wall"
  focusId = $state(null);   // moment the map is centred on
  storyIndex = $state(-1);  // -1 means the story viewer is closed

  days = $derived(daysOf(this.moments));

  visibleMoments = $derived(
    this.moments
      .filter((m) => momentMatches(m, this.facets))
      .filter((m) => (this.day ? dayKey(m.t) === this.day : true))
      .sort((a, b) => (a.t < b.t ? -1 : 1))
  );

  visibleTracks = $derived(
    this.tracks
      .filter((t) => trackMatches(t, this.facets))
      .filter((t) => (this.day ? dayKey(t.t0) === this.day : true))
  );

  focused = $derived(this.moments.find((m) => m.id === this.focusId) ?? null);
  storyMoment = $derived(this.visibleMoments[this.storyIndex] ?? null);
  storyOpen = $derived(this.storyIndex >= 0 && this.storyIndex < this.visibleMoments.length);

  async load() {
    try {
      const [m, t] = await Promise.all([
        fetch("data/moments.json").then((r) => r.json()),
        fetch("data/tracks.json").then((r) => r.json()),
      ]);
      this.moments = m;
      this.tracks = t;
      this.loaded = true;
    } catch (e) {
      this.error = String(e);
    }
  }

  toggleFacet(id) {
    const anchor = this.storyMoment?.id;
    this.facets = this.facets.includes(id)
      ? this.facets.filter((f) => f !== id)
      : [...this.facets, id];
    this.restoreStory(anchor);
  }

  clearFacets() {
    const anchor = this.storyMoment?.id;
    this.facets = [];
    this.restoreStory(anchor);
  }

  setDay(key) {
    const anchor = this.storyMoment?.id;
    this.day = this.day === key ? null : key;
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
