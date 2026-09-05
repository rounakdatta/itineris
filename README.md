# itineris

A travel journal you can look at from several angles at once: a map, a timeline,
a photo wall, and a full-screen story viewer — all rendering the *same* selection.

## The idea

Two primitives, different shapes in spacetime:

| | shape | examples | file |
|---|---|---|---|
| **Moment** | a point in time and space | photo, video, note | `public/data/moments.json` |
| **Track** | an interval in time, a line in space | run, ride, walk, flight | `public/data/tracks.json` |

Places, days and trips are *derived* by grouping, never stored.

Everything downstream is one pipeline:

```
facets + day  ──►  visibleMoments / visibleTracks
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
      MAP             TIMELINE         WALL / STORY
   markers+lines      scrubber          grid / full-screen
```

**One selection, three renderers.** Adding a new angle — "coffee", "swims",
"train journeys" — is a row in `FACETS` in `src/lib/data.js`, not a new screen.

Tags are **authored, never inferred**. Nothing in this repo classifies photos.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173  (viewer, demo gallery)
npm run dev -- --host   # to open it on your phone over LAN
```

The demo trip is generated, not committed: every `dev`/`build`/`test` script
first runs `scripts/make-seed.js`, which writes `seed/` (the private library,
the public projection of one demo gallery, placeholder media) deterministically
and mirrors the public half into `public/`.

## Layout

```
src/
├── lib/
│   ├── data.js            facets, colours, day/time helpers, GeoJSON builders
│   └── trip.svelte.js     the single reactive store (Svelte 5 runes)
└── components/
    ├── MapView.svelte     MapLibre — created once, never re-rendered
    ├── FacetBar.svelte    filter chips with live counts
    ├── Timeline.svelte    day chips + scrubbable strip of moments
    ├── PhotoWall.svelte   chronological grid
    └── Story.svelte       full-screen viewer: tap, hold, swipe-down
```

### Two things worth knowing

**The map is never torn down.** `MapView` is mounted once for the life of the
app. View switches overlay it rather than replacing it, and state changes push
new data into existing sources (`setData`, `flyTo`, `setFilter`). This is the
whole reason the camera survives a filter change.

**Timestamps carry their own offset.** `"2026-03-14T08:40+08:00"` — days are
derived by slicing the string, never by parsing into a `Date`. The host
timezone never enters the picture.

## Story viewer controls

| | |
|---|---|
| tap right / `→` | next |
| tap left / `←` | previous |
| hold / `space` | pause |
| swipe down / `esc` | close |

## Offline

The traveler is the person most likely to have no signal, and whoever gets a
link is often on a plane, so both apps work without one.

**Uploading in bad conditions.** Photos go into IndexedDB the moment they are
picked — with an on-device thumbnail and client-read EXIF — and show up as a
queue immediately, network or not. They upload one file per request with
exponential backoff, wake on the browser's `online` event, and can be retried by
hand. Caption, tags and galleries can be set while a photo is queued; they
arrive with it. A 401 (the tinyauth session expired) pauses the queue and asks
for a sign-in; the queue survives reloads, closed tabs and sleeping phones. The
server dedups by content hash, so a retry after a lost response is harmless.
(`admin/lib/outbox.js`)

**Viewer.** A service worker (`src/sw/`) precaches the shell, serves gallery
data network-first with the last copy as fallback — marked
`X-Itineris-Cache: fallback` and shown as *Saved copy* — and caches photos and
map tiles as you browse. **⤓ Save for offline** fetches every photo of a gallery
plus its map area (to zoom 14; Carto's round-robin tile hosts are normalized to
one cache key). The viewer is installable (`manifest.webmanifest`).

**Admin.** The same worker under `/admin/`: it opens offline with the last
library and the queue. Edits to already-uploaded photos still need the network
and fail visibly; uploads never do.

Known limits: iOS has no Background Sync, so the queue drains when the app is
opened — install it to the home screen so iOS keeps its storage. The map style,
glyphs and tiles come from Carto's CDN until PMTiles are self-hosted.

## Galleries

Uploads are **private by default**. A gallery is a curated subset — any photos,
any routes — with an **unguessable URL**: `/g/<12-char token>`. Share one link
with one group, another with another; a photo can sit in as many galleries as
you like. One gallery can be marked *home* and is what `/` shows; with no home
gallery, `/` is a landing card that lists nothing.

The public site never sees the library. The admin materialises one JSON per
gallery under `data/galleries/<token>.json` using a **whitelist** projection
(`pub()` in `server/store.js`) — uploader, filename, camera and the original's
path can't leak without someone adding them there on purpose. Media is served by
content hash, so a photo not linked from any gallery you hold is not discoverable.

Deep links: `#m/<id>` opens a story, `#wall` the wall. Opening a story pushes
one history entry, so the phone's back button closes it instead of leaving.

## Admin (uploads and tagging)

`server/` is a small Node service (Hono + sharp) that lives at `/admin/` on the
same host, behind tinyauth. It never runs in the public nginx pod: Traefik routes
`/admin` to it and everything else to nginx, and it trusts the `Remote-Email`
header tinyauth injects — a request without one did not come through the proxy
and gets a 401.

Upload a photo and it reads EXIF as raw strings (never as a `Date`), keeps the
capture time in the photo's own zone — from `OffsetTimeOriginal`, else from the
GPS position, else flagged `tz: "unknown"` — writes content-hashed WebP
derivatives (EXIF-free by construction) plus the untouched original, and appends
an **untagged** moment to `moments.json` atomically. Tagging is yours, in the UI.
Deleting a moment removes its public derivatives and keeps the original.

Everything lands under one directory (`ITINERIS_DATA_DIR`): `data/`, `media/`,
`originals/`. The public nginx mounts `data/` and `media/` from the same volume
read-only; `originals/` is never served.

```sh
npm run build:admin && npm run server   # http://localhost:8080/admin/  (set Remote-Email yourself locally)
npm run test:server                      # forges JPEGs with EXIF/GPS and exercises every route
```

## Tests

```sh
npm test               # vitest + jsdom + Testing Library: store, router, gestures, admin components
npm run test:server    # forges JPEGs with EXIF/GPS and drives every API route on a fresh, a legacy and an existing volume
npm run test:e2e       # real headless Chromium via nix: nginx + admin server + puppeteer walking the user journey, screenshots
npm run check:live     # production: install the worker, Save for offline, relaunch with the network unreachable, reopen from cache
```

CI runs the first two before building any image. The e2e needs `nix`; it
resolves Chromium and a font from nixpkgs itself (`scripts/browser.mjs`).

## Build and deploy

The image is a two-stage Dockerfile: `node:24-alpine` runs `npm run build`,
then `nginxinc/nginx-unprivileged` serves `dist/` on port 8080 as uid 101 —
non-root, read-only root filesystem, every capability dropped.
`nginx/default.conf` owns caching (fingerprinted assets are immutable, `data/`
and `media/` revalidate, the app shell is `no-cache`) and `/healthz`.

CI pushes the image to `ghcr.io/rounakdatta/itineris` and the chart in
`charts/itineris` to `oci://ghcr.io/rounakdatta/charts`, matching the
`agentfest` and `texas-fold-em` pipelines. **A `v*` tag is the release**: it
sets the chart version, the appVersion, and therefore the image the chart
deploys, in one move. Plain pushes to `main` publish `+<sha>` chart versions
for tracing. `homelab.setup` consumes the chart through a Kustomize
`helmCharts` block pinned to a version.

The chart deliberately ships no Ingress: the deployment repo owns hostnames,
TLS and whatever sits in front. For the public viewer that is nothing at all,
on purpose — it is meant to be shared.

## Not built yet

- Video (needs ffmpeg for poster frames and transcoding — a separate decision)
- Tracks: GPX upload for runs and rides; the model and the viewer already render them — and placing GPS-less photos by timestamp against a track, since phones strip location from photos picked in a browser
- Journey playback ("▶" — fly the map through the trip while photos surface)
- A Content-Security-Policy header, once it can be verified against the deployed site
- Self-hosted PMTiles, so the map needs nothing from Carto
- An edit queue for offline changes to photos already uploaded
