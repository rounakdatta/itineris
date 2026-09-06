<script>
  // The caption as visitors see it -- and, with `editable`, as the author
  // places it: drag it anywhere in the frame, grab the handle above it to tilt
  // it to any angle, or nudge and turn it from the keyboard. Positions are
  // fractions of the frame, so the admin's small preview and a phone's full
  // screen agree; the font size follows the frame width (cqw).
  import "../lib/caption-fonts.css";
  import { captionVars, normalizeStyle, X_RANGE, Y_RANGE, ROT_RANGE, clamp } from "../../server/caption.js";

  let { text = "", style = null, editable = false, animate = false, onMove = null, onRotate = null, onCommit = null } = $props();
  const st = $derived(normalizeStyle(style));
  const vars = $derived(captionVars(style));

  let layer = $state(null);
  let dragging = $state(false);
  let turning = $state(false);
  let grab = null;   // pointer-to-anchor offset at pointerdown, in fractions, so the caption does not jump under the finger

  const SNAP_DEG = 15, SNAP_WITHIN = 3.5;   // tidy angles are easy to hit; hold Alt for a free one
  function frac(e) { const r = layer.getBoundingClientRect(); return { x: (e.clientX - r.left) / (r.width || 1), y: (e.clientY - r.top) / (r.height || 1) }; }

  function down(e) {
    if (!editable) return;
    e.preventDefault(); e.stopPropagation();
    const p = frac(e); grab = { dx: st.x - p.x, dy: st.y - p.y }; dragging = true;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
  }
  function move(e) { if (!dragging) return; const p = frac(e); onMove?.(+clamp(p.x + grab.dx, X_RANGE).toFixed(4), +clamp(p.y + grab.dy, Y_RANGE).toFixed(4)); }
  function up() { if (!dragging) return; dragging = false; grab = null; onCommit?.(); }

  // The handle sits above the caption and turns with it, so dragging it is
  // simply "point the caption's top at my finger".
  function turnDown(e) {
    if (!editable) return;
    e.preventDefault(); e.stopPropagation();
    turning = true;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
  }
  function turnMove(e) {
    if (!turning) return;
    const r = layer.getBoundingClientRect();
    const dx = e.clientX - (r.left + st.x * r.width), dy = e.clientY - (r.top + st.y * r.height);
    if (Math.hypot(dx, dy) < 8) return;                       // too close to the centre to mean an angle
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;      // the handle starts due north
    if (deg > 180) deg -= 360; if (deg < -180) deg += 360;
    if (!e.altKey) { const snapped = Math.round(deg / SNAP_DEG) * SNAP_DEG; if (Math.abs(deg - snapped) <= SNAP_WITHIN) deg = snapped; }
    onRotate?.(+clamp(deg, ROT_RANGE).toFixed(1));
  }
  function turnUp(e) { if (!turning) return; turning = false; e?.stopPropagation?.(); onCommit?.(); }

  function key(e) {
    if (!editable) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) {
      e.preventDefault();
      onMove?.(+clamp(st.x + d[0], X_RANGE).toFixed(4), +clamp(st.y + d[1], Y_RANGE).toFixed(4)); onCommit?.();
      return;
    }
    // [ and ] turn it, like a rotate tool's shortcuts; Shift turns faster.
    const turn = { "[": -1, "]": 1 }[e.key];
    if (turn) {
      e.preventDefault();
      onRotate?.(+clamp(st.rot + turn * (e.shiftKey ? 15 : 1), ROT_RANGE).toFixed(1)); onCommit?.();
    }
  }
</script>

{#if text}
  <div class="cap-layer" class:editable bind:this={layer}>
    <div
      class="cap" class:editable class:dragging class:animate
      style={vars}
      role={editable ? "button" : null} tabindex={editable ? 0 : null}
      aria-label={editable ? "Caption. Drag to place it; arrow keys nudge, [ and ] turn it." : null}
      onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={key}
    >{text}{#if editable}<span
        class="turn" class:on={turning} aria-hidden="true" title="Drag to tilt (hold Alt for any angle)"
        onpointerdown={turnDown} onpointermove={turnMove} onpointerup={turnUp} onpointercancel={turnUp}
      ></span>{/if}</div>
  </div>
{/if}

<style>
  .cap-layer { position: absolute; inset: 0; pointer-events: none; container-type: inline-size; }
  .cap {
    position: absolute; left: var(--cap-x); top: var(--cap-y);
    transform: translate(-50%, -50%) rotate(var(--cap-rot));
    max-width: 86%; width: max-content; box-sizing: border-box;
    font-family: var(--cap-font); font-weight: var(--cap-weight); font-style: var(--cap-style); text-align: var(--cap-align);
    text-transform: var(--cap-transform); letter-spacing: var(--cap-spacing);
    font-size: 17px; font-size: calc(var(--cap-size) * 4.7cqw); line-height: 1.28;
    color: var(--cap-ink); background: var(--cap-bg); text-shadow: var(--cap-shadow);
    padding: var(--cap-pad); border-radius: 0.55em;
    white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .cap.animate { animation: cap-in 460ms cubic-bezier(.2,.8,.2,1) 120ms both; }
  @keyframes cap-in {
    from { opacity: 0; transform: translate(-50%, -50%) translateY(10px) rotate(var(--cap-rot)); }
    to { opacity: 1; transform: translate(-50%, -50%) translateY(0) rotate(var(--cap-rot)); }
  }
  .cap.editable { pointer-events: auto; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; outline: 1.5px dashed rgba(255, 255, 255, 0.7); outline-offset: 5px; }
  .cap.editable:focus-visible { outline: 2px solid #7aa2f7; }
  .cap.dragging { cursor: grabbing; }
  /* The tilt handle: a grip on a short stalk above the caption, turning with it. */
  .turn {
    position: absolute; left: 50%; top: 0; translate: -50% -100%; margin-top: -14px;
    width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    cursor: grab; touch-action: none;
  }
  .turn::before { content: ""; position: absolute; left: 50%; top: 100%; width: 1.5px; height: 14px; translate: -50% 0; background: rgba(255, 255, 255, 0.8); }
  .turn::after { content: ""; position: absolute; inset: 0; margin: -11px; border-radius: 50%; }   /* a finger-sized target */
  .turn.on { cursor: grabbing; background: #7aa2f7; }
  @media (prefers-reduced-motion: reduce) { .cap.animate { animation: none; } }
</style>
