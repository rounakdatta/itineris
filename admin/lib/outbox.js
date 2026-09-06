// A persistent upload queue.
//
// Photos go into IndexedDB the moment they are picked -- before any network is
// involved -- with an on-device thumbnail and their EXIF, so they show up as
// "waiting" tiles instantly and survive a reload, a killed tab or a phone going
// to sleep. They upload one file per request (a flaky link then makes progress
// photo by photo instead of failing a batch atomically), with exponential
// backoff and a wake-up on the browser's `online` event, until the server
// confirms each one. A 401 means the tinyauth session expired: the queue pauses
// and waits for a sign-in rather than burning retries. The server dedups by
// content hash, so a retry after a lost response is harmless.
import { readExif } from "./exif.js";
import { makeThumb } from "./thumbs.js";

const DB = "itineris-admin", STORE = "outbox";
const openDb = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error ?? new Error("aborted"));
    });
  } finally { db.close(); }
}
const getAll = () => withStore("readonly", (s) => s.getAll());
const put = (item) => withStore("readwrite", (s) => s.put(item));
const del = (id) => withStore("readwrite", (s) => s.delete(id));

// 2s, 4s, 8s ... capped at 5 minutes; a little jitter so two phones don't sync up.
export const backoff = (attempts) => Math.min(2000 * 2 ** Math.max(0, attempts - 1), 5 * 60_000) * (0.85 + Math.random() * 0.3);

// Only what the user actually set goes to the server; everything else (time,
// GPS) the server derives from the file itself, which is more reliable than
// the browser's reading.
export function metaToSend(item) {
  const m = item.meta ?? {};
  const out = {};
  if (m.caption) out.caption = m.caption;
  if (m.place) out.place = m.place;
  if (m.tags?.length) out.tags = m.tags;
  if (m.galleries?.length) out.galleries = m.galleries;
  if (m.locEdited && Number.isFinite(m.lat) && Number.isFinite(m.lng)) { out.lat = m.lat; out.lng = m.lng; if (m.mapsUrl) out.mapsUrl = m.mapsUrl; if (m.placeId) out.placeId = m.placeId; }
  if (m.timeEdited && m.t) out.t = m.t;
  return out;
}

export class Outbox {
  constructor({ upload, now = () => Date.now(), isOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false) } = {}) {
    this.upload = upload;
    this.now = now;
    this.isOnline = isOnline;
    this.items = [];
    this.blocked = false;     // 401/403: waiting for a sign-in
    this.flushing = false;
    this.ready = false;
    this.timer = null;
    this.current = null;
    this.listeners = new Set();
    this.onUploaded = null;   // (result, item) => void
  }

  subscribe(fn) { this.listeners.add(fn); fn(this.snapshot()); return () => this.listeners.delete(fn); }
  snapshot() { return { items: this.items.slice(), blocked: this.blocked, flushing: this.flushing, online: this.isOnline(), ready: this.ready }; }
  emit() { const s = this.snapshot(); for (const fn of this.listeners) fn(s); }

  async init() {
    const stored = await getAll();
    // Anything that was mid-upload when the page died goes back to waiting.
    this.items = stored.sort((a, b) => a.createdAt - b.createdAt).map((i) => ({ ...i, state: i.state === "uploading" ? "waiting" : i.state, progress: 0 }));
    this.ready = true;
    this.emit();
  }

  // Wire the wake-ups and load what is already queued.
  start(win = globalThis) {
    win.addEventListener?.("online", () => { this.emit(); this.flush(); });
    win.addEventListener?.("offline", () => this.emit());
    win.document?.addEventListener?.("visibilitychange", () => { if (win.document.visibilityState === "visible") this.flush(); });
    return this.init().then(() => this.flush());
  }

  // `location` ({ lat, lng, name?, mapsUrl? }) places every photo of the batch
  // up front -- a shared Google Maps place, typically -- and wins over EXIF.
  async add(files, { galleries = [], location = null } = {}) {
    const ids = [];
    const placed = location && Number.isFinite(location.lat) && Number.isFinite(location.lng) ? location : null;
    for (const file of files) {
      const id = crypto.randomUUID();
      const [exif, thumb] = await Promise.all([readExif(file).catch(() => ({})), makeThumb(file).catch(() => null)]);
      const item = {
        id, createdAt: this.now(), name: file.name, type: file.type, size: file.size, file, thumb, exif,
        meta: {
          caption: "", place: placed?.name ?? "", tags: [], galleries: JSON.parse(JSON.stringify([...galleries])),
          lat: placed ? placed.lat : exif.lat ?? null, lng: placed ? placed.lng : exif.lng ?? null, mapsUrl: placed?.mapsUrl ?? null, placeId: placed?.placeId ?? null,
          t: null, locEdited: !!placed, timeEdited: false,
        },
        state: "waiting", attempts: 0, nextAt: 0, error: null, progress: 0,
      };
      await put(item);
      this.items.push(item);
      ids.push(id);
    }
    this.emit();
    this.flush();
    return ids;
  }

  async updateMeta(id, meta) {
    const it = this.items.find((i) => i.id === id);
    if (!it) return;
    // Callers hand us Svelte state proxies; IndexedDB cannot structured-clone
    // a Proxy. Meta is JSON-shaped by construction, so this strips them safely.
    it.meta = { ...it.meta, ...JSON.parse(JSON.stringify(meta)) };
    await put(it);
    this.emit();
  }

  async remove(id) {
    await del(id);
    this.items = this.items.filter((i) => i.id !== id);
    this.emit();
    this.schedule();
  }

  // The button. Also how "I have signed in again" is expressed.
  retryNow() {
    this.blocked = false;
    for (const it of this.items) if (it.state !== "uploading") { it.state = "waiting"; it.nextAt = 0; }
    this.emit();
    return this.flush();
  }

  nextItem() { const t = this.now(); return this.items.find((i) => i.state === "waiting" && i.nextAt <= t); }

  // Runs the queue until nothing is eligible. Concurrent callers get the run
  // already in progress; `idle()` lets tests (and the UI) wait for it.
  flush() {
    if (this.flushing) return this.current ?? Promise.resolve();
    if (!this.ready || this.blocked) return Promise.resolve();
    if (!this.isOnline()) { this.emit(); return Promise.resolve(); }
    this.flushing = true;
    this.current = this.#run().finally(() => { this.current = null; });
    return this.current;
  }
  idle() { return this.current ?? Promise.resolve(); }

  async #run() {
    this.emit();
    try {
      let it;
      while ((it = this.nextItem())) {
        if (!this.isOnline()) break;
        it.state = "uploading"; it.progress = 0; it.error = null;
        this.emit();
        try {
          const res = await this.upload(it, (p) => { it.progress = p; this.emit(); });
          if (res?.created?.length || res?.duplicates?.length) {
            await del(it.id);
            this.items = this.items.filter((x) => x.id !== it.id);
            this.onUploaded?.(res, it);
          } else {
            // The server looked at the file and said no (422 & co.). Retrying
            // the same bytes will not help; the user decides.
            it.state = "rejected";
            it.error = res?.errors?.[0]?.error ?? res?.error ?? "the server rejected this file";
            await put(it);
          }
        } catch (e) {
          if (e?.status === 401 || e?.status === 403) {
            this.blocked = true;
            it.state = "waiting"; it.error = "signed out";
            await put(it);
            break;
          }
          it.attempts += 1;
          it.state = "waiting";
          it.error = e?.message ?? "network error";
          it.nextAt = this.now() + backoff(it.attempts);
          await put(it);
        }
        this.emit();
      }
    } finally {
      this.flushing = false;
      this.emit();
      this.schedule();
    }
  }

  // Wake up when the earliest backoff expires. Being offline needs no timer:
  // the `online` event does it.
  schedule() {
    clearTimeout(this.timer);
    if (this.blocked) return;
    const waiting = this.items.filter((i) => i.state === "waiting");
    if (!waiting.length) return;
    const delay = Math.max(250, Math.min(...waiting.map((i) => i.nextAt)) - this.now());
    this.timer = setTimeout(() => this.flush(), delay);
  }
}
