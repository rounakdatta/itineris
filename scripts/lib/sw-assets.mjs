// Big vendor chunks (MapLibre is ~1 MB) and the caption fonts are NOT precached
// at install: a worker only takes over once its install finishes, and on a
// 1 KB/s link a megabyte means twenty minutes -- or never. A gallery uses at
// most a couple of the fonts, so paying for five up front would be worse than
// fetching one on demand. Both are cached on first use and carried across
// versions instead (their hashed names rarely change).
export const isHeavy = (file) => /\/assets\/maplibre-/.test(file) || /\.woff2?$/.test(file);
export function partitionAssets(files) {
  return { precache: files.filter((f) => !isHeavy(f)), heavy: files.filter(isHeavy) };
}
