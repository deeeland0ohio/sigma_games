import { ClientMusicTrack, formatDuration } from "./types";

/** Client-side fallback search for the iTunes catalog. Preview audio only. */
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
      if (Array.isArray(data?.results)) {
        return data.results
          .filter((item: any) => item.trackName)
          .map((item: any) => {
            const seconds = Math.round((item.trackTimeMillis || 0) / 1000);
            return {
              id: `octave_${item.trackId}`,
              rawId: item.trackId,
              name: item.trackName,
              artist: item.artistName || "Unknown Artist",
              album: item.collectionName || "",
              pic: item.artworkUrl100
                ? item.artworkUrl100.replace("100x100bb", "600x600bb")
                : item.artworkUrl60 || "",
              duration: seconds,
              formattedDuration: formatDuration(seconds),
              previewUrl: item.previewUrl,
              source: "octave",
              isVerified: true,
            };
          });
      }
    }
  } catch {}
  return [];
}

export async function resolveClientOctaveTrack(track: any): Promise<{ url: string; duration?: number }> {
  if (track.previewUrl && String(track.previewUrl).startsWith("http")) {
    return { url: track.previewUrl, duration: 30 };
  }
  return { url: "", duration: 0 };
}
