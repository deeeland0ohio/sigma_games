import { ClientMusicTrack, formatDuration } from "./types";

const APP_NAME = "SigmaGames";
const BASE = "https://api.audius.co/v1";

interface AudiusTrack {
  id: string;
  title: string;
  duration: number;
  is_streamable?: boolean;
  is_delete?: boolean;
  genre?: string;
  artwork?: Record<string, string>;
  user?: { name?: string };
}

function toTrack(track: AudiusTrack): ClientMusicTrack | null {
  if (track.is_delete || track.is_streamable === false) return null;
  const art = track.artwork || {};
  return {
    id: `audius_${track.id}`,
    rawId: track.id,
    name: track.title,
    artist: track.user?.name || "Audius",
    album: track.genre || "Audius",
    pic: art["480x480"] || art["150x150"] || art["1000x1000"],
    duration: track.duration,
    formattedDuration: formatDuration(track.duration),
    source: "audius",
    isVerified: true
  };
}

async function get(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`audius ${res.status}`);
  return res.json();
}

export async function fetchClientAudius(query: string = "", page: number = 1, limit: number = 30): Promise<ClientMusicTrack[]> {
  const offset = Math.max(0, (page - 1) * limit);
  const trimmed = query.trim();
  const path = trimmed
    ? `/tracks/search?query=${encodeURIComponent(trimmed)}&app_name=${APP_NAME}&limit=${limit}&offset=${offset}`
    : `/tracks/trending?app_name=${APP_NAME}&limit=${limit}&time=week&offset=${offset}`;

  const data = await get(path);
  return (data?.data || [])
    .map(toTrack)
    .filter((track: ClientMusicTrack | null): track is ClientMusicTrack => Boolean(track));
}

export async function resolveClientAudiusTrack(track: any): Promise<{ url: string; duration?: number }> {
  const id = String(track.rawId || track.id || "").replace(/^audius_/, "");
  if (!id) return { url: "", duration: 0 };
  return {
    url: `${BASE}/tracks/${id}/stream?app_name=${APP_NAME}`,
    duration: track.duration
  };
}
