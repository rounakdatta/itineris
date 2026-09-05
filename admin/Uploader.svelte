<script>
  import { api } from "./lib/api.js";

  let { onDone } = $props();
  let input;
  let busy = $state(false);
  let progress = $state(0);
  let over = $state(false);
  let last = $state(null);   // { created, duplicates, errors }

  async function send(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|avif)$/i.test(f.name));
    if (!files.length) return;
    busy = true; progress = 0; last = null;
    try {
      last = await api.upload(files, (p) => (progress = p));
      onDone?.(last);
    } catch (e) {
      last = { created: [], duplicates: [], errors: [{ filename: "upload", error: e.message }] };
    } finally {
      busy = false;
      if (input) input.value = "";
    }
  }
</script>

<section
  class="drop"
  class:over
  class:busy
  ondragover={(e) => { e.preventDefault(); over = true; }}
  ondragleave={() => (over = false)}
  ondrop={(e) => { e.preventDefault(); over = false; send(e.dataTransfer.files); }}
>
  <!-- `multiple` + accept="image/*" gives camera-or-gallery on a phone and a
       normal picker on desktop, in one control. -->
  <input bind:this={input} type="file" accept="image/*" multiple hidden onchange={(e) => send(e.target.files)} />

  {#if busy}
    <div class="bar"><div class="fill" style:width="{Math.round(progress * 100)}%"></div></div>
    <p class="muted">{progress < 1 ? `uploading… ${Math.round(progress * 100)}%` : "processing photos…"}</p>
  {:else}
    <button class="btn primary" onclick={() => input.click()}>Add photos</button>
    <p class="muted hint">or drop them here · EXIF time and GPS are read, tags are yours to add</p>
  {/if}

  {#if last && !busy}
    <p class="result">
      {#if last.created.length}<span class="ok">{last.created.length} added</span>{/if}
      {#if last.duplicates.length}<span class="muted">· {last.duplicates.length} already there</span>{/if}
      {#each last.errors as e}<span class="err">· {e.filename}: {e.error}</span>{/each}
    </p>
  {/if}
</section>

<style>
  .drop {
    border: 1.5px dashed var(--line); border-radius: 14px; padding: 22px 16px; text-align: center;
    background: var(--panel); transition: border-color 140ms, background 140ms;
  }
  .drop.over { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--panel)); }
  .hint { margin: 10px 0 0; font-size: 13px; }
  .bar { height: 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.1); overflow: hidden; margin: 6px auto 10px; max-width: 420px; }
  .fill { height: 100%; background: var(--accent); transition: width 120ms linear; }
  .result { margin: 12px 0 0; font-size: 13px; display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
  .ok { color: var(--ok); }
  .err { color: var(--danger); }
</style>
