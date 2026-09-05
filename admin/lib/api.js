const J = async (r) => {
  if (r.status === 401) throw new Error("Not signed in. Reload the page to go through the login.");
  if (!r.ok) { let msg = `${r.status}`; try { msg = (await r.json()).error ?? msg; } catch { /* text */ } throw new Error(msg); }
  return r.json();
};
const json = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  me: () => fetch("/admin/api/me").then(J),
  library: () => fetch("/admin/api/library").then(J),
  // Same, plus whether the service worker served a saved copy (we are offline,
  // or the server is unreachable even though the browser thinks it is online).
  libraryWithMeta: async () => { const r = await fetch("/admin/api/library"); return { body: await J(r), fromCache: r.headers.get("x-itineris-cache") === "fallback" }; },
  patch: (id, body) => fetch(`/admin/api/moments/${id}`, json("PATCH", body)).then(J),
  bulk: (ids, body) => fetch("/admin/api/moments", json("PATCH", { ids, ...body })).then(J),
  remove: (id) => fetch(`/admin/api/moments/${id}`, { method: "DELETE" }).then(J),
  createGallery: (body) => fetch("/admin/api/galleries", json("POST", body)).then(J),
  patchGallery: (id, body) => fetch(`/admin/api/galleries/${id}`, json("PATCH", body)).then(J),
  removeGallery: (id) => fetch(`/admin/api/galleries/${id}`, { method: "DELETE" }).then(J),
  // One file per request, with progress. Rejects with {status} so the queue can
  // tell "signed out" (401) and "server down" (5xx, network) from "this file was
  // refused" (a JSON body with errors), which is the difference between retrying
  // forever and asking the user.
  uploadOne: (item, onProgress) =>
    new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("files", item.file, item.name);
      fd.append("meta", JSON.stringify(item.metaForServer ?? {}));
      const x = new XMLHttpRequest();
      x.open("POST", "/admin/api/upload");
      x.timeout = 180_000;
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      const fail = (message, status) => reject(Object.assign(new Error(message), { status }));
      x.onload = () => {
        if (x.status === 401 || x.status === 403) return fail("signed out", x.status);
        if (x.status >= 500) return fail(`server error ${x.status}`, x.status);
        try { resolve(JSON.parse(x.responseText)); }
        catch { /^\s*</.test(x.responseText) ? fail("signed out", 401) : fail(`unexpected response ${x.status}`, x.status || 0); }
      };
      x.onerror = () => fail("network error", 0);
      x.ontimeout = () => fail("timed out", 0);
      x.onabort = () => fail("aborted", 0);
      x.send(fd);
    }),
};

export const dayKey = (iso) => iso.slice(0, 10);
export const clockOf = (iso) => iso.slice(11, 16);
export const mediaUrl = (rel) => `/${rel}`;
export const galleryUrl = (id) => `${location.origin}/g/${id}`;
export const storyUrl = (galleryId, momentId) => `${location.origin}${galleryId ? `/g/${galleryId}` : "/"}#m/${momentId}`;

// "2026-03-14T08:40:12+08:00" -> { local: "2026-03-14T08:40", seconds: ":12", offset: "+08:00" }
export function splitIso(t) {
  const m = (t ?? "").match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?([+-]\d{2}:\d{2})$/);
  return m ? { local: m[1], seconds: m[2] ?? ":00", offset: m[3] } : { local: "", seconds: ":00", offset: "+00:00" };
}
export const joinIso = ({ local, seconds = ":00", offset }) => `${local}${seconds}${offset}`;
export const OFFSETS = ["-10:00", "-08:00", "-07:00", "-06:00", "-05:00", "-04:00", "-03:00", "+00:00", "+01:00", "+02:00", "+03:00", "+04:00", "+05:00", "+05:30", "+07:00", "+08:00", "+09:00", "+10:00", "+11:00", "+12:00"];

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}
