<script>
  import { trip } from "../lib/trip.svelte.js";
  import { clockOf, dayKey, dateLabel, mediaUrl, storySrc, placeLink, isVideo, fmtDuration } from "../lib/data.js";
  import { markSeen } from "../lib/seen.svelte.js";
  import Caption from "./Caption.svelte";

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

  const items = $derived(trip.storyGroup);   // this place's photos: its bars, its count
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
  // What the Next stop pill says about the place we are arriving at.
  const nextStop = $derived.by(() => {
    if (!handoff || !current) return null;
    const g = trip.storyGroup;
    const google = current.google?.placeId ? current.google : g.find((x) => x.google?.placeId)?.google ?? null;
    const videos = g.filter((x) => isVideo(x.media)).length, photos = g.length - videos;
    const what = [photos ? `${photos} photo${photos === 1 ? "" : "s"}` : "", videos ? `${videos} video${videos === 1 ? "" : "s"}` : ""].filter(Boolean).join(" & ");
    const first = g[0] ?? current;
    return { name: current.place?.trim() || current.caption?.trim() || "Photo", rating: Number.isFinite(google?.rating) ? google.rating.toFixed(1) : null, what, thumb: mediaUrl(first.media.thumb ?? first.media.src), video: isVideo(first.media) };
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
      if (!paused && !axis && !handoff && (loaded || failed) && !(video_ && !failed)) {
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
      if (e.key === "Escape") trip.closeStory();
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
    class:handoff
    bind:this={dialog}
    style:transform={handoff ? "translateY(var(--ho-y)) scale(var(--ho-s))" : `translate(${dragX * 0.35}px, ${dragY}px) scale(${1 - Math.min(dragY / 2600, 0.06)})`}
    style:transition={axis ? "none" : "transform 380ms cubic-bezier(.2,.8,.2,1), border-radius 380ms, box-shadow 380ms"}
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
        <img class="media" class:contain={landscape} class:loaded src={fullUrl} alt={current.caption || current.place || ""} draggable="false"
          onload={() => (loadedId = id)} onerror={() => (failedId = id)} />
      {/if}
      {#if current.caption}
        <!-- The caption sits ON the photo, where the author dragged it, in the face and pill they chose (Caption.svelte, shared with the admin's preview). -->
        <div class="cap-host"><Caption text={current.caption} style={current.captionStyle} animate /></div>
      {/if}
      {#if !loaded && !failed}<span class="loading" aria-label={video_ ? "Loading video" : "Loading photo"} role="status"></span>{/if}
      {#if failed}<p class="failed" role="alert">Couldn't load this {video_ ? "video" : "photo"}</p>{/if}
    {/key}

    <footer>
      {#if current.tags.length}
        <div class="tags">{#each current.tags as t (t)}<span class="tag">{t}</span>{/each}</div>
      {/if}
      <div class="hint">{trip.storyPos + 1} / {items.length}{paused ? " · paused" : ""}</div>
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
          <span class="eyebrow">Next stop</span>
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
  .placeholder.contain { object-fit: contain; }
  .media { z-index: 2; object-fit: cover; opacity: 0; transition: opacity 260ms ease; }
  .media.loaded { opacity: 1; }
  .media.contain { object-fit: contain; }
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
  .cap-host { grid-row: 1 / -1; grid-column: 1; position: relative; z-index: 3; pointer-events: none; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .tag { font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.16); }
  .hint { font-size: 11px; opacity: 0.55; }

  @media (min-width: 760px) {
    .story {
      inset: 50% auto auto 50%; translate: -50% -50%;
      width: min(430px, 92vw); height: min(88vh, 860px);
      border-radius: 14px; box-shadow: 0 24px 80px rgba(0, 0, 0, 0.7);
      --ho-s: 0.5; --ho-y: 0;
    }
  }
</style>
