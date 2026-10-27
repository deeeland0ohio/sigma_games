import { StreamResolutionResult } from "./types";
import { TrackIdentity, buildQueries, isSameRecording, titleCovers } from "./match";
import { resolveYouTubeAudioStream, searchYouTubeRaw, YouTubeSearchItem } from "./youtubeStream";
import {
  resolveSoundCloudStream,
  searchSoundCloudTracks,
  SoundCloudCandidate,
} from "./soundcloudApi";

/**
 * Full-length audio backends.
 *
 * Deezer and iTunes only hand out 30-second previews, and YouTube audio often
 * cannot be extracted from a server IP, so full tracks usually have to come
 * from a second catalog. That is acceptable as long as the audio is verifiably
 * the same recording as the metadata the user clicked — which is what
 * `isSameRecording` enforces. No candidate, no substitution.
 *
 * Everything here runs under ONE deadline (`MUSIC_RESOLVE_BUDGET_MS`, 18s).
 * That matters: the three catalogs barely know about each other, so searching
 * them one after another meant saavn's 2 queries × 2 endpoints × 6s, then an
 * unbounded YouTube search, then yt-dlp twice per candidate for 25s and 15s,
 * then SoundCloud — four to five minutes for a track that was never going to
 * resolve. The host answers 503/504 long before that, which is exactly what a
 * hanging `GET /api/music/url` looked like. Now the catalogs are searched in
 * parallel, extraction gets whatever time is left, and the caller gets a
 * straight answer inside the budget so it can fall back to the preview.
 */

/** Wall-clock budget for a whole full-length lookup, including extraction. */
export const RESOLVE_BUDGET_MS = Math.max(4000, Number(process.env.MUSIC_RESOLVE_BUDGET_MS) || 18000);

/** Time a single HTTP step may take, never past the deadline. */
function stepTimeout(deadline: number, capMs: number): number {
  return Math.max(0, Math.min(capMs, deadline - Date.now()));
}

/** How much of the budget the (parallel) catalog searches may use. */
function searchWindow(end: number): number {
  const left = Math.max(0, end - Date.now());
  return Date.now() + Math.max(2500, Math.round(left * 0.55));
}

const SAAVN_ENDPOINTS = [
  "https://saavn-api-virid.vercel.app/api/search/songs",
  "https://saavn.me/api/search/songs",
];

export interface SaavnCandidate {
  title: string;
  artist: string;
  duration: number;
  downloadUrls: { quality: string; url: string }[];
}

function toSaavnCandidate(raw: any): SaavnCandidate | null {
  if (!raw?.name) return null;
  const artist =
    raw.artists?.primary?.map((a: any) => a.name).join(", ") ||
    raw.primaryArtists ||
    raw.artist ||
    "";
  const downloadUrls = Array.isArray(raw.downloadUrl)
    ? raw.downloadUrl
        .filter((entry: any) => typeof entry?.url === "string" && entry.url.startsWith("http"))
        .map((entry: any) => ({ quality: String(entry.quality || ""), url: entry.url }))
    : [];
  return {
    title: String(raw.name),
    artist: String(artist),
    duration: Number(raw.duration || 0),
    downloadUrls,
  };
}

export async function searchSaavn(query: string, deadline: number): Promise<SaavnCandidate[]> {
  for (const endpoint of SAAVN_ENDPOINTS) {
    const timeout = stepTimeout(deadline, 6000);
    if (timeout < 1000) return [];
    try {
      const response = await fetch(
        `${endpoint}?query=${encodeURIComponent(query)}&limit=10`,
        { headers: { "User-Agent": "x8rr-music/1.0" }, signal: AbortSignal.timeout(timeout) }
      );
      if (!response.ok) continue;
      const data: any = await response.json();
      const results = data?.data?.results || data?.results || [];
      const candidates = (Array.isArray(results) ? results : [])
        .map(toSaavnCandidate)
        .filter((c: SaavnCandidate | null): c is SaavnCandidate => Boolean(c) && Boolean(c!.downloadUrls.length));
      if (candidates.length > 0) return candidates;
    } catch {
      // try the next endpoint
    }
  }
  return [];
}

/** Best available file for a saavn candidate: 320kbps when offered. */
function pickAudioUrl(candidate: SaavnCandidate): string {
  const preferred = candidate.downloadUrls.find((d) => d.quality.includes("320"));
  return (preferred || candidate.downloadUrls[candidate.downloadUrls.length - 1]).url;
}

function saavnResult(candidate: SaavnCandidate, identity: TrackIdentity): StreamResolutionResult {
  const url = pickAudioUrl(candidate);
  return {
    url,
    mimeType: /\.mp4(\?|$)/i.test(url) ? "audio/mp4" : "audio/mpeg",
    source: "full-length",
    isFullLength: true,
    duration: candidate.duration || identity.duration,
  };
}

/** Verified saavn matches for this identity, best duration agreement first. */
export async function collectSaavnCandidates(
  identity: TrackIdentity,
  deadline: number
): Promise<SaavnCandidate[]> {
  for (const query of buildQueries(identity)) {
    if (stepTimeout(deadline, 6000) < 1500) break;
    const candidates = await searchSaavn(query, deadline);
    if (candidates.length === 0) continue;

    const verified = candidates
      .filter((candidate) => isSameRecording(candidate, identity))
      .sort(
        (a, b) =>
          Math.abs(a.duration - (identity.duration || a.duration)) -
          Math.abs(b.duration - (identity.duration || b.duration))
      );

    if (verified.length > 0) return verified;
  }
  return [];
}

/** Prefer official artist channels and topic channels over reuploads. */
function channelScore(author: string): number {
  const lower = author.toLowerCase();
  if (lower.endsWith("- topic")) return 0;
  if (lower.includes("vevo") || lower.includes("official")) return 1;
  return 2;
}

/**
 * Verified YouTube videos of the same recording, best channel first.
 * No extraction happens here — that is the expensive part and is done later,
 * in order, while the deadline allows.
 */
export async function collectYouTubeCandidates(
  identity: TrackIdentity,
  deadline: number
): Promise<YouTubeSearchItem[]> {
  const queries = buildQueries(identity).map((query) => `${query} official audio`);
  const seen = new Set<string>();
  const verified: YouTubeSearchItem[] = [];

  for (const query of queries) {
    if (stepTimeout(deadline, 6000) < 1500) break;
    const items = await searchYouTubeRaw(query, 10, deadline);
    for (const item of items) {
      if (!item.videoId || seen.has(item.videoId)) continue;
      seen.add(item.videoId);
      if (isSameRecording({ title: item.title, artist: item.author, duration: item.duration }, identity)) {
        verified.push(item);
      }
    }
    if (verified.length >= 3) break;
  }

  return verified.sort((a, b) => channelScore(a.author) - channelScore(b.author));
}

/**
 * Verified SoundCloud uploads of the same recording.
 *
 * These are user uploads, so the bar is higher than for a licensed catalog:
 * the candidate title must contain every word of the real title (uploads
 * append the artist, e.g. "Let Down - Radiohead"), the artist must be
 * credited, and the length must agree within 2%. A reupload of the real
 * recording passes; a different take, edit or cover does not.
 */
export async function collectSoundCloudCandidates(
  identity: TrackIdentity,
  deadline: number
): Promise<SoundCloudCandidate[]> {
  if (!identity.title) return [];
  const target = identity.duration || 0;
  const seen = new Set<number>();
  const verified: SoundCloudCandidate[] = [];

  for (const query of buildQueries(identity)) {
    if (stepTimeout(deadline, 8000) < 1500) break;
    const candidates = await searchSoundCloudTracks(query, 12);

    for (const candidate of candidates) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      if (!candidate.streamable || !candidate.duration) continue;
      if (!titleCovers(identity.title!, candidate.title)) continue;
      if (
        !isSameRecording(
          { title: candidate.title, artist: candidate.artist, duration: candidate.duration },
          identity
        )
      ) {
        continue;
      }
      // Tighter length window than the general gate: an edit that is 8
      // seconds short is a different recording, not a remaster.
      if (target > 0) {
        const drift = Math.abs(target - candidate.duration) / target;
        if (drift > 0.02) continue;
      }
      verified.push(candidate);
    }
    if (verified.length >= 3) break;
  }

  return verified.sort((a, b) => {
    if (a.verifiedUser !== b.verifiedUser) return a.verifiedUser ? -1 : 1;
    return Math.abs(target - a.duration) - Math.abs(target - b.duration);
  });
}

/**
 * Last resort for a full track: search every backend at once, then extract in
 * order of audio quality while the deadline holds. Returns null when nothing
 * can be proven to be the same recording, or when the budget runs out.
 */
export async function resolveFullLengthAudio(
  identity: TrackIdentity,
  deadline?: number
): Promise<StreamResolutionResult | null> {
  if (!identity.title) return null;

  const end = deadline ?? Date.now() + RESOLVE_BUDGET_MS;
  const searchesEnd = searchWindow(end);

  const [saavn, youtube, soundcloud] = await Promise.all([
    collectSaavnCandidates(identity, searchesEnd).catch(() => []),
    collectYouTubeCandidates(identity, searchesEnd).catch(() => []),
    collectSoundCloudCandidates(identity, searchesEnd).catch(() => []),
  ]);

  // Licensed catalog first: it is the highest-quality match when it exists.
  if (saavn[0]) return saavnResult(saavn[0], identity);

  for (const item of youtube.slice(0, 2)) {
    if (stepTimeout(end, 12000) < 2500) break;
    const stream = await resolveYouTubeAudioStream(item.videoId, end);
    if (stream?.url) {
      return {
        url: stream.url,
        mimeType: stream.mimeType,
        source: "full-length",
        isFullLength: true,
        duration: stream.duration || item.duration || identity.duration,
      };
    }
  }

  for (const candidate of soundcloud.slice(0, 2)) {
    if (stepTimeout(end, 6000) < 1500) break;
    const stream = await resolveSoundCloudStream(candidate.id);
    if (stream?.url) {
      return {
        url: stream.url,
        mimeType: stream.url.includes(".m3u8") ? "application/vnd.apple.mpegurl" : "audio/mpeg",
        source: "full-length",
        isFullLength: true,
        duration: candidate.duration || identity.duration,
      };
    }
  }

  return null;
}
