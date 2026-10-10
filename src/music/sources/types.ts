export interface ClientMusicTrack {
  id: string;
  rawId?: string | number;
  name: string;
  artist: string;
  album?: string;
  pic?: string;
  duration: number;
  formattedDuration: string;
  source: string;
  previewUrl?: string;
  isrc?: string;
  isVerified?: boolean;
  audioQuality?: string;
  playbackCount?: number;
  track_authorization?: string;
  media?: any;
}

export function formatDuration(secs: number): string {
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

  if (tWords.length > 0) {
    const matchedWords = tWords.filter(w => cT.includes(w));
    if (matchedWords.length === 0 || matchedWords.length < Math.ceil(tWords.length * 0.6)) {
      return false;
    }
  }

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
