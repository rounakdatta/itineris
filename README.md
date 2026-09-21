<div align="center">
  <img src="brand/itineris-mark.png" alt="itineris logo" width="200">
</div>

# itineris

A travel journal that lives on a map. Photos and videos become pins where they
were taken, a pin opens as a story, and a gallery is shared by link — so the
viewer is deliberately public and only `/creator` asks who you are. Sign in
with Google and the journal is yours. Live at
[itineris.taptappers.club](https://itineris.taptappers.club).

## How broad it is

- **The map is the interface** — Google Maps, one photo pin per place, its rating on the pin, a story ring that opens it.
- **Stories per place** — a place's photos play together, then the map travels to the next pin.
- **Captions on the photo** — up to five, dragged anywhere, tilted to any angle, in twelve faces.
- **Videos** — transcoded to H.264 with a poster frame.
- **Offline** — whatever you looked at reopens without a signal.
- **Uploads that survive bad networks** — a queue in IndexedDB, with retries.
- **Anyone can make their own** — Google sign-in at `/creator`, one journal per person on one volume.

## How to navigate

- `src/` — the viewer: map, strip, story, service worker.
- `admin/` — the upload and tagging app, served at `/creator`.
- `server/` — its API, sign-in, media ingest, Google Places, and the caption model both apps share.
- `charts/itineris/` — the Helm chart. `brand/` — the mark every icon comes from.

## Going ahead and using it

```bash
npm install
npm run dev          # viewer on :5173  (add -- --host for a phone on the LAN)
npm run dev:admin    # the creator app; npm run server for its API
```

Without `ITINERIS_GOOGLE_CLIENT_ID` and `ITINERIS_GOOGLE_CLIENT_SECRET` the
server has no Google client, so it falls back to trusting a `Remote-Email`
header from an authenticating proxy — which is how it ran before 0.21, and how
the tests drive it. Set both and it runs the sign-in itself and stops believing
that header, because a deployment must be one or the other and never quietly
both. The redirect URI to register is `<your site>/creator/auth/callback`.

The demo trip is generated, not committed: `dev`, `build` and `test` all run
`scripts/make-seed.js` first.

```bash
npm test             # vitest + jsdom
npm run test:server  # the API, on a fresh, a legacy and an existing volume
npm run test:e2e     # real headless Chromium via nix, with screenshots
npm run check:live   # production, then again with the network unreachable
```

## How it ships

A `v*` tag is the release: it sets the chart version, the appVersion and the
image the chart deploys, in one move. CI pushes two images and the chart to
GHCR; `homelab.setup` pins the chart version.

## What else

- Phones strip GPS from photos handed to a website, so pictures picked on a phone arrive unplaced — the creator app can place a whole selection at once.
- One volume, many journals: `users/<uid>/` per person, `media/<uid>/` for their derivatives, and a gallery token that is global so `/g/<token>` means the same thing whoever made it. The single-tenant library from before 0.21 belongs to whoever signs in first.
- The Maps key reaches the browser via `/config.json`, mounted by the chart. Place details are looked up server-side, once per place.
- Caption faces are bundled: SIL OFL 1.1, except Permanent Marker (Apache 2.0). Licences in `src/assets/fonts/`.

---

Everything hangs off a pin: a photo without a place is a photo, and a photo
with one is somewhere you went.
