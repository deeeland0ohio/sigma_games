/**
 * Low-level SoundCloud API access.
 *
 * Kept separate from the SoundCloud *source* so other resolvers can search it
 * for a verified copy of a track without importing the source layer (which
 * itself imports the full-length layer, and would form a cycle).
 */

const SOUNDCLOUD_CLIENT_IDS = [
  "pmagYZKQF6mRtNmtRzPkXSQJ76jYHLN8",
  "Pb72ranhoyt6gw7hM7TkzUItXlMWSNSo",
  "b3e20e360f4e1f744e2de266ab0e5f29",
];

let cachedClientId = SOUNDCLOUD_CLIENT_IDS[0];
let lastClientIdFetch = 0;

export async function getValidSoundCloudClientId(): Promise<string> {
  const now = Date.now();
  if (cachedClientId && now - lastClientIdFetch < 60 * 60 * 1000) return cachedClientId;

  try {
    const res = await fetch("https://soundcloud.com/discover", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const html = await res.text();
      const scriptUrls = html.match(/https:\/\/[a-z0-9-]+\.sndcdn\.com\/assets\/[a-zA-Z0-9.-]+\.js/g) || [];
      for (const scriptUrl of scriptUrls.slice(0, 5)) {
        try {
          const jsRes = await fetch(scriptUrl, { signal: AbortSignal.timeout(3000) });
          if (!jsRes.ok) continue;
          const match = (await jsRes.text()).match(/client_id["']?\s*[:=]\s*["']([a-zA-Z0-9]{32})["']/);
          if (match?.[1]) {
            cachedClientId = match[1];
            lastClientIdFetch = now;
            return match[1];
          }
        } catch {}
      }
    }
  } catch {}

  return cachedClientId || SOUNDCLOUD_CLIENT_IDS[0];
}

/** A playable URL for one exact SoundCloud track id. */
export async function resolveSoundCloudStream(trackId: any, trackAuth?: string): Promise<{ url: string } | null> {
  try {
    const clientId = await getValidSoundCloudClientId();
    let authParam = trackAuth ? `&track_authorization=${trackAuth}` : "";

    const trackRes = await fetch(`https://api-v2.soundcloud.com/tracks/${trackId}?client_id=${clientId}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(6000),
    });
    if (!trackRes.ok) return null;

    const trackData: any = await trackRes.json();
    if (trackData.track_authorization && !authParam) {
      authParam = `&track_authorization=${trackData.track_authorization}`;
    }

    const transcodings: any[] = (trackData.media?.transcodings || []).filter((t: any) => {
      const url = String(t.url || "");
      const protocol = String(t.format?.protocol || "");
      return !url.includes("encrypted") && !url.includes("/cbcs/") && !url.includes("/cenc/") && !protocol.includes("encrypted");
    });
    if (transcodings.length === 0) return null;

    // Progressive first (plain MP3 the <audio> element can stream and seek),
    // then HLS for tracks that only offer that.
    const ordered = [
      ...transcodings.filter((t) => t.format?.protocol === "progressive"),
      ...transcodings.filter((t) => t.format?.protocol === "hls"),
      ...transcodings,
    ];

    for (const transcoding of ordered) {
      if (!transcoding?.url) continue;
      try {
        const streamRes = await fetch(`${transcoding.url}?client_id=${clientId}${authParam}`, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
          signal: AbortSignal.timeout(6000),
        });
        if (!streamRes.ok) continue;
        const streamData: any = await streamRes.json();
        if (streamData?.url && !streamData.url.includes("/cbcs/") && !streamData.url.includes("/cenc/")) {
          return { url: streamData.url };
        }
      } catch {}
    }
  } catch (err) {
    console.warn("[music] SoundCloud stream error:", err);
  }
  return null;
}

export interface SoundCloudCandidate {
  id: number;
  title: string;
  artist: string;
  duration: number; // seconds
  streamable: boolean;
  verifiedUser: boolean;
  permalink?: string;
}

/** Raw track search, for finding a specific recording by metadata. */
export async function searchSoundCloudTracks(query: string, limit = 12): Promise<SoundCloudCandidate[]> {
  const clientId = await getValidSoundCloudClientId();
  try {
    const res = await fetch(
      `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${clientId}&limit=${limit}`,
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data.collection || [])
      .filter((t: any) => t?.id && t?.title)
      .map((t: any) => ({
        id: Number(t.id),
        title: String(t.title),
        artist: String(t.user?.username || ""),
        duration: Math.round(Number(t.duration || 0) / 1000),
        streamable: t.streamable !== false,
        verifiedUser: Boolean(t.user?.verified),
        permalink: t.permalink_url,
      }));
  } catch {
    return [];
  }
}
