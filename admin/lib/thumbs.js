// A small preview for a queued photo, made on-device so the queue can be shown
// before anything has been uploaded. Falls back to null when the browser
// cannot decode the file (the tile then shows a placeholder).
export async function makeThumb(file, max = 400) {
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
