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
