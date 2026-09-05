// EXIF in the browser, for the queue's own display: the server re-reads the
// file authoritatively on upload, so this only has to be good enough to show a
// time and a pin while a photo is waiting.
import exifr from "exifr/dist/lite.esm.mjs";

export async function readExif(file) {
  let tags = {};
  try { tags = (await exifr.parse(file, { reviveValues: false, translateKeys: true, pick: ["DateTimeOriginal", "OffsetTimeOriginal", 0x9011] })) ?? {}; } catch { /* no exif */ }
  let gps = null;
  try { gps = (await exifr.gps(file)) ?? null; } catch { /* no gps */ }
  return {
    dateTimeOriginal: tags.DateTimeOriginal ?? null,
    offset: tags.OffsetTimeOriginal ?? tags[36881] ?? null,
    lat: Number.isFinite(gps?.latitude) ? gps.latitude : null,
    lng: Number.isFinite(gps?.longitude) ? gps.longitude : null,
  };
}

const pad = (n) => String(n).padStart(2, "0");
const deviceOffset = (d) => { const m = -d.getTimezoneOffset(); return `${m < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(m) / 60))}:${pad(Math.abs(m) % 60)}`; };

// A displayable local ISO for a queued photo: EXIF wall clock + its offset if
// known, else the device's own zone (the phone that took it is usually the
// phone queueing it, so this is a good guess the server will refine anyway).
export function exifToIso(exif, fallbackMs = Date.now()) {
  const m = exif?.dateTimeOriginal?.match?.(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    const off = /^[+-]\d{2}:\d{2}$/.test(exif.offset ?? "") ? exif.offset : deviceOffset(new Date());
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${off}`;
  }
  const d = new Date(fallbackMs);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${deviceOffset(d)}`;
}
