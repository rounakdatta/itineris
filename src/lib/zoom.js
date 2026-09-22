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

// --- how a picture should meet the frame ------------------------------------

// What `object-fit: cover` throws away, as a fraction of the picture. Cover
// scales until the frame is full and crops the overflow on one axis, so the
// visible share is just the ratio of the two aspects.
export const coverLoss = (frameAspect, imageAspect) => {
  const a = Number(imageAspect), f = Number(frameAspect);
  if (!(a > 0 && f > 0)) return 0;
  return 1 - Math.min(a, f) / Math.max(a, f);
};

// Above this, fill the frame; beyond it, show the whole picture on a blurred
// copy of itself.
//
// The old rule was `width > height` -- landscape fills, everything else is
// cropped -- which is a cliff at exactly 1:1 while the HARM is continuous. In
// a real gallery that meant a 9:16 phone photo and a 1:1 collage were treated
// identically, though one lost 18% off the top and bottom and the other lost
// 54%: whole faces, whole quarters of a four-photo collage, gone.
//
// A quarter is the line because it sits between those two. The 18% a phone
// photo loses is the format working as intended -- that crop lands on sky and
// pavement, and filling the screen is the whole point of a story. Past a
// quarter you are no longer cropping a photo, you are re-composing somebody
// else's, and no viewer should be doing that.
export const COVER_LIMIT = 0.25;

export const shouldContain = (frameAspect, imageAspect, limit = COVER_LIMIT) =>
  coverLoss(frameAspect, imageAspect) > limit;
