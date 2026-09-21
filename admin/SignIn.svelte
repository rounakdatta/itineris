<script>
  // Where "Make my own" lands, and where anyone signed out ends up. It is the
  // first thing a stranger sees of itineris as a thing they could use, so it
  // says what the thing is before it asks for anything.
  import { BASE } from "./lib/api.js";

  let { me = null } = $props();
  // Come back to whatever was being looked at, not always the front page.
  const next = typeof location === "undefined" ? `${BASE}/` : location.pathname + location.search + location.hash;
  const href = $derived(`${me?.signInUrl ?? `${BASE}/auth/google`}?next=${encodeURIComponent(next)}`);
</script>

<main class="hello">
  <img class="mark" src="{BASE}/mark-96.png" alt="" width="64" height="64" />
  <h1>Make your own <span>itineris</span></h1>
  <p class="pitch">A travel journal that lives on a map. Photos and videos become pins where they were taken, a pin opens as a story, and you share a whole trip with one link.</p>

  <ul class="how">
    <li><b>Put photos on it.</b> They place themselves from the picture's own GPS, or you pin a whole batch to one spot.</li>
    <li><b>Say something on them.</b> Captions go anywhere on the photo, at any angle, in a dozen faces.</li>
    <li><b>Share the link.</b> Nothing is public until you put it in a gallery, and each gallery is its own unguessable link.</li>
  </ul>

  {#if me?.error}
    <p class="err" role="alert">{me.error}</p>
  {/if}

  {#if me && me.google === false}
    <p class="err" role="alert">This server has no Google sign-in configured, so it is expecting an authenticating proxy in front of it.</p>
  {:else}
    <a class="google" {href} rel="nofollow">
      <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
        <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
        <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.42 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
      </svg>
      Continue with Google
    </a>
    <p class="fine">Your photos stay on this server. itineris asks Google only for your name, e-mail and picture, so it knows whose journal is whose.</p>
  {/if}

  <p class="back"><a href="/">← back to the journal</a></p>
</main>

<style>
  .hello {
    max-width: 34em; margin: 0 auto; padding: max(28px, env(safe-area-inset-top)) 20px 60px;
    display: flex; flex-direction: column; align-items: center; text-align: center;
  }
  .mark { border-radius: 14px; background: #fff; margin-bottom: 14px; }
  h1 { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.25; }
  h1 span { color: var(--accent, #7aa2f7); }
  .pitch { margin: 12px 0 0; color: var(--muted); line-height: 1.6; }
  .how {
    list-style: none; margin: 22px 0 0; padding: 0; text-align: left; display: grid; gap: 10px;
    color: var(--muted); font-size: 14px; line-height: 1.55;
  }
  .how li { padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); }
  .how b { color: var(--text); font-weight: 600; }
  .google {
    display: inline-flex; align-items: center; gap: 10px; margin-top: 26px;
    padding: 12px 22px; border-radius: 999px; border: 1px solid var(--line);
    background: #fff; color: #1f1f1f; font-size: 15px; font-weight: 600; text-decoration: none;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.35);
  }
  .google:hover { background: #f3f4f6; }
  .fine { margin: 14px 0 0; font-size: 12px; color: var(--muted); max-width: 30em; line-height: 1.5; }
  .err { margin: 18px 0 0; padding: 10px 14px; border-radius: 10px; background: color-mix(in srgb, var(--danger) 18%, transparent); color: var(--danger); font-size: 14px; }
  .back { margin: 30px 0 0; font-size: 13px; }
  .back a { color: var(--muted); }
</style>
