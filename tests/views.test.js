import { describe, it, expect } from "vitest";
import { visitorKey, countView, clientIp, makeLimiter, dayOf, newSalt, VIEW_CAP } from "../server/views.js";
import { short, exact } from "../server/count.js";

const SALT = "a-salt";
const key = (over = {}) => visitorKey({ salt: SALT, ip: "1.2.3.4", ua: "Mozilla/5.0", token: "abc123", day: "2026-09-22", ...over });

describe("what a view remembers about a visitor", () => {
  it("is the same visitor on the same day at the same gallery", () => {
    expect(key()).toBe(key());
  });
  it("and nobody else", () => {
    expect(key({ ip: "1.2.3.5" })).not.toBe(key());
    expect(key({ ua: "Safari" })).not.toBe(key());
  });
  it("cannot be matched across galleries, or across days, or across servers", () => {
    expect(key({ token: "other" })).not.toBe(key());
    expect(key({ day: "2026-09-23" })).not.toBe(key());
    expect(key({ salt: newSalt() })).not.toBe(key());
  });
  it("keeps nothing that could be read back", () => {
    const k = key();
    expect(k).toMatch(/^[0-9a-f]{16}$/);
    for (const secret of ["1.2.3.4", "Mozilla", SALT]) expect(k).not.toContain(secret);
  });
  it("names the day in UTC, so the whole instance rolls over together", () => {
    expect(dayOf("2026-09-22T23:30:00Z")).toBe("2026-09-22");
    expect(dayOf("2026-09-23T00:30:00Z")).toBe("2026-09-23");
  });
});

describe("counting a view", () => {
  const DAY = "2026-09-22";
  it("counts the first visit", () => {
    const r = countView(undefined, "k1", DAY);
    expect(r).toMatchObject({ n: 1, fresh: true });
    expect(r.entry).toMatchObject({ n: 1, day: DAY, seen: ["k1"] });
  });
  it("does not count somebody reloading all afternoon", () => {
    let e = countView(undefined, "k1", DAY).entry;
    for (let i = 0; i < 50; i++) { const r = countView(e, "k1", DAY); expect(r.fresh).toBe(false); e = r.entry; }
    expect(e.n).toBe(1);
  });
  it("counts a different person on the same day", () => {
    const e = countView(undefined, "k1", DAY).entry;
    expect(countView(e, "k2", DAY)).toMatchObject({ n: 2, fresh: true });
  });
  it("counts the same person again tomorrow, and forgets yesterday's hashes", () => {
    const e = countView(undefined, "k1", DAY).entry;
    const r = countView(e, "k1", "2026-09-23");
    expect(r).toMatchObject({ n: 2, fresh: true });
    expect(r.entry).toMatchObject({ n: 2, day: "2026-09-23", seen: ["k1"] });   // yesterday's are gone
  });
  it("keeps counting past the cap rather than growing without bound", () => {
    const seen = Array.from({ length: 4 }, (_, i) => `k${i}`);
    const e = { n: 4, day: DAY, seen };
    const r = countView(e, "new", DAY, { cap: 4 });
    expect(r).toMatchObject({ n: 5, fresh: true });
    expect(r.entry.seen).toEqual(seen);         // not remembered, but counted
    expect(VIEW_CAP).toBeGreaterThan(1000);
  });
  it("survives a file written by an older version", () => {
    expect(countView({ n: 7 }, "k1", DAY)).toMatchObject({ n: 8, fresh: true });
    expect(countView({}, "k1", DAY)).toMatchObject({ n: 1, fresh: true });
  });
});

describe("counting one photo rather than the whole gallery", () => {
  const DAY = "2026-09-22";
  it("tallies each photo on its own", () => {
    let e = countView(undefined, "v1/a", DAY, { moment: "a" }).entry;
    e = countView(e, "v1/b", DAY, { moment: "b" }).entry;
    const again = countView(e, "v2/a", DAY, { moment: "a" });
    expect(again.n).toBe(2);
    expect(again.entry.m).toEqual({ a: 2, b: 1 });
  });
  it("does not let a photo view inflate the gallery's own count, or the reverse", () => {
    // Two different questions: how many opened this, and how many looked at
    // THIS picture. A creator reading the second needs it not to be the first.
    let e = countView(undefined, "v1", DAY).entry;                       // opened the gallery
    e = countView(e, "v1/a", DAY, { moment: "a" }).entry;                // looked at one photo
    e = countView(e, "v1/b", DAY, { moment: "b" }).entry;
    expect(e.n).toBe(1);
    expect(e.m).toEqual({ a: 1, b: 1 });
  });
  it("counts the same visitor once per photo per day", () => {
    let e = countView(undefined, "v1/a", DAY, { moment: "a" }).entry;
    for (let i = 0; i < 20; i++) {
      const r = countView(e, "v1/a", DAY, { moment: "a" });
      expect(r.fresh).toBe(false);
      e = r.entry;
    }
    expect(e.m.a).toBe(1);
  });
  it("keeps every tally when the day rolls over, and only forgets who", () => {
    const e = countView(undefined, "v1/a", DAY, { moment: "a" }).entry;
    const r = countView(e, "v1/a", "2026-09-23", { moment: "a" });
    expect(r.entry.m.a).toBe(2);
    expect(r.entry.seen).toEqual(["v1/a"]);
  });
  it("survives a file written before photos were counted at all", () => {
    const r = countView({ n: 7, day: DAY, seen: [] }, "v1/a", DAY, { moment: "a" });
    expect(r.entry).toMatchObject({ n: 7, m: { a: 1 } });
  });
});

describe("who the request came from", () => {
  const h = (o) => (k) => o[k];
  it("reads the address the proxy in front of us reports", () => {
    expect(clientIp(h({ "x-forwarded-for": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(h({ "x-forwarded-for": "9.9.9.9, 10.0.0.1, 10.0.0.2" }))).toBe("9.9.9.9");
    expect(clientIp(h({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
  });
  it("copes with no proxy at all", () => {
    expect(clientIp(h({}))).toBe("");
  });
});

describe("the rate limit", () => {
  it("is nowhere near anything a real address does", () => {
    // A household, an office and a mobile carrier all look like one address.
    // The dedupe means a repeat visitor writes nothing, so this only has to
    // catch a script inventing a new browser every request -- and a limit
    // tight enough to catch a NAT stops counting real people instead.
    const allow = makeLimiter();
    for (let i = 0; i < 200; i++) expect(allow("one-office", 1000)).toBe(true);
  });
  it("lets an ordinary visitor through", () => {
    const allow = makeLimiter({ perMinute: 60 });
    for (let i = 0; i < 10; i++) expect(allow("1.2.3.4", 1000 + i * 100)).toBe(true);
  });
  it("stops a flood, and only from the one flooding", () => {
    const allow = makeLimiter({ perMinute: 5 });
    for (let i = 0; i < 5; i++) expect(allow("flood", 1000)).toBe(true);
    expect(allow("flood", 1000)).toBe(false);
    expect(allow("someone-else", 1000)).toBe(true);
  });
  it("lets them back in as the minute passes", () => {
    const allow = makeLimiter({ perMinute: 60 });
    for (let i = 0; i < 60; i++) allow("x", 0);
    expect(allow("x", 0)).toBe(false);
    expect(allow("x", 2000)).toBe(true);      // two seconds buys two more
  });
  it("does not grow without bound", () => {
    const allow = makeLimiter({ perMinute: 60, max: 40 });
    for (let i = 0; i < 400; i++) allow(`ip-${i}`, i);
    expect(allow("ip-399", 500)).toBe(true);
  });
});

describe("reading a count at a glance", () => {
  it("shows small numbers exactly", () => {
    for (const n of [0, 1, 7, 42, 999]) expect(short(n)).toBe(String(n));
  });
  it("shortens the big ones without lying upward", () => {
    expect(short(1000)).toBe("1k");
    expect(short(1049)).toBe("1k");
    expect(short(1500)).toBe("1.5k");
    expect(short(9999)).toBe("9.9k");     // never rounds up to 10k
    expect(short(12400)).toBe("12k");
    expect(short(1_200_000)).toBe("1.2m");
  });
  it("says the exact number where there is room for it", () => {
    expect(exact(1)).toBe("1 view");
    expect(exact(12400)).toBe("12,400 views");
  });
  it("is not fooled by nonsense", () => {
    expect(short(undefined)).toBe("0");
    expect(short(-3)).toBe("0");
    expect(short(NaN)).toBe("0");
  });
});
