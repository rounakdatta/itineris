// Deep links live in the hash: "#m/<id>" while a story is open. A static host
// never needs to know about client routes, a story URL can be shared, and --
// the part that matters on a phone -- the back button closes the story instead
// of leaving the site. (The view itself is not in the URL: the map is the
// view, and the wall only stands in when nothing has a location. An old
// "#wall" link is ignored and cleaned up.)
export function parseHash(hash) {
  const h = (hash ?? "").replace(/^#\/?/, "");
  const m = h.match(/^m\/([A-Za-z0-9_-]+)$/);
  return { story: m ? m[1] : null };
}

export function buildHash({ story = null } = {}) {
  return story ? `#m/${story}` : "";
}

// URL -> state. Idempotent, so it is safe to call on every popstate.
export function applyHash(trip, hash) {
  const { story } = parseHash(hash);
  if (story) {
    if (trip.storyMoment?.id !== story) trip.openStory(story);
  } else if (trip.storyOpen) {
    trip.closeStory();
  }
}

// State -> URL. Idempotent. Opening a story pushes exactly one history entry
// (so Back closes it); moving between photos replaces; closing pops that entry
// when we were the ones who pushed it.
export function syncHash(trip, win = globalThis.window) {
  if (!win) return;
  const want = buildHash({ story: trip.storyOpen ? trip.storyMoment.id : null });
  const have = win.location.hash;
  if (have === want) return;
  const url = win.location.pathname + win.location.search + want;
  const wasStory = parseHash(have).story !== null;
  if (trip.storyOpen && !wasStory) win.history.pushState({ itinerisStory: true }, "", url);
  else if (!trip.storyOpen && wasStory && win.history.state?.itinerisStory) win.history.back();
  else win.history.replaceState(win.history.state, "", url);
}
