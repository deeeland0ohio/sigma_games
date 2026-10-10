import { ClientMusicTrack, formatDuration, isAccurateMatch } from "./types";
import { resolveClientSoundCloudMatch } from "./soundcloud";

export async function fetchClientOctave(query: string = "", page: number = 1, limit: number = 30): Promise<ClientMusicTrack[]> {
  const searchTerm = query.trim() || "Top Hits";
  const offset = (page - 1) * limit;
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=song&limit=${limit}&offset=${offset}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.results) && data.results.length > 0) {
        return data.results.map((item: any) => ({
          id: `octave_${item.trackId}`,
          rawId: item.trackId,
          name: item.trackName,
          artist: item.artistName,
          album: item.collectionName || "Octave Master 320k",
          pic: item.artworkUrl100 ? item.artworkUrl100.replace("100x100bb", "600x600bb") : item.artworkUrl60 || "",
          duration: Math.round((item.trackTimeMillis || 210000) / 1000),
          formattedDuration: formatDuration(Math.round((item.trackTimeMillis || 210000) / 1000)),
          previewUrl: item.previewUrl,
          source: "octave",
          audioQuality: "320kbps MP3",
          isVerified: true
        }));
      }
    }
  } catch {}
  return [];
}

export async function resolveClientStudioMaster(query: string, targetTitle?: string, targetArtist?: string): Promise<{ url: string; duration?: number } | null> {
  try {
    const sRes = await fetch(
      `https://saavn-api-virid.vercel.app/api/search/songs?query=${encodeURIComponent(query)}&limit=5`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (sRes.ok) {
      const sData = await sRes.json();
      const results = sData.data?.results || [];
      const match = results.find((r: any) => {
        if (!targetTitle) return true;
        const rArtist = r.artists?.primary?.map((a: any) => a.name).join(", ") || r.artist || "";
        return isAccurateMatch(r.name, rArtist, targetTitle, targetArtist || "");
      }) || (results.length > 0 ? results[0] : null);

      if (match?.downloadUrl && Array.isArray(match.downloadUrl) && match.downloadUrl.length > 0) {
        const streamUrl = match.downloadUrl[match.downloadUrl.length - 1]?.url;
        if (streamUrl && streamUrl.startsWith("http")) {
          return {
            url: streamUrl,
            duration: Number(match.duration || 0)
          };
        }
      }
    }
  } catch {}
  return null;
}

export async function resolveClientOctaveTrack(track: any): Promise<{ url: string; duration?: number }> {
  const title = track.name || track.title || "";
  const artist = track.artist || "";

  if (title) {
    const master = await resolveClientStudioMaster(artist ? `${title} ${artist}` : title, title, artist);
    if (master?.url) return master;

    const scMatch = await resolveClientSoundCloudMatch(
      [artist ? `${title} ${artist}` : null, title].filter(Boolean) as string[],
      title,
      artist
    );
    if (scMatch?.url) return scMatch;
  }

  if (track.previewUrl && track.previewUrl.startsWith("http")) {
    return { url: track.previewUrl, duration: track.duration || 30 };
  }

  return { url: "", duration: 0 };
}
