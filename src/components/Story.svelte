<script>
  import { trip } from "../lib/trip.svelte.js";
  import { clockOf, dayKey, mediaUrl } from "../lib/data.js";

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
  let dialog;

  let down = null;
  let holdTimer = null;

  const items = $derived(trip.visibleMoments);
  const current = $derived(trip.storyMoment);
  const landscape = $derived(!!current && current.media.w > current.media.h);
  const dayLabel = $derived(current ? trip.days.find((d) => d.key === dayKey(current.t))?.label : "");

  // Advance timer. Restarts whenever the index changes; `paused`/`axis` are
  // read inside rAF (outside the tracking pass) so they gate without restarting.
  $effect(() => {
    const idx = trip.storyIndex;
    if (idx < 0) return;
    progress = 0;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const dt = now - last;
      last = now;
      if (!paused && !axis) {
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

  // Preload the next two so a tap never lands on a blank frame.
  $effect(() => {
    const i = trip.storyIndex;
    if (i < 0) return;
    for (const m of items.slice(i + 1, i + 3)) { const img = new Image(); img.src = mediaUrl(m.media.src); }
  });

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
        {#if dayLabel}<span class="day">{dayLabel}</span>{/if}
        <strong>{current.place || " "}</strong>
        <span class="clock">{clockOf(current.t)}</span>
      </div>
      <button class="close" onclick={(e) => { e.stopPropagation(); trip.closeStory(); }} onpointerdown={(e) => e.stopPropagation()} aria-label="Close">✕</button>
    </header>

    {#key current.id}
      {#if landscape}
        <!-- A landscape photo on a portrait screen: show all of it, over a blurred copy of itself. -->
        <img class="backdrop" src={mediaUrl(current.media.thumb ?? current.media.src)} alt="" draggable="false" aria-hidden="true" />
      {/if}
      <img class="media" class:contain={landscape} src={mediaUrl(current.media.src)} alt={current.caption || current.place || ""} draggable="false" />
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
  .media, .backdrop { grid-row: 1 / -1; grid-column: 1; width: 100%; height: 100%; pointer-events: none; }
  .media { object-fit: cover; animation: fade 320ms ease; }
  .media.contain { object-fit: contain; }
  .backdrop { object-fit: cover; filter: blur(28px) brightness(0.45); transform: scale(1.15); }
  @keyframes fade { from { opacity: 0.25; } to { opacity: 1; } }

  .bars { grid-row: 1; grid-column: 1; z-index: 2; display: flex; gap: 3px; padding: max(10px, env(safe-area-inset-top)) 10px 0; }
  .bar { flex: 1; height: 2.5px; border-radius: 2px; background: rgba(255, 255, 255, 0.3); overflow: hidden; }
  .fill { height: 100%; background: #fff; }

  header {
    grid-row: 2; grid-column: 1; z-index: 2;
    display: flex; align-items: flex-start; justify-content: space-between; padding: 12px 14px;
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.55), transparent);
  }
  .meta { display: flex; flex-direction: column; gap: 2px; color: #fff; min-width: 0; }
  .meta .day { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.7; }
  .meta strong { font-size: 15px; font-weight: 600; }
  .meta .clock { font-size: 12px; opacity: 0.65; font-variant-numeric: tabular-nums; }
  .close {
    background: rgba(0, 0, 0, 0.35); border: 0; color: #fff; opacity: 0.9; font-size: 16px; line-height: 1;
    width: 36px; height: 36px; border-radius: 50%; cursor: pointer; display: grid; place-items: center; touch-action: manipulation;
  }

  footer {
    grid-row: 4; grid-column: 1; z-index: 2;
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
