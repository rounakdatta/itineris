// A gallery's own name in the URL: itineris.taptappers.club/singaporeeats
// instead of /g/2mro45eyznpc.
//
// This lives at the ROOT of the site, which is the nice bit and also the
// dangerous bit: every slug is one name the site can never use for anything
// else. So the rules are strict, the reserved list is generous, and the token
// URL keeps working forever -- a link already sent to somebody must not stop
// resolving because its gallery was renamed.
//
// No node imports on purpose: the viewer bundles this to decide whether a path
// could be a gallery at all.

// Long enough not to collide with a one-word route by accident, short enough
// to type. Must start and end alphanumeric so "-x" and "x-" are out.
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

// Names the site serves, or might serve, itself. A slug may never be one of
// these, and the list is deliberately wider than what exists today: adding a
// route later must not break somebody's link.
export const RESERVED = new Set([
  "g", "creator", "admin", "api", "auth", "data", "media", "originals", "assets", "static", "public",
  "healthz", "health", "status", "metrics", "robots", "sitemap", "sw", "manifest",
  "favicon", "icon", "icons", "apple-touch-icon", "mark", "og", "brand", "logo",
  "about", "help", "support", "terms", "privacy", "legal", "contact", "pricing", "blog", "docs",
  "login", "logout", "signin", "signout", "signup", "register", "account", "settings", "profile", "me",
  "new", "edit", "search", "explore", "home", "index", "null", "undefined", "true", "false",
]);

// Anything with a file extension is a file the server might serve, not a
// gallery -- "config.json", "sw.js", "favicon.ico".
const looksLikeAFile = (s) => /\.[a-z0-9]{2,5}$/.test(s);

export function slugProblem(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "give it a name";
  if (s.length < 3) return "at least 3 characters";
  if (s.length > 40) return "at most 40 characters";
  // Before the shape check, so "config.json" gets the useful complaint rather
  // than a lecture about hyphens.
  if (looksLikeAFile(s)) return "that looks like a filename";
  if (!SLUG_RE.test(s)) return "lowercase letters, numbers and hyphens only, starting and ending with a letter or number";
  if (RESERVED.has(s)) return `“${s}” is reserved by the site`;
  return null;
}
export const cleanSlug = (raw) => String(raw ?? "").trim().toLowerCase();

// A suggestion from the gallery's title, for the field's placeholder. Not
// applied automatically: a URL somebody shares should be one they chose.
export function slugFrom(title) {
  const s = String(title ?? "").toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")   // "Café" -> "cafe"
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return slugProblem(s) ? "" : s;
}

// What a path could be pointing at. The viewer uses this to tell
// "/singaporeeats" (a gallery) from "/sw.js" (a file nginx will have served).
export function galleryFromPath(pathname) {
  const p = String(pathname ?? "");
  const token = p.match(/^\/g\/([a-z0-9-]{4,40})\/?$/)?.[1];
  if (token) return { by: "token", id: token };
  const root = p.match(/^\/([^/]+)\/?$/)?.[1];
  if (root && !slugProblem(root)) return { by: "slug", id: root.toLowerCase() };
  return null;
}
