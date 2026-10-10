import { MusicTrackResult, StreamResolutionResult, formatSeconds, isAccurateMatch } from "./types";
import { findSoundCloudMatch } from "./soundcloud";

export async function searchOctave(query: string, limit = 30): Promise<MusicTrackResult[]> {
  try {
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=${limit}`, {
      signal: AbortSignal.timeout(3500)
    });
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
          durationFormatted: formatSeconds(Math.round((item.trackTimeMillis || 210000) / 1000)),
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

export async function resolveStudioMasterAudio(title: string, artist?: string): Promise<{ url: string; duration: number; title: string; artist: string } | null> {
  const clean = title.replace(/\s*[\(\[](?:official|video|audio|remastered|version|deluxe|explicit)[\s\S]*?[\)\]]/gi, "").trim();
  const queries = [
    artist && !artist.toLowerCase().includes("artist") && !artist.toLowerCase().includes("creator") ? `${clean} ${artist}` : clean,
    clean,
    title
  ];

  for (const query of queries) {
    const endpoints = [
      `https://saavn-api-virid.vercel.app/api/search/songs?query=${encodeURIComponent(query)}&limit=6`,
      `https://saavn.me/api/search/songs?query=${encodeURIComponent(query)}&limit=6`
    ];

    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(3000)
        });
        if (res.ok) {
          const data = await res.json();
          const results = data.data?.results || [];
          if (Array.isArray(results) && results.length > 0) {
            const match = results.find((r: any) => {
              const rArtist = r.artists?.primary?.map((a: any) => a.name).join(", ") || r.artist || "";
              return isAccurateMatch(r.name, rArtist, clean, artist || "");
            });

            if (match?.downloadUrl && Array.isArray(match.downloadUrl) && match.downloadUrl.length > 0) {
              const bestLink = match.downloadUrl[match.downloadUrl.length - 1]?.url;
              if (bestLink && bestLink.startsWith("http")) {
                return {
                  url: bestLink,
                  duration: Number(match.duration || 0),
                  title: match.name,
                  artist: match.artists?.primary?.map((a: any) => a.name).join(", ") || match.artist || ""
                };
              }
            }
          }
        }
      } catch {}
    }
  }

  return null;
}

export async function resolveOctaveTrack(track: {
  id: string;
  name?: string;
  artist?: string;
  duration?: number;
  previewUrl?: string;
}): Promise<StreamResolutionResult | null> {
  const title = track.name || "";
  const artist = track.artist || "";

  // 1. Studio Master 320k (Full length)
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

    // 2. Full-length SoundCloud Match (duration >= 45s)
    const scMatched = await findSoundCloudMatch(
      [artist ? `${title} ${artist}` : null, title].filter(Boolean) as string[],
      title,
      artist
    );
    if (scMatched) return scMatched;
  }

  // 3. Fallback to iTunes Preview if available
  if (track.previewUrl && track.previewUrl.startsWith("http")) {
    return {
      url: track.previewUrl,
      mimeType: "audio/mpeg",
      source: "preview-audio",
      isFullLength: false,
      duration: track.duration || 30
    };
  }

  return null;
}
