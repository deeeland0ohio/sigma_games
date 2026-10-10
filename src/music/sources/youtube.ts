import { ClientMusicTrack, formatDuration } from "./types";
import { resolveClientStudioMaster } from "./octave";
import { resolveClientSoundCloudMatch } from "./soundcloud";

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

export async function fetchClientYouTube(query: string = "", page: number = 1, limit: number = 30): Promise<ClientMusicTrack[]> {
  const searchTerm = query.trim() || "Trending Music";
  try {
    const saavnRes = await fetch(`https://saavn-api-virid.vercel.app/api/search/songs?query=${encodeURIComponent(searchTerm)}&limit=${limit}&page=${page}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (saavnRes.ok) {
      const data = await saavnRes.json();
      const results = data.data?.results || [];
      if (results.length > 0) {
        return results.map((r: any) => ({
          id: `yt_${r.id}`,
          rawId: r.id,
          name: r.name,
          artist: r.artists?.primary?.map((a: any) => a.name).join(", ") || r.artist || "YouTube Artist",
          album: r.album?.name || "YouTube Music",
          pic: r.image?.[r.image.length - 1]?.url || "",
          duration: Number(r.duration || 0),
          formattedDuration: formatDuration(Number(r.duration || 0)),
          source: "youtube",
          isVerified: true
        }));
      }
    }
  } catch {}
  return [];
}

export async function resolveClientYouTubeTrack(track: any): Promise<{ url: string; duration?: number }> {
  const rawId = String(track.rawId || track.id || "");
  const cleanYtId = rawId.replace(/^yt_/, "");

  // 1. Direct YouTube audio extraction
  if (cleanYtId.length === 11 && !cleanYtId.includes(" ") && !cleanYtId.includes("_")) {
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
              clientName: "ANDROID_VR",
              clientVersion: "1.58.31",
              deviceMake: "Oculus",
              deviceModel: "Quest 3",
              osName: "Android",
              osVersion: "12",
              hl: "en",
              gl: "US"
            }
          },
          videoId: cleanYtId
        }),
        signal: AbortSignal.timeout(3500)
      });
      if (res.ok) {
        const data = await res.json();
        const formats = (data.streamingData?.adaptiveFormats || []).filter((f: any) =>
          (f.mimeType || "").startsWith("audio/")
        );
        const best = formats.find((f: any) => (f.mimeType || "").includes("mp4a") && f.url) || formats.find((f: any) => Boolean(f.url));
        if (best?.url) {
          return { url: best.url, duration: Number(data.videoDetails?.lengthSeconds || 0) };
        }
      }
    } catch {}
  }

  // 2. Parse true song info
  const parsed = extractActualSongInfo(track.name || track.title || "", track.artist);

  // 3. Studio Master 320k for official titles (with accurate title check)
  if (parsed.title) {
    const master = await resolveClientStudioMaster(parsed.artist ? `${parsed.title} ${parsed.artist}` : parsed.title, parsed.title, parsed.artist);
    if (master?.url) return master;
  }

  // 4. Match against full-length SoundCloud (duration >= 45s)
  const scMatch = await resolveClientSoundCloudMatch(parsed.searchQueries, parsed.title, parsed.artist);
  if (scMatch?.url) {
    return scMatch;
  }

  if (track.previewUrl && track.previewUrl.startsWith("http")) {
    return { url: track.previewUrl, duration: track.duration || 30 };
  }

  return { url: "", duration: 0 };
}
