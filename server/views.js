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

// One view per visitor per gallery per day. Reloading all afternoon counts
// once; coming back tomorrow counts again, which is what "views" means to the
// person reading the number.
export function countView(entry, key, day, cap = VIEW_CAP) {
  const carried = entry?.day === day ? entry : { n: entry?.n ?? 0, day, seen: [] };
  const seen = carried.seen ?? [];
  if (seen.includes(key)) return { entry: carried, n: carried.n, fresh: false };
  const n = carried.n + 1;
  return { entry: { n, day, seen: seen.length >= cap ? seen : [...seen, key] }, n, fresh: true };
}

// The visitor's address as the proxy in front of us reports it. Only ever used
// as hash input, never stored or logged.
export function clientIp(header) {
  const xff = (header("x-forwarded-for") ?? "").split(",")[0].trim();
  return xff || (header("x-real-ip") ?? "").trim() || "";
}

// A plain token bucket, per address. The per-day dedupe already stops anyone
// running the NUMBER up; this stops them running the DISK up.
export function makeLimiter({ perMinute = 60, max = 8192 } = {}) {
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
