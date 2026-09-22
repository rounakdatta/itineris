// The little eye, and what it counts.
//
// Two separate questions, deliberately: how many people opened the gallery
// (kept for the creator's list) and how many looked at each PHOTO -- which is
// the one that tells a creator which picture people stopped on, and the one a
// viewer sees, on the photo it belongs to.
//
// Counting happens on the server (see server/views.js); this only asks, once
// per thing per load, and holds the answers. A failure is silent: an eye whose
// count never arrived shows no eye at all, which is better than a broken one.
class Views {
  gallery = $state(null);          // the whole gallery's count, not shown to visitors
  moments = $state({});            // momentId -> count
  #asked = new Set();
  #token = null;

  async #post(token, body, fetcher) {
    const r = await fetcher(`/creator/api/views/${encodeURIComponent(token)}`, {
      method: "POST",
      // The server needs the session cookie to know not to count the owner's
      // own visits.
      credentials: "same-origin",
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const out = await r.json();
    return Number.isFinite(out?.views) ? out.views : null;
  }

  async record(token, fetcher = globalThis.fetch) {
    if (!token) return;
    this.#token = token;
    if (this.#asked.has("~gallery")) return;
    this.#asked.add("~gallery");
    try { const n = await this.#post(token, {}, fetcher); if (n !== null) this.gallery = n; }
    catch { /* offline, blocked, or no creator app: no eye */ }
  }

  // Called as each photo is shown. Once per photo per load: flicking back and
  // forth through a story is one person looking, not ten views.
  async seen(momentId, fetcher = globalThis.fetch) {
    if (!this.#token || !momentId || this.#asked.has(momentId)) return;
    this.#asked.add(momentId);
    try {
      const n = await this.#post(this.#token, { moment: momentId }, fetcher);
      if (n !== null) this.moments = { ...this.moments, [momentId]: n };
    } catch { /* same */ }
  }

  of(momentId) { return this.moments[momentId] ?? null; }

  reset() { this.gallery = null; this.moments = {}; this.#asked = new Set(); this.#token = null; }
}

export const views = new Views();
