import express, { Request, Response } from "express";

const musicRouter = express.Router();

const SOURCES = [
  { id: "octave", name: "Apple Music", description: "Every song in the iTunes catalogue, played full length", quality: "320 kbps", icon: "zap" },
  { id: "youtube", name: "YouTube Music", description: "Vast Global Video & Audio Library", quality: "Full Length HD", icon: "youtube" },
  { id: "soundcloud", name: "SoundCloud", description: "Indie, EDM, Hip-Hop & Remixes", quality: "128k MP3", icon: "cloud" },
  { id: "deezer", name: "Deezer", description: "Worldwide Pop, Rock, & Electronic", quality: "320k HQ", icon: "headphones" }
];

musicRouter.get("/sources", (_req: Request, res: Response) => {
  res.json({ sources: SOURCES, defaultSource: "soundcloud" });
});

musicRouter.get("/search", (req: Request, res: Response) => {
  const source = ((req.query.source || "soundcloud") as string).toLowerCase();
  res.json({ songs: [], total: 0, source });
});

musicRouter.get("/trending", (req: Request, res: Response) => {
  const source = ((req.query.source || "soundcloud") as string).toLowerCase();
  res.json({ songs: [], total: 0, source });
});

musicRouter.get("/octave/search", (req: Request, res: Response) => {
  res.json({ songs: [], total: 0, source: "octave" });
});

musicRouter.get("/octave/trending", (req: Request, res: Response) => {
  res.json({ songs: [], total: 0, source: "octave" });
});

musicRouter.get("/url", (req: Request, res: Response) => {
  const name = (req.query.name || req.query.title || req.query.id || "") as string;
  res.status(404).json({
    error: "Stream unavailable",
    message: `Audio stream could not be resolved for "${name}"`
  });
});

const streamProxyHandler = async (req: Request, res: Response) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).json({ error: "Missing target audio URL" });
  }

  const range = req.headers.range;
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };
  if (range) headers["Range"] = range;

  const abortCtrl = new AbortController();
  req.on("close", () => abortCtrl.abort());

  try {
    const upstream = await fetch(targetUrl, { headers, signal: abortCtrl.signal });

    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "audio/mpeg");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    const contentRange = upstream.headers.get("content-range");
    if (contentRange) res.setHeader("Content-Range", contentRange);

    if (!upstream.body) return res.end();

    const { Readable } = await import("node:stream");
    const nodeStream = Readable.fromWeb(upstream.body as any);

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

    const lyricsRes = await fetch(lrclibUrl.toString(), {
      headers: { "User-Agent": "x8rr-music/1.0" },
      signal: AbortSignal.timeout(3500)
    });

    if (lyricsRes.ok) {
      const data = await lyricsRes.json();
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
