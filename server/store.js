import { readFile, writeFile, rename, mkdir, cp, unlink, access } from "node:fs/promises";
import path from "node:path";

const exists = (p) => access(p).then(() => true, () => false);

// Everything the viewer reads lives under one directory the public nginx also
// mounts:  data/moments.json  data/tracks.json  media/*  (originals/ is NOT
// served). Writes are serialised through a queue and land via tmp+rename, so a
// reader -- nginx, mid-request -- only ever sees a complete file.
export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.momentsPath = path.join(dataDir, "data", "moments.json");
    this.queue = Promise.resolve();
  }

  // Seed a fresh volume from the bundled demo trip, never clobbering anything
  // already there. The public image's initContainer does the same with the
  // same sentinel, so whichever pod starts first, the result is identical.
  async init(seedDir) {
    for (const d of ["data", "media", "originals"]) await mkdir(path.join(this.dir, d), { recursive: true });
    if (await exists(this.momentsPath)) return "existing";
    if (seedDir && (await exists(path.join(seedDir, "data", "moments.json")))) {
      await cp(path.join(seedDir, "data"), path.join(this.dir, "data"), { recursive: true, force: false, errorOnExist: false });
      if (await exists(path.join(seedDir, "media"))) {
        await cp(path.join(seedDir, "media"), path.join(this.dir, "media"), { recursive: true, force: false, errorOnExist: false });
      }
      return "seeded";
    }
    await this.#write([]);
    return "empty";
  }

  async moments() {
    try { return JSON.parse(await readFile(this.momentsPath, "utf8")); }
    catch (e) { if (e.code === "ENOENT") return []; throw e; }
  }

  // fn receives the current list and returns the new one.
  update(fn) {
    const run = this.queue.then(async () => {
      const next = await fn(await this.moments());
      next.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
      await this.#write(next);
      return next;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  async #write(list) {
    const tmp = `${this.momentsPath}.tmp`;
    await writeFile(tmp, JSON.stringify(list, null, 2) + "\n");
    await rename(tmp, this.momentsPath);
  }

  async removeFiles(rels) {
    for (const rel of rels) {
      if (!rel || rel.includes("..")) continue;
      await unlink(path.join(this.dir, rel)).catch(() => {});
    }
  }
}
