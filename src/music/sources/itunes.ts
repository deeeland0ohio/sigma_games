import { ClientMusicTrack, formatDuration } from "./types";

const BASE = "https://itunes.apple.com/search";

interface AppleResult {
  trackId: number;
  trackName: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
  previewUrl?: string;
}

function toTrack(item: AppleResult): ClientMusicTrack {
  const seconds = Math.round((item.trackTimeMillis || 0) / 1000);
  return {
    id: `apple_${item.trackId}`,
    rawId: item.trackId,
    name: item.trackName,
    artist: item.artistName || "Unknown Artist",
    album: item.collectionName || "Apple Music",
    pic: item.artworkUrl100?.replace("100x100", "600x600"),
    duration: seconds,
    formattedDuration: formatDuration(seconds),
    source: "apple",
    previewUrl: item.previewUrl,
    isVerified: true
  };
}

export async function fetchClientApple(query: string = "", page: number = 1, limit: number = 30): Promise<ClientMusicTrack[]> {
  const term = query.trim() || "top hits";
  const offset = Math.max(0, (page - 1) * limit);
  const url = `${BASE}?term=${encodeURIComponent(term)}&media=music&entity=song&limit=${limit}&offset=${offset}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`apple ${res.status}`);
  const data = await res.json();
  return (data?.results || []).map(toTrack);
}

export async function resolveClientAppleTrack(track: any): Promise<{ url: string; duration?: number }> {
  const url = typeof track.previewUrl === "string" ? track.previewUrl : "";
  return { url, duration: url ? undefined : 0 };
}
