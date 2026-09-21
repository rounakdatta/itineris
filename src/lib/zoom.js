// Pinch-to-zoom maths, kept out of the component so it can be tested without
// a browser. Everything here is in CSS pixels relative to the FRAME'S CENTRE,
// which is where a `transform: translate(x, y) scale(z)` measures from.

export const MAX_ZOOM = 5;
// Below this the photo is close enough to 1:1 that it should just snap back.
export const ZOOM_EPS = 0.01;
export const isZoomed = (z) => z > 1 + ZOOM_EPS;

// Where the PICTURE is, which is not where the frame is. A landscape photo in
// a portrait frame is letterboxed, and panning has to stop at the picture's
// edge -- otherwise you drag the photo away into the blurred bands and it
// looks broken.
export function pictureBox(frame, media, contain) {
  const W = frame?.width ?? 0, H = frame?.height ?? 0;
  if (!(W > 0 && H > 0)) return null;
  const w = media?.w || W, h = media?.h || H;
  // Mirrors the CSS: `object-fit: contain` for landscape, `cover` otherwise.
  const fit = contain ? Math.min(W / w, H / h) : Math.max(W / w, H / h);
  return { W, H, iw: w * fit, ih: h * fit };
}

// Never let the picture's edge come inside the frame. When a dimension is
// smaller than the frame even scaled up (a letterboxed photo at 1:1) there is
// nothing to pan along that axis, so it is pinned at the centre.
export function clampPan(box, z, x, y) {
  if (!box) return { x, y };
  const mx = Math.max(0, (box.iw * z - box.W) / 2);
  const my = Math.max(0, (box.ih * z - box.H) / 2);
  return { x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
}

// Scale about a point, keeping whatever is under that point exactly where it
// is. This is the whole feel of a pinch: the photo must not slide out from
// under your fingers. `from` is the current {z, x, y}; `anchor` is the midpoint
// between the fingers, relative to the frame's centre.
export function zoomAbout(box, from, scale, anchor) {
  const z = Math.min(MAX_ZOOM, Math.max(1, scale || 1));
  // All the way back out lands exactly home. A `cover` photo is already
  // cropped sideways at 1:1, so there is pan room even unzoomed -- without
  // this, pinching out left the photo sitting at a different crop than the
  // one the rest of the app draws, and it looked like a glitch.
  if (!isZoomed(z)) return { z: 1, x: 0, y: 0 };
  const ax = anchor?.x ?? 0, ay = anchor?.y ?? 0;
  // The point of the picture currently under the anchor, in unscaled pixels.
  const px = (ax - from.x) / from.z, py = (ay - from.y) / from.z;
  const p = clampPan(box, z, ax - px * z, ay - py * z);
  return { z, x: p.x, y: p.y };
}
