import { ClientMusicTrack, formatDuration } from "./types";

/**
 * Client-side fallback search, used only if /api/music is unreachable.
 * Audio is never guessed from another catalog here: the server does the
 * verified full-length lookup, and the preview is always the real song.
 */
export async function fetchClientDeezer(query: string = "", page: number = 1, limit: number = 30): Promise<ClientMusicTrack[]> {
  const searchTerm = query.trim() || "Top Hits";
  const index = (page - 1) * limit;
  try {
    const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(searchTerm)}&index=${index}&limit=${limit}`, {
      signal: AbortSignal.timeout(4000),
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
        formattedDuration: formatDuration(t.duration || 0),
        source: "deezer",
        previewUrl: t.preview,
        isrc: t.isrc,
        isVerified: true,
      }));
    }
  } catch {}
  return [];
}

export async function resolveClientDeezerTrack(track: any): Promise<{ url: string; duration?: number }> {
  if (track.previewUrl && String(track.previewUrl).startsWith("http")) {
    return { url: track.previewUrl, duration: 30 };
  }
  return { url: "", duration: 0 };
}
