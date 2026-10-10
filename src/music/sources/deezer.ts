import { ClientMusicTrack, formatDuration } from "./types";
import { resolveClientStudioMaster } from "./octave";
import { resolveClientSoundCloudMatch } from "./soundcloud";

export async function fetchClientDeezer(query: string = "", page: number = 1, limit: number = 30): Promise<ClientMusicTrack[]> {
  const searchTerm = query.trim() || "Top Hits";
  const index = (page - 1) * limit;
  try {
    const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(searchTerm)}&index=${index}&limit=${limit}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      const items = data.data || [];
      if (items.length > 0) {
        return items.map((t: any) => ({
          id: `dz_${t.id}`,
          rawId: t.id,
          name: t.title,
          artist: t.artist?.name || "Deezer Artist",
          album: t.album?.title || "Deezer Album",
          pic: t.album?.cover_big || t.album?.cover_medium || "",
          duration: t.duration || 200,
          formattedDuration: formatDuration(t.duration || 200),
          source: "deezer",
          previewUrl: t.preview,
          isrc: t.isrc,
          isVerified: true
        }));
      }
    }
  } catch {}
  return [];
}

export async function resolveClientDeezerTrack(track: any): Promise<{ url: string; duration?: number }> {
  const title = track.name || track.title || "";
  const artist = track.artist || "";

  // 1. Full 320k Studio Master
  if (title) {
    const master = await resolveClientStudioMaster(artist ? `${title} ${artist}` : title, title, artist);
    if (master?.url) return master;

    // 2. Full-length SoundCloud match
    const scMatch = await resolveClientSoundCloudMatch(
      [artist ? `${title} ${artist}` : null, title].filter(Boolean) as string[],
      title,
      artist
    );
    if (scMatch?.url) return scMatch;
  }

  // 3. Fallback to preview
  if (track.previewUrl && track.previewUrl.startsWith("http")) {
    return { url: track.previewUrl, duration: track.duration || 30 };
  }

  return { url: "", duration: 0 };
}
