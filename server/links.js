// Google Maps links people share -> a place: its name, coordinates, and the
// exact Google Maps URL to send viewers back to. Pure, so the admin UI bundles
// it too (client-side detection and parsing; only redirects need the server).
//
// Understood forms:
//   https://maps.app.goo.gl/<code>, https://goo.gl/maps/<code>     short: resolved by following redirects
//   https://www.google.com/maps/place/<name>/@<lat>,<lng>,<z>z/data=...!3d<lat>!4d<lng>...!1s0x<a>:0x<cid>
//   https://www.google.com/maps/search/<q>/@<lat>,<lng>,<z>z
//   https://www.google.com/maps/@<lat>,<lng>,<z>z
//   https://www.google.com/maps?q=<lat>,<lng> | ?q=<name> | ?ll=<lat>,<lng>
//   https://www.google.com/maps/search/?api=1&query=<lat>,<lng>
//   https://maps.google.com/?cid=<cid>
//   https://consent.google.com/...?continue=<any of the above>            (EU consent interstitial)
// `!3d…!4d…` is the place itself; `@lat,lng` is only where the map was looking.

const HOST = /^(www\.|maps\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/i;
const SHORT = /^(maps\.app\.goo\.gl|goo\.gl)$/i;

export function isGoogleMapsUrl(s) {
  let u; try { u = new URL(String(s).trim()); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (SHORT.test(u.hostname)) return true;
  if (/^consent\.google\./i.test(u.hostname)) return !!u.searchParams.get("continue");
  return HOST.test(u.hostname) && (u.pathname.startsWith("/maps") || u.hostname.toLowerCase().startsWith("maps."));
}

// The first Google Maps link in a blob of shared text ("Zahrat Lebnan\nhttps://maps.app.goo.gl/x").
export function extractMapsUrl(text) {
  for (const m of String(text ?? "").matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
    const candidate = m[0].replace(/[.,;:!?)\]]+$/, "");
    if (isGoogleMapsUrl(candidate)) return candidate;
  }
  return null;
}

const num = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? +n.toFixed(6) : null; };
const pair = (s) => {
  const m = String(s ?? "").match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  return m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180 ? { lat: num(m[1]), lng: num(m[2]) } : null;
};
const decodeName = (s) => { const t = s.replace(/\+/g, " "); try { return decodeURIComponent(t).trim(); } catch { return t.trim(); } };

export function parseGoogleMapsUrl(s) {
  let u; try { u = new URL(String(s).trim()); } catch { return null; }
  if (/^consent\.google\./i.test(u.hostname)) { const c = u.searchParams.get("continue"); return c ? parseGoogleMapsUrl(c) : null; }
  if (!isGoogleMapsUrl(s) || SHORT.test(u.hostname)) return null;
  const out = { name: null, lat: null, lng: null, cid: null, mapsUrl: null };
  const path = decodeURI(u.pathname).replace(/%2F/gi, "/") === u.pathname ? u.pathname : u.pathname;
  const place = path.match(/\/maps\/place\/([^/]+)/);
  if (place) out.name = decodeName(place[1]);
  const search = path.match(/\/maps\/search\/([^/@?]+)/);
  const data = path.match(/\/data=([^?]*)/)?.[1] ?? "";
  const d3 = data.match(/!3d(-?\d+(?:\.\d+)?)/), d4 = data.match(/!4d(-?\d+(?:\.\d+)?)/);
  if (d3 && d4) { out.lat = num(d3[1]); out.lng = num(d4[1]); }
  const at = path.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (out.lat === null && at) { out.lat = num(at[1]); out.lng = num(at[2]); }
  const cid = data.match(/!1s0x[0-9a-f]+:0x([0-9a-f]+)/i);
  if (cid) out.cid = BigInt("0x" + cid[1]).toString();
  if (/^\d+$/.test(u.searchParams.get("cid") ?? "")) out.cid = u.searchParams.get("cid");
  const q = u.searchParams.get("q") ?? u.searchParams.get("query") ?? u.searchParams.get("ll") ?? (search ? decodeName(search[1]) : null);
  if (q) {
    const p = pair(q);
    const numeric = /^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/.test(q);
    if (p) { if (out.lat === null) Object.assign(out, p); }
    else if (!numeric && !out.name) out.name = q.trim();
  }
  if (out.lat !== null && (Math.abs(out.lat) > 90 || Math.abs(out.lng) > 180)) { out.lat = null; out.lng = null; }
  if (out.cid) out.mapsUrl = `https://maps.google.com/?cid=${out.cid}`;
  else if (place || search || at) out.mapsUrl = u.origin + u.pathname;
  else if (out.lat !== null) out.mapsUrl = `https://www.google.com/maps/search/?api=1&query=${out.lat},${out.lng}`;
  else if (out.name) out.mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(out.name)}`;
  return out.name || out.lat !== null || out.cid ? out : null;
}

// Short links, and full links that carry no coordinates, are followed to
// their final URL first. Only Google Maps hosts are ever fetched.
export async function resolveMapsLink(s, { fetch: f = globalThis.fetch, timeout = 8000 } = {}) {
  const url = String(s ?? "").trim();
  if (!isGoogleMapsUrl(url)) throw Object.assign(new Error("not a Google Maps link"), { status: 400 });
  let final = url;
  if (parseGoogleMapsUrl(url)?.lat == null) {
    let res;
    try {
      res = await f(url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; itineris)", accept: "text/html" }, signal: AbortSignal.timeout(timeout) });
    } catch (e) { throw Object.assign(new Error(`could not reach Google Maps (${e.message})`), { status: 502 }); }
    try { await res.body?.cancel?.(); } catch { /* nothing to drain */ }
    final = res.url || url;
  }
  const parsed = parseGoogleMapsUrl(final);
  if (!parsed) throw Object.assign(new Error("that link does not point at a place"), { status: 422 });
  return parsed;
}
