// Where the visitor is, shown on the map when they ask for it -- never before.
// The browser only prompts on a real gesture, so nothing here runs until the
// locate button is tapped, and stopping forgets the position entirely.
class Here {
  status = $state("off");     // off | asking | on | denied | error | unavailable
  lat = $state(null);
  lng = $state(null);
  accuracy = $state(null);    // metres, as the browser reports it
  fixes = $state(0);          // the first fix moves the camera; later ones must not fight the user
  #watch = null;

  get available() { return typeof navigator !== "undefined" && !!navigator.geolocation; }
  get on() { return this.status === "asking" || this.status === "on"; }
  get placed() { return this.status === "on" && Number.isFinite(this.lat) && Number.isFinite(this.lng); }

  start() {
    if (!this.available) { this.status = "unavailable"; return; }
    if (this.on) return;
    this.status = "asking"; this.fixes = 0;
    this.#watch = navigator.geolocation.watchPosition(
      (p) => {
        this.lat = p?.coords?.latitude ?? null; this.lng = p?.coords?.longitude ?? null;
        this.accuracy = Number.isFinite(p?.coords?.accuracy) ? p.coords.accuracy : null;
        this.fixes += 1; this.status = "on";
      },
      (e) => { const denied = e?.code === 1; this.stop(); this.status = denied ? "denied" : "error"; },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  }

  stop() {
    if (this.#watch !== null) { try { navigator.geolocation.clearWatch(this.#watch); } catch { /* gone already */ } }
    this.#watch = null;
    this.status = "off"; this.lat = null; this.lng = null; this.accuracy = null; this.fixes = 0;
  }

  toggle() { if (this.on) this.stop(); else this.start(); }
}

export const here = new Here();
