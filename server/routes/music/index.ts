import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { Readable } from "stream";

const APP_NAME = "SigmaGames";
const AUDIUS = "https://api.audius.co/v1";
const ITUNES = "https://itunes.apple.com";
const TICKET_TTL_SECONDS = 60 * 60 * 2;
const TICKET_SECRET = process.env.MUSIC_TICKET_SECRET || crypto.randomBytes(32).toString("hex");

type Source = "audius" | "apple";

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
  previewUrl?: string;
  isVerified: boolean;
}

const ALLOWED_PREVIEW_HOST = /^audio-ssl\.itunes\.apple\.com$/;

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

function audiusSong(track: any): Song | null {
  if (!track || track.is_delete || track.is_streamable === false) return null;
  const artwork = track.artwork || {};
  return {
    id: `audius_${track.id}`,
    rawId: String(track.id),
    name: track.title || "Untitled",
    artist: track.user?.name || "Audius",
    album: track.genre || "Audius",
    pic: artwork["480x480"] || artwork["150x150"] || artwork["1000x1000"],
    duration: track.duration || 0,
    formattedDuration: formatDuration(track.duration || 0),
    source: "audius",
    isVerified: true
  };
}

async function audiusTracks(path: string): Promise<Song[]> {
  const res = await fetch(`${AUDIUS}${path}`);
  if (!res.ok) throw new Error(`audius ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return (Array.isArray(data?.data) ? data.data : [])
    .map(audiusSong)
    .filter((song: Song | null): song is Song => Boolean(song));
}

function appleSong(item: any): Song | null {
  if (!item || !item.trackId || !item.previewUrl) return null;
  const duration = Math.round((item.trackTimeMillis || 0) / 1000);
  return {
    id: `apple_${item.trackId}`,
    rawId: String(item.trackId),
    name: item.trackName || "Untitled",
    artist: item.artistName || "Unknown Artist",
    album: item.collectionName || "Apple Music",
    pic: typeof item.artworkUrl100 === "string" ? item.artworkUrl100.replace("100x100", "600x600") : undefined,
    duration,
    formattedDuration: formatDuration(duration),
    source: "apple",
    previewUrl: item.previewUrl,
    isVerified: true
  };
}

async function appleTracks(query: string, limit: number, offset: number): Promise<Song[]> {
  const term = query.trim() || "top hits";
  const res = await fetch(
    `${ITUNES}/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=${limit}&offset=${offset}`
  );
  if (!res.ok) throw new Error(`apple ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return (Array.isArray(data?.results) ? data.results : [])
    .map(appleSong)
    .filter((song: Song | null): song is Song => Boolean(song));
}

function readSource(value: unknown): Source {
  return String(value || "").toLowerCase() === "apple" ? "apple" : "audius";
}

async function searchCatalogue(source: Source, query: string, limit: number, offset: number): Promise<Song[]> {
  const trimmed = query.trim();
  const key = `${source}:${trimmed.toLowerCase()}:${limit}:${offset}`;

  return cached(key, trimmed ? 60_000 : 300_000, async () => {
    if (source === "apple") return appleTracks(trimmed, limit, offset);
    if (trimmed) {
      return audiusTracks(`/tracks/search?query=${encodeURIComponent(trimmed)}&app_name=${APP_NAME}&limit=${limit}&offset=${offset}`);
    }
    return audiusTracks(`/tracks/trending?app_name=${APP_NAME}&limit=${limit}&time=week&offset=${offset}`);
  });
}

const BROWSE_ROWS: Array<{ key: string; genre: string }> = [
  { key: "electronic", genre: "Electronic" },
  { key: "hiphop", genre: "Hip-Hop/Rap" },
  { key: "house", genre: "House" },
  { key: "chill", genre: "Ambient" }
];

async function browseRows(): Promise<Record<string, Song[]>> {
  return cached("browse", 300_000, async () => {
    const [hits, ...rows] = await Promise.all([
      audiusTracks(`/tracks/trending?app_name=${APP_NAME}&limit=24&time=week`),
      ...BROWSE_ROWS.map((row) =>
        audiusTracks(`/tracks/trending?app_name=${APP_NAME}&limit=20&time=week&genre=${encodeURIComponent(row.genre)}`)
      )
    ]);

    const result: Record<string, Song[]> = { hits };
    BROWSE_ROWS.forEach((row, index) => {
      result[row.key] = rows[index] || [];
    });
    return result;
  });
}

/* --------------------------------------------------------------- router -- */

const musicRouter = Router();

musicRouter.get("/ping", (_req: Request, res: Response) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
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
    res.status(502).json({ songs: [], items: [], total: 0, error: `source unavailable: ${String(error)}` });
  }
});

musicRouter.get("/browse", async (_req: Request, res: Response) => {
  try {
    const rows = await browseRows();
    res.json({ rows, albums: [], artists: [] });
  } catch (error) {
    res.status(502).json({ rows: {}, albums: [], artists: [], error: `source unavailable: ${String(error)}` });
  }
});

musicRouter.get("/stream", async (req: Request, res: Response) => {
  if (!readTicket(req.query.k)) {
    res.status(401).json({ error: "ticket required" });
    return;
  }

  const source = readSource(req.query.source);
  const rawId = String(req.query.id ?? "").replace(/^(audius|apple)_/, "");
  if (!/^[\w-]+$/.test(rawId)) {
    res.status(400).json({ error: "bad track id" });
    return;
  }

  let upstream = "";
  if (source === "audius") {
    upstream = `${AUDIUS}/tracks/${rawId}/stream?app_name=${APP_NAME}`;
  } else {
    const preview = String(req.query.preview ?? "");
    let host = "";
    try {
      host = new URL(preview).hostname;
    } catch {
      host = "";
    }
    if (!ALLOWED_PREVIEW_HOST.test(host)) {
      res.status(400).json({ error: "bad preview url" });
      return;
    }
    upstream = preview;
  }

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
    Readable.fromWeb(upstreamRes.body as any).pipe(res);
  } catch {
    res.status(502).json({ error: "audio unavailable" });
  }
});

export default musicRouter;
