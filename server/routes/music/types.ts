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

// Recording-identity checks live in ./match — they are the only matcher now.
