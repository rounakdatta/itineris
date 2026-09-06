// A small preview for a queued photo, made on-device so the queue can be shown
// before anything has been uploaded. Falls back to null when the browser
// cannot decode the file (the tile then shows a placeholder).
export async function makeThumb(file, max = 400) {
  if (isVideoFile(file)) return makeVideoThumb(file, max);
  if (typeof createImageBitmap !== "function") return null;
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  let blob;
  if (typeof OffscreenCanvas === "function") {
    const c = new OffscreenCanvas(w, h); c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    blob = await c.convertToBlob({ type: "image/webp", quality: 0.72 }).catch(() => c.convertToBlob({ type: "image/jpeg", quality: 0.8 }));
  } else {
    const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
  }
  bmp.close?.();
  return blob ?? null;
}

export const isVideoFile = (file) => (file?.type ?? "").startsWith("video/") || /\.(mp4|m4v|mov|webm|mkv|3gp|3g2|avi|mts|m2ts)$/i.test(file?.name ?? "");

// A poster frame for a queued video, drawn from the browser's own decoder half
// a second in. Null when the browser cannot decode it (HEVC on some Androids):
// the tile then shows a placeholder and the server makes the real poster.
export function makeVideoThumb(file, max = 400) {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") return resolve(null);
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    const done = (blob) => { URL.revokeObjectURL(url); v.removeAttribute("src"); resolve(blob ?? null); };
    const t = setTimeout(() => done(null), 8000);
    v.onerror = () => { clearTimeout(t); done(null); };
    v.onloadedmetadata = () => { try { v.currentTime = Math.min(0.5, Math.max(0, (v.duration || 1) / 2)); } catch { clearTimeout(t); done(null); } };
    v.onseeked = () => {
      clearTimeout(t);
      try {
        const scale = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(v.videoWidth * scale)); c.height = Math.max(1, Math.round(v.videoHeight * scale));
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((b) => done(b), "image/jpeg", 0.8);
      } catch { done(null); }
    };
  });
}
