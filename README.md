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
- **Photos that belong nowhere** — no pin to put them on, so the mark carries them, wearing the ring that turns until they have been watched.
- **Pinch to zoom** — two fingers on a photo or a video; while it is zoomed a drag pans and the story waits.
- **Every shape of picture** — a photo is shown whole rather than cropped whenever filling the frame would throw away more than a quarter of it, so a square collage keeps its four corners.
- **Captions on the photo** — up to five, dragged anywhere, tilted to any angle, in twelve faces.
- **A gallery's own name in the URL** — `/singaporeeats` as well as `/g/<token>`, and the token keeps working forever.
- **The walk between places** — opt-in per gallery: a dotted thread from each stop to the next, following the streets, with how far the walk actually was.
- **How many looked at each photo** — a small eye at the foot of the story, counted once per visitor per photo per day, storing nothing that could identify anybody. The creator's library marks the best-watched picture.
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
npm run test:pinch   # two-finger input through the browser's own touch pipeline
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
- The viewer and the creator are one origin in production: Traefik path-routes `/creator` to the creator pod, and nginx never sees it. The viewer relies on that to record a view, so a local harness has to reproduce the routing or it is testing a layout that exists nowhere.
- A view stores a salted hash of address, browser, gallery (or photo) and date — nothing that can be walked back to a person, matched across galleries, or that means anything after midnight. Only the totals are ever served.
- Walking routes come from Google's **Routes API**, server-side, once per pair of points, cached on the volume and published with the gallery — a viewer opening a gallery costs nothing. The LEGACY Directions API is not enabled on this project and will not be; Google's own refusal of it says to use Routes. Until a hop has been routed its leg draws straight and carries **no** distance: the gap between two points is displacement, not distance, and on a street grid the real walk is routinely a third longer.
- The thread is deep amber with a light casing, and the colour is measured rather than chosen: it shipped white once and scored a contrast ratio of 1.1 against Google's real tiles — not faint, absent. `tests/route.test.js` holds samples of both basemaps and fails anything below 3.0 on any of them.
- Caption faces are bundled: SIL OFL 1.1, except Permanent Marker (Apache 2.0). Licences in `src/assets/fonts/`.

---

Everything hangs off a pin: a photo without a place is a photo, and a photo
with one is somewhere you went.
