<script>
  import { trip } from "../lib/trip.svelte.js";
  import { clockOf, dayKey, dateLabel, mediaUrl, storySrc, placeLink, isVideo, fmtDuration } from "../lib/data.js";
  import { markSeen } from "../lib/seen.svelte.js";

  const SEGMENT_MS = 5000;
  const DISMISS_PX = 110;   // drag down this far to close
  const SWIPE_PX = 56;      // drag sideways this far to change photo
  const TAP_MS = 350;      // a tap released within this is navigation; longer is hold-to-pause
  const TAP_SLOP = 12;

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

  let down = null;
  let holdTimer = null;

  const items = $derived(trip.visibleMoments);
  const current = $derived(trip.storyMoment);
  const landscape = $derived(!!current && current.media.w > current.media.h);
  const dateStr = $derived(current ? dateLabel(dayKey(current.t)) : "");   // "14 Mar": the date, minimally
  const thumbUrl = $derived(current ? mediaUrl(current.media.thumb ?? current.media.src) : "");
  const fullUrl = $derived(current ? storySrc(current.media) : "");
  const video_ = $derived(!!current && isVideo(current.media));
  const videoUrl = $derived(video_ ? mediaUrl(current.media.src) : "");
  const loaded = $derived(!!current && loadedId === current.id);
  const failed = $derived(!!current && failedId === current.id);
  const link = $derived(placeLink(current));
  // Seen = shown, like a story: the ring on the map goes quiet for this photo.
  $effect(() => { if (trip.storyOpen && current) markSeen(current.id); });

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
      if (!paused && !axis && (loaded || failed) && !(video_ && !failed)) {
        progress += dt / SEGMENT_MS;
        if (progress >= 1) {
          if (!trip.step(1)) trip.closeStory();
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
    for (const m of items.slice(i + 1, i + 3)) { const img = new Image(); img.src = storySrc(m.media); }
  });

  // Hold-to-pause and the space bar pause the video too; the speaker button
  // is applied to the element directly (a fresh <video> per photo needs it again).
  $effect(() => { if (!video) return; if (paused || axis) video.pause(); else video.play?.()?.catch?.(() => {}); });
  $effect(() => { if (video) video.muted = muted; });

  // Keyboard, and focus the dialog so screen readers and arrow keys land here.
  $effect(() => {
    if (!trip.storyOpen) return;
    dialog?.focus?.();
    const onKey = (e) => {
      if (e.key === "Escape") trip.closeStory();
      else if (e.key === "ArrowRight") { if (!trip.step(1)) trip.closeStory(); }
      else if (e.key === "ArrowLeft") trip.step(-1);
      else if (e.key === " ") { e.preventDefault(); paused = !paused; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function next() { if (!trip.step(1)) trip.closeStory(); }
  function prev() { trip.step(-1); }

  function onPointerDown(e) {
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* synthetic or already-released pointer */ }
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    dragX = 0; dragY = 0; axis = null;
    holdTimer = setTimeout(() => { paused = true; }, TAP_MS);
  }

  function onPointerMove(e) {
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
    bind:this={dialog}
    style:transform="translate({dragX * 0.35}px, {dragY}px) scale({1 - Math.min(dragY / 2600, 0.06)})"
    style:transition={axis ? "none" : "transform 260ms cubic-bezier(.2,.8,.2,1)"}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label={`Story: ${current.place || current.caption || "photo"}`}
  >
    <div class="bars" aria-hidden="true">
      {#each items as m, i (m.id)}
        <div class="bar">
          <div class="fill" style:width={i < trip.storyIndex ? "100%" : i === trip.storyIndex ? `${progress * 100}%` : "0%"}></div>
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
        {:else}
          <strong>{current.place || " "}</strong>
        {/if}
        <span class="clock">{clockOf(current.t)}</span>
      </div>
      <button class="close" onclick={(e) => { e.stopPropagation(); trip.closeStory(); }} onpointerdown={(e) => e.stopPropagation()} aria-label="Close">✕</button>
    </header>

    {#key current.id}
      {@const id = current.id}
      {#if landscape}
        <!-- A landscape photo on a portrait screen: show all of it, over a blurred copy of itself. -->
        <img class="backdrop" src={thumbUrl} alt="" draggable="false" aria-hidden="true" />
      {/if}
      <!-- The thumbnail is already on the device (it is in the strip): show it
           sharp at once, and fade the full-size image in over it when it lands. -->
      <img class="placeholder" class:contain={landscape} src={thumbUrl} alt="" draggable="false" aria-hidden="true" />
      {#if video_}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video class="media" class:contain={landscape} class:loaded bind:this={video} src={videoUrl} poster={fullUrl} playsinline autoplay muted preload="auto"
          onloadeddata={() => (loadedId = id)} onerror={() => (failedId = id)}
          ontimeupdate={(e) => { const v = e.currentTarget; if (v.duration > 0) progress = Math.min(1, v.currentTime / v.duration); }}
          onended={() => next()}></video>
        <!-- Drawn, not an emoji: every phone (and headless Chromium) has a different speaker glyph, or none. -->
        <button class="sound" onclick={(e) => { e.stopPropagation(); muted = !muted; }} onpointerdown={(e) => e.stopPropagation()} aria-label={muted ? "Turn sound on" : "Turn sound off"} aria-pressed={!muted}>
          {#if muted}
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4-2.7-2.7z"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3zm11.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 14.5 12zM12 3.23v2.06a6.99 6.99 0 0 1 0 13.42v2.06A9 9 0 0 0 12 3.23z"/></svg>
          {/if}
        </button>
        {#if Number.isFinite(current.media.duration)}<span class="dur" aria-hidden="true">{fmtDuration(current.media.duration)}</span>{/if}
      {:else}
        <img class="media" class:contain={landscape} class:loaded src={fullUrl} alt={current.caption || current.place || ""} draggable="false"
          onload={() => (loadedId = id)} onerror={() => (failedId = id)} />
      {/if}
      {#if !loaded && !failed}<span class="loading" aria-label={video_ ? "Loading video" : "Loading photo"} role="status"></span>{/if}
      {#if failed}<p class="failed" role="alert">Couldn't load this {video_ ? "video" : "photo"}</p>{/if}
    {/key}

    <footer>
      {#if current.caption}<p class="caption">{current.caption}</p>{/if}
      {#if current.tags.length}
        <div class="tags">{#each current.tags as t (t)}<span class="tag">{t}</span>{/each}</div>
      {/if}
      <div class="hint">{trip.storyIndex + 1} / {items.length}{paused ? " · paused" : ""}</div>
    </footer>
  </div>
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
  }
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
  .placeholder.contain { object-fit: contain; }
  .media { z-index: 2; object-fit: cover; opacity: 0; transition: opacity 260ms ease; }
  .media.loaded { opacity: 1; }
  .media.contain { object-fit: contain; }
  /* No background on the video: a landscape clip is letterboxed, and the blurred
     backdrop must show through those bands exactly as it does behind a photo. */
  .sound {
    grid-row: 2; grid-column: 1; z-index: 5; justify-self: end; align-self: start; margin: 60px 14px 0 0;
    width: 36px; height: 36px; border-radius: 50%; border: 0; background: rgba(0, 0, 0, 0.45); color: #fff; cursor: pointer; pointer-events: auto;
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
  .backdrop { object-fit: cover; filter: blur(28px) brightness(0.45); transform: scale(1.15); }
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
    width: 36px; height: 36px; border-radius: 50%; cursor: pointer; display: grid; place-items: center; touch-action: manipulation;
  }

  footer {
    grid-row: 4; grid-column: 1; z-index: 4;
    padding: 28px 18px max(20px, env(safe-area-inset-bottom));
    background: linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent); color: #fff; pointer-events: none;
  }
  .caption { margin: 0 0 10px; font-size: 16px; line-height: 1.45; max-width: 34rem; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .tag { font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.16); }
  .hint { font-size: 11px; opacity: 0.55; }

  @media (min-width: 760px) {
    .story {
      inset: 50% auto auto 50%; translate: -50% -50%;
      width: min(430px, 92vw); height: min(88vh, 860px);
      border-radius: 14px; box-shadow: 0 24px 80px rgba(0, 0, 0, 0.7);
    }
  }
</style>
