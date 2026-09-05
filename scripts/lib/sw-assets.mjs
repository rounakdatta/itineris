// Big vendor chunks (MapLibre is ~1 MB) are NOT precached at install: a worker
// only takes over once its install finishes, and on a 1 KB/s link a megabyte
// means twenty minutes -- or never. They are cached on first use and carried
// across versions instead (their hashed names rarely change).
export const isHeavy = (file) => /\/assets\/maplibre-/.test(file);
export function partitionAssets(files) {
  return { precache: files.filter((f) => !isHeavy(f)), heavy: files.filter(isHeavy) };
}
