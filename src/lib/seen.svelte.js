// Instagram's rule for story rings: bright until every photo behind the ring
// has been seen, on this device. Remembered in localStorage, never sent anywhere.
import { SvelteSet } from "svelte/reactivity";

const KEY = "itineris:seen";
const load = () => { try { const v = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };

export const seen = new SvelteSet(load());

export function markSeen(id) {
  if (!id || seen.has(id)) return;
  seen.add(id);
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify([...seen].slice(-5000))); } catch { /* private mode, quota */ }
}
export const allSeen = (moments) => moments.length > 0 && moments.every((m) => seen.has(m.id));
export function resetSeen() { seen.clear(); try { globalThis.localStorage?.removeItem(KEY); } catch { /* ignore */ } }
