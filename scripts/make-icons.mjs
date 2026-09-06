// Every icon the site serves, from one master drawing.
//
//   node scripts/make-icons.mjs
//
// The master (brand/itineris-mark.png) is the walking "it" ligature with its
// backpack, drawn on white with generous air around it. Each output crops that
// air away and puts back exactly as much as the slot wants: tight for a 16 px
// favicon, roomy for a home-screen tile, roomier still for Android's circular
// mask. Outputs are committed, so a build never needs sharp for this.
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MASTER = path.join(ROOT, "brand", "itineris-mark.png");
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

// The mark alone, with the master's white margins removed.
const trimmed = await sharp(MASTER).flatten({ background: WHITE }).trim({ threshold: 12 }).toBuffer();
const { width: tw, height: th } = await sharp(trimmed).metadata();
console.log(`mark: ${tw}x${th} after trimming the master's margins`);

// The mark centred on a white square, `margin` of the square left as air.
async function square(size, margin) {
  const inner = Math.round(size * (1 - 2 * margin));
  const art = await sharp(trimmed).resize({ width: inner, height: inner, fit: "inside", withoutEnlargement: false }).toBuffer();
  const { width, height } = await sharp(art).metadata();
  return sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: art, left: Math.round((size - width) / 2), top: Math.round((size - height) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// An .ico is a tiny directory of images; PNG payloads are allowed and smaller.
function ico(pngs) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = 6 + pngs.length * 16;
  const dir = [], body = [];
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    dir.push(e); body.push(data); offset += data.length;
  }
  return Buffer.concat([head, ...dir, ...body]);
}

// A share card: the mark on white, at ease, for whatever unfurls a gallery link.
async function card(width, height) {
  const art = await sharp(trimmed).resize({ height: Math.round(height * 0.56), fit: "inside" }).toBuffer();
  const { width: aw, height: ah } = await sharp(art).metadata();
  return sharp({ create: { width, height, channels: 4, background: WHITE } })
    .composite([{ input: art, left: Math.round((width - aw) / 2), top: Math.round((height - ah) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const TIGHT = 0.06, ROOMY = 0.12, APPLE = 0.14, MASKABLE = 0.26;   // Android masks to a circle: keep the art inside the safe 80%
const files = {
  "favicon-16.png": await square(16, TIGHT),
  "favicon-32.png": await square(32, TIGHT),
  "icon-192.png": await square(192, ROOMY),
  "icon-512.png": await square(512, ROOMY),
  "icon-maskable-512.png": await square(512, MASKABLE),
  "apple-touch-icon.png": await square(180, APPLE),
  "favicon.ico": ico([{ size: 16, data: await square(16, TIGHT) }, { size: 32, data: await square(32, TIGHT) }, { size: 48, data: await square(48, TIGHT) }]),
};
const viewerOnly = { "og-card.png": await card(1200, 630) };

for (const dir of [path.join(ROOT, "public"), path.join(ROOT, "admin", "public")]) {
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(files)) { writeFileSync(path.join(dir, name), data); console.log(`${path.relative(ROOT, path.join(dir, name))}  ${data.length} B`); }
}
for (const [name, data] of Object.entries(viewerOnly)) { writeFileSync(path.join(ROOT, "public", name), data); console.log(`public/${name}  ${data.length} B`); }
