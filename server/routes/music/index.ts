import { Router, type Request, type Response } from "express";
import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

const TICKET_TTL_SECONDS = 60 * 60 * 2;
const TICKET_SECRET = process.env.MUSIC_TICKET_SECRET || crypto.randomBytes(32).toString("hex");
const TIDAL_COUNTRY = (process.env.TIDAL_COUNTRY || "US").toUpperCase();
const TIDAL_CLIENT_ID = process.env.TIDAL_CLIENT_ID || "";
const TIDAL_ACCOUNT_TOKEN = process.env.TIDAL_ACCOUNT_TOKEN || "";

const YTDLP_CANDIDATES = [
  process.env.YTDLP_PATH || "",
  "yt-dlp",
  path.join(os.homedir(), ".local", "bin", "yt-dlp")
].filter(Boolean);

const FFMPEG_CANDIDATES = [
  process.env.FFMPEG_PATH || "",
  "ffmpeg",
  path.join(os.homedir(), ".local", "bin", "ffmpeg")
].filter(Boolean);

const AUDIO_CACHE_DIR = path.join(os.tmpdir(), "sigma-music-cache");
const AUDIO_CACHE_TTL = 90 * 60_000;

// YouTube refuses datacenter addresses, so allow a cookies file or a proxy to be supplied.
const YTDLP_COOKIES = process.env.YTDLP_COOKIES || "";
const YTDLP_PROXY = process.env.YTDLP_PROXY || "";

// Solving YouTube's signature/n challenges needs a JavaScript runtime. The Node
// binary running this server is the obvious one, no extra install required.
const JS_RUNTIME =
  process.env.YTDLP_JS_RUNTIME ||
  (process.execPath && fs.existsSync(process.execPath) ? `node:${process.execPath}` : "");

function cookiesReport() {
  if (!YTDLP_COOKIES) return { active: false, file: null, reason: "YTDLP_COOKIES is not set" };
  const file = path.resolve(YTDLP_COOKIES);
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { active: false, file, reason: "cookies file is missing or unreadable" };
  }

  const lines = raw.split("\n").filter((line) => line.trim() && !line.startsWith("#"));
  const entries = lines.map((line) => line.split("\t"));
  const names = new Set(entries.map((parts) => parts[5]).filter(Boolean));
  const signedIn = names.has("SID") || names.has("__Secure-1PSID") || names.has("__Secure-3PSID");
  const expires = entries
    .filter((parts) => ["SID", "HSID", "__Secure-1PSID", "__Secure-3PSID"].includes(parts[5] || ""))
    .map((parts) => Number(parts[4]))
    .filter((value) => Number.isFinite(value) && value > 0);
  const expiresAt = expires.length ? Math.min(...expires) : 0;

  return {
    active: signedIn,
    file,
    entries: lines.length,
    signedIn,
    expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
    reason: signedIn ? null : "cookies file has no YouTube login (exported while signed out?)"
  };
}

function proxyReport() {
  if (!YTDLP_PROXY) return { active: false, host: null, reason: "YTDLP_PROXY is not set" };
  try {
    const parsed = new URL(YTDLP_PROXY);
    return { active: true, host: `${parsed.protocol}//${parsed.host}`, reason: null };
  } catch {
    return { active: true, host: "(unparsable value)", reason: "proxy value is not a valid URL" };
  }
}

function ytdlpFlags(): string[] {
  const flags = ["--no-warnings"];
  if (YTDLP_COOKIES && fs.existsSync(path.resolve(YTDLP_COOKIES))) flags.push("--cookies", path.resolve(YTDLP_COOKIES));
  if (YTDLP_PROXY) flags.push("--proxy", YTDLP_PROXY);
  if (JS_RUNTIME) flags.push("--js-runtimes", JS_RUNTIME);
  return flags;
}

const SOURCES = ["tidal", "ytm", "scdlp"] as const;
type Source = (typeof SOURCES)[number];

interface Song {
  id: string;
  rawId: string;
  name: string;
  artist: string;
  album: string;
  pic?: string;
  duration: number;
  formattedDuration: string;
  source: Source;
  ref?: string;
  previewUrl?: string;
  isVerified: boolean;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function readSource(value: unknown): Source {
  const source = String(value || "").toLowerCase();
  return (SOURCES as readonly string[]).includes(source) ? (source as Source) : "ytm";
}

/* ---------------------------------------------------------------- cache -- */

const cache = new Map<string, { at: number; ttl: number; value: unknown }>();

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value as T;

  const value = await load();
  cache.set(key, { at: Date.now(), ttl, value });

  if (cache.size > 400) {
    for (const [entryKey, entry] of cache) {
      if (Date.now() - entry.at > entry.ttl) cache.delete(entryKey);
    }
  }
  return value;
}

/* ---------------------------------------------------------------- yt-dlp -- */

let resolvedYtdlp: string | null | undefined;

async function ytdlpBinary(): Promise<string | null> {
  if (resolvedYtdlp !== undefined) return resolvedYtdlp;

  for (const candidate of YTDLP_CANDIDATES) {
    const ok = await new Promise<boolean>((resolve) => {
      execFile(candidate, ["--version"], { timeout: 10_000 }, (error) => resolve(!error));
    });
    if (ok) {
      resolvedYtdlp = candidate;
      return candidate;
    }
  }
  resolvedYtdlp = null;
  return null;
}

function runYtdlp(binary: string, args: string[], timeout = 45_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { timeout, maxBuffer: 24 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(String(stdout));
      }
    );
  });
}

async function ytdlpJson(searchTarget: string): Promise<any[]> {
  const binary = await ytdlpBinary();
  if (!binary) throw new Error("yt-dlp is not installed");

  const raw = await runYtdlp(binary, ["-J", "--flat-playlist", ...ytdlpFlags(), searchTarget]);
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed?.entries) ? parsed.entries : [];
}

let resolvedFfmpeg: string | null | undefined;

async function ffmpegBinary(): Promise<string | null> {
  if (resolvedFfmpeg !== undefined) return resolvedFfmpeg;

  for (const candidate of FFMPEG_CANDIDATES) {
    const ok = await new Promise<boolean>((resolve) => {
      execFile(candidate, ["-version"], { timeout: 10_000 }, (error) => resolve(!error));
    });
    if (ok) {
      resolvedFfmpeg = candidate;
      return candidate;
    }
  }
  resolvedFfmpeg = null;
  return null;
}

interface CachedAudio {
  file: string;
  contentType: string;
}

const audioFileCache = new Map<string, { at: number; value: CachedAudio }>();
const audioDownloads = new Map<string, Promise<CachedAudio>>();

const CONTENT_TYPES: Record<string, string> = {
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".webm": "audio/webm",
  ".opus": "audio/ogg",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac",
  ".flac": "audio/flac"
};

async function pruneAudioCache(): Promise<void> {
  const fs = await import("fs/promises");
  const entries = await fs.readdir(AUDIO_CACHE_DIR).catch(() => [] as string[]);
  const now = Date.now();

  await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(AUDIO_CACHE_DIR, entry);
      const stat = await fs.stat(full).catch(() => null);
      if (stat && now - stat.mtimeMs > AUDIO_CACHE_TTL) {
        await fs.rm(full, { force: true }).catch(() => undefined);
      }
    })
  );
}

function audioCacheKey(target: string): string {
  return crypto.createHash("sha1").update(target).digest("hex").slice(0, 24);
}

async function downloadAudio(target: string): Promise<CachedAudio> {
  const key = audioCacheKey(target);
  const hit = audioFileCache.get(key);
  if (hit && Date.now() - hit.at < AUDIO_CACHE_TTL) return hit.value;

  const pending = audioDownloads.get(key);
  if (pending) return pending;

  const job = (async (): Promise<CachedAudio> => {
    const binary = await ytdlpBinary();
    if (!binary) throw new Error("yt-dlp is not installed");

    const fs = await import("fs/promises");
    await fs.mkdir(AUDIO_CACHE_DIR, { recursive: true });
    void pruneAudioCache();

    const ffmpeg = await ffmpegBinary();
    const output = path.join(AUDIO_CACHE_DIR, `${key}.%(ext)s`);

    await runYtdlp(
      binary,
      [
        "-f",
        "bestaudio/best",
        ...ytdlpFlags(),
        "--no-playlist",
        ...(ffmpeg && path.isAbsolute(ffmpeg) ? ["--ffmpeg-location", path.dirname(ffmpeg)] : []),
        "-o",
        output,
        target
      ],
      240_000
    );

    const produced = (await fs.readdir(AUDIO_CACHE_DIR))
      .filter((entry) => entry.startsWith(`${key}.`))
      .map((entry) => path.join(AUDIO_CACHE_DIR, entry))
      .sort()[0];

    if (!produced) throw new Error("audio was not produced");

    const value: CachedAudio = {
      file: produced,
      contentType: CONTENT_TYPES[path.extname(produced).toLowerCase()] || "audio/mpeg"
    };
    audioFileCache.set(key, { at: Date.now(), value });
    return value;
  })();

  audioDownloads.set(key, job);
  try {
    return await job;
  } finally {
    audioDownloads.delete(key);
  }
}

async function youtubeMatch(name: string, artist = ""): Promise<{ kind: "url" | "file"; value: string } | null> {
  for (const query of matchQueries(name, artist)) {
    try {
      const entries = await ytdlpJson(`ytsearch1:${query}`);
      const song = youtubeSong(entries[0]);
      if (!song) continue;
      return await resolveUpstream(`https://www.youtube.com/watch?v=${song.rawId}`);
    } catch {
      /* try the next, shorter query */
    }
  }
  return null;
}

function cleanMatchQuery(value: string): string {
  return value
    .replace(/\((?:[^)]*)\)|\[(?:[^\]]*)\]/g, " ")
    .replace(/\b(official|audio|video|lyrics?|visuali[sz]er|hd|hq|4k|mv|remaster(ed)?|explicit)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function describeFailure(error: unknown): string {
  const text = String(error);
  if (/drm protected/i.test(text)) return "that upload is DRM protected";
  if (/sign in to confirm|not a bot|cookies/i.test(text)) return "the source blocks this server";
  if (/not installed/i.test(text)) return "yt-dlp is not installed here";
  if (/timed? ?out|ETIMEDOUT/i.test(text)) return "the source timed out";
  if (/private video|unavailable|removed|not available/i.test(text)) return "that upload is gone";
  return "the source did not return audio";
}

function matchQueries(name: string, artist = ""): string[] {
  const attempts = [
    cleanMatchQuery(`${artist} ${name}`),
    cleanMatchQuery(name.split(/\s+/).slice(0, 8).join(" ")),
    cleanMatchQuery(name)
  ];
  return [...new Set(attempts.filter((query) => query.length > 2))];
}

// Last resort: Deezer hands out 30 second previews with no key at all.
async function deezerPreview(name: string, artist = ""): Promise<{ kind: "url" | "file"; value: string } | null> {
  for (const query of matchQueries(name, artist).slice(0, 2)) {
    try {
      const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=5`);
      if (!res.ok) continue;
      const data = await res.json().catch(() => ({}));
      const hit = (Array.isArray(data?.data) ? data.data : []).find((item: any) => typeof item?.preview === "string" && item.preview);
      if (hit?.preview) return { kind: "url", value: hit.preview };
    } catch {
      /* try the next query */
    }
  }
  return null;
}

function normalizeWords(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 2);
}

// Lower is better. Sharing the title matters far more than an exact length match;
// a different mix with the right name still beats a shorter, unrelated upload.
function matchScore(candidate: Song, name: string, duration: number): number {
  const wanted = normalizeWords(name);
  const present = new Set(normalizeWords(candidate.name));
  const overlap = wanted.length ? wanted.filter((word) => present.has(word)).length / wanted.length : 0;
  const drift =
    duration > 0 && candidate.duration > 0
      ? Math.abs(candidate.duration - duration) / Math.max(duration, 1)
      : 0;
  return (1 - overlap) * 10 + Math.min(drift, 1) * 6;
}

async function soundcloudFallback(
  name: string,
  artist = "",
  duration = 0
): Promise<{ kind: "url" | "file"; value: string } | null> {
  for (const query of matchQueries(name, artist)) {
    try {
      const entries = await ytdlpJson(`scsearch10:${query}`);
      const candidates = entries
        .map(soundcloudSong)
        .filter((song: Song | null): song is Song => Boolean(song?.ref))
        .filter((song) => song.duration > 20 && song.duration <= 900)
        .map((song) => ({ song, score: matchScore(song, name, duration) }))
        .sort((a, b) => a.score - b.score);

      const best = candidates[0];
      if (!best?.song.ref) continue;

      // A wildly different length means the upload is a different version, not this song.
      if (duration && best.song.duration && Math.abs(best.song.duration - duration) > Math.max(15, duration * 0.25)) {
        continue;
      }
      if (best.score > 9.5) continue;

      return await resolveUpstream(best.song.ref);
    } catch {
      /* try the next, shorter query */
    }
  }
  return null;
}

async function resolveUpstream(target: string): Promise<{ kind: "url" | "file"; value: string }> {
  // googlevideo links are tied to the downloader that asked for them and answer
  // 403 to a plain fetch, so YouTube audio is always pulled down into the cache.
  if (!/youtube\.com|youtu\.be/i.test(target)) {
    try {
      const binary = await ytdlpBinary();
      if (!binary) throw new Error("yt-dlp is not installed");

      const raw = await runYtdlp(binary, ["-g", "-f", "bestaudio/best", ...ytdlpFlags(), target]);
      const url = raw.split("\n").map((line) => line.trim()).find((line) => line.startsWith("http"));

      if (url && !url.includes("m3u8")) return { kind: "url", value: url };
    } catch {
      /* fall through to a cached download */
    }
  }

  const audio = await downloadAudio(target);
  return { kind: "file", value: audio.file };
}

/* -------------------------------------------------------------- tickets -- */

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signTicket(expiresAt: number): string {
  const payload = base64Url(Buffer.from(JSON.stringify({ exp: expiresAt })));
  const signature = base64Url(crypto.createHmac("sha256", TICKET_SECRET).update(payload).digest());
  return `${payload}.${signature}`;
}

function readTicket(token: unknown): boolean {
  if (typeof token !== "string" || !token.includes(".")) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expected = base64Url(crypto.createHmac("sha256", TICKET_SECRET).update(payload).digest());
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof decoded.exp === "number" && decoded.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ catalogue -- */

function tidalCover(cover: unknown, size = "640x640"): string | undefined {
  if (typeof cover !== "string" || !cover) return undefined;
  return `https://resources.tidal.com/images/${cover.split("-").join("/")}/${size}.jpg`;
}

async function tidalSearch(query: string, limit: number, offset: number): Promise<Song[]> {
  if (!TIDAL_CLIENT_ID) throw new Error("TIDAL_CLIENT_ID is not set");

  const url =
    `https://api.tidal.com/v1/search/tracks?query=${encodeURIComponent(query)}` +
    `&limit=${limit}&offset=${offset}&countryCode=${TIDAL_COUNTRY}`;

  const res = await fetch(url, { headers: { "X-Tidal-Token": TIDAL_CLIENT_ID } });
  if (!res.ok) throw new Error(`tidal ${res.status}`);

  const data = await res.json().catch(() => ({}));
  return (Array.isArray(data?.items) ? data.items : []).map((item: any) => ({
    id: `tidal_${item.id}`,
    rawId: String(item.id),
    name: item.title || "Untitled",
    artist: item.artist?.name || "Tidal",
    album: item.album?.title || "Tidal",
    pic: tidalCover(item.album?.cover),
    duration: item.duration || 0,
    formattedDuration: formatDuration(item.duration || 0),
    source: "tidal" as const,
    previewUrl: typeof item.preview === "string" ? item.preview : undefined,
    isVerified: true
  }));
}

function youtubeSong(entry: any): Song | null {
  const rawId = String(entry?.id || "");
  if (!/^[\w-]{6,20}$/.test(rawId)) return null;
  // Hour-long compilations are not songs and take forever to resolve.
  if (Math.round(entry?.duration || 0) > 3600) return null;

  const thumbnails: any[] = Array.isArray(entry.thumbnails) ? entry.thumbnails : [];
  const pic = thumbnails.length ? thumbnails[thumbnails.length - 1]?.url : undefined;

  return {
    id: `ytm_${rawId}`,
    rawId,
    name: entry.title || "Untitled",
    artist: entry.uploader || entry.channel || "YouTube",
    album: "YouTube",
    pic,
    duration: Math.round(entry.duration || 0),
    formattedDuration: formatDuration(Math.round(entry.duration || 0)),
    source: "ytm",
    isVerified: true
  };
}

function soundcloudSong(entry: any): Song | null {
  const ref = typeof entry?.url === "string" ? entry.url : "";
  if (!ref.includes("api.soundcloud.com/tracks/")) return null;

  const duration = Math.round(entry.duration || 0);
  const thumbnails: any[] = Array.isArray(entry.thumbnails) ? entry.thumbnails : [];
  const pic = thumbnails.length ? thumbnails[thumbnails.length - 1]?.url : undefined;

  return {
    id: `scdlp_${String(entry.id)}`,
    rawId: String(entry.id),
    name: entry.title || "Untitled",
    artist: entry.uploader || "SoundCloud",
    album: "SoundCloud",
    pic,
    duration,
    formattedDuration: formatDuration(duration),
    source: "scdlp",
    ref,
    isVerified: true
  };
}

async function searchCatalogue(source: Source, query: string, limit: number, offset: number): Promise<Song[]> {
  const trimmed = query.trim() || "top hits";
  const key = `${source}:${trimmed.toLowerCase()}:${limit}:${offset}`;

  return cached(key, 120_000, async () => {
    if (source === "tidal") return tidalSearch(trimmed, limit, offset);

    const target = `${source === "scdlp" ? "scsearch" : "ytsearch"}${limit + offset}:${trimmed}`;
    let entries: any[];
    try {
      entries = await ytdlpJson(target);
    } catch (error) {
      // yt-dlp search gets rate limited now and then; one quiet retry usually clears it.
      await new Promise((resolve) => setTimeout(resolve, 600));
      entries = await ytdlpJson(target);
    }
    const mapper = source === "scdlp" ? soundcloudSong : youtubeSong;

    return entries
      .map(mapper)
      .filter((song: Song | null): song is Song => Boolean(song))
      .slice(offset, offset + limit);
  });
}

const BROWSE_ROWS: Array<{ key: string; query: string }> = [
  { key: "hits", query: "top hits 2026" },
  { key: "electronic", query: "electronic music mix" },
  { key: "hiphop", query: "hip hop hits" },
  { key: "house", query: "house music" },
  { key: "chill", query: "lofi chill beats" }
];

async function browseRows(): Promise<Record<string, Song[]>> {
  return cached("browse", 600_000, async () => {
    const results = await Promise.all(
      BROWSE_ROWS.map(async (row) => {
        try {
          return [row.key, await searchCatalogue("ytm", row.query, 15, 0)] as const;
        } catch {
          return [row.key, [] as Song[]] as const;
        }
      })
    );
    return Object.fromEntries(results);
  });
}

/* --------------------------------------------------------------- router -- */

const musicRouter = Router();

musicRouter.get("/ping", async (_req: Request, res: Response) => {
  const binary = await ytdlpBinary();
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    sources: SOURCES,
    ytdlp: binary ? path.basename(binary) : null,
    ffmpeg: (await ffmpegBinary()) ? path.basename((await ffmpegBinary()) as string) : null,
    cookies: cookiesReport(),
    proxy: proxyReport(),
    jsRuntime: JS_RUNTIME || null,
    youtube: {
      // Full YouTube audio needs a trusted address or an account; without either only previews play.
      mode: YTDLP_COOKIES && YTDLP_PROXY ? "cookies+proxy" : YTDLP_COOKIES ? "cookies" : YTDLP_PROXY ? "proxy" : "blocked-ip-fallbacks-only"
    },
    tidal: Boolean(TIDAL_CLIENT_ID)
  });
});

musicRouter.get("/ticket", (_req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  const expiresAt = Math.floor(Date.now() / 1000) + TICKET_TTL_SECONDS;
  res.json({ ticket: signTicket(expiresAt), expiresIn: TICKET_TTL_SECONDS });
});

musicRouter.get("/search", async (req: Request, res: Response) => {
  const query = String(req.query.q ?? req.query.keyword ?? "");
  const source = readSource(req.query.source);
  const limit = clamp(req.query.limit, 1, 50, 30);
  const page = clamp(req.query.page, 1, 100, 1);

  try {
    const songs = await searchCatalogue(source, query, limit, (page - 1) * limit);
    res.json({ songs, items: songs, total: songs.length, source, page });
  } catch (error) {
    // Keep the page usable: an unavailable source is an empty list with a reason, not a hard failure.
    res.json({ songs: [], items: [], total: 0, source, page, error: String(error) });
  }
});

musicRouter.get("/browse", async (_req: Request, res: Response) => {
  try {
    const rows = await browseRows();
    res.json({ rows, albums: [], artists: [] });
  } catch (error) {
    res.status(502).json({ rows: {}, albums: [], artists: [], error: String(error) });
  }
});

musicRouter.get("/stream", async (req: Request, res: Response) => {
  if (!readTicket(req.query.k)) {
    res.status(401).json({ error: "ticket required" });
    return;
  }

  const source = readSource(req.query.source);
  const rawId = String(req.query.id ?? "").replace(/^(tidal|ytm|scdlp)_/, "");

  const name = String(req.query.name ?? "").slice(0, 120);
  const artist = String(req.query.artist ?? "").slice(0, 120);
  const trackDuration = Number(req.query.duration) || 0;

  let target = "";
  try {
    if (source === "ytm") {
      if (!/^[\w-]{6,20}$/.test(rawId)) {
        res.status(400).json({ error: "bad track id" });
        return;
      }
      target = `https://www.youtube.com/watch?v=${rawId}`;
    } else if (source === "scdlp") {
      const ref = String(req.query.ref ?? "");
      if (!/^https:\/\/api\.soundcloud\.com\/tracks\/[\w:%-]+$/.test(ref)) {
        res.status(400).json({ error: "bad soundcloud reference" });
        return;
      }
      target = ref;
    } else {
      // Tidal is a catalogue: audio for its tracks is matched on another source.
      const preview = String(req.query.preview ?? "");
      target = /^https:\/\/[a-z0-9.-]*tidal\.com\//.test(preview) ? preview : "";
    }
  } catch {
    res.status(400).json({ error: "bad request" });
    return;
  }

  try {
    let upstream: { kind: "url" | "file"; value: string } | null = null;

    if (source === "tidal") {
      upstream =
        (target ? await resolveUpstream(target).catch(() => null) : null) ??
        (await youtubeMatch(name, artist)) ??
        (await soundcloudFallback(name, artist, trackDuration)) ??
        (await deezerPreview(name, artist));

      if (!upstream) {
        res.status(424).json({ error: "no audio match for this track" });
        return;
      }
      res.set("X-Music-Match", "external");
    } else {
      try {
        // A two hour radio mix has no sensible single-file match; fail fast instead of downloading it.
        if (source === "ytm" && trackDuration > 900) {
          res.status(424).json({ error: "that upload is too long to stream" });
          return;
        }
        upstream = await resolveUpstream(target);
      } catch (error) {
        // YouTube is blocked on plenty of hosts, so borrow the same song from elsewhere.
        if (source === "ytm") {
          const fallback =
            (await soundcloudFallback(name, artist, trackDuration)) ?? (await deezerPreview(name, artist));
          if (!fallback) {
            const hint =
              !YTDLP_COOKIES && !YTDLP_PROXY
                ? " (this server has no YouTube cookies or proxy configured)"
                : "";
            res.status(424).json({ error: `${describeFailure(error)}, and no match was found elsewhere${hint}` });
            return;
          }
          res.set("X-Music-Fallback", fallback.value.includes("dzcdn") ? "deezer-preview" : "soundcloud");
          upstream = fallback;
        } else if (source === "scdlp") {
          const fallback = await deezerPreview(name, artist);
          if (!fallback) throw error;
          res.set("X-Music-Fallback", "deezer-preview");
          upstream = fallback;
        } else {
          throw error;
        }
      }
    }

    if (upstream.kind === "file") {
      res.set("Content-Type", CONTENT_TYPES[path.extname(upstream.value).toLowerCase()] || "audio/mpeg");
      res.sendFile(upstream.value, { acceptRanges: true });
      return;
    }

    await proxyAudio(upstream.value, req, res);
  } catch (error) {
    res.status(424).json({ error: describeFailure(error) });
  }
});

async function proxyAudio(upstream: string, req: Request, res: Response): Promise<void> {
  try {
    const range = req.headers.range;
    const upstreamRes = await fetch(upstream, range ? { headers: { Range: range } } : undefined);
    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      res.status(upstreamRes.status === 404 ? 404 : 502).json({ error: "audio unavailable" });
      return;
    }

    res.status(upstreamRes.status);
    res.set("Content-Type", upstreamRes.headers.get("content-type") || "audio/mpeg");
    res.set("Accept-Ranges", "bytes");
    const length = upstreamRes.headers.get("content-length");
    const contentRange = upstreamRes.headers.get("content-range");
    if (length) res.set("Content-Length", length);
    if (contentRange) res.set("Content-Range", contentRange);

    if (!upstreamRes.body) {
      res.end();
      return;
    }
    // An upstream that drops mid-stream must not take the whole server with it.
    await pipeline(Readable.fromWeb(upstreamRes.body as any), res).catch(() => {
      if (!res.writableEnded) res.destroy();
    });
  } catch {
    if (!res.headersSent) {
      res.status(502).json({ error: "audio unavailable" });
    } else if (!res.writableEnded) {
      res.destroy();
    }
  }
}

export default musicRouter;
