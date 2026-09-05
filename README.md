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
npm run dev      # http://localhost:5173
npm run dev -- --host   # to open it on your phone over LAN
```

The demo trip and its placeholder media are committed, so a fresh clone runs as
is. `npm run seed` regenerates them from `scripts/make-seed.js`.

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

- Upload path (mobile + desktop), and the tagging UI that goes with it
- Real media pipeline — `media.src` is the only field that needs repointing
- Privacy scrub for publishing: clip route starts/ends, fuzz home, strip EXIF
- Journey playback ("▶" — fly the map through the trip while photos appear)
