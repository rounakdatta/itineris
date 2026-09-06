// @vitest-environment node
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../admin/lib/exif.js", () => ({
  readExif: vi.fn(async () => ({ dateTimeOriginal: "2026:03:14 08:40:12", offset: "+08:00", lat: 1.28, lng: 103.84 })),
  exifToIso: () => "2026-03-14T08:40:12+08:00",
}));
vi.mock("../admin/lib/thumbs.js", () => ({ makeThumb: vi.fn(async () => null) }));
import { Outbox, backoff, metaToSend } from "../admin/lib/outbox.js";

// Plain objects stand in for File: the mocked exif/thumb readers never touch bytes.
const file = (name = "a.jpg") => ({ name, type: "image/jpeg", size: 3 });
const created = () => ({ created: [{ id: "p1" }], duplicates: [], errors: [] });
const netErr = () => Object.assign(new Error("network error"), { status: 0 });

let now, online;
const make = (upload) => new Outbox({ upload, now: () => now, isOnline: () => online });
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); now = 1_000_000; online = true; });

describe("Outbox", () => {
  it("queues instantly while offline and uploads once online", async () => {
    const upload = vi.fn(async () => created());
    const ob = make(upload); await ob.init();
    online = false;
    await ob.add([file("a.jpg"), file("b.jpg")]);
    expect(ob.items.map((i) => i.state)).toEqual(["waiting", "waiting"]);
    expect(upload).not.toHaveBeenCalled();
    const done = []; ob.onUploaded = (_r, it) => done.push(it.name);
    online = true; await ob.flush();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(ob.items).toEqual([]);
    expect(done).toEqual(["a.jpg", "b.jpg"]);
  });

  it("a network failure backs off and is retried, then succeeds", async () => {
    const upload = vi.fn().mockRejectedValueOnce(netErr()).mockResolvedValueOnce(created());
    const ob = make(upload); await ob.init();
    await ob.add([file()]); await ob.idle();      // add() kicks a flush: the first attempt fails
    const it = ob.items[0];
    expect(it.state).toBe("waiting"); expect(it.attempts).toBe(1); expect(it.error).toMatch(/network/);
    expect(it.nextAt).toBeGreaterThan(now + 1500); expect(it.nextAt).toBeLessThan(now + 2500);
    await ob.flush();                             // too early: nothing happens
    expect(upload).toHaveBeenCalledTimes(1);
    now += 3000; await ob.flush();
    expect(upload).toHaveBeenCalledTimes(2); expect(ob.items).toEqual([]);
  });

  it("keeps trying: backoff grows and is capped, never gives up", () => {
    expect(backoff(1)).toBeGreaterThan(1600); expect(backoff(1)).toBeLessThan(2400);
    expect(backoff(4)).toBeGreaterThan(backoff(1));
    expect(backoff(30)).toBeLessThanOrEqual(5 * 60_000 * 1.15);
  });

  it("a 401 pauses the whole queue until the user signs in (retryNow)", async () => {
    const upload = vi.fn().mockRejectedValueOnce(Object.assign(new Error("signed out"), { status: 401 })).mockResolvedValue(created());
    const ob = make(upload); await ob.init();
    await ob.add([file("a.jpg"), file("b.jpg")]); await ob.idle();
    expect(ob.blocked).toBe(true);
    expect(ob.items.map((i) => i.state)).toEqual(["waiting", "waiting"]);
    expect(upload).toHaveBeenCalledTimes(1);      // stopped at the first 401
    await ob.flush();
    expect(upload).toHaveBeenCalledTimes(1);      // blocked: no more attempts
    await ob.retryNow();
    expect(ob.blocked).toBe(false); expect(ob.items).toEqual([]); expect(upload).toHaveBeenCalledTimes(3);
  });

  it("a file the server refuses is parked, not retried, until the user asks", async () => {
    const upload = vi.fn().mockResolvedValueOnce({ created: [], duplicates: [], errors: [{ error: "unsupported image format" }] }).mockResolvedValueOnce(created());
    const ob = make(upload); await ob.init();
    await ob.add([file()]); await ob.idle();
    expect(ob.items[0].state).toBe("rejected"); expect(ob.items[0].error).toMatch(/unsupported/);
    now += 60_000; await ob.flush();
    expect(upload).toHaveBeenCalledTimes(1);
    await ob.retryNow();
    expect(ob.items).toEqual([]);
  });

  it("a duplicate (retry after a lost response) counts as success", async () => {
    const ob = make(vi.fn(async () => ({ created: [], duplicates: [{ id: "p1" }], errors: [] }))); await ob.init();
    await ob.add([file()]); await ob.idle();
    expect(ob.items).toEqual([]);
  });

  it("survives a restart: items, edits and a stuck 'uploading' state", async () => {
    online = false;
    const ob = make(vi.fn()); await ob.init();
    const [id] = await ob.add([file("keep.jpg")]);
    // A Proxy (what Svelte $state hands us) must not reach IndexedDB.
    await ob.updateMeta(id, new Proxy({ caption: "from the queue", tags: ["food"] }, {}));
    ob.items[0].state = "uploading"; await ob.updateMeta(id, {});   // persist the mid-upload state
    const again = make(vi.fn()); await again.init();
    expect(again.items.length).toBe(1);
    expect(again.items[0].meta.caption).toBe("from the queue");
    expect(again.items[0].state).toBe("waiting");                   // normalised on load
  });

  it("remove drops an item from the queue and the store", async () => {
    online = false;
    const ob = make(vi.fn()); await ob.init();
    const [a, b] = await ob.add([file("a.jpg"), file("b.jpg")]);
    await ob.remove(a);
    expect(ob.items.map((i) => i.id)).toEqual([b]);
    const again = make(vi.fn()); await again.init();
    expect(again.items.map((i) => i.id)).toEqual([b]);
  });

  it("subscribers get a snapshot immediately and on every change", async () => {
    online = false;
    const ob = make(vi.fn()); await ob.init();
    const seen = []; ob.subscribe((s) => seen.push(s.items.length));
    await ob.add([file()]);
    expect(seen[0]).toBe(0); expect(seen.at(-1)).toBe(1);
  });

  it("only user-set fields travel to the server", () => {
    const item = { meta: { caption: "", place: "", tags: [], galleries: [], lat: 1.28, lng: 103.84, t: "2026-03-14T08:40:12+08:00", locEdited: false, timeEdited: false } };
    expect(metaToSend(item)).toEqual({});                                     // server derives time/GPS from the file
    item.meta = { ...item.meta, caption: "hi", tags: ["food"], galleries: ["g1"], locEdited: true, timeEdited: true };
    expect(metaToSend(item)).toEqual({ caption: "hi", tags: ["food"], galleries: ["g1"], lat: 1.28, lng: 103.84, t: "2026-03-14T08:40:12+08:00" });
  });

  it("schedules a wake-up for the earliest backoff", async () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    const ob = make(vi.fn().mockRejectedValue(netErr())); await ob.init();
    await ob.add([file()]); await ob.idle();
    const delays = spy.mock.calls.map((c) => c[1]).filter((d) => d > 250);
    expect(delays.length).toBeGreaterThan(0); expect(Math.min(...delays)).toBeLessThan(2500);
    spy.mockRestore(); clearTimeout(ob.timer);
  });
});

describe("Outbox: a place for the whole batch", () => {
  it("photos added at a shared place carry it -- over EXIF -- and it travels to the server", async () => {
    const ob = make(vi.fn(async () => created())); await ob.init(); online = false;
    await ob.add([file("a.jpg")], { location: { lat: 24.471235, lng: 54.371235, name: "Zahrat Lebnan", mapsUrl: "https://maps.google.com/?cid=5" } });
    const it = ob.items[0];
    expect(it.meta).toMatchObject({ lat: 24.471235, lng: 54.371235, place: "Zahrat Lebnan", mapsUrl: "https://maps.google.com/?cid=5", locEdited: true });
    expect(metaToSend(it)).toEqual({ place: "Zahrat Lebnan", lat: 24.471235, lng: 54.371235, mapsUrl: "https://maps.google.com/?cid=5" });
    await ob.add([file("b.jpg")]);
    expect(ob.items[1].meta).toMatchObject({ lat: 1.28, lng: 103.84, mapsUrl: null, locEdited: false });   // EXIF, as before
  });
});
