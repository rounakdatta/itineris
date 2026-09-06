<script>
  // Style the caption the way the story will show it: a phone-shaped preview
  // of THIS photo with the real Caption renderer, draggable; underneath, the
  // few choices that matter -- face, size, pill, ink, alignment.
  import Caption from "../src/components/Caption.svelte";
  import { FONTS, SIZES, ACCENTS, ALIGNS, normalizeStyle, isDefaultStyle } from "../server/caption.js";
  import { mediaUrl } from "./lib/api.js";

  let { moment, caption = "", style = null, pending = false, onChange } = $props();
  const st = $derived(normalizeStyle(style));
  const landscape = $derived(!!moment.media && moment.media.w > moment.media.h);
  const img = $derived(pending ? moment.media.src : mediaUrl(moment.media.medium ?? moment.media.poster ?? moment.media.src));
  const set = (patch) => onChange?.({ ...st, ...patch });
  const SIZE_LABEL = { s: "S", m: "M", l: "L", xl: "XL" };
  const ALIGN_LABEL = { left: "Left", center: "Centre", right: "Right" };
</script>

<div class="styler">
  <div class="frame" data-testid="caption-frame">
    {#if landscape}<img class="blur" src={img} alt="" />{/if}
    <img class="photo" class:contain={landscape} src={img} alt="" />
    <Caption text={caption} style={st} editable onMove={(x, y) => set({ x, y })} />
    <div class="hint" aria-hidden="true">drag the caption where you want it</div>
  </div>
  <div class="controls">
    <div class="row" role="group" aria-label="Font">
      {#each Object.entries(FONTS) as [k, f] (k)}
        <button type="button" class="opt" class:on={st.font === k} style={`font-family:${f.family};font-weight:${f.weight};${f.upper ? "text-transform:uppercase;" : ""}`} aria-pressed={st.font === k} onclick={() => set({ font: k })}>{f.label}</button>
      {/each}
    </div>
    <div class="row" role="group" aria-label="Size">
      {#each Object.keys(SIZES) as k (k)}<button type="button" class="opt" class:on={st.size === k} aria-pressed={st.size === k} onclick={() => set({ size: k })}>{SIZE_LABEL[k]}</button>{/each}
      <span class="sep" aria-hidden="true"></span>
      {#each ALIGNS as a (a)}<button type="button" class="opt" class:on={st.align === a} aria-pressed={st.align === a} onclick={() => set({ align: a })}>{ALIGN_LABEL[a]}</button>{/each}
    </div>
    <div class="row" role="group" aria-label="Background">
      <button type="button" class="opt" class:on={st.bg === "none"} aria-pressed={st.bg === "none"} onclick={() => set({ bg: "none" })}>No box</button>
      <button type="button" class="opt" class:on={st.bg === "dark"} aria-pressed={st.bg === "dark"} onclick={() => set({ bg: "dark" })}>Dark</button>
      <button type="button" class="opt" class:on={st.bg === "light"} aria-pressed={st.bg === "light"} onclick={() => set({ bg: "light" })}>Light</button>
      {#each ACCENTS as c (c)}<button type="button" class="dot" class:on={st.bg === c} style={`background:${c}`} aria-label={`Colour ${c}`} aria-pressed={st.bg === c} onclick={() => set({ bg: c })}></button>{/each}
      {#if st.bg === "none"}
        <span class="sep" aria-hidden="true"></span>
        <button type="button" class="opt" class:on={st.ink === "light"} aria-pressed={st.ink === "light"} onclick={() => set({ ink: "light" })}>Light text</button>
        <button type="button" class="opt" class:on={st.ink === "dark"} aria-pressed={st.ink === "dark"} onclick={() => set({ ink: "dark" })}>Dark text</button>
      {/if}
      <span class="spacer"></span>
      {#if !isDefaultStyle(st)}<button type="button" class="opt ghost" onclick={() => onChange?.(null)}>Reset</button>{/if}
    </div>
  </div>
</div>

<style>
  .styler { margin-top: 8px; }
  .frame { position: relative; width: min(100%, 250px); aspect-ratio: 9 / 19.5; margin: 0 auto; border-radius: 16px; overflow: hidden; background: #06070a; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45); }
  .photo, .blur { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
  .photo.contain { object-fit: contain; }
  .blur { filter: blur(22px) brightness(0.45); transform: scale(1.15); }
  .hint { position: absolute; left: 0; right: 0; bottom: 8px; text-align: center; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(255, 255, 255, 0.55); pointer-events: none; }
  .controls { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .opt { padding: 5px 10px; border-radius: 999px; border: 1px solid var(--line); background: rgba(255, 255, 255, 0.06); color: var(--text); font-size: 13px; line-height: 1.2; cursor: pointer; }
  .opt.on { background: #fff; color: #111; border-color: #fff; }
  .opt.ghost { background: transparent; color: var(--muted); }
  .dot { width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35) inset; }
  .dot.on { border-color: #fff; box-shadow: 0 0 0 2px #111; }
  .sep { width: 1px; height: 18px; background: var(--line); margin: 0 2px; }
  .spacer { flex: 1; }
</style>
