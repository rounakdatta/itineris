// How many people have seen a gallery.
//
// This is a public, unauthenticated write: anybody with the link can make the
// number go up, which is the point. So the design is about what it REFUSES to
// remember. Nothing that identifies a visitor is stored -- only a salted hash
// that mixes in the gallery and the date, so it cannot be walked back to an
// address, cannot be matched across galleries, and stops meaning anything at
// midnight. The hashes are never served to anyone; only the total is.
import { createHash, randomBytes } from "node:crypto";

// Hashes kept for one gallery for one day. Past this we stop remembering who
// and keep counting -- a gallery with twenty thousand visitors in a day has
// bigger things to worry about than a duplicate.
export const VIEW_CAP = 20000;

export const dayOf = (at = new Date()) => new Date(at).toISOString().slice(0, 10);
export const newSalt = () => randomBytes(32).toString("hex");

export function visitorKey({ salt, ip, ua, token, day }) {
  return createHash("sha256")
    .update(`${salt}\u0000${ip ?? ""}\u0000${ua ?? ""}\u0000${token}\u0000${day}`)
    .digest("hex").slice(0, 16);
}

// One view per visitor per day -- of the gallery, or of one photo in it.
// Reloading all afternoon counts once; coming back tomorrow counts again,
// which is what "views" means to the person reading the number.
//
// A gallery view and a photo view are different questions and are counted
// separately: `n` answers "how many people opened this", `m[id]` answers "how
// many looked at THIS picture", and the second is the one that tells a creator
// which of their photos people actually stopped on. The caller keeps them apart
// by mixing the photo's id into the visitor key, so each photo dedupes on its
// own.
export function countView(entry, key, day, { moment = null, cap = VIEW_CAP } = {}) {
  const carried = entry?.day === day
    ? { n: entry.n ?? 0, day, seen: entry.seen ?? [], m: entry.m ?? {} }
    : { n: entry?.n ?? 0, day, seen: [], m: entry?.m ?? {} };   // tallies persist; the day's hashes do not
  const seen = carried.seen;
  const total = moment ? (carried.m[moment] ?? 0) : carried.n;
  if (seen.includes(key)) return { entry: carried, n: total, fresh: false };
  const next = seen.length >= cap ? seen : [...seen, key];
  if (moment) {
    const n = total + 1;
    return { entry: { ...carried, seen: next, m: { ...carried.m, [moment]: n } }, n, fresh: true };
  }
  const n = carried.n + 1;
  return { entry: { ...carried, n, seen: next }, n, fresh: true };
}

// The visitor's address as the proxy in front of us reports it. Only ever used
// as hash input, never stored or logged.
export function clientIp(header) {
  const xff = (header("x-forwarded-for") ?? "").split(",")[0].trim();
  return xff || (header("x-real-ip") ?? "").trim() || "";
}

// A plain token bucket, per address. The per-day dedupe already stops anyone
// running the NUMBER up -- a repeat visitor writes nothing at all -- so this
// only has to stop somebody running the DISK up with a script that invents a
// new browser every request. It must therefore be far looser than real
// traffic: whole households, offices and mobile carriers share one address,
// and a limit tight enough to catch them stops counting real people.
export function makeLimiter({ perMinute = 240, max = 8192 } = {}) {
  const buckets = new Map();
  return function allow(who, now = Date.now()) {
    const b = buckets.get(who) ?? { tokens: perMinute, at: now };
    b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60000) * perMinute);
    b.at = now;
    if (b.tokens < 1) { buckets.set(who, b); return false; }
    b.tokens -= 1;
    // Cheapest possible eviction: when it gets big, drop whoever is oldest.
    if (buckets.size >= max) {
      const oldest = [...buckets.entries()].sort((a, z) => a[1].at - z[1].at).slice(0, Math.floor(max / 4));
      for (const [k] of oldest) buckets.delete(k);
    }
    buckets.set(who, b);
    return true;
  };
}
