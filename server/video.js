// Videos: what phones record (H.264/HEVC .mp4/.mov, often rotated, sometimes
// with GPS and a local creation time in QuickTime tags) -> what every browser
// plays (H.264 .mp4 at most 1280 px, faststart, AAC) plus a poster frame that
// goes through the same 1600/960/400 tiers as a photo. ffmpeg/ffprobe do the
// work; the parsers here are pure so they can be tested without them.
import { spawn } from "node:child_process";
import tzlookup from "tz-lookup";

export const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|3gp|3g2|avi|mts|m2ts)$/i;
export const isVideo = (filename, mime) => (mime ?? "").toLowerCase().startsWith("video/") || VIDEO_EXT.test(filename ?? "");
export const MAX_VIDEO_SECONDS = +(process.env.ITINERIS_MAX_VIDEO_SECONDS ?? 180);
export const VIDEO_MAX_EDGE = 1280;

export function run(cmd, args, { input = null, timeout = 15 * 60_000, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    const out = [], err = []; let outLen = 0;
    const t = setTimeout(() => { p.kill("SIGKILL"); reject(new Error(`${cmd} timed out`)); }, timeout);
    p.stdout.on("data", (d) => { outLen += d.length; if (outLen <= maxBuffer) out.push(d); });
    p.stderr.on("data", (d) => { err.push(d); if (err.length > 200) err.shift(); });
    p.on("error", (e) => { clearTimeout(t); reject(new Error(`${cmd}: ${e.message}`)); });
    p.on("close", (code) => {
      clearTimeout(t);
      const stderr = Buffer.concat(err).toString("utf8");
      if (code !== 0) return reject(new Error(`${cmd} exited ${code}: ${stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 400)}`));
      resolve({ stdout: Buffer.concat(out), stderr });
    });
    if (input) p.stdin.end(input);
  });
}

// "+37.7619-122.4194+010.000/" (Apple) or "+01.2807+103.8504/" (Android) -> { lat, lng }
export function parseIso6709(s) {
  const m = String(s ?? "").match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

// A tag may carry several values joined by ";" (ffmpeg's use_metadata_tags does that); the first date wins.
const firstDate = (s) => String(s ?? "").split(";").map((x) => x.trim()).find((x) => x && Number.isFinite(Date.parse(x))) ?? null;

// ffprobe -show_format -show_streams JSON -> the few facts we keep.
export function parseProbe(json) {
  const streams = json?.streams ?? [], fmt = json?.format ?? {}, tags = fmt.tags ?? {};
  const v = streams.find((s) => s.codec_type === "video") ?? {};
  const rot = Math.abs(+(v.tags?.rotate ?? v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0)) % 180;
  const [w, h] = rot === 90 ? [v.height, v.width] : [v.width, v.height];
  const tag = (...keys) => { for (const k of keys) { const hit = Object.keys(tags).find((t) => t.toLowerCase() === k.toLowerCase()); if (hit && tags[hit]) return String(tags[hit]); } return null; };
  return {
    duration: Number.isFinite(+fmt.duration) ? +(+fmt.duration).toFixed(2) : Number.isFinite(+v.duration) ? +(+v.duration).toFixed(2) : null,
    width: Number.isFinite(+w) ? +w : null, height: Number.isFinite(+h) ? +h : null,
    codec: v.codec_name ?? null,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
    creationTime: firstDate(tag("creation_time")) ?? firstDate(v.tags?.creation_time),   // UTC, e.g. 2026-03-14T00:40:12.000000Z
    localCreation: tag("com.apple.quicktime.creationdate"),               // local with offset, e.g. 2026-03-14T08:40:12+0800
    gps: parseIso6709(tag("com.apple.quicktime.location.ISO6709", "location", "location-eng")),
  };
}

const pad = (n) => String(n).padStart(2, "0");
const fmtOffset = (min) => `${min < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(min) / 60))}:${pad(Math.abs(min) % 60)}`;
// A UTC instant as local wall-clock in `zone`, plus that zone's offset then.
export function utcToLocal(utcMs, zone) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const wall = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  const offsetMin = Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs) / 60000);
  return `${wall}${fmtOffset(offsetMin)}`;
}

// When the video was shot, in its own local time:
//   QuickTime's creationdate (local, with offset) -> as is;
//   else creation_time (UTC) in the zone of its GPS position;
//   else creation_time as UTC, flagged unknown. Nothing -> null (the caller
//   falls back to the upload moment).
export function videoTime(probe) {
  const local = probe.localCreation?.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-])(\d{2}):?(\d{2})$/);
  if (local) return { t: `${local[1]}${local[2]}${local[3]}:${local[4]}`, tz: "video" };
  const utcMs = probe.creationTime ? Date.parse(probe.creationTime) : NaN;
  if (!Number.isFinite(utcMs) || utcMs < Date.UTC(1990, 0, 1)) return null;   // cameras that never set a clock write 1904/1970
  if (probe.gps) { try { return { t: utcToLocal(utcMs, tzlookup(probe.gps.lat, probe.gps.lng)), tz: "gps" }; } catch { /* no zone */ } }
  return { t: utcToLocal(utcMs, "UTC"), tz: "unknown" };
}

export async function probe(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeout: 60_000 });
  return parseProbe(JSON.parse(stdout.toString("utf8")));
}

// One frame as PNG (a second in, or the first frame of a very short clip).
export async function posterFrame(file, duration) {
  const at = duration && duration > 1.5 ? 1 : 0;
  const { stdout } = await run("ffmpeg", ["-v", "error", "-ss", String(at), "-i", file, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], { timeout: 120_000 });
  if (!stdout.length) throw new Error("could not extract a poster frame");
  return stdout;
}

// H.264 + AAC .mp4, longest edge <= maxEdge, even dimensions, rotation baked
// in, moov atom first so playback starts before the download ends. Niced and
// limited to two threads: this shares a small box with everything else.
export async function transcode(file, out, { maxEdge = VIDEO_MAX_EDGE } = {}) {
  const vf = `scale='if(gte(iw,ih),min(${maxEdge},iw),-2)':'if(gte(iw,ih),-2,min(${maxEdge},ih))',format=yuv420p`;
  const args = ["-v", "error", "-y", "-i", file, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-profile:v", "high", "-level", "4.1",
    "-movflags", "+faststart", "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-threads", "2", out];
  try { await run("nice", ["-n", "10", "ffmpeg", ...args]); }
  catch (e) { if (/^nice: /.test(e.message)) await run("ffmpeg", args); else throw e; }
}
