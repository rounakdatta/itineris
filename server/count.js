// Turning a count into something readable at a glance.
//
// No node imports on purpose, same rule as server/slug.js: the viewer and the
// creator app both bundle this to draw the same number the same way.

// "1", "999", "1k", "1.5k", "12k", "1.2m". Never rounds up -- a gallery with
// 9,999 views says "9.9k", not "10k", because a number that overstates itself
// is a number nobody trusts.
export function short(n) {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.floor(n));
  for (const [unit, size] of [["m", 1e6], ["k", 1e3]]) {
    if (n >= size) {
      const v = n / size;
      return (v < 10 ? (Math.floor(v * 10) / 10).toFixed(1).replace(/\.0$/, "") : String(Math.floor(v))) + unit;
    }
  }
  return String(Math.floor(n));
}

// The exact number, for the tooltip and for screen readers.
export const exact = (n) => `${Number(n).toLocaleString("en")} ${n === 1 ? "view" : "views"}`;
