import { MusicTrackResult, StreamResolutionResult, formatSeconds } from "./types";
import { resolveYouTubeAudioStream, searchYouTubeRaw } from "./youtubeStream";
import { resolveFullLengthAudio } from "./fullLength";

/**
 * YouTube source.
 *
 * The track the user clicked always has a video id, so playback is that exact
 * video. If Google refuses to hand out the audio (very common from a server
 * IP), we look for a *verified* copy of the same recording rather than playing
 * a random result of the same title.
 */

/** Pull "artist - title" out of the usual YouTube title soup. */
export function extractActualSongInfo(rawTitle: string, author?: string): { title: string; artist: string; searchQueries: string[] } {
  let text = rawTitle || "";

  if (text.includes(" | ")) {
    const segments = text.split(" | ");
    const dashSegment = segments.find((s) => s.includes(" - ") || s.includes(" – "));
    text = dashSegment ? dashSegment.trim() : segments[segments.length - 1].trim();
  }

  let artist = "";
  let title = text;

  if (text.includes(" - ")) {
    const parts = text.split(" - ");
    artist = parts[0].trim();
    title = parts.slice(1).join(" - ").trim();
  } else if (text.includes(" – ")) {
    const parts = text.split(" – ");
    artist = parts[0].trim();
    title = parts.slice(1).join(" – ").trim();
  } else if (author && !/creator|amv|edits|topic/i.test(author)) {
    artist = author.trim();
  }

  const cleanSongTitle = title
    .replace(/\s*[\(\[][^)\]]*(official|lyrics?|audio|video|visualizer|4k|hd|amv|pmv|edit)[^)\]]*[\)\]]/gi, "")
    .replace(/\s*-\s*official\s+(video|audio|music\s+video).*/gi, "")
    .replace(/\s*[\(\[][^)\]]*[\)\]]\s*$/g, "")
    .trim();

  const searchQueries: string[] = [];
  if (artist && cleanSongTitle) searchQueries.push(`${cleanSongTitle} ${artist}`);
  if (cleanSongTitle) searchQueries.push(cleanSongTitle);

  return {
    title: cleanSongTitle || title || rawTitle,
    artist: artist || author || "",
    searchQueries,
  };
}

export async function searchYouTube(query: string, limit = 30): Promise<MusicTrackResult[]> {
  // Keep real videos only: shorts and multi-hour compilations are noise.
  const videos = (await searchYouTubeRaw(query, limit + 10)).filter(
    (video) => video.duration >= 45 && video.duration <= 900
  );

  return videos.slice(0, limit).map((video) => {
    const parsed = extractActualSongInfo(video.title, video.author);
    return {
      id: `yt_${video.videoId}`,
      rawId: video.videoId,
      name: parsed.title || video.title,
      artist: parsed.artist || video.author || "YouTube Artist",
      album: "YouTube",
      pic: video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
      duration: video.duration,
      durationFormatted: formatSeconds(video.duration),
      source: "youtube",
      views: video.views,
      isVerified: true,
    };
  });
}

export async function resolveYouTubeTrack(track: {
  id: string;
  rawId?: string | number;
  name?: string;
  artist?: string;
  duration?: number;
}): Promise<StreamResolutionResult | null> {
  const videoId = String(track.id || track.rawId || "").replace(/^yt_/, "");

  // 1. The exact video the user clicked.
  if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    const stream = await resolveYouTubeAudioStream(videoId);
    if (stream?.url) {
      return {
        url: stream.url,
        mimeType: stream.mimeType,
        source: "youtube",
        isFullLength: true,
        duration: stream.duration || track.duration,
      };
    }
  }

  // 2. The same recording, verified, from another backend.
  return resolveFullLengthAudio({ title: track.name, artist: track.artist, duration: track.duration });
}
