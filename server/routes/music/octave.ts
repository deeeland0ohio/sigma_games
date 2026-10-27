import { MusicTrackResult, StreamResolutionResult, formatSeconds } from "./types";
import { resolveFullLengthAudio } from "./fullLength";

/**
 * "Octave" is the iTunes Search catalog: real metadata (title, artist, artwork,
 * duration) plus a 30-second preview. Same rule as Deezer — verified full audio
 * if we can prove it is the same recording, otherwise the real preview.
 */
export async function searchOctave(query: string, limit = 30): Promise<MusicTrackResult[]> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=${limit}`,
      { signal: AbortSignal.timeout(5000) }
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
              durationFormatted: formatSeconds(seconds),
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

export async function resolveOctaveTrack(track: {
  id: string;
  name?: string;
  artist?: string;
  duration?: number;
  previewUrl?: string;
}, deadline?: number): Promise<StreamResolutionResult | null> {
  const identity = { title: track.name, artist: track.artist, duration: track.duration };

  const full = await resolveFullLengthAudio(identity, deadline);
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
