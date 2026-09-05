const J = async (r) => {
  if (r.status === 401) throw new Error("Not signed in. Reload the page to go through the login.");
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};
const json = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  me: () => fetch("/admin/api/me").then(J),
  moments: () => fetch("/admin/api/moments").then(J),
  patch: (id, body) => fetch(`/admin/api/moments/${id}`, json("PATCH", body)).then(J),
  remove: (id) => fetch(`/admin/api/moments/${id}`, { method: "DELETE" }).then(J),
  // XHR rather than fetch: it is the only way to get upload progress, and a
  // dozen phone photos over mobile data is exactly when you want a bar.
  upload: (files, onProgress) =>
    new Promise((resolve, reject) => {
      const fd = new FormData();
      for (const f of files) fd.append("files", f, f.name);
      const x = new XMLHttpRequest();
      x.open("POST", "/admin/api/upload");
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      x.onload = () => {
        if (x.status === 401) return reject(new Error("Not signed in. Reload the page to go through the login."));
        try { const body = JSON.parse(x.responseText); x.status < 300 || x.status === 422 ? resolve(body) : reject(new Error(body.error ?? x.statusText)); }
        catch { reject(new Error(`${x.status} ${x.responseText.slice(0, 200)}`)); }
      };
      x.onerror = () => reject(new Error("network error"));
      x.send(fd);
    }),
};

export const dayKey = (iso) => iso.slice(0, 10);
export const clockOf = (iso) => iso.slice(11, 16);
export const mediaUrl = (rel) => `/${rel}`;
