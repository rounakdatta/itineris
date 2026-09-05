// Small, explicit fixtures: two days, a mix of tags, one moment without GPS.
export const moments = [
  { id: "a", t: "2026-03-14T08:40:00+08:00", lat: 1.28, lng: 103.84, place: "Chinatown", caption: "Kaya toast", tags: ["food"], media: { type: "photo", src: "media/a.webp", w: 1080, h: 1920, thumb: "media/a-t.webp" } },
  { id: "b", t: "2026-03-14T12:10:00+08:00", lat: 1.2803, lng: 103.8449, place: "Maxwell", caption: "Chicken rice", tags: ["food"], media: { type: "photo", src: "media/b.webp", w: 1920, h: 1080 } },
  { id: "c", t: "2026-03-15T06:35:00+08:00", lat: 1.2868, lng: 103.8545, place: "Merlion", caption: "Sunrise run", tags: ["run"], media: { type: "photo", src: "media/c.webp", w: 1080, h: 1920 } },
  { id: "d", t: "2026-03-15T19:50:00+08:00", lat: null, lng: null, place: "", caption: "", tags: [], media: { type: "photo", src: "media/d.webp", w: 1080, h: 1920 } },
];
export const tracks = [
  { id: "t1", mode: "run", name: "Bay loop", t0: "2026-03-15T06:30:00+08:00", t1: "2026-03-15T07:18:00+08:00", stats: {}, geometry: [[103.85, 1.28], [103.86, 1.29]] },
  { id: "t2", mode: "cycle", name: "East Coast", t0: "2026-03-16T07:00:00+08:00", t1: "2026-03-16T09:40:00+08:00", stats: {}, geometry: [[103.91, 1.30], [103.99, 1.36]] },
];
