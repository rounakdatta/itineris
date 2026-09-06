<script>
  // The caption as visitors see it -- and, with `editable`, as the author
  // places it: drag anywhere in the frame, or nudge with the arrow keys.
  // Positions are fractions of the frame, so the admin's small preview and a
  // phone's full screen agree; the font size follows the frame width (cqw).
  import "../lib/caption-fonts.css";
  import { captionVars, normalizeStyle, X_RANGE, Y_RANGE, clamp } from "../../server/caption.js";

  let { text = "", style = null, editable = false, animate = false, onMove = null, onCommit = null } = $props();
  const st = $derived(normalizeStyle(style));
  const vars = $derived(captionVars(style));

  let layer = $state(null);
  let dragging = $state(false);
  let grab = null;   // pointer-to-anchor offset at pointerdown, in fractions, so the caption does not jump under the finger

  function frac(e) { const r = layer.getBoundingClientRect(); return { x: (e.clientX - r.left) / (r.width || 1), y: (e.clientY - r.top) / (r.height || 1) }; }
  function down(e) {
    if (!editable) return;
    e.preventDefault(); e.stopPropagation();
    const p = frac(e); grab = { dx: st.x - p.x, dy: st.y - p.y }; dragging = true;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
  }
  function move(e) { if (!dragging) return; const p = frac(e); onMove?.(clamp(p.x + grab.dx, X_RANGE), clamp(p.y + grab.dy, Y_RANGE)); }
  function up() { if (!dragging) return; dragging = false; grab = null; onCommit?.(); }
  function key(e) {
    if (!editable) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    onMove?.(+clamp(st.x + d[0], X_RANGE).toFixed(4), +clamp(st.y + d[1], Y_RANGE).toFixed(4)); onCommit?.();
  }
</script>

{#if text}
  <div class="cap-layer" class:editable bind:this={layer}>
    <div
      class="cap" class:editable class:dragging class:animate
      style={vars}
      role={editable ? "button" : null} tabindex={editable ? 0 : null}
      aria-label={editable ? "Caption. Drag to place it; arrow keys nudge." : null}
      onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={key}
    >{text}</div>
  </div>
{/if}

<style>
  .cap-layer { position: absolute; inset: 0; pointer-events: none; container-type: inline-size; }
  .cap {
    position: absolute; left: var(--cap-x); top: var(--cap-y); transform: translate(-50%, -50%);
    max-width: 86%; width: max-content; box-sizing: border-box;
    font-family: var(--cap-font); font-weight: var(--cap-weight); text-align: var(--cap-align);
    text-transform: var(--cap-transform); letter-spacing: var(--cap-spacing);
    font-size: 17px; font-size: calc(var(--cap-size) * 4.7cqw); line-height: 1.28;
    color: var(--cap-ink); background: var(--cap-bg); text-shadow: var(--cap-shadow);
    padding: var(--cap-pad); border-radius: 0.55em;
    white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .cap.animate { animation: cap-in 460ms cubic-bezier(.2,.8,.2,1) 120ms both; }
  @keyframes cap-in { from { opacity: 0; transform: translate(-50%, -50%) translateY(10px); } }
  .cap.editable { pointer-events: auto; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; outline: 1.5px dashed rgba(255, 255, 255, 0.7); outline-offset: 5px; }
  .cap.editable:focus-visible { outline: 2px solid #7aa2f7; }
  .cap.dragging { cursor: grabbing; }
  @media (prefers-reduced-motion: reduce) { .cap.animate { animation: none; } }
</style>
