import { readFile, writeFile, rename, mkdir, cp, unlink, access, readdir, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { countView, visitorKey, dayOf, newSalt } from "./views.js";

// ---------------------------------------------------------------------------
// Layout under the data dir. Only data/ and media/ are ever served publicly.
//
//   users/<uid>/moments.json    one person's moments, private (uploader, filename…)
//   users/<uid>/tracks.json     their tracks
//   users/<uid>/galleries.json  their curated subsets: which moments/tracks, title, home
//   library/owners.json         gallery token -> uid, so one person's galleries
//                               can be published and pruned without touching anyone else's
//   library/slugs.json          pretty name -> token, global because the pretty
//                               name lives at the root of the site (/singaporeeats)
//   library/instance.json       { owner } -- whose home gallery "/" shows
//   data/home.json              { gallery } -> what "/" shows; absent = landing page
//   data/galleries/<id>.json    one public projection per gallery, any owner
//   media/<uid>/                content-hashed derivatives (public by obscurity)
//   originals/<uid>/            never served
//
// Uploads are therefore private until placed in a gallery, a photo can sit in
// many galleries, and every gallery URL is an unguessable token.
//
// Gallery tokens are global, so `/g/<token>` means the same thing whoever made
// it; everything else is per person. Media is filed under the uid as well --
// two people who upload the same photo would otherwise share one derivative,
// and the first to delete it would break the other's gallery.
//
// Before 0.21 there was one library at library/moments.json, because there was
// one person behind tinyauth. `adopt()` hands that to whoever signs in first.
// ---------------------------------------------------------------------------

const exists = (p) => access(p).then(() => true, () => false);
const readJson = async (p, fallback) => {
  try { return JSON.parse(await readFile(p, "utf8")); }
  catch (e) { if (e.code === "ENOENT") return fallback; throw e; }
};
async function atomicWrite(p, data) {
  await mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
  await rename(tmp, p);
}
const byT = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);

// Gallery ids double as share URLs, so they are random: 12 chars from a
// 32-symbol alphabet (no l/1/0 look-alikes) is 60 bits, unguessable in practice.
const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";
export function token(n = 12) {
  const bytes = randomBytes(n);
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}
export const TOKEN_RE = /^[a-z0-9-]{4,40}$/;
export const UID_RE = /^[0-9a-f]{16}$/;
// The single-tenant library from before 0.21, standing in as a person until
// somebody signs in and adopts it. Deliberately not a valid uid, so it can
// never collide with a real one or turn up in users().
export const LEGACY = "legacy";

// The public shape of a moment. Whitelist, never blacklist: a new private field
// on the library record must be added here on purpose before it can leak.
export const pub = (m) => ({
  id: m.id, t: m.t, tz: m.tz ?? "exif",
  lat: Number.isFinite(m.lat) ? m.lat : null, lng: Number.isFinite(m.lng) ? m.lng : null,
  place: m.place ?? "", caption: m.caption ?? "", tags: m.tags ?? [],
  ...(m.mapsUrl ? { mapsUrl: m.mapsUrl } : {}),
  ...(m.captionStyle ? { captionStyle: m.captionStyle } : {}),
  ...(m.captions?.length ? { captions: m.captions } : {}),
  // What Google says about the place, looked up server-side (see places.js).
  ...(m.google?.placeId ? { google: { placeId: m.google.placeId, rating: m.google.rating ?? null, ratingCount: m.google.ratingCount ?? null, type: m.google.type ?? null, mapsUri: m.google.mapsUri ?? null } } : {}),
  media: {
    type: m.media?.type ?? "photo", src: m.media?.src, w: m.media?.w, h: m.media?.h,
    ...(m.media?.medium ? { medium: m.media.medium } : {}),
    ...(m.media?.thumb ? { thumb: m.media.thumb } : {}),
    ...(m.media?.poster ? { poster: m.media.poster } : {}),
    ...(Number.isFinite(m.media?.duration) ? { duration: m.media.duration } : {}),
  },
});

export function materializeGallery(g, moments, tracks) {
  const ms = new Set(g.momentIds ?? []), ts = new Set(g.trackIds ?? []);
  return {
    id: g.id, title: g.title, description: g.description ?? "", updatedAt: g.updatedAt ?? g.createdAt ?? null,
    // Only when it is on: a projection should say what is true, not carry a
    // false for every option that exists.
    ...(g.route === true ? { route: true } : {}),
    moments: moments.filter((m) => ms.has(m.id)).map(pub).sort(byT),
    tracks: tracks.filter((t) => ts.has(t.id)),
  };
}

// One person's journal. Every route works through one of these, so there is no
// path in the API that can reach somebody else's photos by construction.
export class Library {
  constructor(store, uid) {
    this.store = store;
    this.uid = uid;
    this.dir = uid === LEGACY ? path.join(store.dir, "library") : path.join(store.dir, "users", uid);
    this.paths = {
      moments: path.join(this.dir, "moments.json"),
      tracks: path.join(this.dir, "tracks.json"),
      galleries: path.join(this.dir, "galleries.json"),
    };
  }

  async ensure() {
    if (await exists(this.paths.moments)) return this;
    await mkdir(this.dir, { recursive: true });
    for (const p of [this.paths.moments, this.paths.tracks, this.paths.galleries]) {
      if (!(await exists(p))) await atomicWrite(p, []);
    }
    return this;
  }

  moments() { return readJson(this.paths.moments, []); }
  tracks() { return readJson(this.paths.tracks, []); }
  galleries() { return readJson(this.paths.galleries, []); }

  // Every write goes through the store's one queue and ends with a
  // rematerialisation, so the public files always reflect the library and
  // never interleave -- with other writes of this person's OR anyone else's.
  #run(fn) {
    return this.store.serialize(async () => {
      const r = await fn();
      // `locked`: we are already inside the queue. Asking materialize to take
      // it again waits for a turn that cannot come until we return -- which is
      // a deadlock, and the request simply never answers.
      await this.store.materialize(this.uid, { locked: true });
      return r;
    });
  }
  updateMoments(fn) {
    return this.#run(async () => {
      const next = await fn(await this.moments());
      next.sort(byT);
      await atomicWrite(this.paths.moments, next);
      return next;
    });
  }
  updateGalleries(fn) {
    return this.#run(async () => {
      const next = await fn(await this.galleries());
      await atomicWrite(this.paths.galleries, next);
      return next;
    });
  }
}

export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.paths = {
      users: path.join(dataDir, "users"),
      owners: path.join(dataDir, "library", "owners.json"),
      slugs: path.join(dataDir, "library", "slugs.json"),
      views: path.join(dataDir, "library", "views.json"),
      instance: path.join(dataDir, "library", "instance.json"),
      home: path.join(dataDir, "data", "home.json"),
      pubGalleries: path.join(dataDir, "data", "galleries"),
      legacyLibrary: path.join(dataDir, "library"),
      legacyMomentsV1: path.join(dataDir, "library", "moments.json"),
      legacyTracksV1: path.join(dataDir, "library", "tracks.json"),
      legacyGalleriesV1: path.join(dataDir, "library", "galleries.json"),
      legacyMoments: path.join(dataDir, "data", "moments.json"),
      legacyTracks: path.join(dataDir, "data", "tracks.json"),
    };
    this.queue = Promise.resolve();
  }

  // One writer at a time across every library on the volume.
  serialize(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }

  // Returns how the volume was brought up: existing | migrated | seeded | empty.
  async init(seedDir) {
    for (const d of ["library", "users", "data/galleries", "media", "originals"]) await mkdir(path.join(this.dir, d), { recursive: true });
    const how = await this.#bring(seedDir);
    await this.reconcile();
    return how;
  }

  async #bring(seedDir) {
    if ((await this.users()).length || (await exists(this.paths.legacyMomentsV1))) return "existing";
    if (await exists(this.paths.legacyMoments)) { await this.#migrateV0(); return "migrated"; }
    if (seedDir && (await exists(path.join(seedDir, "library", "moments.json")))) {
      // Never clobber: whichever pod seeds first wins, the other finds it done.
      for (const d of ["library", "data", "media"]) {
        if (await exists(path.join(seedDir, d))) await cp(path.join(seedDir, d), path.join(this.dir, d), { recursive: true, force: false, errorOnExist: false });
      }
      return "seeded";
    }
    return "empty";
  }

  // 0.2.x served the whole library publicly from data/moments.json. Move it
  // into the (then single) library and wrap everything in one home gallery.
  async #migrateV0() {
    const moments = await readJson(this.paths.legacyMoments, []);
    const tracks = await readJson(this.paths.legacyTracks, []);
    const now = new Date().toISOString();
    const home = {
      id: token(), title: "My journal", description: "", home: true,
      momentIds: moments.map((m) => m.id), trackIds: tracks.map((t) => t.id), createdAt: now, updatedAt: now,
    };
    await atomicWrite(this.paths.legacyMomentsV1, moments);
    await atomicWrite(this.paths.legacyTracksV1, tracks);
    await atomicWrite(this.paths.legacyGalleriesV1, [home]);
    await unlink(this.paths.legacyMoments).catch(() => {});
    await unlink(this.paths.legacyTracks).catch(() => {});
  }

  async users() {
    const names = await readdir(this.paths.users).catch(() => []);
    return names.filter((n) => UID_RE.test(n));
  }
  library(uid) { return new Library(this, uid); }
  // Present only until the first sign-in adopts it.
  async legacy() { return (await exists(this.paths.legacyMomentsV1)) && !(await this.users()).length ? new Library(this, LEGACY) : null; }

  #owners() { return readJson(this.paths.owners, {}); }
  slugs() { return readJson(this.paths.slugs, {}); }
  // Who, if anyone, already answers to this name. Global: there is only one
  // root namespace, and it is first come, first served.
  async slugTaken(slug, exceptToken = null) {
    const t = (await this.slugs())[slug];
    return !!t && t !== exceptToken;
  }
  #instance() { return readJson(this.paths.instance, {}); }

  // --- how many people have seen a gallery ----------------------------------
  // The hashes that make the per-day dedupe work never leave this file, so
  // `views()` hands back only the totals.
  #viewFile() { return readJson(this.paths.views, {}); }
  async views() {
    return Object.fromEntries(Object.entries(await this.#viewFile()).map(([token, e]) => [token, e?.n ?? 0]));
  }
  async viewsOf(token) { return (await this.#viewFile())[token]?.n ?? 0; }
  // How many people looked at each PHOTO, across every gallery it is in --
  // "which of my pictures did people stop on" is a question about the photo,
  // not about one link it happens to be shared through.
  async momentViews() {
    const out = {};
    for (const e of Object.values(await this.#viewFile()))
      for (const [id, n] of Object.entries(e?.m ?? {})) out[id] = (out[id] ?? 0) + n;
    return out;
  }
  async momentViewsOf(token) { return (await this.#viewFile())[token]?.m ?? {}; }

  // The salt is per-instance and never leaves the volume: without it the
  // stored hashes are not linkable to anything, even by whoever holds the file.
  async #viewSalt() {
    const inst = await this.#instance();
    if (inst.viewSalt) return inst.viewSalt;
    const viewSalt = newSalt();
    await atomicWrite(this.paths.instance, { ...inst, viewSalt });
    return viewSalt;
  }

  // Returns `{ n, fresh }`, or null if there is no such published gallery --
  // so this endpoint cannot be used to make up entries.
  async recordView(name, { ip, ua, moment = null, at = new Date() } = {}) {
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(String(name ?? ""))) return null;
    if (moment !== null && !/^[a-z0-9]{4,64}$/.test(String(moment))) return null;
    return this.serialize(async () => {
      // A gallery reached by its pretty name is the same gallery: one count,
      // whichever of its two URLs somebody was given.
      const token = (await this.slugs())[name] ?? name;
      const file_ = path.join(this.paths.pubGalleries, `${token}.json`);
      if (!(await exists(file_))) return null;
      // A photo is only countable if it is actually IN this gallery -- the
      // endpoint is public, so the id has to be checked against what was
      // published rather than trusted.
      if (moment) {
        const pub = await readJson(file_, null);
        if (!pub?.moments?.some((m) => m.id === moment)) return null;
      }
      const day = dayOf(at);
      const salt = await this.#viewSalt();
      const file = await this.#viewFile();
      // The photo's id goes into the visitor key, so each photo dedupes on its
      // own: one visitor looking at six photos is six views, not one.
      const key = visitorKey({ salt, ip, ua, token: moment ? `${token}/${moment}` : token, day });
      const { entry, n, fresh } = countView(file[token], key, day, { moment });
      if (fresh) await atomicWrite(this.paths.views, { ...file, [token]: entry });
      return { n, fresh };
    });
  }

  // A gallery that is gone should not keep a count that a later token could
  // inherit. Called from the same pass that prunes its published file.
  async forgetViews(tokens) {
    if (!tokens.length) return;
    const file = await this.#viewFile();
    let touched = false;
    for (const t of tokens) if (t in file) { delete file[t]; touched = true; }
    if (touched) await atomicWrite(this.paths.views, file);
  }

  // Whose home gallery "/" shows. The first person to sign in; after that it
  // does not move, so somebody else making their own journal cannot take over
  // the front page.
  async ownerUid() { return (await this.#instance()).owner ?? null; }
  async ownerOf(token) { return (await this.#owners())[token] ?? null; }

  // The single-tenant library from before 0.21 belongs to whoever signs in
  // first -- on a deployment that has been running, that is the person whose
  // photos they already are.
  async adopt(uid, email) {
    return this.serialize(async () => {
      const inst = await this.#instance();
      if (!inst.owner) await atomicWrite(this.paths.instance, { ...inst, owner: uid, ownerEmail: email ?? null, since: new Date().toISOString() });
      const lib = this.library(uid);
      const legacy = await exists(this.paths.legacyMomentsV1);
      const mine = await exists(lib.paths.moments);
      if (legacy && !mine && (await this.users()).length === 0) {
        await mkdir(lib.dir, { recursive: true });
        for (const [from, to] of [[this.paths.legacyMomentsV1, lib.paths.moments], [this.paths.legacyTracksV1, lib.paths.tracks], [this.paths.legacyGalleriesV1, lib.paths.galleries]]) {
          if (await exists(from)) await rename(from, to);
        }
        // Everything already published under the old layout is now theirs.
        const owners = await this.#owners();
        for (const [id, who] of Object.entries(owners)) if (who === LEGACY) owners[id] = uid;
        for (const g of await lib.galleries()) owners[g.id] = uid;
        await atomicWrite(this.paths.owners, owners);
      }
      await lib.ensure();
      await this.materialize(uid, { locked: true });
      return lib;
    });
  }

  // Publish one person's galleries and retire the ones they have deleted.
  // Scoped by the owners index: pruning by "everything not in this list" would
  // delete every other person's gallery on the volume.
  async materialize(uid, { locked = false } = {}) {
    const run = async () => {
      const lib = this.library(uid);
      const [moments, tracks, galleries] = await Promise.all([lib.moments(), lib.tracks(), lib.galleries()]);
      await mkdir(this.paths.pubGalleries, { recursive: true });
      const owners = await this.#owners();
      const slugs = await this.slugs();
      // Which galleries were this person's BEFORE this pass. Both prunes need
      // it, and the owners prune below is about to forget the deleted ones.
      const wasMine = new Set(Object.entries(owners).filter(([, o]) => o === uid).map(([id]) => id));
      const keep = new Set();
      for (const g of galleries) {
        const projection = materializeGallery(g, moments, tracks);
        await atomicWrite(path.join(this.paths.pubGalleries, `${g.id}.json`), projection);
        owners[g.id] = uid;
        keep.add(g.id);
        // The pretty name is published as a second copy under its own name, so
        // the viewer resolves /singaporeeats with one fetch and no routing.
        // The token file stays forever: a link already sent must keep working.
        if (g.slug) {
          await atomicWrite(path.join(this.paths.pubGalleries, `${g.slug}.json`), projection);
          slugs[g.slug] = g.id;
        }
      }
      const dropped = [];
      for (const id of wasMine) {
        if (keep.has(id)) continue;
        delete owners[id];
        dropped.push(id);
        await unlink(path.join(this.paths.pubGalleries, `${id}.json`)).catch(() => {});
      }
      // ...and its view count goes with it, so a later token cannot inherit
      // somebody else's number.
      await this.forgetViews(dropped);
      // A name this person's gallery has given up -- renamed, cleared, or the
      // whole gallery deleted -- stops answering, and the name is free for
      // anybody again. Someone else's names are not ours to touch.
      const mine = new Map(galleries.map((g) => [g.id, g.slug ?? null]));
      for (const [slug, tok] of Object.entries(slugs)) {
        if (!wasMine.has(tok) && !keep.has(tok)) continue;
        if (mine.get(tok) === slug) continue;
        delete slugs[slug];
        await unlink(path.join(this.paths.pubGalleries, `${slug}.json`)).catch(() => {});
      }
      await atomicWrite(this.paths.owners, owners);
      await atomicWrite(this.paths.slugs, slugs);
      // "/" belongs to the instance owner; everyone else shares by link. Until
      // anyone has signed in, that is the library the deployment came with.
      const owner = await this.ownerUid();
      if (owner === uid || (uid === LEGACY && !owner)) {
        const home = galleries.find((g) => g.home);
        if (home) await atomicWrite(this.paths.home, { gallery: home.id });
        else await unlink(this.paths.home).catch(() => {});
      }
    };
    return locked ? run() : this.serialize(run);
  }

  // Boot-time tidy: publish what every library says, and drop public files for
  // galleries nobody owns any more (a half-finished delete, an old layout).
  async reconcile() {
    const uids = await this.users();
    for (const uid of uids) await this.materialize(uid);
    // A deployment that has never been signed into still has a journal to
    // serve -- the seed, or whatever the single-tenant layout left behind.
    if (await this.legacy()) await this.materialize(LEGACY);
    const owners = await this.#owners();
    const slugs = await this.slugs();
    for (const f of await readdir(this.paths.pubGalleries).catch(() => [])) {
      if (!f.endsWith(".json")) continue;
      const id = f.slice(0, -5);
      if (owners[id] || slugs[id]) continue;
      await unlink(path.join(this.paths.pubGalleries, f)).catch(() => {});
    }
  }

  async removeFiles(rels) {
    for (const rel of rels) {
      if (!rel || rel.includes("..")) continue;
      await unlink(path.join(this.dir, rel)).catch(() => {});
    }
  }

  // Everything a person has, gone. (Not wired to a route yet; here so that
  // "delete my account" is a five-line change rather than an archaeology dig.)
  async forget(uid) {
    return this.serialize(async () => {
      const owners = await this.#owners();
      const slugs = await this.slugs();
      for (const [id, owner] of Object.entries(owners)) {
        if (owner !== uid) continue;
        delete owners[id];
        await unlink(path.join(this.paths.pubGalleries, `${id}.json`)).catch(() => {});
        for (const [slug, token] of Object.entries(slugs)) {
          if (token !== id) continue;
          delete slugs[slug];
          await unlink(path.join(this.paths.pubGalleries, `${slug}.json`)).catch(() => {});
        }
      }
      await atomicWrite(this.paths.owners, owners);
      await atomicWrite(this.paths.slugs, slugs);
      await rm(path.join(this.paths.users, uid), { recursive: true, force: true });
      await rm(path.join(this.dir, "media", uid), { recursive: true, force: true });
      await rm(path.join(this.dir, "originals", uid), { recursive: true, force: true });
    });
  }
}
