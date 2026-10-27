import express, { type Request, type Response } from "express";
import { getCached, setCache, StreamResolutionResult } from "./types";
import { searchDeezer, resolveDeezerTrack } from "./deezer";
import { searchOctave, resolveOctaveTrack } from "./octave";
import { searchYouTube, resolveYouTubeTrack } from "./youtube";
import { searchSoundCloud, resolveSoundCloudTrack } from "./soundcloud";
import { RESOLVE_BUDGET_MS, searchSaavn } from "./fullLength";
import { buildQueries, identityMismatch } from "./match";
import { searchYouTubeRaw } from "./youtubeStream";
import { searchSoundCloudTracks } from "./soundcloudApi";
import { isYtDlpAvailable, probeYtDlp, ytDlpBinaryPath, ytDlpConfig } from "./ytdlp";

const musicRouter = express.Router();

// Sources list
musicRouter.get("/sources", (_req: Request, res: Response) => {
  res.json({
    sources: [
      { id: "deezer", name: "Deezer", description: "Worldwide Pop, Rock, & Electronic", quality: "320k HQ", icon: "headphones" },
      { id: "octave", name: "Octave", description: "High Fidelity 320kbps MP3 Audio", quality: "320kbps MP3", icon: "zap" },
      { id: "youtube", name: "YouTube Music", description: "Vast Global Video & Audio Library", quality: "Full Length HD", icon: "youtube" },
      { id: "soundcloud", name: "SoundCloud", description: "Indie, EDM, Hip-Hop & Remixes", quality: "128k MP3", icon: "cloud" }
    ],
    defaultSource: "deezer"
  });
});

// Search Endpoint (Delegates to source-specific handler)
musicRouter.get("/search", async (req: Request, res: Response) => {
  const query = ((req.query.keyword || req.query.q || "") as string).trim();
  const source = ((req.query.source || "deezer") as string).toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 30, 50);

  if (!query) {
    return res.json({ songs: [], total: 0, source });
  }

  const cacheKey = `search:${source}:${query}:${limit}`;
  const cached = getCached<any[]>(cacheKey);
  if (cached) {
    return res.json({ songs: cached, total: cached.length, source, cached: true });
  }

  try {
    let results: any[] = [];
    switch (source) {
      case "deezer":
        results = await searchDeezer(query, limit);
        break;
      case "octave":
        results = await searchOctave(query, limit);
        break;
      case "youtube":
        results = await searchYouTube(query, limit);
        break;
      case "soundcloud":
        results = await searchSoundCloud(query, limit);
        break;
      default:
        results = await searchDeezer(query, limit);
        break;
    }

    setCache(cacheKey, results);
    res.json({ songs: results, total: results.length, source });
  } catch (err: any) {
    res.json({ songs: [], total: 0, source });
  }
});

// Trending Endpoint
musicRouter.get("/trending", async (req: Request, res: Response) => {
  const source = ((req.query.source || "deezer") as string).toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 30, 50);

  const cacheKey = `trending:${source}:${limit}`;
  const cached = getCached<any[]>(cacheKey);
  if (cached) {
    return res.json({ songs: cached, total: cached.length, source });
  }

  try {
    let results: any[] = [];
    switch (source) {
      case "deezer":
        results = await searchDeezer("Top Hits", limit);
        break;
      case "octave":
        results = await searchOctave("Billboard Hot 100", limit);
        break;
      case "soundcloud":
        results = await searchSoundCloud("Trending Pop", limit);
        break;
      case "youtube":
      default:
        results = await searchYouTube("Trending Music Official Audio", limit);
        break;
    }

    setCache(cacheKey, results);
    res.json({ songs: results, total: results.length, source });
  } catch (err: any) {
    res.json({ songs: [], total: 0, source });
  }
});

// Backward-compatible Octave endpoints
musicRouter.get("/octave/search", async (req: Request, res: Response) => {
  const query = ((req.query.keyword || req.query.q || "") as string).trim();
  const limit = Math.min(Number(req.query.limit) || 30, 50);
  try {
    const songs = await searchOctave(query || "Top Hits", limit);
    res.json({ songs, total: songs.length, source: "octave" });
  } catch (e: any) {
    res.json({ songs: [], total: 0, source: "octave" });
  }
});

musicRouter.get("/octave/trending", async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 30, 50);
  try {
    const songs = await searchOctave("Trending Billboard", limit);
    res.json({ songs, total: songs.length, source: "octave" });
  } catch (e: any) {
    res.json({ songs: [], total: 0, source: "octave" });
  }
});

// URL Resolution Endpoint (Delegates to source-specific resolver)
musicRouter.get("/url", async (req: Request, res: Response) => {
  const id = (req.query.id || req.query.songId || "") as string;
  const source = ((req.query.source || "deezer") as string).toLowerCase();
  const name = (req.query.name || req.query.title || "") as string;
  const artist = (req.query.artist || "") as string;
  const duration = Number(req.query.duration) || 0;
  const previewUrl = (req.query.previewUrl || "") as string;

  if (!id && !name) {
    return res.status(400).json({ error: "Missing required track identifier" });
  }

  const cacheKey = `url:${source}:${id}:${name}:${artist}`;
  const cached = getCached<any>(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  // One deadline for the whole lookup. A resolver that runs for minutes gets
  // the request killed by the host (Cloud Run answers 503), so the budget is
  // spent trying, not waiting: when it expires the preview is served instead.
  const deadline = Date.now() + RESOLVE_BUDGET_MS;

  try {
    const trackPayload = { id, name, artist, duration, previewUrl };

    const resolution = (async (): Promise<StreamResolutionResult | null> => {
      if (source === "deezer" || id.startsWith("dz_")) {
        return resolveDeezerTrack(trackPayload, deadline);
      }
      if (source === "octave" || id.startsWith("octave_")) {
        return resolveOctaveTrack(trackPayload, deadline);
      }
      if (source === "youtube" || id.startsWith("yt_") || (id.length === 11 && !id.includes("_"))) {
        return resolveYouTubeTrack(trackPayload, deadline);
      }
      if (source === "soundcloud" || id.startsWith("sc_")) {
        return resolveSoundCloudTrack(trackPayload, deadline);
      }
      return resolveDeezerTrack(trackPayload, deadline);
    })().catch((err) => {
      console.warn("[music] resolve failed:", err?.message || err);
      return null;
    });

    // Hard guard: even a resolver that ignores its deadline cannot hold the
    // connection open past the budget.
    let guardTimer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<null>((resolve) => {
      guardTimer = setTimeout(() => resolve(null), RESOLVE_BUDGET_MS + 3000);
    });
    const resolved = await Promise.race([resolution, guard]);
    if (guardTimer) clearTimeout(guardTimer);

    if (resolved?.url) {
      const result = {
        url: resolved.url,
        mimeType: resolved.mimeType,
        source: resolved.source,
        isFullLength: resolved.isFullLength,
        duration: resolved.duration || duration,
        streamUrl: `/api/music/stream?url=${encodeURIComponent(resolved.url)}`
      };
      // A preview is a negative result: remember it briefly so the next click
      // answers instantly instead of paying the budget again, but not so long
      // that a fixed source stays broken for the rest of the session.
      setCache(cacheKey, result, resolved.isFullLength ? undefined : 5 * 60 * 1000);
      return res.json(result);
    }

    // Preview URL fallback if available
    if (previewUrl && previewUrl.startsWith("http")) {
      const result = {
        url: previewUrl,
        mimeType: "audio/mpeg",
        source: "preview-audio",
        isFullLength: false,
        duration: duration || 30,
        streamUrl: `/api/music/stream?url=${encodeURIComponent(previewUrl)}`
      };
      return res.json(result);
    }

    return res.status(404).json({
      error: "Stream unavailable",
      message: `Audio stream could not be resolved for "${name || id}"`
    });
  } catch (err: any) {
    if (previewUrl && previewUrl.startsWith("http")) {
      return res.json({
        url: previewUrl,
        mimeType: "audio/mpeg",
        source: "preview-audio",
        isFullLength: false,
        duration: 30,
        streamUrl: `/api/music/stream?url=${encodeURIComponent(previewUrl)}`
      });
    }
    return res.status(500).json({ error: "Resolution error", details: err?.message });
  }
});

/**
 * Diagnostics: why did this track resolve the way it did?
 *
 * "It plays 30 seconds on the deployed site but not here" is otherwise a
 * guessing game, because the answer depends on the host's IP, on whether
 * yt-dlp is installed, and on which catalog has a verified copy. One request
 * reports all three: yt-dlp presence, what each backend found, and which gate
 * rejected each candidate.
 *
 *   /api/music/debug?name=SPIN&artist=KROI&duration=305
 *   /api/music/debug?name=SPIN&artist=KROI&duration=305&videoId=<11 chars>
 */
musicRouter.get("/debug", async (req: Request, res: Response) => {
  const name = ((req.query.name || req.query.title || "") as string).trim();
  const artist = ((req.query.artist || "") as string).trim();
  const duration = Number(req.query.duration) || 0;
  const videoId = ((req.query.videoId || req.query.yt || "") as string).trim();

  if (!name) {
    return res.status(400).json({
      error: "name is required",
      example: "/api/music/debug?name=SPIN&artist=KROI&duration=305",
    });
  }

  const identity = { title: name, artist, duration };
  const query = buildQueries(identity)[0] || name;
  const perBackendBudget = 8000;
  const startedAt = Date.now();

  const probe = async (
    backend: string,
    search: (deadline: number) => Promise<{ title: string; artist: string; duration: number; videoId?: string }[]>
  ): Promise<any> => {
    const started = Date.now();
    try {
      const items = await search(Date.now() + perBackendBudget);
      return {
        backend,
        elapsedMs: Date.now() - started,
        candidates: items.slice(0, 5).map((item) => {
          const rejectedBecause = identityMismatch(item, identity);
          return { ...item, accepted: rejectedBecause.length === 0, rejectedBecause };
        }),
      };
    } catch (err: any) {
      return {
        backend,
        elapsedMs: Date.now() - started,
        error: err?.message || String(err),
      };
    }
  };

  // The catalogs are independent, so they are searched at the same time; one
  // after another this route alone would spend 8s per backend.
  const [saavn, youtube, soundcloud] = await Promise.all([
    probe("saavn", (deadline) => searchSaavn(query, deadline)),
    probe("youtube", async (deadline) =>
      (await searchYouTubeRaw(`${query} official audio`, 10, deadline)).map((item) => ({
        title: item.title,
        artist: item.author,
        duration: item.duration,
        videoId: item.videoId,
      }))
    ),
    probe("soundcloud", async () =>
      (await searchSoundCloudTracks(query, 12)).map((item) => ({
        title: item.title,
        artist: item.artist,
        duration: item.duration,
      }))
    ),
  ]);

  // With no videoId supplied, test the best verified YouTube copy, so one
  // request answers "can this host extract audio at all?" without the caller
  // having to dig an 11-character id out of the search results first.
  const autoVideoId: string | undefined = Array.isArray(youtube?.candidates)
    ? youtube.candidates.find((candidate: any) => candidate.accepted && candidate.videoId)?.videoId
    : undefined;
  const probeVideoId = videoId || autoVideoId;

  let ytDlpProbe: any;
  if (probeVideoId) {
    const result = await probeYtDlp(probeVideoId, Date.now() + 15000);
    ytDlpProbe = { videoId: probeVideoId, autoSelected: !videoId, ...result };
  } else {
    ytDlpProbe = {
      hint:
        "no verified YouTube copy to test: pass &videoId=<11 chars>. If extraction " +
        "fails, set YT_DLP_PROXY / YT_DLP_PROXY_FILE to extract from an IP YouTube allows.",
    };
  }

  res.json({
    target: identity,
    query,
    budgetMs: RESOLVE_BUDGET_MS,
    ytDlp: { available: isYtDlpAvailable(), path: ytDlpBinaryPath(), configured: ytDlpConfig() },
    ytDlpProbe,
    backends: [saavn, youtube, soundcloud],
    totalMs: Date.now() - startedAt,
  });
});

// Audio Stream Proxy with Byte Range Seeking
const streamProxyHandler = async (req: Request, res: Response) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).json({ error: "Missing target audio URL" });
  }

  const range = req.headers.range;
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };

  if (targetUrl.includes("deezer") || targetUrl.includes("dzcdn")) {
    headers["Referer"] = "https://deezer.com/";
    headers["Origin"] = "https://deezer.com";
  } else if (targetUrl.includes("sndcdn") || targetUrl.includes("soundcloud")) {
    headers["Referer"] = "https://soundcloud.com/";
    headers["Origin"] = "https://soundcloud.com";
  } else if (targetUrl.includes("googlevideo.com")) {
    headers["User-Agent"] = "Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36";
  }

  if (range) headers["Range"] = range;

  const abortCtrl = new AbortController();
  req.on("close", () => abortCtrl.abort());

  try {
    const upstream = await fetch(targetUrl, {
      headers,
      signal: abortCtrl.signal
    });

    res.status(upstream.status);
    const contentType = upstream.headers.get("content-type") || "audio/mpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    const contentRange = upstream.headers.get("content-range");
    if (contentRange) res.setHeader("Content-Range", contentRange);

    if (!upstream.body) return res.end();

    const { Readable } = await import("node:stream");
    const nodeStream = Readable.fromWeb(upstream.body as any);

    // A listener that seeks, skips or closes the tab tears the response down
    // mid-pipe. Without these handlers that surfaces as an uncaught 'error'
    // event and takes the whole server with it.
    nodeStream.on("error", () => {
      abortCtrl.abort();
      if (!res.writableEnded) res.end();
    });
    res.on("close", () => {
      abortCtrl.abort();
      nodeStream.destroy();
    });

    nodeStream.pipe(res);
  } catch (e: any) {
    if (!res.headersSent) {
      res.status(502).json({ error: "Stream proxy error", details: e.message });
    }
  }
};

musicRouter.get("/stream", streamProxyHandler);
musicRouter.get("/proxy", streamProxyHandler);

// Lyrics Provider
musicRouter.get("/lyrics", async (req: Request, res: Response) => {
  const title = (req.query.title || req.query.name || "") as string;
  const artist = (req.query.artist || "") as string;
  const duration = Number(req.query.duration) || 0;

  if (!title) {
    return res.status(400).json({ error: "Title required" });
  }

  try {
    const lrclibUrl = new URL("https://lrclib.net/api/get");
    lrclibUrl.searchParams.set("track_name", title);
    if (artist) lrclibUrl.searchParams.set("artist_name", artist);
    if (duration > 0) lrclibUrl.searchParams.set("duration", String(duration));

    const resLrc = await fetch(lrclibUrl.toString(), {
      headers: { "User-Agent": "x8rr-music/1.0" },
      signal: AbortSignal.timeout(3500)
    });

    if (resLrc.ok) {
      const data = await resLrc.json();
      return res.json({
        syncedLyrics: data.syncedLyrics || null,
        plainLyrics: data.plainLyrics || null,
        instrumental: data.instrumental || false
      });
    }
  } catch {}

  res.json({ syncedLyrics: null, plainLyrics: null, instrumental: false });
});

export { musicRouter };
export default musicRouter;
