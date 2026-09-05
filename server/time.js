import tzlookup from "tz-lookup";

// EXIF DateTimeOriginal is wall-clock time with NO zone: "2026:03:14 08:40:12".
// OffsetTimeOriginal (EXIF 2.31, written by every modern phone) is "+08:00".
// When the offset is missing we derive the zone from GPS; when there is no GPS
// either, we say so in the record (tz: "unknown") rather than silently adopt
// the server's zone -- which is the bug this whole app is built to avoid.

const EXIF_DT = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const OFFSET = /^([+-])(\d{2}):(\d{2})$/;

export function parseExifDate(s) {
  const m = typeof s === "string" ? s.match(EXIF_DT) : null;
  if (!m) return null;
  const [, Y, M, D, h, mi, sec] = m;
  return { Y: +Y, M: +M, D: +D, h: +h, mi: +mi, sec: +sec };
}

export function parseOffset(s) {
  const m = typeof s === "string" ? s.trim().match(OFFSET) : null;
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (+m[2] * 60 + +m[3]);
}

export const fmtOffset = (min) => {
  const a = Math.abs(min);
  return `${min < 0 ? "-" : "+"}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
};

// Offset (minutes) that `zone` had at a given UTC instant, via Intl -- no tz database shipped.
function zoneOffsetAt(zone, utcMs) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).filter((x) => x.type !== "literal").map((x) => [x.type, +x.value]));
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asIfUtc - utcMs) / 60000);
}

// For a wall-clock time in `zone`, the offset in force. Two passes because the
// offset depends on the instant, which depends on the offset (DST edges).
export function offsetForWall(zone, w) {
  const naive = Date.UTC(w.Y, w.M - 1, w.D, w.h, w.mi, w.sec);
  const first = zoneOffsetAt(zone, naive);
  return zoneOffsetAt(zone, naive - first * 60000);
}

const pad = (n) => String(n).padStart(2, "0");
const iso = (w, off) => `${w.Y}-${pad(w.M)}-${pad(w.D)}T${pad(w.h)}:${pad(w.mi)}:${pad(w.sec)}${fmtOffset(off)}`;

// -> { t: "2026-03-14T08:40:12+08:00", tz: "exif" | "gps" | "unknown" }
export function localIso({ dateTimeOriginal, offsetTimeOriginal, lat, lng }, now = new Date()) {
  const wall = parseExifDate(dateTimeOriginal);
  if (!wall) {
    // No capture time at all: record the upload instant, in UTC, and flag it.
    const w = { Y: now.getUTCFullYear(), M: now.getUTCMonth() + 1, D: now.getUTCDate(), h: now.getUTCHours(), mi: now.getUTCMinutes(), sec: now.getUTCSeconds() };
    return { t: iso(w, 0), tz: "unknown" };
  }
  const off = parseOffset(offsetTimeOriginal);
  if (off !== null) return { t: iso(wall, off), tz: "exif" };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    try {
      return { t: iso(wall, offsetForWall(tzlookup(lat, lng), wall)), tz: "gps" };
    } catch { /* out-of-range coordinates: fall through */ }
  }
  return { t: iso(wall, 0), tz: "unknown" };
}

// Validates a user-edited timestamp: full ISO with an explicit offset, nothing else.
export const isLocalIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?[+-]\d{2}:\d{2}$/.test(s);
