import { MusicTrackResult, StreamResolutionResult, formatSeconds, isAccurateMatch } from "./types";
import { resolveStudioMasterAudio } from "./octave";

const SOUNDCLOUD_CLIENT_IDS = [
  "pmagYZKQF6mRtNmtRzPkXSQJ76jYHLN8",
  "Pb72ranhoyt6gw7hM7TkzUItXlMWSNSo",
  "b3e20e360f4e1f744e2de266ab0e5f29"
];

let cachedSoundCloudClientId = SOUNDCLOUD_CLIENT_IDS[0];
let lastClientIdFetch = 0;

export async function getValidSoundCloudClientId(): Promise<string> {
  const now = Date.now();
  if (cachedSoundCloudClientId && now - lastClientIdFetch < 1000 * 60 * 60) {
    return cachedSoundCloudClientId;
  }

  try {
    const res = await fetch("https://soundcloud.com/discover", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const html = await res.text();
      const scriptUrls = html.match(/https:\/\/[a-z0-9-]+\.sndcdn\.com\/assets\/[a-zA-Z0-9.-]+\.js/g) || [];
      for (const scriptUrl of scriptUrls.slice(0, 5)) {
        try {
          const jsRes = await fetch(scriptUrl, { signal: AbortSignal.timeout(2000) });
          if (jsRes.ok) {
            const js = await jsRes.text();
            const match = js.match(/client_id[\"']?\s*[:=]\s*[\"']([a-zA-Z0-9]{32})[\"']/);
            if (match && match[1]) {
              cachedSoundCloudClientId = match[1];
              lastClientIdFetch = now;
              return match[1];
            }
          }
        } catch {}
      }
    }
  } catch {}

  return cachedSoundCloudClientId || SOUNDCLOUD_CLIENT_IDS[0];
}

export async function resolveSoundCloudStream(trackIdOrTranscodings: any, trackAuth?: string): Promise<{ url: string; duration?: number } | null> {
  try {
    const clientId = await getValidSoundCloudClientId();
    let transcodings: any[] = [];
    let authHeader = trackAuth ? `&track_authorization=${trackAuth}` : "";

    if (Array.isArray(trackIdOrTranscodings)) {
      transcodings = trackIdOrTranscodings;
    } else {
      const trackRes = await fetch(`https://api-v2.soundcloud.com/tracks/${trackIdOrTranscodings}?client_id=${clientId}`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        signal: AbortSignal.timeout(4000)
      });
      if (trackRes.ok) {
        const trackData = await trackRes.json();
        transcodings = trackData.media?.transcodings || [];
        if (trackData.track_authorization && !authHeader) {
          authHeader = `&track_authorization=${trackData.track_authorization}`;
        }
      }
    }

    if (!transcodings.length) return null;

    // Filter out DRM encrypted streams (cbcs, cenc)
    const playableTranscodings = transcodings.filter((t: any) =>
      !t.url?.includes("encrypted") &&
      !t.url?.includes("/cbcs/") &&
      !t.url?.includes("/cenc/") &&
      !t.format?.protocol?.includes("encrypted")
    );

    const ordered = [
      ...playableTranscodings.filter((t: any) => t.format?.protocol === "progressive"),
      ...playableTranscodings.filter((t: any) => t.format?.protocol === "hls"),
      ...playableTranscodings
    ];

    for (const chosen of ordered) {
      if (!chosen?.url) continue;
      try {
        const streamRes = await fetch(`${chosen.url}?client_id=${clientId}${authHeader}`, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
          signal: AbortSignal.timeout(3500)
        });
        if (streamRes.ok) {
          const streamData = await streamRes.json();
          if (streamData?.url && !streamData.url.includes("/cbcs/") && !streamData.url.includes("/cenc/")) {
            return { url: streamData.url };
          }
        }
      } catch {}
    }
  } catch (e) {
    console.warn("SoundCloud stream resolve error:", e);
  }
  return null;
}

export async function searchSoundCloud(query: string, limit = 30): Promise<MusicTrackResult[]> {
  try {
    const clientId = await getValidSoundCloudClientId();
    const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${clientId}&limit=${limit + 10}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json();
      const collection = (data.collection || [])
        .filter((t: any) => {
          const dur = Math.round((t.duration || 0) / 1000);
          return dur >= 20;
        })
        .slice(0, limit);

      if (collection.length > 0) {
        return collection.map((t: any) => ({
          id: `sc_${t.id}`,
          rawId: t.id,
          name: t.title,
          artist: t.user?.username || "SoundCloud Artist",
          album: t.genre || "SoundCloud",
          pic: (t.artwork_url || t.user?.avatar_url || "").replace("-large", "-t500x500"),
          duration: Math.floor((t.duration || 0) / 1000),
          durationFormatted: formatSeconds(Math.floor((t.duration || 0) / 1000)),
          source: "soundcloud",
          isrc: t.isrc,
          playbackCount: t.playback_count,
          isVerified: Boolean(t.user?.verified),
          track_authorization: t.track_authorization,
          media: t.media
        }));
      }
    }
  } catch {}
  return [];
}

export async function findSoundCloudMatch(queries: string[], targetTitle?: string, targetArtist?: string): Promise<StreamResolutionResult | null> {
  const clientId = await getValidSoundCloudClientId();
  for (const q of queries) {
    if (!q || !q.trim()) continue;
    try {
      const scSearchRes = await fetch(
        `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q.trim())}&client_id=${clientId}&limit=6`,
        { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(3500) }
      );
      if (scSearchRes.ok) {
        const scData = await scSearchRes.json();
        for (const item of scData.collection || []) {
          const durSec = Math.round((item.duration || 0) / 1000);
          // CRITICAL: Reject 30-second Go+ preview snippets (< 45s) when matching full tracks!
          if (durSec < 45) continue;

          // Check title & artist accuracy if target info is provided
          if (targetTitle) {
            const matches = isAccurateMatch(item.title, item.user?.username || "", targetTitle, targetArtist || "");
            if (!matches) continue;
          }

          const stream = await resolveSoundCloudStream(
            item.media?.transcodings || item.id,
            item.track_authorization
          );
          if (stream?.url) {
            return {
              url: stream.url,
              mimeType: "audio/mpeg",
              source: "soundcloud-match",
              isFullLength: true,
              duration: durSec
            };
          }
        }
      }
    } catch {}
  }
  return null;
}

export async function resolveSoundCloudTrack(track: {
  id: string;
  name?: string;
  artist?: string;
  duration?: number;
  url?: string;
}): Promise<StreamResolutionResult | null> {
  const rawId = String(track.id || "").replace(/^sc_/, "");
  const title = track.name || "";
  const artist = track.artist || "";
  const dur = Number(track.duration || 0);

  // If SoundCloud track has full length (dur >= 45s), resolve direct stream
  if (rawId && !isNaN(Number(rawId)) && (dur === 0 || dur >= 45)) {
    const scStream = await resolveSoundCloudStream(rawId);
    if (scStream?.url) {
      return {
        url: scStream.url,
        mimeType: "audio/mpeg",
        source: "soundcloud",
        isFullLength: true,
        duration: track.duration
      };
    }
  }

  // If track on SoundCloud is a 30-second snippet (Go+ preview), auto-upgrade to 320k Studio Master!
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

    // Full length SoundCloud match (dur >= 45s)
    const queries = [
      artist ? `${title} ${artist}` : null,
      title
    ].filter(Boolean) as string[];

    const matched = await findSoundCloudMatch(queries, title, artist);
    if (matched) return matched;
  }

  // If direct stream was 30s but nothing else matched, play direct as fallback
  if (rawId && !isNaN(Number(rawId))) {
    const scStream = await resolveSoundCloudStream(rawId);
    if (scStream?.url) {
      return {
        url: scStream.url,
        mimeType: "audio/mpeg",
        source: "soundcloud-preview",
        isFullLength: dur >= 45,
        duration: track.duration || 30
      };
    }
  }

  return null;
}
