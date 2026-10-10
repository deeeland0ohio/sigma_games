import yts from "yt-search";
import { MusicTrackResult, StreamResolutionResult, formatSeconds, isAccurateMatch } from "./types";
import { resolveStudioMasterAudio } from "./octave";
import { findSoundCloudMatch } from "./soundcloud";

export function extractActualSongInfo(rawTitle: string, author?: string): { title: string; artist: string; searchQueries: string[] } {
  let text = rawTitle || "";

  if (text.includes(" | ")) {
    const segments = text.split(" | ");
    const dashSegment = segments.find(s => s.includes(" - ") || s.includes(" – "));
    if (dashSegment) {
      text = dashSegment.trim();
    } else {
      text = segments[segments.length - 1].trim();
    }
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
  } else if (author && !author.toLowerCase().includes("creator") && !author.toLowerCase().includes("amv") && !author.toLowerCase().includes("edits") && !author.toLowerCase().includes("topic")) {
    artist = author.trim();
  }

  const cleanSongTitle = title
    .replace(/\s*[\(\[](?:official\s+video|official\s+music\s+video|official\s+audio|lyrics|amv|pmv|edit|visualizer|4k|hd|sub\s+español|clip\s+officiel)[\s\S]*?[\)\]]/gi, "")
    .replace(/\s*-\s*official\s+video.*/gi, "")
    .trim();

  const searchQueries: string[] = [];

  if (artist && cleanSongTitle) {
    searchQueries.push(`${cleanSongTitle} ${artist}`);
    searchQueries.push(`${artist} - ${cleanSongTitle}`);
  }
  if (cleanSongTitle) {
    searchQueries.push(cleanSongTitle);
  }
  if (title && title !== cleanSongTitle) {
    searchQueries.push(title);
  }

  return {
    title: cleanSongTitle || title || rawTitle,
    artist: artist || author || "",
    searchQueries
  };
}

export async function resolveYouTubeAudioStream(videoId: string): Promise<{ url: string; duration?: number; mimeType?: string } | null> {
  if (!videoId || typeof videoId !== "string") return null;

  const clients = [
    {
      clientName: "ANDROID_VR",
      clientVersion: "1.58.31",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      osName: "Android",
      osVersion: "12"
    },
    {
      clientName: "VISIONOS",
      clientVersion: "1.0",
      deviceMake: "Apple",
      deviceModel: "Vision Pro",
      osName: "visionOS",
      osVersion: "1.0"
    }
  ];

  for (const client of clients) {
    try {
      const res = await fetch("https://www.youtube.com/youtubei/v1/player", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36"
        },
        body: JSON.stringify({
          context: {
            client: {
              ...client,
              hl: "en",
              gl: "US"
            }
          },
          videoId
        }),
        signal: AbortSignal.timeout(3500)
      });

      if (res.ok) {
        const data = await res.json();
        if (data.playabilityStatus?.status === "OK" || data.streamingData?.adaptiveFormats) {
          const formats = (data.streamingData?.adaptiveFormats || []).filter((f: any) =>
            (f.mimeType || "").startsWith("audio/")
          );
          if (formats.length > 0) {
            const best =
              formats.find((f: any) => (f.mimeType || "").includes("mp4a") && f.url) ||
              formats.filter((f: any) => Boolean(f.url)).sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];

            if (best?.url) {
              return {
                url: best.url,
                mimeType: best.mimeType || "audio/mp4",
                duration: Number(data.videoDetails?.lengthSeconds || 0)
              };
            }
          }
        }
      }
    } catch {}
  }

  return null;
}

export async function searchYouTube(query: string, limit = 30): Promise<MusicTrackResult[]> {
  try {
    const res = await yts(query);
    const videos = (res.videos || []).filter((v) => {
      const dur = v.duration?.seconds || 0;
      return dur >= 45 && dur <= 600; // Exclude multi-hour compilation playlists
    });

    return videos.slice(0, limit).map((v) => {
      const parsed = extractActualSongInfo(v.title, v.author?.name);
      return {
        id: `yt_${v.videoId}`,
        rawId: v.videoId,
        name: parsed.title || v.title,
        artist: parsed.artist || v.author?.name || "YouTube Artist",
        album: "YouTube Music",
        pic: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        duration: v.duration?.seconds || 0,
        durationFormatted: v.duration?.timestamp || formatSeconds(v.duration?.seconds || 0),
        source: "youtube",
        isVerified: true,
        views: v.views
      };
    });
  } catch {
    return [];
  }
}

export async function resolveYouTubeTrack(track: {
  id: string;
  name?: string;
  artist?: string;
  duration?: number;
}): Promise<StreamResolutionResult | null> {
  const rawId = String(track.id || "");
  const cleanYtId = rawId.replace(/^yt_/, "");

  // 1. Direct YouTube video stream if available (11 chars)
  if (cleanYtId.length === 11 && !cleanYtId.includes(" ") && !cleanYtId.includes("_")) {
    const directStream = await resolveYouTubeAudioStream(cleanYtId);
    if (directStream?.url) {
      return {
        url: directStream.url,
        mimeType: directStream.mimeType || "audio/mp4",
        source: "youtube",
        isFullLength: true,
        duration: directStream.duration || track.duration
      };
    }
  }

  // 2. Accurately parse the true song and artist name
  const parsed = extractActualSongInfo(track.name || "", track.artist);

  // 3. For official songs, resolve Full 320kbps Studio Master (strictly accurate matching)
  if (parsed.title) {
    const master = await resolveStudioMasterAudio(parsed.title, parsed.artist);
    if (master?.url) {
      return {
        url: master.url,
        mimeType: "audio/mp4",
        source: "studio-master-320k",
        isFullLength: true,
        duration: master.duration || track.duration
      };
    }
  }

  // 4. Match against SoundCloud for full-length tracks (dur >= 45s, matching title accurately)
  const scMatched = await findSoundCloudMatch(parsed.searchQueries, parsed.title, parsed.artist);
  if (scMatched) {
    return scMatched;
  }

  // 5. Try finding an official or clean YouTube alternate video
  if (parsed.title) {
    try {
      const altQuery = parsed.artist ? `${parsed.title} ${parsed.artist} official audio` : `${parsed.title} official audio`;
      const ytResults = await yts(altQuery);
      for (const candidate of (ytResults.videos || []).slice(0, 3)) {
        if (candidate.videoId && candidate.videoId !== cleanYtId && candidate.duration.seconds >= 45) {
          const altStream = await resolveYouTubeAudioStream(candidate.videoId);
          if (altStream?.url) {
            return {
              url: altStream.url,
              mimeType: altStream.mimeType || "audio/mp4",
              source: "youtube-alternate",
              isFullLength: true,
              duration: altStream.duration || candidate.duration.seconds
            };
          }
        }
      }
    } catch {}
  }

  return null;
}
