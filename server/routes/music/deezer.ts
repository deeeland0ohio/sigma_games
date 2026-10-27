import { MusicTrackResult, StreamResolutionResult, formatSeconds } from "./types";
import { resolveFullLengthAudio } from "./fullLength";

/**
 * Deezer is a metadata catalog here: the public API gives titles, artwork,
 * durations and a 30-second preview, and nothing else. Full audio may come from
 * a verified full-length backend, and if there is no verified match the
 * preview is the correct answer — it is the actual song, just short.
 */
export async function searchDeezer(query: string, limit = 30): Promise<MusicTrackResult[]> {
  try {
    const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      const items = data.data || [];
      return items.map((t: any) => ({
        id: `dz_${t.id}`,
        rawId: t.id,
        name: t.title,
        artist: t.artist?.name || "Unknown Artist",
        album: t.album?.title || "",
        pic: t.album?.cover_big || t.album?.cover_medium || "",
        duration: t.duration || 0,
        durationFormatted: formatSeconds(t.duration),
        source: "deezer",
        previewUrl: t.preview,
        isrc: t.isrc,
        isVerified: true,
      }));
    }
  } catch {}
  return [];
}

export async function resolveDeezerTrack(track: {
  id: string;
  name?: string;
  artist?: string;
  duration?: number;
  previewUrl?: string;
}): Promise<StreamResolutionResult | null> {
  const identity = { title: track.name, artist: track.artist, duration: track.duration };

  const full = await resolveFullLengthAudio(identity);
  if (full) return full;

  if (track.previewUrl?.startsWith("http")) {
    return {
      url: track.previewUrl,
      mimeType: "audio/mpeg",
      source: "preview",
      isFullLength: false,
      duration: 30,
    };
  }

  return null;
}
