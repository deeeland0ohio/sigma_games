export interface MusicTrackResult {
  id: string;
  rawId?: string | number;
  name: string;
  artist: string;
  album?: string;
  pic?: string;
  duration: number;
  durationFormatted?: string;
  source: string;
  previewUrl?: string;
  isrc?: string;
  isVerified?: boolean;
  audioQuality?: string;
  playbackCount?: number;
  views?: number;
  track_authorization?: string;
  media?: any;
}

export interface StreamResolutionResult {
  url: string;
  mimeType: string;
  source: string;
  isFullLength: boolean;
  duration?: number;
}

// Global In-Memory Cache
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 20; // 20 minutes

export function getCached<T>(key: string): T | null {
  const item = cache.get(key);
  if (item && Date.now() - item.timestamp < CACHE_TTL) {
    return item.data as T;
  }
  return null;
}

export function setCache(key: string, data: any): void {
  cache.set(key, { data, timestamp: Date.now() });
  if (cache.size > 3000) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
}

export function formatSeconds(secs: number): string {
  if (!secs || isNaN(secs) || secs <= 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function isAlteredAudio(title: string): boolean {
  const lower = (title || "").toLowerCase();
  return (
    lower.includes("slowed") ||
    lower.includes("speed up") ||
    lower.includes("sped up") ||
    lower.includes("nightcore") ||
    lower.includes("daycore") ||
    lower.includes("reverb") ||
    lower.includes("remix") ||
    lower.includes("mashup") ||
    lower.includes("hoodtrap") ||
    lower.includes("bass boosted") ||
    lower.includes("chipmunk")
  );
}

export function isAccurateMatch(candTitle: string, candArtist: string, targetTitle: string, targetArtist: string): boolean {
  const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  const cT = norm(candTitle);
  const cA = norm(candArtist);
  const tT = norm(targetTitle);
  const tA = norm(targetArtist);

  if (!cT || !tT) return false;

  const stopWords = new Set(["the", "a", "an", "and", "or", "in", "on", "of", "to", "for", "with", "by", "audio", "video", "official", "music", "feat", "ft"]);
  const tWords = tT.split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w));
  const tArtistWords = tA.split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w));

  // 1. Title match: majority of significant title words must be in candidate title
  if (tWords.length > 0) {
    const matchedWords = tWords.filter(w => cT.includes(w));
    if (matchedWords.length === 0 || matchedWords.length < Math.ceil(tWords.length * 0.6)) {
      return false;
    }
  }

  // 2. Artist check
  if (tArtistWords.length > 0) {
    const artistMatched = tArtistWords.some(w => cA.includes(w) || cT.includes(w));
    const cWords = cT.split(/\s+/).filter(w => w.length >= 2);
    const isVeryCloseTitle = Math.abs(cWords.length - tWords.length) <= 1;

    if (!artistMatched && !isVeryCloseTitle) {
      return false;
    }
  }

  return true;
}
