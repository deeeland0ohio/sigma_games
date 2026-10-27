/**
 * YouTube audio extraction (InnerTube, no API key).
 *
 * Google blocks anonymous player calls from a lot of datacenter IPs
 * ("Sign in to confirm you're not a bot"), so this tries a few clients and
 * gives up cleanly. Callers must treat `null` as "no audio", never as an
 * invitation to play something else.
 */
import yts from "yt-search";
import { resolveWithYtDlp } from "./ytdlp";

const INNERTUBE_PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

const CLIENTS = [
  {
    // Still the most permissive client for anonymous audio in 2026.
    clientName: "ANDROID_VR",
    clientVersion: "1.60.19",
    clientId: "28",
    deviceMake: "Oculus",
    deviceModel: "Quest 3",
    osName: "Android",
    osVersion: "12",
  },
  { clientName: "VISIONOS", clientVersion: "1.2", clientId: "101", deviceMake: "Apple", deviceModel: "Vision Pro", osName: "visionOS", osVersion: "2.0" },
  { clientName: "MWEB", clientVersion: "2.20250101.00.00", clientId: "2" },
];

export interface YouTubeStream {
  url: string;
  mimeType: string;
  duration?: number;
}

/** `yts` has no timeout of its own, and a hung search would stall the request. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

/** How long a single step may take, never past the caller's deadline. */
function stepTimeout(deadline: number | undefined, capMs: number): number {
  if (!deadline) return capMs;
  return Math.max(0, Math.min(capMs, deadline - Date.now()));
}

export async function resolveYouTubeAudioStream(
  videoId: string,
  deadline?: number
): Promise<YouTubeStream | null> {
  const id = String(videoId || "").replace(/^yt_/, "").trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;

  for (const client of CLIENTS) {
    const timeout = stepTimeout(deadline, 8000);
    if (timeout < 1500) break;
    try {
      const response = await fetch(INNERTUBE_PLAYER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; en_US)",
          "X-YouTube-Client-Name": client.clientId,
          "X-YouTube-Client-Version": client.clientVersion,
          Origin: "https://www.youtube.com",
        },
        body: JSON.stringify({
          context: { client: { ...client, hl: "en", gl: "US" } },
          videoId: id,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) continue;
      const data: any = await response.json();
      const formats: any[] = (data?.streamingData?.adaptiveFormats || []).filter(
        (format) => String(format.mimeType || "").startsWith("audio/") && format.url
      );
      if (formats.length === 0) continue;

      // Prefer m4a (widest browser support), then the highest bitrate MP3/Opus we can get.
      const best =
        formats.find((f) => f.mimeType.includes("mp4a")) ||
        [...formats].sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

      if (best?.url) {
        return {
          url: best.url,
          mimeType: best.mimeType || "audio/mp4",
          duration: Number(data?.videoDetails?.lengthSeconds || 0) || undefined,
        };
      }
    } catch {
      // try the next client
    }
  }

  // InnerTube is refused from most datacenter IPs; yt-dlp copes far better.
  const viaYtDlp = await resolveWithYtDlp(id, deadline);
  if (viaYtDlp?.url) {
    return {
      url: viaYtDlp.url,
      mimeType: viaYtDlp.url.includes(".m3u8") ? "application/vnd.apple.mpegurl" : "audio/mp4",
      duration: viaYtDlp.duration,
    };
  }

  return null;
}

export interface YouTubeSearchItem {
  videoId: string;
  title: string;
  author: string;
  duration: number;
  thumbnail?: string;
  views?: number;
}

/** Raw YouTube search (no metadata rewriting). */
export async function searchYouTubeRaw(
  query: string,
  limit = 12,
  deadline?: number
): Promise<YouTubeSearchItem[]> {
  try {
    const budget = stepTimeout(deadline, 6000);
    if (budget < 1000) return [];
    const results = await withTimeout<{ videos?: any[] }>(
      yts(query) as Promise<{ videos?: any[] }>,
      budget
    );
    if (!results) return [];
    return (results.videos || []).slice(0, limit).map((video) => ({
      videoId: video.videoId,
      title: video.title,
      author: video.author?.name || "",
      duration: video.duration?.seconds || 0,
      thumbnail: video.thumbnail,
      views: video.views,
    }));
  } catch {
    return [];
  }
}
