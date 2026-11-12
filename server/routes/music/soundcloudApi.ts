const FALLBACK_CLIENT_IDS = [
  "pmagYZKQF6mRtNmtRzPkXSQJ76jYHLN8",
  "Pb72ranhoyt6gw7hM7TkzUItXlMWSNSo",
  "b3e20e360f4e1f744e2de266ab0e5f29",
];

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const CLIENT_ID_TTL = 60 * 60 * 1000;
const CLIENT_ID_RETRY = 2 * 60 * 1000;

let cachedClientId = process.env.SOUNDCLOUD_CLIENT_ID || "";
let lastClientIdFetch = 0;

async function clientIdWorks(candidate: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api-v2.soundcloud.com/search/tracks?q=a&limit=1&client_id=${candidate}`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(4000) }
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function scrapeClientId(): Promise<string | null> {
  try {
    const res = await fetch("https://soundcloud.com/", {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    const candidates = new Set<string>();
    for (const match of html.matchAll(/client_id["']?\s*[:=]\s*["']([a-zA-Z0-9]{32})["']/g)) {
      candidates.add(match[1]);
    }

    for (const match of html.matchAll(/\b[a-zA-Z0-9]{32}\b/g)) {
      candidates.add(match[0]);
    }

    for (const candidate of candidates) {
      if (await clientIdWorks(candidate)) return candidate;
    }
  } catch {}
  return null;
}

export async function getValidSoundCloudClientId(): Promise<string> {
  const now = Date.now();
  if (cachedClientId && lastClientIdFetch && now - lastClientIdFetch < CLIENT_ID_TTL) {
    return cachedClientId;
  }

  const fresh = await scrapeClientId();
  if (fresh) {
    cachedClientId = fresh;
    lastClientIdFetch = now;
    return fresh;
  }

  lastClientIdFetch = now - CLIENT_ID_TTL + CLIENT_ID_RETRY;
  return cachedClientId || FALLBACK_CLIENT_IDS[0];
}

export function invalidateSoundCloudClientId(): void {
  cachedClientId = "";
  lastClientIdFetch = 0;
}

export async function soundcloudGet(path: string, timeoutMs = 8000): Promise<Response | null> {
  const separator = path.includes("?") ? "&" : "?";

  for (let attempt = 0; attempt < 2; attempt++) {
    const clientId = await getValidSoundCloudClientId();
    try {
      const res = await fetch(
        `https://api-v2.soundcloud.com${path}${separator}client_id=${clientId}`,
        { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) }
      );
      if (res.ok) return res;
      if (res.status === 401 && attempt === 0) {
        invalidateSoundCloudClientId();
        continue;
      }
      return res;
    } catch {
      return null;
    }
  }
  return null;
}

export { USER_AGENT as SOUNDCLOUD_USER_AGENT };

export async function resolveSoundCloudStream(trackId: any, trackAuth?: string): Promise<{ url: string } | null> {
  try {
    const clientId = await getValidSoundCloudClientId();
    let authParam = trackAuth ? `&track_authorization=${trackAuth}` : "";

    const trackRes = await soundcloudGet(`/tracks/${trackId}`, 6000);
    if (!trackRes || !trackRes.ok) return null;

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

    const ordered = [
      ...transcodings.filter((t) => t.format?.protocol === "progressive"),
      ...transcodings.filter((t) => t.format?.protocol === "hls"),
      ...transcodings,
    ];

    for (const transcoding of ordered) {
      if (!transcoding?.url) continue;
      try {
        const streamRes = await fetch(`${transcoding.url}?client_id=${clientId}${authParam}`, {
          headers: { "User-Agent": USER_AGENT },
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
  duration: number;
  streamable: boolean;
  verifiedUser: boolean;
  permalink?: string;
}

export async function searchSoundCloudTracks(query: string, limit = 12): Promise<SoundCloudCandidate[]> {
  try {
    const res = await soundcloudGet(`/search/tracks?q=${encodeURIComponent(query)}&limit=${limit}`, 8000);
    if (!res || !res.ok) return [];
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
