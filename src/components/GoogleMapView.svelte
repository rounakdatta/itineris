<script>
  // Google Maps as the map: Google's tiles, streets and shop labels; our photos
  // as pins, our routes drawn on top. Same contract as MapView (MapLibre): it
  // renders trip.visibleMoments / visibleTracks, follows trip.focused, refits
  // when the selection changes, and hands taps to the same two-step gesture.
  // Cannot work offline (Google's terms forbid caching tiles) -- App falls back
  // to MapView when there is no connection or the script fails.
  import { onMount, untrack } from "svelte";
  import { trip } from "../lib/trip.svelte.js";
  import { bboxOf, hasCoords, mediaUrl, MODE_COLOR, groupByPlace, placeKey, fitPadding } from "../lib/data.js";
  import { allSeen } from "../lib/seen.svelte.js";
  import { here } from "../lib/here.svelte.js";
  import { loadGoogleMaps, onAuthFailure, watchMapErrors } from "../lib/gmaps.js";
  import { legsOf, LEG_INK, LEG_CASING } from "../../server/route.js";

  let { config, onFail } = $props();
  let container;
  let g = null;        // the google.maps namespace
  let map = null;
  let Marker = null;   // AdvancedMarkerElement
  let ready = $state(false);
  const lines = new Map();     // track id -> polyline
  const legLines = new Map();  // leg id -> the dotted thread between two stops
  const legTags = new Map();   // leg id -> the little distance marker halfway along
  let mePin = null, meRing = null;   // the visitor's own position, while they ask for it

  onMount(() => {
    let cancelled = false;
    let failed = false;
    const fail = (e) => { if (failed || cancelled) return; failed = true; onFail?.(e); };
    // Billing off, key restricted to another site, API not enabled: Google says
    // so once in the console and leaves a grey overlay. We would rather draw MapLibre.
    const unwatch = watchMapErrors(fail);
    (async () => {
      try {
        g = await loadGoogleMaps({ key: config.googleMapsApiKey });
        const [{ Map: GMap }, { AdvancedMarkerElement }] = await Promise.all([g.importLibrary("maps"), g.importLibrary("marker")]);
        if (cancelled) return;
        Marker = AdvancedMarkerElement;
        map = new GMap(container, {
          // A neutral start; the first fitBounds takes it to the photos.
          center: { lat: 15, lng: 20 },
          zoom: 2,
          mapId: config.googleMapsMapId || "DEMO_MAP_ID",   // AdvancedMarkerElement needs a vector map id
          disableDefaultUI: true,
          // Not `pointer: fine`: `pointer: none` (keyboard only, a TV remote) is
          // exactly the visitor who cannot zoom without the buttons. See MapView.
          zoomControl: !globalThis.matchMedia?.("(pointer: coarse)")?.matches,
          gestureHandling: "greedy",
          clickableIcons: true,      // Google's own place labels stay tappable: that IS the point of Google Maps
          keyboardShortcuts: false,
        });
        onAuthFailure(() => fail(new Error("Google Maps refused this API key")));
        // A tap on bare map puts the place card away; a tap on one of Google's
        // places (e.placeId) opens Google's own card, so leave ours alone.
        map.addListener("click", (e) => { if (!e?.placeId) trip.focusId = null; });
        // Test hook, same as MapView: tiles loaded and nothing pending.
        map.addListener("idle", () => { container.dataset.idle = "1"; declutterSoon(); });
        map.addListener("dragstart", () => { container.dataset.idle = "0"; });
        map.addListener("zoom_changed", () => { container.dataset.idle = "0"; });
        ready = true;
      } catch (e) { fail(e); }
    })();
    return () => {
      cancelled = true;
      unwatch();
      if (mePin) { mePin.map = null; mePin = null; }
      if (meRing) { meRing.setMap(null); meRing = null; }
      for (const p of pins.values()) p.mk.map = null;
      for (const l of lines.values()) l.setMap(null);
      pins.clear(); lines.clear(); map = null;
    };
  });

  // One pin per place. The photo sits in an Instagram-style story ring --
  // bright until every photo behind it has been seen on this device -- and,
  // when Google knows the place, a small rating chip hangs under it (the
  // Claude.ai-style pin). Tap the ring: the story opens, straight away. Tap
  // the chip: the place card, with the details.
  const pins = new Map();   // group key -> { mk, sig, ring, chip }
  function pinFor(group) {
    const el = document.createElement("div");
    el.className = "gpin";
    el.dataset.place = group.key;
    const ring = document.createElement("button");
    ring.type = "button"; ring.className = "ring";
    ring.setAttribute("aria-label", `Open story: ${group.name || group.first.caption || "photo"}`);
    const img = document.createElement("img");
    img.src = mediaUrl(group.first.media.thumb ?? group.first.media.src); img.alt = ""; img.loading = "lazy"; img.draggable = false;
    ring.appendChild(img);
    if (group.moments.length > 1) { const n = document.createElement("span"); n.className = "n"; n.textContent = String(group.moments.length); ring.appendChild(n); }
    if (group.moments.some((x) => x.media?.type === "video")) { const v = document.createElement("span"); v.className = "v"; v.textContent = "▶"; v.setAttribute("aria-hidden", "true"); ring.appendChild(v); }
    el.appendChild(ring);
    // The chip says which place this is -- "Yamo" -- and, when Google knows it, how it is rated.
    let chip = null;
    const rated = Number.isFinite(group.google?.rating);
    if (group.name || rated) {
      chip = document.createElement("button");
      chip.type = "button"; chip.className = "chip";
      chip.setAttribute("aria-label", `${group.name || "Place"}${rated ? `: ${group.google.rating.toFixed(1)} stars on Google` : ""}`);
      if (group.name) { const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = group.name; chip.appendChild(nm); }
      if (rated) {
        const b = document.createElement("b"); b.textContent = group.google.rating.toFixed(1);
        const star = document.createElement("i"); star.textContent = "★"; star.setAttribute("aria-hidden", "true");
        chip.append(b, star);
      }
      el.appendChild(chip); el.classList.add("has-chip");
    }
    const mk = new Marker({ map, position: { lat: group.lat, lng: group.lng }, content: el, title: group.name, zIndex: 1, gmpClickable: true });
    ring.addEventListener("click", (e) => { e.stopPropagation(); trip.openStory(group.first.id); });
    chip?.addEventListener("click", (e) => { e.stopPropagation(); trip.openStory(group.first.id); });
    // Anything else on the pin (padding, badge): what is this place?
    mk.addListener("click", () => trip.openStory(group.first.id));
    return { mk, ring, chip, sig: group.moments.map((x) => x.id).join(","), group };
  }

  // Selection -> pins and routes. A group whose photos changed is rebuilt;
  // one that merely left the selection is hidden and comes back as it was.
  $effect(() => {
    const groups = groupByPlace(trip.visibleMoments);
    const tracks = trip.visibleTracks;
    if (!ready || !map) return;
    const want = new Set();
    for (const grp of groups) {
      want.add(grp.key);
      let pin = pins.get(grp.key);
      const sig = grp.moments.map((x) => x.id).join(",");
      if (pin && pin.sig !== sig) { pin.mk.map = null; pins.delete(grp.key); pin = null; }
      if (!pin) { pin = pinFor(grp); pins.set(grp.key, pin); }
      else if (!pin.mk.map) pin.mk.map = map;
      pin.group = grp;
      pin.ring.classList.toggle("seen", allSeen(grp.moments));
    }
    for (const [key, pin] of pins) if (!want.has(key) && pin.mk.map) pin.mk.map = null;
    const wantT = new Set();
    for (const t of tracks) {
      if (!(t.geometry?.length > 1)) continue;
      wantT.add(t.id);
      let l = lines.get(t.id);
      if (!l) {
        l = new g.Polyline({ path: t.geometry.map(([lng, lat]) => ({ lat, lng })), strokeColor: MODE_COLOR[t.mode] ?? "#8b9dc3", strokeOpacity: 0.9, strokeWeight: 4, map });
        lines.set(t.id, l);
      } else if (!l.getMap?.() && l.map !== map) l.setMap(map);
    }
    for (const [id, l] of lines) if (!wantT.has(id)) l.setMap(null);

    // Opt-in per gallery, and over what is currently SHOWN: filtering to one
    // tag should re-thread the stops that remain, not leave a thread hanging
    // to a pin that is no longer on the map.
    const legs = trip.route ? legsOf(trip.visibleMoments, trip.walks) : [];
    const wantL = new Set(legs.map((l) => l.id));
    for (const leg of legs) {
      if (legLines.has(leg.id)) continue;
      const { line, tag, el } = legThread(leg);
      legLines.set(leg.id, line);
      if (tag) legTags.set(leg.id, { tag, el });
    }
    for (const [id, line] of legLines) {
      if (wantL.has(id)) continue;
      line.setMap(null); legLines.delete(id);
      const t = legTags.get(id); if (t) { t.tag.map = null; legTags.delete(id); }

    }
    if (container) container.dataset.legs = String(legs.length);   // test hook, like data-idle
    declutterSoon();
  });

  // The walk between stops: a dotted thread and, halfway along, how far it was.
  // Deliberately dim and thin -- it is the connective tissue of the trip, not
  // one of its subjects, and a trip with twenty stops must not turn into a
  // diagram. Drawn under the pins, and only when the gallery asked for it.
  function legThread(leg) {
    const line = new g.Polyline({
      // The routed walk, following the streets -- or, for a hop nothing has
      // routed yet, the two points and a straight thread between them.
      path: leg.path.map(([lng, lat]) => ({ lat, lng })),
      // A dotted polyline in the Maps API is an invisible line wearing
      // repeated symbols; there is no dash array.
      strokeOpacity: 0,
      icons: [{
        // AMBER, not white. White shipped once and was invisible here: this
        // basemap is 86% brighter than luminance 200 and white scored a
        // contrast ratio of 1.1 against it -- the line was not faint, it was
        // absent. Deep amber clears 3.0 against these tiles, their roads,
        // their parks and MapLibre's dark style; nothing else did.
        //
        // The white rim is the casing: contrast against the AVERAGE background
        // is not contrast against all of it, and the rim keeps the dots off
        // dark parks and water.
        icon: { path: g.SymbolPath.CIRCLE, scale: 2.1, fillColor: LEG_INK, fillOpacity: 1, strokeColor: LEG_CASING, strokeOpacity: 0.85, strokeWeight: 1.1 },
        offset: "0", repeat: "10px",
      }],
      clickable: false,
      zIndex: 0,
      map,
    });
    // An unrouted hop carries no distance: displacement labelled as distance
    // is exactly what this replaced, so it says nothing instead.
    if (!leg.label) return { line, tag: null, el: null };
    const el = document.createElement("span");
    el.className = "leg";
    el.textContent = leg.label;
    const tag = new Marker({ map, position: leg.mid, content: el, zIndex: 0, gmpClickable: false });
    return { line, tag, el };
  }

  // A dense trip puts several places within a few hundred metres of each
  // other, and their name chips then sit on top of one another -- three
  // half-readable labels where one readable one would have been better, and
  // some of them hanging off the edge of the screen. So the labels declutter:
  // walked in order of how much each place is carrying, a chip that would
  // land on one already kept steps aside. The PIN always stays -- it is the
  // photo, and it is what you tap. Only the label goes.
  //
  // `visibility`, not `display`: the chip has to keep its box, because
  // .has-chip shifts the whole pin up by the chip's height and a chip that
  // stopped taking space would make its pin jump.
  const CLEAR = 3;   // px of air required between two labels
  // Returns whether it could measure anything at all. Markers are mounted by
  // Google's own code, so there is a window after a redraw where the elements
  // exist and have no size yet -- measuring then quietly decides that no label
  // overlaps any other, which is how the first version of this shipped doing
  // nothing at all on the real map while passing against the stub.
  function declutter() {
    if (!container) return false;
    // Liveness from the DOM, not from marker.map: what matters is whether the
    // thing is on screen, and that is not an API detail.
    // The distances take part in the same pass, below the place names: a name
    // is what somebody is looking for, a distance is a nicety, and two
    // separate decluttering rules would let one hide behind the other.
    const live = [
      ...[...pins.values()].filter((p) => p.chip && p.chip.isConnected).map((p) => ({ ...p, chip: p.chip, rank: 1 })),
      ...[...legTags.values()].filter((t) => t.el?.isConnected).map((t) => ({ chip: t.el, ring: null, group: null, rank: 0 })),
    ];
    for (const p of live) p.chip.classList.remove("crowded");
    if (live.length < 2) { container.dataset.labels = String(live.length); return live.length > 0; }
    const view = container.getBoundingClientRect();
    // Most photos first, then nearest the middle of the map: the biggest
    // stop keeps its name, and ties resolve the same way on every redraw
    // rather than flickering between two equally good answers.
    const mid = { x: view.left + view.width / 2, y: view.top + view.height / 2 };
    const scored = live.map((p) => {
      const r = p.chip.getBoundingClientRect();
      return { p, r, rank: p.rank, n: p.group?.moments.length ?? 1, d: Math.hypot(r.left + r.width / 2 - mid.x, r.top + r.height / 2 - mid.y) };
    }).filter((x) => x.r.width > 0 && x.r.height > 0)
      .sort((a, b) => b.rank - a.rank || b.n - a.n || a.d - b.d || ((a.p.group?.key ?? "") < (b.p.group?.key ?? "") ? -1 : 1));
    // The rings are obstacles, not candidates: a pin is never hidden, so a
    // label half behind somebody else's photo is just a label you cannot
    // read. (Its own ring sits directly above it by design.)
    const rings = new Map(live.filter((p) => p.ring).map((p) => [p, p.ring.getBoundingClientRect()]));
    const hits = (a, b) => a.left < b.right + CLEAR && a.right > b.left - CLEAR && a.top < b.bottom + CLEAR && a.bottom > b.top - CLEAR;
    const covered = (a, b) => {
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return w > 0 && h > 0 ? (w * h) / (a.width * a.height) : 0;
    };
    const kept = [];
    for (const { p, r } of scored) {
      const outside = r.left < view.left || r.right > view.right || r.top < view.top || r.bottom > view.bottom;
      // Grazed at one end is fine -- the name is ellipsized anyway. Hidden
      // only when a neighbour's photo eats enough of it to matter.
      const behindAPin = [...rings].some(([q, rr]) => q !== p && covered(r, rr) >= 0.15);
      const clash = kept.some((k) => hits(r, k));
      if (outside || behindAPin || clash) p.chip.classList.add("crowded");
      else kept.push(r);
    }
    // A test hook, like data-idle and data-me: what the declutter itself
    // thinks it did, readable from outside without reaching into the closure.
    container.dataset.labels = `${kept.length}/${live.length}`;
    return scored.length > 0;
  }
  // After the pins settle, and after every camera move -- retrying while the
  // markers still have no size, because Google mounts them on its own
  // schedule and a measurement taken too early is silently wrong rather than
  // obviously wrong.
  let declutterRaf = 0, declutterTimer = 0;
  function declutterSoon(tries = 8) {
    cancelAnimationFrame(declutterRaf); clearTimeout(declutterTimer);
    declutterRaf = requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!declutter() && tries > 0) declutterTimer = setTimeout(() => declutterSoon(tries - 1), 150);
    }));
  }

  // Focus -> that place's pin grows and its chip turns dark; the camera goes there.
  $effect(() => {
    const f = trip.focused;
    if (!ready || !map) return;
    const key = f ? placeKey(f) : null;
    for (const [k, pin] of pins) { const on = k === key; pin.mk.content?.classList.toggle("on", on); pin.mk.zIndex = on ? 1000 : 1; }
    if (!f || !hasCoords(f)) return;
    map.panTo({ lat: f.lat, lng: f.lng });
    if (map.getZoom() < 15) map.setZoom(15);
  });

  // Where the visitor is: a blue dot, with what the browser says about its
  // accuracy drawn around it. The camera goes there on the first fix only.
  $effect(() => {
    const { placed, lat, lng, accuracy, fixes } = here;
    if (container) container.dataset.me = placed ? "1" : "0";   // test hook, like data-idle
    if (!ready || !map) return;
    untrack(() => {
      if (!placed) {
        if (mePin) { mePin.map = null; mePin = null; }
        if (meRing) { meRing.setMap(null); meRing = null; }
        return;
      }
      const at = { lat, lng };
      if (!mePin) {
        const el = document.createElement("div");
        el.className = "mepin";
        mePin = new Marker({ map, position: at, content: el, zIndex: 3000, title: "You are here" });
      } else mePin.position = at;
      if (!meRing && g.Circle) meRing = new g.Circle({ map, center: at, radius: 30, strokeWeight: 0, fillColor: "#4c8dff", fillOpacity: 0.14, clickable: false });
      if (meRing) { meRing.setCenter(at); meRing.setRadius(Math.max(10, Math.min(accuracy ?? 30, 3000))); }
      if (fixes === 1) { map.panTo(at); if (map.getZoom() < 15) map.setZoom(15); }
    });
  });

  // "Next stop": while the story hands over, the pin it is travelling to pulses.
  $effect(() => { if (container) container.classList.toggle("travel", trip.handoff); });

  // The whole selection on screen at once. (The map element already stops
  // above the dock, so it only needs padding for the top bar.)
  function fitAll() {
    const box = bboxOf(trip.visibleMoments, trip.visibleTracks);
    if (!box) return;
    // Google's map is inset above the dock, so it only needs to clear the top bar.
    map.fitBounds(new g.LatLngBounds({ lat: box[1], lng: box[0] }, { lat: box[3], lng: box[2] }),
      fitPadding(container?.clientWidth ?? 0, { top: 90, bottom: 40 }));
    // A single spot would zoom to the rooftops; keep it street-level.
    g.event.addListenerOnce(map, "idle", () => { if (map.getZoom() > 16) map.setZoom(16); });
  }

  // Filter changed, or data arrived -> refit (inputs only, like MapView).
  $effect(() => {
    trip.facets;
    trip.loaded;
    trip.galleryId;
    if (!ready || !map) return;
    untrack(fitAll);
  });

  // Opening a story flies the camera to that one pin and holds it at zoom 15.
  // Nothing used to bring it back, so closing the story left the map stranded
  // on the last place you looked at, with the rest of the trip off screen --
  // and every story after that stranded it somewhere else again. Coming back
  // to the map means coming back to the whole trip.
  let storyWasOpen = false;
  $effect(() => {
    const open = trip.storyOpen;
    if (!ready || !map) { storyWasOpen = open; return; }
    untrack(() => {
      if (storyWasOpen && !open) fitAll();
      storyWasOpen = open;
    });
  });
</script>

<div class="map" data-engine="google" bind:this={container}></div>

<style>
  /* Ends above the timeline dock so Google's logo and terms stay visible (they
     must). --dock-h is the dock's real height, so this cannot fall short of it. */
  .map { position: absolute; inset: 0 0 var(--dock-h) 0; background: #e5e3df; }
  /* Pins are DOM nodes Google positions; they live outside Svelte's scoping.
     The marker anchors at the content's bottom centre: shift so the RING's
     centre sits on the spot (ring 44 + gap 4 + chip 20 = 68 tall). */
  :global(.gpin) { display: flex; flex-direction: column; align-items: center; gap: 4px; transform: translateY(22px); cursor: pointer; }
  :global(.gpin.has-chip) { transform: translateY(46px); }
  :global(.mepin) { width: 15px; height: 15px; border-radius: 50%; background: #4c8dff; border: 2.5px solid #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25), 0 2px 8px rgba(0, 0, 0, 0.35); }
  :global(.map.travel .gpin.on .ring) { animation: travel-pulse 900ms ease-in-out infinite; }
  @keyframes travel-pulse { 50% { scale: 1.16; } }
  :global(.gpin .ring) {
    position: relative; width: 44px; height: 44px; padding: 3px; border: 0; border-radius: 50%; cursor: pointer;
    background: conic-gradient(from 200deg, #f9ce34, #ee2a7b, #6228d7, #f9ce34);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.95), 0 4px 14px rgba(238, 42, 123, 0.35);
    transition: transform 160ms, box-shadow 160ms;
  }
  :global(.gpin .ring img) { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block; border: 2px solid #fff; background: #14181e; pointer-events: none; }
  :global(.gpin .ring.seen) { background: #cfcfcf; box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.95), 0 3px 10px rgba(0, 0, 0, 0.25); }
  :global(.gpin .ring .n) {
    position: absolute; right: -5px; top: -5px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; border: 2px solid #fff;
    background: #111; color: #fff; font: 700 10.5px/14px system-ui, -apple-system, sans-serif; text-align: center; box-sizing: border-box;
  }
  :global(.gpin .ring .v) { position: absolute; left: -5px; bottom: -5px; width: 18px; height: 18px; border-radius: 50%; border: 2px solid #fff; background: #111; color: #fff; font-size: 8px; line-height: 14px; text-align: center; box-sizing: border-box; }
  :global(.gpin .chip) {
    display: inline-flex; align-items: center; gap: 3px; height: 20px; padding: 0 7px; border: 0; border-radius: 999px; cursor: pointer;
    background: #fff; color: #111; font: 700 11px/20px system-ui, -apple-system, sans-serif; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
    transition: background 160ms, color 160ms, opacity 140ms;
  }
  /* Stepped aside for a neighbour, or hanging off the edge of the map. */
  :global(.gpin .chip.crowded) { visibility: hidden; opacity: 0; pointer-events: none; }
  /* How far it was, halfway along the thread. Small, dim, and out of the way:
     a number nobody needs to read, that rewards anybody who looks. */
  :global(.leg) {
    display: inline-block; padding: 1px 6px; border-radius: 999px;
    background: rgba(12, 15, 20, 0.78); color: #fff;
    font: 600 10px/16px system-ui, -apple-system, sans-serif; letter-spacing: 0.01em;
    font-variant-numeric: tabular-nums; white-space: nowrap; pointer-events: none;
    backdrop-filter: blur(3px); transition: opacity 140ms;
  }
  :global(.leg.crowded) { visibility: hidden; opacity: 0; }
  :global(.gpin.on .chip.crowded) { visibility: visible; opacity: 1; pointer-events: auto; }
  :global(.gpin .chip .nm) { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  :global(.gpin .chip b) { font-weight: 800; }
  :global(.gpin .chip i) { font-style: normal; color: #f4b400; font-size: 10px; }
  :global(.gpin.on .ring) { transform: scale(1.18); }
  :global(.gpin.on .chip) { background: #111; color: #fff; }
  :global(.gpin.on .chip i) { color: #ffd54f; }
</style>
