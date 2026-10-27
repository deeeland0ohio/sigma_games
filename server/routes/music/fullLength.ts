import { StreamResolutionResult } from "./types";
import { TrackIdentity, buildQueries, isSameRecording, titleCovers } from "./match";
import { resolveYouTubeAudioStream, searchYouTubeRaw } from "./youtubeStream";
import { resolveSoundCloudStream, searchSoundCloudTracks } from "./soundcloudApi";

/**
 * Full-length audio backends.
 *
 * Deezer and iTunes only hand out 30-second previews, and YouTube audio often
 * cannot be extracted from a server IP, so full tracks usually have to come
 * from a second catalog. That is acceptable as long as the audio is verifiably
 * the same recording as the metadata the user clicked — which is what
 * `isSameRecording` enforces. No candidate, no substitution.
 */

const SAAVN_ENDPOINTS = [
  "https://saavn-api-virid.vercel.app/api/search/songs",
  "https://saavn.me/api/search/songs",
];

interface SaavnCandidate {
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

async function searchSaavn(query: string): Promise<SaavnCandidate[]> {
  for (const endpoint of SAAVN_ENDPOINTS) {
    try {
      const response = await fetch(
        `${endpoint}?query=${encodeURIComponent(query)}&limit=10`,
        { headers: { "User-Agent": "x8rr-music/1.0" }, signal: AbortSignal.timeout(6000) }
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

export async function findSaavnMatch(identity: TrackIdentity): Promise<StreamResolutionResult | null> {
  for (const query of buildQueries(identity)) {
    const candidates = await searchSaavn(query);
    if (candidates.length === 0) continue;

    const verified = candidates
      .filter((candidate) => isSameRecording(candidate, identity))
      .sort((a, b) => Math.abs(a.duration - (identity.duration || a.duration)) - Math.abs(b.duration - (identity.duration || b.duration)));

    const best = verified[0];
    if (best) {
      const url = pickAudioUrl(best);
      return {
        url,
        mimeType: /\.mp4(\?|$)/i.test(url) ? "audio/mp4" : "audio/mpeg",
        source: "full-length",
        isFullLength: true,
        duration: best.duration || identity.duration,
      };
    }
  }
  return null;
}

/** Prefer official artist channels and topic channels over reuploads. */
function channelScore(author: string): number {
  const lower = author.toLowerCase();
  if (lower.endsWith("- topic")) return 0;
  if (lower.includes("vevo") || lower.includes("official")) return 1;
  return 2;
}

export async function findYouTubeMatch(identity: TrackIdentity): Promise<StreamResolutionResult | null> {
  const queries = buildQueries(identity).map((query) => `${query} official audio`);

  for (const query of queries) {
    const items = await searchYouTubeRaw(query, 10);
    const verified = items
      .filter((item) => isSameRecording({ title: item.title, artist: item.author, duration: item.duration }, identity))
      .sort((a, b) => channelScore(a.author) - channelScore(b.author));

    for (const item of verified.slice(0, 2)) {
      const stream = await resolveYouTubeAudioStream(item.videoId);
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
  }
  return null;
}

/**
 * SoundCloud as a last-resort catalog.
 *
 * These are user uploads, so the bar is higher than for a licensed catalog:
 * the candidate title must contain every word of the real title (uploads
 * append the artist, e.g. "Let Down - Radiohead"), the artist must be
 * credited, and the length must agree within 2%. A reupload of the real
 * recording passes; a different take, edit or cover does not.
 */
export async function findSoundCloudMatch(identity: TrackIdentity): Promise<StreamResolutionResult | null> {
  if (!identity.title) return null;
  const target = identity.duration || 0;

  for (const query of buildQueries(identity)) {
    const candidates = await searchSoundCloudTracks(query, 12);

    const verified = candidates
      .filter((candidate) => {
        if (!candidate.streamable || !candidate.duration) return false;
        if (!titleCovers(identity.title!, candidate.title)) return false;
        if (!isSameRecording({ title: candidate.title, artist: candidate.artist, duration: candidate.duration }, identity)) return false;
        // Tighter length window than the general gate: an edit that is 8
        // seconds short is a different recording, not a remaster.
        if (target > 0) {
          const drift = Math.abs(target - candidate.duration) / target;
          if (drift > 0.02) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.verifiedUser !== b.verifiedUser) return a.verifiedUser ? -1 : 1;
        return Math.abs(target - a.duration) - Math.abs(target - b.duration);
      });

    for (const candidate of verified.slice(0, 3)) {
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
  }
  return null;
}

/**
 * Last resort for a full track: try each backend, first verified match wins.
 * Returns null when nothing can be proven to be the same recording.
 *
 * Order is by audio quality, not by convenience: licensed 320k catalog first,
 * then official YouTube uploads, then SoundCloud reuploads.
 */
export async function resolveFullLengthAudio(identity: TrackIdentity): Promise<StreamResolutionResult | null> {
  if (!identity.title) return null;
  const saavn = await findSaavnMatch(identity);
  if (saavn) return saavn;
  const youtube = await findYouTubeMatch(identity);
  if (youtube) return youtube;
  return findSoundCloudMatch(identity);
}
