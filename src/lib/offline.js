// "Save for offline": pull a gallery's photos and its map area into the same
// Cache Storage the service worker serves from, with progress. The worker
// also caches whatever you browse; this is the deliberate, complete version.
import { hasCoords, mediaUrl, bboxOf } from "./data.js";
import { tilesFor, fillTemplate, normalizeTileKey, zoomToFit } from "../sw/strategies.js";

let tileTemplate = null;
export const setTileTemplate = (t) => { tileTemplate = t ? normalizeTileKey(t) : null; };
export const getTileTemplate = () => tileTemplate;
const savedKey = (id) => `itineris:saved:${id}`;

export function savedInfo(id) {
  try { return JSON.parse(localStorage.getItem(savedKey(id))); } catch { return null; }
}

export function planDownload({ moments = [], tracks = [] }) {
  const media = [...new Set(moments.flatMap((m) => [m.media?.thumb, m.media?.src].filter(Boolean).map(mediaUrl)))];
  const box = bboxOf(moments.filter(hasCoords), tracks);
  let tiles = [], stoppedAt = null, zmin = null, zmax = null;
  if (box && tileTemplate) {
    const pad = 0.15;
    const padded = [box[0] - (box[2] - box[0]) * pad, box[1] - (box[3] - box[1]) * pad, box[2] + (box[2] - box[0]) * pad, box[3] + (box[3] - box[1]) * pad];
    zmin = Math.max(8, Math.min(12, zoomToFit(padded) - 1));
    zmax = 14;
    ({ tiles, stoppedAt } = tilesFor(padded, zmin, zmax));
    tiles = tiles.map((t) => fillTemplate(tileTemplate, t));
  }
  return { media, tiles, zmin, zmax: stoppedAt ? stoppedAt - 1 : zmax };
}

async function pull(urls, cacheName, keyFor, state, onProgress) {
  const cache = await caches.open(cacheName);
  const queue = urls.slice();
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const u = queue.shift();
      try {
        const res = await fetch(u);
        if (res.ok) { const b = await res.blob(); state.bytes += b.size; await cache.put(keyFor(u), new Response(b, { headers: res.headers })); }
        else state.failed++;
      } catch { state.failed++; }
      state.done++;
      onProgress?.({ ...state });
    }
  }));
}

export async function saveGallery(gallery, { onProgress } = {}) {
  await navigator.storage?.persist?.().catch(() => {});
  const plan = planDownload(gallery);
  const state = { done: 0, total: plan.media.length + plan.tiles.length, bytes: 0, failed: 0 };
  onProgress?.({ ...state });
  await pull(plan.media, "itineris-media", (u) => u, state, onProgress);
  await pull(plan.tiles, "itineris-tiles", normalizeTileKey, state, onProgress);
  const info = { at: Date.now(), media: plan.media.length, tiles: plan.tiles.length, zmax: plan.zmax, bytes: state.bytes, failed: state.failed };
  localStorage.setItem(savedKey(gallery.id), JSON.stringify(info));
  return info;
}

export async function forgetGallery(gallery) {
  const cache = await caches.open("itineris-media");
  for (const u of planDownload(gallery).media) await cache.delete(u);
  localStorage.removeItem(savedKey(gallery.id));
}

export const fmtBytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
export const canSave = () => typeof caches !== "undefined";
