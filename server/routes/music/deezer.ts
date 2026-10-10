import { MusicTrackResult, StreamResolutionResult, formatSeconds } from "./types";
import { resolveStudioMasterAudio } from "./octave";
import { findSoundCloudMatch } from "./soundcloud";
import { resolveYouTubeAudioStream } from "./youtube";
import yts from "yt-search";

export async function searchDeezer(query: string, limit = 30): Promise<MusicTrackResult[]> {
  try {
    const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(3500)
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
          duration: t.duration || 0,
          durationFormatted: formatSeconds(t.duration),
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

export async function resolveDeezerTrack(track: {
  id: string;
  name?: string;
  artist?: string;
  duration?: number;
  previewUrl?: string;
}): Promise<StreamResolutionResult | null> {
  const title = track.name || "";
  const artist = track.artist || "";

  // 1. High-Fidelity Full 320kbps Studio Master
  if (title) {
    const master = await resolveStudioMasterAudio(title, artist);
    if (master?.url) {
      return {
        url: master.url,
        mimeType: "audio/mp4",
        source: "studio-master-320k",
        isFullLength: true,
        duration: master.duration || track.duration
      };
    }

    // 2. Full-length SoundCloud Match (> 45s)
    const scMatched = await findSoundCloudMatch(
      [artist ? `${title} ${artist}` : null, title].filter(Boolean) as string[],
      title,
      artist
    );
    if (scMatched) {
      return scMatched;
    }

    // 3. Full-length YouTube Audio Stream fallback
    try {
      const ytQuery = artist ? `${title} ${artist} audio` : `${title} audio`;
      const ytResults = await yts(ytQuery);
      for (const candidate of (ytResults.videos || []).slice(0, 3)) {
        if (candidate.videoId && candidate.duration.seconds >= 45) {
          const ytStream = await resolveYouTubeAudioStream(candidate.videoId);
          if (ytStream?.url) {
            return {
              url: ytStream.url,
              mimeType: ytStream.mimeType || "audio/mp4",
              source: "youtube-stream",
              isFullLength: true,
              duration: ytStream.duration || candidate.duration.seconds
            };
          }
        }
      }
    } catch {}
  }

  // 4. Fallback to Deezer Preview (proxied) if all full streams fail
  if (track.previewUrl && track.previewUrl.startsWith("http")) {
    return {
      url: track.previewUrl,
      mimeType: "audio/mpeg",
      source: "deezer-preview",
      isFullLength: false,
      duration: track.duration || 30
    };
  }

  return null;
}
