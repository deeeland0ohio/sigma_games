import { MusicTrackResult, StreamResolutionResult, formatSeconds } from "./types";
import { resolveFullLengthAudio } from "./fullLength";
import { resolveSoundCloudStream, searchSoundCloudTracks, soundcloudGet } from "./soundcloudApi";

export { getValidSoundCloudClientId, resolveSoundCloudStream } from "./soundcloudApi";

export async function searchSoundCloud(query: string, limit = 30): Promise<MusicTrackResult[]> {
  try {
    const res = await soundcloudGet(
      `/search/tracks?q=${encodeURIComponent(query)}&limit=${limit + 10}`,
      8000
    );
    if (!res || !res.ok) return [];

    const data = await res.json();
    return (data.collection || [])
      .filter((t: any) => {
        const seconds = Math.round((t.duration || 0) / 1000);
        return seconds >= 20;
      })
      .slice(0, limit)
      .map((t: any) => {
        const seconds = Math.floor((t.duration || 0) / 1000);
        return {
          id: `sc_${t.id}`,
          rawId: t.id,
          name: t.title || "Untitled",
          artist: t.user?.username || "SoundCloud Artist",
          album: t.genre || "SoundCloud",
          pic: (t.artwork_url || t.user?.avatar_url || "").replace("-large", "-t500x500"),
          duration: seconds,
          durationFormatted: formatSeconds(seconds),
          source: "soundcloud",
          isrc: t.isrc,
          playbackCount: t.playback_count,
          isVerified: Boolean(t.user?.verified),
        };
      });
  } catch {
    return [];
  }
}

export { searchSoundCloudTracks };

export async function resolveSoundCloudTrack(track: {
  id: string;
  name?: string;
  artist?: string;
  duration?: number;
}, deadline?: number): Promise<StreamResolutionResult | null> {
  const rawId = String(track.id || "").replace(/^sc_/, "");
  const seconds = Number(track.duration || 0);

  if (rawId && !Number.isNaN(Number(rawId))) {
    const stream = await resolveSoundCloudStream(rawId);
    if (stream?.url) {
      return {
        url: stream.url,
        mimeType: "audio/mpeg",
        source: "soundcloud",
        isFullLength: seconds === 0 || seconds >= 45,
        duration: track.duration,
      };
    }
  }

  return resolveFullLengthAudio(
    { title: track.name, artist: track.artist, duration: track.duration },
    deadline
  );
}
