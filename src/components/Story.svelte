<script>
  import { pictureBox, clampPan, zoomAbout, isZoomed, shouldContain } from "../lib/zoom.js";
  import { trip } from "../lib/trip.svelte.js";
  import { clockOf, dayKey, dateLabel, mediaUrl, storySrc, placeLink, isVideo, fmtDuration, isLoose } from "../lib/data.js";
  import { markSeen } from "../lib/seen.svelte.js";
  import { views } from "../lib/views.svelte.js";
  import { short, exact } from "../../server/count.js";
  import Caption from "./Caption.svelte";
  import { captionsOf } from "../../server/caption.js";

  const SEGMENT_MS = 5000;
  const DISMISS_PX = 110;   // drag down this far to close
  const SWIPE_PX = 56;      // drag sideways this far to change photo
  const TAP_MS = 350;      // a tap released within this is navigation; longer is hold-to-pause
  const TAP_SLOP = 12;
  const HANDOFF_MS = 1400;  // how long the "Next stop" postcard + map show before the next place plays

  let progress = $state(0);
  let paused = $state(false);
  let dragY = $state(0);
  let dragX = $state(0);
  let axis = $state(null);   // null | "x" | "y" once the finger commits
  // Which photo's full-size image has arrived (or failed). Keyed by id rather
  // than reset per photo, so no effect can race the load/error event.
  let loadedId = $state(null);
  let failedId = $state(null);
  let dialog = $state(null);
  // Videos start muted (that is what browsers allow without a gesture); one tap
  // on the speaker turns sound on for the rest of the session.
  let muted = $state(true);
  let video = $state(null);
  // "Next stop": crossing from one place's story to the next. The whole viewer
  // shrinks to a postcard at the top, the map beneath glides to the new pin,
  // and a pill names it. A tap (or the timer) expands into the new story.
  let handoff = $state(false);
  let handoffTimer = null;
  // While the postcard expands back (380 ms) the card is still small and
  // moving; a tap then would be measured against the wrong geometry or miss
  // the card altogether, so taps are swallowed until it has settled.
  let expanding = $state(false);
  let expandTimer = null;
  const EXPAND_MS = 400;

  let down = null;
  let holdTimer = null;

  // --- pinch to zoom ---------------------------------------------------------
  // The hard part is not the scaling, it is that this frame already owns every
  // gesture: a tap advances, a sideways drag changes photo, a downward drag
  // dismisses, and a long press pauses. So zoom is a MODE. A second finger
  // abandons whatever the first was starting, and while the photo is zoomed a
  // one-finger drag pans instead of navigating -- you zoom back out to leave.
  // Predictable beats clever: an edge-swipe-to-advance-while-zoomed is how
  // these things become impossible to use.
  //
  // There is deliberately no double-tap to zoom. It would mean holding every
  // single tap for 300 ms to see whether a second one is coming, and tapping
  // to advance is the thing people do most.
  let zoom = $state(1), zx = $state(0), zy = $state(0);
  let pinching = $state(false);
  const zoomed = $derived(isZoomed(zoom));
  const pointers = new Map();   // live fingers, by pointerId
  let pinch = null;             // { dist, zoom } at the moment the second finger landed
  let panFrom = null;           // { x, y, zx, zy } for a one-finger drag while zoomed

  // The frame in page coordinates, plus the picture box the maths needs.
  function frame() {
    if (!dialog || !current) return null;
    const r = dialog.getBoundingClientRect();
    const box = pictureBox(r, current.media, contain);
    return box && { box, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }
  function zoomTo(scale, anchor) {
    const f = frame();
    if (!f) return;
    const n = zoomAbout(f.box, { z: zoom, x: zx, y: zy },
      scale, anchor && { x: anchor.x - f.cx, y: anchor.y - f.cy });
    zoom = n.z; zx = n.x; zy = n.y;
  }
  function panTo(x, y) {
    const f = frame();
    const p = clampPan(f?.box ?? null, zoom, x, y);
    zx = p.x; zy = p.y;
  }
  function resetZoom() { zoom = 1; zx = 0; zy = 0; pinching = false; pinch = null; panFrom = null; }
  // A new photo always starts unzoomed, and so does a closed viewer.
  $effect(() => { trip.storyIndex; resetZoom(); });
  $effect(() => { if (!trip.storyOpen) { pointers.clear(); resetZoom(); } });

  // A trackpad pinch arrives as ctrl+wheel; a plain scroll is not a zoom.
  function onWheel(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomTo(zoom * Math.exp(-e.deltaY / 180), { x: e.clientX, y: e.clientY });
    if (!zoomed) resetZoom();
  }

  const items = $derived(trip.storyGroup);   // this place's photos: its bars, its count
  const current = $derived(trip.storyMoment);
  // Whether to fill the frame or show the whole picture on a blurred copy of
  // itself. Decided by how much `cover` would THROW AWAY, measured against the
  // frame actually on screen -- not by orientation, which is a cliff at 1:1
  // while the harm is continuous. See shouldContain() for the reasoning and
  // the real numbers that prompted it.
  //
  // The frame is bound rather than assumed because it is not a constant: a
  // phone, a phone on its side and the card on a desktop are three different
  // shapes, and the same photo deserves a different answer in each.
  let frameW = $state(0), frameH = $state(0);
  const contain = $derived(
    !!current && current.media.w > 0 && current.media.h > 0 && frameW > 0 && frameH > 0
      ? shouldContain(frameW / frameH, current.media.w / current.media.h)
      // Before the frame has been measured, fall back to the old orientation
      // test: it is right for the obvious cases and wrong only briefly.
      : !!current && current.media.w > current.media.h
  );
  const dateStr = $derived(current ? dateLabel(dayKey(current.t)) : "");   // "14 Mar": the date, minimally
  const thumbUrl = $derived(current ? mediaUrl(current.media.thumb ?? current.media.src) : "");
  const fullUrl = $derived(current ? storySrc(current.media) : "");
  const video_ = $derived(!!current && isVideo(current.media));
  const videoUrl = $derived(video_ ? mediaUrl(current.media.src) : "");
  const loaded = $derived(!!current && loadedId === current.id);
  const failed = $derived(!!current && failedId === current.id);
  const link = $derived(placeLink(current));
  const captions = $derived(current ? captionsOf(current) : []);
  const seenBy = $derived(current ? views.of(current.id) : null);
  // What the Next stop pill says about the place we are arriving at.
  const nextStop = $derived.by(() => {
    if (!handoff || !current) return null;
    const g = trip.storyGroup;
    const google = current.google?.placeId ? current.google : g.find((x) => x.google?.placeId)?.google ?? null;
    const videos = g.filter((x) => isVideo(x.media)).length, photos = g.length - videos;
    const what = [photos ? `${photos} photo${photos === 1 ? "" : "s"}` : "", videos ? `${videos} video${videos === 1 ? "" : "s"}` : ""].filter(Boolean).join(" & ");
    const first = g[0] ?? current;
    // Photos that belong to nowhere are not a stop, and calling them one -- or
    // naming the pill "Photo", which is what it used to do -- reads as a bug.
    const loose = isLoose(current);
    return {
      loose,
      eyebrow: loose ? "Also on this trip" : "Next stop",
      name: loose ? "Not on the map" : current.place?.trim() || current.caption?.trim() || "Photo",
      rating: Number.isFinite(google?.rating) ? google.rating.toFixed(1) : null,
      what, thumb: mediaUrl(first.media.thumb ?? first.media.src), video: isVideo(first.media),
    };
  });
  function startHandoff() { clearTimeout(handoffTimer); handoff = true; trip.handoff = true; handoffTimer = setTimeout(endHandoff, HANDOFF_MS); }
  function endHandoff() {
    clearTimeout(handoffTimer); handoffTimer = null;
    if (!handoff) return;
    handoff = false; trip.handoff = false;
    expanding = true; clearTimeout(expandTimer); expandTimer = setTimeout(() => (expanding = false), EXPAND_MS);
  }
  // Every step goes through here: a step that lands in another place is a handoff.
  function go(delta) {
    const before = trip.storyPlace;
    if (!trip.step(delta)) return false;
    if (trip.storyPlace !== before) startHandoff();
    return true;
  }
  $effect(() => { if (!trip.storyOpen) endHandoff(); });
  // Seen = shown, like a story: the ring on the map goes quiet for this photo.
  $effect(() => { if (trip.storyOpen && current) { markSeen(current.id); views.seen(current.id); } });

  // Advance timer. Restarts whenever the index changes; `paused`/`axis` are
  // read inside rAF (outside the tracking pass) so they gate without restarting.
  $effect(() => {
    const idx = trip.storyIndex;
    if (idx < 0) return;
    progress = 0;
    // `last` comes from the frame clock itself, never performance.now(): the
    // first frame's timestamp is the frame's start, which predates the code
    // that scheduled it, and mixing the two made the first delta negative.
    // Clamped so a tab coming back from the background does not leap ahead.
    let last = null;
    let raf = requestAnimationFrame(function tick(now) {
      if (last === null) last = now;
      const dt = Math.min(100, Math.max(0, now - last));
      last = now;
      // On a slow link the timer must not run ahead of the photo. A video
      // drives the bar itself (see ontimeupdate) and advances when it ends.
      if (!paused && !axis && !handoff && !zoomed && !pinching && (loaded || failed) && !(video_ && !failed)) {
        progress += dt / SEGMENT_MS;
        if (progress >= 1) {
          if (!go(1)) trip.closeStory();
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  });

  // Preload the next two so a tap never lands on a blank frame (a video's poster, not the video).
  $effect(() => {
    const i = trip.storyIndex;
    if (i < 0) return;
    for (const m of trip.upcoming(1, 2)) { const img = new Image(); img.src = storySrc(m.media); }
  });

  // Hold-to-pause and the space bar pause the video too; the speaker button
  // is applied to the element directly (a fresh <video> per photo needs it again).
  $effect(() => { if (!video) return; if (paused || axis || handoff) video.pause(); else video.play?.()?.catch?.(() => {}); });
  $effect(() => { if (video) video.muted = muted; });

  // Keyboard, and focus the dialog so screen readers and arrow keys land here.
  $effect(() => {
    if (!trip.storyOpen) return;
    dialog?.focus?.();
    const onKey = (e) => {
      if (e.key === "Escape") { if (zoomed) resetZoom(); else trip.closeStory(); }
      else if (handoff && ["ArrowRight", "ArrowLeft", " ", "Enter"].includes(e.key)) { e.preventDefault(); endHandoff(); }
      else if (e.key === "ArrowRight") { if (!go(1)) trip.closeStory(); }
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " ") { e.preventDefault(); paused = !paused; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function next() { if (!go(1)) trip.closeStory(); }
  function prev() { go(-1); }

  function onPointerDown(e) {
    if (handoff) { endHandoff(); return; }   // a tap during the handoff skips straight into the story
    if (expanding) return;                   // ...and one while the card is still expanding is ignored
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* synthetic or already-released pointer */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      // A second finger means a pinch. Whatever the first one was starting --
      // a swipe, a dismiss, a long press -- is abandoned, or letting go would
      // fire it.
      clearTimeout(holdTimer);
      down = null; axis = null; dragX = 0; dragY = 0; paused = false; panFrom = null;
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom };
      pinching = true;
      return;
    }
    if (pointers.size > 2) return;           // a third finger changes nothing

    if (zoomed) { panFrom = { x: e.clientX, y: e.clientY, zx, zy, t: performance.now() }; return; }
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    dragX = 0; dragY = 0; axis = null;
    holdTimer = setTimeout(() => { paused = true; }, TAP_MS);
  }

  function onPointerMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomTo(pinch.zoom * (dist / pinch.dist), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      return;
    }
    if (panFrom) { panTo(panFrom.zx + (e.clientX - panFrom.x), panFrom.zy + (e.clientY - panFrom.y)); return; }
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!axis && Math.hypot(dx, dy) > TAP_SLOP) {
      // Down (not up) dismisses; sideways changes photo. Commit to one.
      axis = Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? "y" : null) : "x";
      if (axis) clearTimeout(holdTimer);
    }
    if (axis === "y") dragY = Math.max(0, dy);
    if (axis === "x") dragX = dx;
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) {
        pinch = null; pinching = false;
        if (!zoomed) resetZoom();            // let go below 1:1 and it settles back
        down = null; axis = null;
        // A finger still down after the pinch keeps panning; it must not
        // become a swipe on release.
        const left = [...pointers.values()][0];
        panFrom = left && zoomed ? { x: left.x, y: left.y, zx, zy } : null;
      }
      clearTimeout(holdTimer);
      return;
    }
    if (panFrom) {
      // A tap on a zoomed photo means "back to normal". Navigation is suspended
      // while zoomed, so tap has no other job, and it is the gesture people try
      // first when they want out.
      const still = Math.hypot(e.clientX - panFrom.x, e.clientY - panFrom.y) < TAP_SLOP;
      const quick = performance.now() - panFrom.t < TAP_MS;
      panFrom = null;
      if (still && quick) resetZoom();
      return;
    }
    clearTimeout(holdTimer);
    if (!down) return;
    const elapsed = performance.now() - down.t;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);

    if (axis === "y") {
      if (dragY > DISMISS_PX) trip.closeStory();
    } else if (axis === "x") {
      if (dragX < -SWIPE_PX) next();
      else if (dragX > SWIPE_PX) prev();
    } else if (elapsed < TAP_MS && moved < TAP_SLOP) {
      const rect = e.currentTarget.getBoundingClientRect();
      if (e.clientX - rect.left < rect.width * 0.32) prev();
      else next();
    }
    dragX = 0; dragY = 0; axis = null;
    paused = false;
    down = null;
  }
</script>

{#if trip.storyOpen && current}
  <div class="scrim" style:opacity={1 - Math.min(dragY / (DISMISS_PX * 2.4), 0.65)}></div>

  <div
    class="story"
    class:handoff
    class:zoomed
    class:pinching
    bind:this={dialog}
    bind:clientWidth={frameW}
    bind:clientHeight={frameH}
    style:--ar="{current.media.w || 9} / {current.media.h || 16}"
    style:--z={zoom}
    style:--zx="{zx}px"
    style:--zy="{zy}px"
    style:transform={handoff ? "translateY(var(--ho-y)) scale(var(--ho-s))" : `translate(${dragX * 0.35}px, ${dragY}px) scale(${1 - Math.min(dragY / 2600, 0.06)})`}
    style:transition={axis ? "none" : "transform 380ms cubic-bezier(.2,.8,.2,1), border-radius 380ms, box-shadow 380ms"}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onwheel={onWheel}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label={`Story: ${current.place || captions.map((c) => c.text).join(" · ") || "photo"}`}
  >
    <div class="bars" aria-hidden="true">
      {#each items as m, i (m.id)}
        <div class="bar">
          <div class="fill" style:width={i < trip.storyPos ? "100%" : i === trip.storyPos ? `${progress * 100}%` : "0%"}></div>
        </div>
      {/each}
    </div>

    <header>
      <div class="meta">
        {#if dateStr}<span class="day">{dateStr}</span>{/if}
        {#if current.place && link}
          <!-- The place name opens Google Maps; it must not read as a tap on the story. -->
          <span class="placerow"><a class="place" href={link} target="_blank" rel="noopener noreferrer" title="Open in Google Maps"
            onpointerdown={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()}>{current.place}<span class="ext" aria-hidden="true">↗</span></a>{#if Number.isFinite(current.google?.rating)}<span class="rate" title={`${current.google.rating.toFixed(1)} on Google${current.google.ratingCount ? ` from ${current.google.ratingCount.toLocaleString("en")} ratings` : ""}`}>{current.google.rating.toFixed(1)}<i aria-hidden="true">★</i></span>{/if}</span>
        {:else if current.place}
          <strong>{current.place}</strong>
        {/if}
        <span class="clock">{clockOf(current.t)}</span>
      </div>
      <button class="close" onclick={(e) => { e.stopPropagation(); trip.closeStory(); }} onpointerdown={(e) => e.stopPropagation()} aria-label="Close">✕</button>
    </header>

    {#key current.id}
      {@const id = current.id}
      {#if contain}
        <!-- Shown whole, so the frame is filled by a blurred copy of the photo
             itself rather than a slab of grey. -->
        <img class="backdrop" src={thumbUrl} alt="" draggable="false" aria-hidden="true" />
      {/if}
      <!-- The thumbnail is already on the device (it is in the strip): show it
           sharp at once, and fade the full-size image in over it when it lands. -->
      <img class="placeholder" class:contain={contain} src={thumbUrl} alt="" draggable="false" aria-hidden="true" />
      {#if video_}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video class="media" class:contain={contain} class:loaded bind:this={video} src={videoUrl} poster={fullUrl} playsinline autoplay muted preload="auto"
          onloadeddata={() => (loadedId = id)} onerror={() => (failedId = id)}
          ontimeupdate={(e) => { const v = e.currentTarget; if (v.duration > 0) progress = Math.min(1, v.currentTime / v.duration); }}
          onended={() => { if (!zoomed && !pinching) next(); }}></video>
        <!-- Drawn, not an emoji: every phone (and headless Chromium) has a different speaker glyph, or none. -->
        <button class="sound" onclick={(e) => { e.stopPropagation(); muted = !muted; }} onpointerdown={(e) => e.stopPropagation()} aria-label={muted ? "Turn sound on" : "Turn sound off"} aria-pressed={!muted}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M12 4.5 7 8.5H3.5v7H7l5 4z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
            {#if muted}
              <path d="M4 3.5 20.5 20" stroke="rgba(0,0,0,0.65)" stroke-width="5" stroke-linecap="round" />
              <path d="M4 3.5 20.5 20" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            {:else}
              <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.5 6.2a8.2 8.2 0 0 1 0 11.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            {/if}
          </svg>
        </button>
        {#if Number.isFinite(current.media.duration)}<span class="dur" aria-hidden="true">{fmtDuration(current.media.duration)}</span>{/if}
      {:else}
        <img class="media" class:contain={contain} class:loaded src={fullUrl} alt={current.caption || current.place || ""} draggable="false"
          onload={() => (loadedId = id)} onerror={() => (failedId = id)} />
      {/if}
      {#if captions.length}
        <!-- Captions sit ON the photo, where the author put them, in the faces and
             pills they chose (Caption.svelte, shared with the admin's preview).
             Several can share a photo; they arrive one after another. -->
        <div class="cap-host">
          {#each captions as c, i (i)}<Caption text={c.text} style={c} animate delay={i * 110} />{/each}
        </div>
      {/if}
      {#if !loaded && !failed}<span class="loading" aria-label={video_ ? "Loading video" : "Loading photo"} role="status"></span>{/if}
      {#if failed}<p class="failed" role="alert">Couldn't load this {video_ ? "video" : "photo"}</p>{/if}
    {/key}

    <footer>
      {#if current.tags.length}
        <div class="tags">{#each current.tags as t (t)}<span class="tag">{t}</span>{/each}</div>
      {/if}
      <!-- The photo's own count, on the photo it belongs to. It used to be the
           GALLERY's count in the top bar, which answered a question nobody
           standing in front of one picture was asking, and told a creator
           nothing about which of their pictures people actually stopped on.
           Bottom right, opposite the position: the foot of a story is where
           its small print lives. -->
      <div class="foot">
        <span class="hint">{trip.storyPos + 1} / {items.length}{paused ? " · paused" : ""}</span>
        {#if seenBy !== null}
          <span class="views" role="status" title={exact(seenBy)}>
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path d="M1.8 12S5.9 5.4 12 5.4 22.2 12 22.2 12 18.1 18.6 12 18.6 1.8 12 1.8 12Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
              <circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.8" />
            </svg>
            <span class="n">{short(seenBy)}</span>
            <span class="sr">{seenBy === 1 ? "view" : "views"}</span>
          </span>
        {/if}
      </div>
    </footer>
  </div>
  {#if (handoff && nextStop) || expanding}
    <!-- Beneath the postcard: the map is travelling to the next pin; this names it. Any touch skips ahead.
         It stays, quietly, while the card expands back, so a tap then lands nowhere wrong. -->
    <div class="handoff-veil" class:quiet={!handoff} onpointerdown={() => { if (handoff) endHandoff(); }} role="status" aria-live="polite">
      {#if handoff && nextStop}
      <div class="nextstop">
        <span class="avatar" aria-hidden="true"><img src={nextStop.thumb} alt="" />{#if nextStop.video}<span class="v">▶</span>{/if}</span>
        <span class="words">
          <span class="eyebrow">{nextStop.eyebrow}</span>
          <span class="name">{nextStop.name}</span>
          <span class="sub">{#if nextStop.rating}<b>{nextStop.rating}<i>★</i></b>{/if}<span>{nextStop.what}</span></span>
        </span>
      </div>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .scrim { position: fixed; inset: 0; background: #000; z-index: 40; }
  .story {
    position: fixed; inset: 0; z-index: 50;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto 1fr auto;
    background: #06070a;
    overscroll-behavior: contain; touch-action: none;
    user-select: none; -webkit-user-select: none;
    overflow: hidden; outline: none;
    /* The Next stop postcard: shrunk from the top edge so the pin at the map's centre shows beneath it. */
    transform-origin: 50% 0; --ho-s: 0.36; --ho-y: 2vh;
    --z: 1; --zx: 0px; --zy: 0px;
  }
  .story.handoff { border-radius: 26px; box-shadow: 0 24px 70px rgba(0, 0, 0, 0.65); }
  .handoff-veil {
    position: fixed; inset: 0; z-index: 49; display: flex; flex-direction: column; align-items: center; padding: 58vh 16px 0;
    background: radial-gradient(ellipse at 50% 44%, rgba(6, 7, 10, 0) 0 20%, rgba(6, 7, 10, 0.55) 62%);
    animation: veil-in 380ms ease both; touch-action: none;
  }
  .handoff-veil.quiet { background: none; animation: none; }
  .nextstop {
    display: flex; align-items: center; gap: 12px; padding: 9px 18px 9px 9px; border-radius: 999px; max-width: min(92vw, 420px);
    background: rgba(10, 12, 16, 0.94); color: #fff; box-shadow: 0 14px 40px rgba(0, 0, 0, 0.5);
    animation: pill-in 420ms cubic-bezier(.2,.8,.2,1) 140ms both;
  }
  .nextstop .avatar { position: relative; width: 50px; height: 50px; border-radius: 50%; padding: 3px; flex: none; background: conic-gradient(#f9ce34, #ee2a7b, #6228d7, #f9ce34); }
  .nextstop .avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block; border: 2px solid #0a0c10; background: #14181e; }
  .nextstop .avatar .v { position: absolute; right: -2px; bottom: -2px; width: 18px; height: 18px; border-radius: 50%; border: 2px solid #0a0c10; background: #fff; color: #111; font-size: 8px; line-height: 14px; text-align: center; box-sizing: border-box; }
  .nextstop .words { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
  .nextstop .eyebrow { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.6; }
  .nextstop .name { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nextstop .sub { display: flex; align-items: center; gap: 8px; font-size: 12px; opacity: 0.85; }
  .nextstop .sub b { color: #ffd166; font-weight: 700; } .nextstop .sub i { font-style: normal; margin-left: 1px; }
  @keyframes pill-in { from { opacity: 0; transform: translateY(14px) scale(0.96); } }
  @keyframes veil-in { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .story { --ho-s: 1; --ho-y: 0; } .story.handoff { border-radius: 0; } .handoff-veil, .nextstop { animation: none; } }
  /* grid-column is load-bearing: the bars/header/footer auto-place into column
     1, so an item spanning every row with no column of its own would be pushed
     into an implicit column 2 -- beside the chrome instead of behind it. */
  .media, .placeholder, .backdrop { grid-row: 1 / -1; grid-column: 1; width: 100%; height: 100%; pointer-events: none; }
  /* Paint order is explicit. A grid item with a transform, a filter or an
     opacity below 1 forms a stacking context and paints ABOVE plain siblings
     whatever the DOM order -- so the blurred, darkened backdrop covered the
     photo, and a landscape photo showed as nothing but its own dark blur. */
  .backdrop { z-index: 0; }
  .placeholder { z-index: 1; object-fit: cover; }
  /* Pinch to zoom. Every layer takes the same transform so the photo, the
     low-res placeholder still showing under it, the blurred backdrop and the
     captions stuck to the photo all move as one object -- zoom into a caption
     and it grows with the thing it is labelling.
     While fingers are down there is no transition: the photo has to sit under
     them exactly. The easing is only for letting go and settling back. */
  .media, .placeholder, .cap-host { transform: translate(var(--zx), var(--zy)) scale(var(--z)); transform-origin: 50% 50%; }
  .backdrop { transform: translate(var(--zx), var(--zy)) scale(calc(var(--z) * 1.15)); transform-origin: 50% 50%; }
  .story:not(.pinching) .media,
  .story:not(.pinching) .placeholder,
  .story:not(.pinching) .backdrop,
  .story:not(.pinching) .cap-host { transition: transform 260ms cubic-bezier(.2, .8, .2, 1); }
  .story:not(.pinching) .media { transition: transform 260ms cubic-bezier(.2, .8, .2, 1), opacity 260ms ease; }
  /* Nothing should sit over a photo somebody is inspecting. */
  .story.zoomed .bars, .story.zoomed .meta, .story.zoomed footer, .story.zoomed .sound { opacity: 0; transition: opacity 180ms ease; pointer-events: none; }
  .story.zoomed header { background: none; transition: background 180ms ease; }
  /* Shown whole, the picture becomes an OBJECT rather than a fill.
     `object-fit: contain` leaves the element spanning the frame with the
     picture floating somewhere inside it, so a radius or a shadow draws around
     the frame and the photograph itself has no edge at all -- it dissolves
     into its own blur. Sized to the picture instead, the corners and the
     shadow land where the photograph actually is, and it reads as a print
     resting on a blurred field rather than a hole cut in one.

     The aspect comes from the stored dimensions, not from the file, so a video
     does not flash at 300x150 while its metadata loads. */
  .placeholder.contain, .media.contain {
    place-self: center;
    width: auto; height: auto; max-width: 100%; max-height: 100%;
    aspect-ratio: var(--ar);
    object-fit: contain;
    border-radius: 7px;
  }
  /* The edge lives on the placeholder alone: it is always opaque and exactly
     coincident with the photo, so there is one shadow at every moment instead
     of two stacking up while the full-size image fades in over it. */
  .placeholder.contain {
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.09), 0 20px 56px rgba(0, 0, 0, 0.55);
  }
  .media { z-index: 2; object-fit: cover; opacity: 0; transition: opacity 260ms ease; }
  .media.loaded { opacity: 1; }
  /* No background on the video: a landscape clip is letterboxed, and the blurred
     backdrop must show through those bands exactly as it does behind a photo. */
  .sound {
    grid-row: 2; grid-column: 1; z-index: 5; justify-self: end; align-self: start; margin: 60px 14px 0 0;
    width: 40px; height: 40px; border-radius: 50%; border: 0; background: rgba(0, 0, 0, 0.45); color: #fff; cursor: pointer; pointer-events: auto;
    display: grid; place-items: center; padding: 0;
  }
  .dur { grid-row: 4; grid-column: 1; z-index: 5; justify-self: end; align-self: end; margin: 0 18px 22px 0; font-size: 11px; color: rgba(255, 255, 255, 0.7); font-variant-numeric: tabular-nums; }
  .loading {
    grid-row: 1 / -1; grid-column: 1; place-self: center; z-index: 3; pointer-events: none;
    width: 34px; height: 34px; border-radius: 50%; border: 3px solid rgba(255, 255, 255, 0.25); border-top-color: #fff;
    animation: spin 900ms linear infinite; box-shadow: 0 0 0 6px rgba(0, 0, 0, 0.25);
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .failed { grid-row: 1 / -1; grid-column: 1; place-self: center; z-index: 3; margin: 0; padding: 8px 14px; border-radius: 10px; background: rgba(0, 0, 0, 0.6); color: #fff; font-size: 14px; }
  .backdrop { object-fit: cover; filter: blur(28px) brightness(0.45); }
  @keyframes fade { from { opacity: 0.25; } to { opacity: 1; } }

  .bars { grid-row: 1; grid-column: 1; z-index: 4; display: flex; gap: 3px; padding: max(10px, env(safe-area-inset-top)) 10px 0; }
  .bar { flex: 1; height: 2.5px; border-radius: 2px; background: rgba(255, 255, 255, 0.3); overflow: hidden; }
  .fill { height: 100%; background: #fff; }

  header {
    grid-row: 2; grid-column: 1; z-index: 4;
    display: flex; align-items: flex-start; justify-content: space-between; padding: 12px 14px;
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.55), transparent);
  }
  .meta { display: flex; flex-direction: column; gap: 2px; color: #fff; min-width: 0; }
  .meta .day { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.7; }
  .meta strong { font-size: 15px; font-weight: 600; }
  .meta .place { font-size: 15px; font-weight: 600; color: #fff; text-decoration: none; display: inline-flex; align-items: baseline; gap: 5px; pointer-events: auto; touch-action: manipulation; }
  .meta .ext { font-size: 12px; opacity: 0.7; }
  .meta .placerow { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 2px; }
  .meta .rate { display: inline-flex; align-items: center; gap: 2px; margin-left: 8px; padding: 1px 7px; border-radius: 999px; background: rgba(255, 255, 255, 0.92); color: #111; font-size: 11px; font-weight: 700; vertical-align: 2px; }
  .meta .rate i { font-style: normal; color: #f4b400; font-size: 10px; }
  .meta .clock { font-size: 12px; opacity: 0.65; font-variant-numeric: tabular-nums; }
  .close {
    background: rgba(0, 0, 0, 0.35); border: 0; color: #fff; opacity: 0.9; font-size: 16px; line-height: 1;
    /* flex-shrink is load-bearing: a long place name in .meta squeezed this
       from 36px to 25px, turning the tap target into an oval too small to hit. */
    flex: 0 0 auto;
    width: 36px; height: 36px; border-radius: 50%; cursor: pointer; display: grid; place-items: center; touch-action: manipulation;
  }

  footer {
    grid-row: 4; grid-column: 1; z-index: 4;
    padding: 28px 18px max(20px, env(safe-area-inset-bottom));
    background: linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent); color: #fff; pointer-events: none;
  }
  .cap-host { grid-row: 1 / -1; grid-column: 1; position: relative; z-index: 3; pointer-events: none; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .tag { font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.16); }
  .foot { display: flex; align-items: center; gap: 10px; }
  .hint { font-size: 11px; opacity: 0.55; }
  /* Quiet enough to ignore while looking at the photo, legible when looked
     for. It fades up when the count lands rather than appearing mid-read. */
  .views {
    margin-left: auto; display: inline-flex; align-items: center; gap: 4px;
    font-size: 11px; font-weight: 600; line-height: 1; opacity: 0.62;
    font-variant-numeric: tabular-nums;
    animation: views-in 380ms cubic-bezier(.2, .8, .2, 1) both;
  }
  .views svg { opacity: 0.85; }
  @keyframes views-in { from { opacity: 0; transform: translateY(2px); } to { opacity: 0.62; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .views { animation: none; } }
  .sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  @media (min-width: 760px) {
    .story {
      inset: 50% auto auto 50%; translate: -50% -50%;
      width: min(430px, 92vw); height: min(88vh, 860px);
      border-radius: 14px; box-shadow: 0 24px 80px rgba(0, 0, 0, 0.7);
      --ho-s: 0.5; --ho-y: 0;
    }
  }
</style>
