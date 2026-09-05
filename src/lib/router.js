// Deep links live in the hash: "#m/<id>" while a story is open, "#wall" for the
// wall. A static host never needs to know about client routes, a story URL can
// be shared, and -- the part that matters on a phone -- the back button closes
// the story instead of leaving the site.
export function parseHash(hash) {
  const h = (hash ?? "").replace(/^#\/?/, "");
  const m = h.match(/^m\/([A-Za-z0-9_-]+)$/);
  return { story: m ? m[1] : null, wall: h === "wall" };
}

export function buildHash({ story = null, wall = false } = {}) {
  return story ? `#m/${story}` : wall ? "#wall" : "";
}

// URL -> state. Idempotent, so it is safe to call on every popstate.
export function applyHash(trip, hash) {
  const { story, wall } = parseHash(hash);
  if (story) {
    if (trip.storyMoment?.id !== story) trip.openStory(story);
  } else {
    if (trip.storyOpen) trip.closeStory();
    // "#wall" selects the wall; an empty hash keeps whatever view is showing
    // (the app picks the default from the data, and the wall writes "#wall").
    if (wall) trip.view = "wall";
  }
}

// State -> URL. Idempotent. Opening a story pushes exactly one history entry
// (so Back closes it); moving between photos replaces; closing pops that entry
// when we were the ones who pushed it.
export function syncHash(trip, win = globalThis.window) {
  if (!win) return;
  const want = buildHash({ story: trip.storyOpen ? trip.storyMoment.id : null, wall: trip.view === "wall" });
  const have = win.location.hash;
  if (have === want) return;
  const url = win.location.pathname + win.location.search + want;
  const wasStory = parseHash(have).story !== null;
  if (trip.storyOpen && !wasStory) win.history.pushState({ itinerisStory: true }, "", url);
  else if (!trip.storyOpen && wasStory && win.history.state?.itinerisStory) win.history.back();
  else win.history.replaceState(win.history.state, "", url);
}
