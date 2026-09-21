// The little eye in the corner.
//
// Counting happens on the server (see server/views.js); this only asks, once
// per gallery per load, and holds the answer. A failure is silent: a gallery
// whose count did not arrive shows no eye at all, which is better than a
// broken one.
class Views {
  n = $state(null);
  #asked = null;

  async record(token, fetcher = globalThis.fetch) {
    if (!token || this.#asked === token) return;
    this.#asked = token;
    try {
      const r = await fetcher(`/creator/api/views/${encodeURIComponent(token)}`, {
        method: "POST",
        // The count is per visitor per day and the server needs the session
        // cookie to know not to count the owner's own visits.
        credentials: "same-origin",
        headers: { "cache-control": "no-store" },
      });
      if (!r.ok) return;
      const body = await r.json();
      if (Number.isFinite(body?.views)) this.n = body.views;
    } catch { /* offline, blocked, or the creator app is not deployed: no eye */ }
  }

  reset() { this.n = null; this.#asked = null; }
}

export const views = new Views();
