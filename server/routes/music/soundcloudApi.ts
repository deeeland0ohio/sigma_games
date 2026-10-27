/**
 * Low-level SoundCloud API access.
 *
 * Kept separate from the SoundCloud *source* so other resolvers can search it
 * for a verified copy of a track without importing the source layer (which
 * itself imports the full-length layer, and would form a cycle).
 */

/**
 * SoundCloud client ids.
 *
 * The public `api-v2` endpoints answer 401 without a valid 32-character
 * client id, and SoundCloud rotates them — the ids that used to be copy-pasted
 * into projects like this one have been dead for a while. A dead id is not a
 * loud failure either: every search just comes back empty, so the whole
 * source looks broken while nothing is thrown.
 *
 * The homepage still embeds a working id, so it is scraped and then *verified*
 * with a real request before use. A 401 anywhere invalidates it and forces a
 * fresh scrape. `SOUNDCLOUD_CLIENT_ID` overrides the scrape entirely.
 */
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

/** Cheap check that a candidate id actually works. */
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
    // The page also carries the id as a bare token in its bootstrap data.
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

  // Do not scrape again on every request when SoundCloud is unreachable.
  lastClientIdFetch = now - CLIENT_ID_TTL + CLIENT_ID_RETRY;
  return cachedClientId || FALLBACK_CLIENT_IDS[0];
}

/** Force a fresh id after a 401. */
export function invalidateSoundCloudClientId(): void {
  cachedClientId = "";
  lastClientIdFetch = 0;
}

/**
 * GET on api-v2 with the current client id, retrying once with a fresh id
 * when the cached one has been revoked.
 */
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

/** A playable URL for one exact SoundCloud track id. */
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
  duration: number; // seconds
  streamable: boolean;
  verifiedUser: boolean;
  permalink?: string;
}

/** Raw track search, for finding a specific recording by metadata. */
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
