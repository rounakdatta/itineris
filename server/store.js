import { readFile, writeFile, rename, mkdir, cp, unlink, access, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

// ---------------------------------------------------------------------------
// Layout under the data dir. Only data/ and media/ are ever served publicly.
//
//   library/moments.json      every moment, private (has uploader, filename…)
//   library/tracks.json       every track, private
//   library/galleries.json    curated subsets: which moments/tracks, title, home
//   data/home.json            { gallery } -> what "/" shows; absent = landing page
//   data/galleries/<id>.json  one public projection per gallery
//   media/                    content-hashed derivatives (public by obscurity)
//   originals/                never served
//
// Uploads are therefore private until placed in a gallery, a photo can sit in
// many galleries, and every gallery URL is an unguessable token.
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

// The public shape of a moment. Whitelist, never blacklist: a new private field
// on the library record must be added here on purpose before it can leak.
export const pub = (m) => ({
  id: m.id, t: m.t, tz: m.tz ?? "exif",
  lat: Number.isFinite(m.lat) ? m.lat : null, lng: Number.isFinite(m.lng) ? m.lng : null,
  place: m.place ?? "", caption: m.caption ?? "", tags: m.tags ?? [],
  ...(m.mapsUrl ? { mapsUrl: m.mapsUrl } : {}),
  ...(m.captionStyle ? { captionStyle: m.captionStyle } : {}),
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
    moments: moments.filter((m) => ms.has(m.id)).map(pub).sort(byT),
    tracks: tracks.filter((t) => ts.has(t.id)),
  };
}

export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.paths = {
      moments: path.join(dataDir, "library", "moments.json"),
      tracks: path.join(dataDir, "library", "tracks.json"),
      galleries: path.join(dataDir, "library", "galleries.json"),
      home: path.join(dataDir, "data", "home.json"),
      pubGalleries: path.join(dataDir, "data", "galleries"),
      legacyMoments: path.join(dataDir, "data", "moments.json"),
      legacyTracks: path.join(dataDir, "data", "tracks.json"),
    };
    this.queue = Promise.resolve();
  }

  // Returns how the volume was brought up: existing | migrated | seeded | empty.
  async init(seedDir) {
    for (const d of ["library", "data/galleries", "media", "originals"]) await mkdir(path.join(this.dir, d), { recursive: true });
    if (await exists(this.paths.moments)) {
      await this.materialize();                 // heals any stale or missing public file
      return "existing";
    }
    if (await exists(this.paths.legacyMoments)) {
      await this.#migrateLegacy();
      return "migrated";
    }
    if (seedDir && (await exists(path.join(seedDir, "library", "moments.json")))) {
      // Never clobber: whichever pod seeds first wins, the other finds it done.
      for (const d of ["library", "data", "media"]) {
        if (await exists(path.join(seedDir, d))) await cp(path.join(seedDir, d), path.join(this.dir, d), { recursive: true, force: false, errorOnExist: false });
      }
      await this.materialize();
      return "seeded";
    }
    await atomicWrite(this.paths.moments, []);
    await atomicWrite(this.paths.tracks, []);
    await atomicWrite(this.paths.galleries, []);
    await this.materialize();
    return "empty";
  }

  // 0.2.x served the whole library publicly from data/moments.json. Move it
  // into the library, wrap everything in one home gallery so the live site
  // keeps showing exactly what it showed, then remove the public copies.
  async #migrateLegacy() {
    const moments = await readJson(this.paths.legacyMoments, []);
    const tracks = await readJson(this.paths.legacyTracks, []);
    const now = new Date().toISOString();
    const home = {
      id: token(), title: "My journal", description: "", home: true,
      momentIds: moments.map((m) => m.id), trackIds: tracks.map((t) => t.id), createdAt: now, updatedAt: now,
    };
    await atomicWrite(this.paths.moments, moments);
    await atomicWrite(this.paths.tracks, tracks);
    await atomicWrite(this.paths.galleries, [home]);
    await this.materialize();
    await unlink(this.paths.legacyMoments).catch(() => {});
    await unlink(this.paths.legacyTracks).catch(() => {});
  }

  moments() { return readJson(this.paths.moments, []); }
  tracks() { return readJson(this.paths.tracks, []); }
  galleries() { return readJson(this.paths.galleries, []); }

  // Every write goes through one queue and ends with a rematerialisation, so
  // the public files always reflect the library and never interleave.
  #run(fn) {
    const run = this.queue.then(async () => { const r = await fn(); await this.materialize(); return r; });
    this.queue = run.catch(() => {});
    return run;
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

  async materialize() {
    const [moments, tracks, galleries] = await Promise.all([this.moments(), this.tracks(), this.galleries()]);
    await mkdir(this.paths.pubGalleries, { recursive: true });
    const keep = new Set();
    for (const g of galleries) {
      await atomicWrite(path.join(this.paths.pubGalleries, `${g.id}.json`), materializeGallery(g, moments, tracks));
      keep.add(`${g.id}.json`);
    }
    for (const f of await readdir(this.paths.pubGalleries)) {
      if (f.endsWith(".json") && !keep.has(f)) await unlink(path.join(this.paths.pubGalleries, f)).catch(() => {});
    }
    const home = galleries.find((g) => g.home);
    if (home) await atomicWrite(this.paths.home, { gallery: home.id });
    else await unlink(this.paths.home).catch(() => {});
  }

  async removeFiles(rels) {
    for (const rel of rels) {
      if (!rel || rel.includes("..")) continue;
      await unlink(path.join(this.dir, rel)).catch(() => {});
    }
  }
}
