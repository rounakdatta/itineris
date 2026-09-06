import { createHash } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import exifr from "exifr";
import { localIso } from "./time.js";
import { isVideo, probe, posterFrame, transcode, videoTime, MAX_VIDEO_SECONDS, VIDEO_MAX_EDGE } from "./video.js";
import { rename, unlink, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";

// One small pod, occasional bursts of very large phone photos: trade throughput
// for a bounded peak. Single libvips thread, no operation cache.
sharp.concurrency(1);
sharp.cache(false);

export const LARGE = 1600;
export const MEDIUM = 960;   // what a phone actually displays; a quarter of the bytes of LARGE
export const THUMB = 400;

const exists = (p) => access(p).then(() => true, () => false);

// Read EXIF as RAW strings. exifr's default `reviveValues` would turn
// DateTimeOriginal into a JS Date interpreted in the SERVER's zone, destroying
// exactly the local-time information we need to keep.
async function readExif(buf) {
  let tags = {};
  try {
    tags = (await exifr.parse(buf, {
      reviveValues: false, translateKeys: true, translateValues: false,
      // Names AND codes: if the dictionary lacks OffsetTimeOriginal, the code still gets picked.
      pick: ["DateTimeOriginal", "CreateDate", "OffsetTimeOriginal", "OffsetTime", "Make", "Model", 0x9011, 0x9010],
    })) ?? {};
  } catch { /* not a JPEG/HEIC with EXIF; fine */ }
  let gps = null;
  try { gps = (await exifr.gps(buf)) ?? null; } catch { /* no GPS */ }
  return {
    dateTimeOriginal: tags.DateTimeOriginal ?? tags.CreateDate ?? null,
    // 0x9011 / 0x9010 in case the dictionary lacks the name.
    offsetTimeOriginal: tags.OffsetTimeOriginal ?? tags[36881] ?? tags.OffsetTime ?? tags[36880] ?? null,
    lat: Number.isFinite(gps?.latitude) ? gps.latitude : null,
    lng: Number.isFinite(gps?.longitude) ? gps.longitude : null,
    camera: [tags.Make, tags.Model].filter(Boolean).join(" ").trim() || null,
  };
}

// Photo or video, by what the phone said it was and by the file's name.
export function ingestMedia(buf, filename, mime, opts) {
  return isVideo(filename, mime) ? ingestVideo(buf, filename, opts) : ingestPhoto(buf, filename, opts);
}

// The three photo tiers from any raster buffer (a photo, or a video's poster frame).
async function tiers(buf, dataDir, hash) {
  const base = sharp(buf, { failOn: "none" });
  const large = await base.clone().rotate().resize({ width: LARGE, height: LARGE, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  const medium = await base.clone().rotate().resize({ width: MEDIUM, height: MEDIUM, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  const thumb = await base.clone().rotate().resize({ width: THUMB, height: THUMB, fit: "inside", withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();
  await mkdir(path.join(dataDir, "media"), { recursive: true });
  const rel = { large: `media/${hash}-${LARGE}.webp`, medium: `media/${hash}-${MEDIUM}.webp`, thumb: `media/${hash}-${THUMB}.webp` };
  await writeFile(path.join(dataDir, rel.large), large.data);
  await writeFile(path.join(dataDir, rel.medium), medium);
  await writeFile(path.join(dataDir, rel.thumb), thumb);
  return { ...rel, w: large.info.width, h: large.info.height };
}

// One uploaded video -> the original kept, an H.264 copy every browser plays,
// a poster frame in the photo tiers, and a moment whose media.type is "video".
// The original is written FIRST, so a retry of a long upload (the phone gave
// up waiting while ffmpeg worked) sees a duplicate instead of transcoding twice.
export async function ingestVideo(buf, filename, { dataDir, email }) {
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
  const id = `p${hash}`;
  const ext = (path.extname(filename || "").toLowerCase().replace(/[^a-z0-9.]/g, "") || ".mp4").slice(0, 8);
  const originalRel = `originals/${hash}${ext}`;
  const originalAbs = path.join(dataDir, originalRel);
  if (await exists(originalAbs)) return { id, duplicate: true };
  await mkdir(path.join(dataDir, "originals"), { recursive: true });
  await mkdir(path.join(dataDir, "media"), { recursive: true });
  await writeFile(originalAbs, buf);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "itineris-video-"));
  try {
    const info = await probe(originalAbs);
    if (!info.width || !info.height) throw new Error("not a video we can read");
    if (info.duration && info.duration > MAX_VIDEO_SECONDS) throw new Error(`video is ${Math.round(info.duration)} s long; the limit is ${MAX_VIDEO_SECONDS} s`);
    const poster = await tiers(await posterFrame(originalAbs, info.duration), dataDir, hash);
    const srcRel = `media/${hash}-${VIDEO_MAX_EDGE}.mp4`;
    const tmpOut = path.join(tmp, "out.mp4");
    await transcode(originalAbs, tmpOut);
    await rename(tmpOut, path.join(dataDir, srcRel)).catch(async () => { await writeFile(path.join(dataDir, srcRel), await (await import("node:fs/promises")).readFile(tmpOut)); });
    const scale = Math.min(1, VIDEO_MAX_EDGE / Math.max(info.width, info.height));
    const w = Math.round(info.width * scale), h = Math.round(info.height * scale);
    const when = videoTime(info);
    const t = when?.t ?? localIso({}).t, tz = when?.tz ?? "unknown";
    return {
      id, duplicate: false,
      moment: {
        id, t, tz,
        lat: info.gps?.lat ?? null, lng: info.gps?.lng ?? null,
        place: "", caption: "", tags: [],
        media: { type: "video", src: srcRel, w, h, poster: poster.large, medium: poster.medium, thumb: poster.thumb, duration: info.duration, original: originalRel },
        camera: null,
        uploadedBy: email, uploadedAt: new Date().toISOString(), filename: path.basename(filename || ""),
      },
    };
  } catch (e) {
    await unlink(originalAbs).catch(() => {});   // a failed video must not count as a duplicate next time
    throw e;
  } finally { await rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}

// One uploaded file -> derivatives on disk + a moment record.
// Files are named by content hash: identical bytes are the same moment, and
// derivative URLs can be cached forever because they can never change meaning.
export async function ingestPhoto(buf, filename, { dataDir, email }) {
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
  const id = `p${hash}`;
  const ext = (path.extname(filename || "").toLowerCase().replace(/[^a-z0-9.]/g, "") || ".jpg").slice(0, 8);
  const originalRel = `originals/${hash}${ext}`;
  const largeRel = `media/${hash}-${LARGE}.webp`;
  const mediumRel = `media/${hash}-${MEDIUM}.webp`;
  const thumbRel = `media/${hash}-${THUMB}.webp`;

  if (await exists(path.join(dataDir, originalRel))) return { id, duplicate: true };

  const exif = await readExif(buf);
  const { t, tz } = localIso(exif);

  // rotate() applies the EXIF orientation and drops the tag; the WebP encoder
  // writes no EXIF at all unless asked, so derivatives carry no GPS, no camera
  // serial, nothing -- the public copies are clean by construction.
  const base = sharp(buf, { failOn: "none" });
  const large = await base.clone().rotate()
    .resize({ width: LARGE, height: LARGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  const medium = await base.clone().rotate()
    .resize({ width: MEDIUM, height: MEDIUM, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 }).toBuffer();
  const thumb = await base.clone().rotate()
    .resize({ width: THUMB, height: THUMB, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 74 }).toBuffer();

  await mkdir(path.join(dataDir, "originals"), { recursive: true });
  await mkdir(path.join(dataDir, "media"), { recursive: true });
  await writeFile(path.join(dataDir, originalRel), buf);
  await writeFile(path.join(dataDir, largeRel), large.data);
  await writeFile(path.join(dataDir, mediumRel), medium);
  await writeFile(path.join(dataDir, thumbRel), thumb);

  return {
    id, duplicate: false,
    moment: {
      id, t, tz,
      lat: exif.lat, lng: exif.lng,
      place: "", caption: "", tags: [],
      media: { type: "photo", src: largeRel, w: large.info.width, h: large.info.height, medium: mediumRel, thumb: thumbRel, original: originalRel },
      camera: exif.camera,
      uploadedBy: email, uploadedAt: new Date().toISOString(), filename: path.basename(filename || ""),
    },
  };
}

// 0.5.0 added the 960 px copy phones actually display. Photos from before it
// get theirs here, one at a time in the background, from the original when it
// is still around (else from the 1600 px copy). Idempotent: a restart resumes.
export async function backfillMedium(store, dataDir) {
  const todo = (await store.moments()).filter((m) => m.media?.type === "photo" && !m.media.medium && m.media.src);
  const made = new Map();
  for (const m of todo) {
    const rel = m.media.src.replace(/(-\d+)?\.webp$/, `-${MEDIUM}.webp`);
    if (rel === m.media.src) continue;
    if (!(await exists(path.join(dataDir, rel)))) {
      const from = m.media.original && (await exists(path.join(dataDir, m.media.original))) ? m.media.original : m.media.src;
      if (!(await exists(path.join(dataDir, from)))) continue;
      try {
        const buf = await sharp(path.join(dataDir, from), { failOn: "none" }).rotate()
          .resize({ width: MEDIUM, height: MEDIUM, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80 }).toBuffer();
        await writeFile(path.join(dataDir, rel), buf);
      } catch (e) { console.error(`backfill ${m.id}: ${e.message}`); continue; }
    }
    made.set(m.id, rel);
  }
  if (made.size) await store.updateMoments((ms) => ms.map((x) => (made.has(x.id) && !x.media.medium ? { ...x, media: { ...x.media, medium: made.get(x.id) } } : x)));
  return made.size;
}
