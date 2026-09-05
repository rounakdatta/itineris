import { createHash } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import exifr from "exifr";
import { localIso } from "./time.js";

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
