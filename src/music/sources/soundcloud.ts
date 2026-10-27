import { ClientMusicTrack, formatDuration } from "./types";

export const SOUNDCLOUD_CLIENT_IDS = [
  "pmagYZKQF6mRtNmtRzPkXSQJ76jYHLN8",
  "Pb72ranhoyt6gw7hM7TkzUItXlMWSNSo",
  "b3e20e360f4e1f744e2de266ab0e5f29",
];

/** Client-side fallback search for SoundCloud (search only — playback is the server's job). */
export async function fetchClientSoundCloud(query: string = "", page: number = 1, limit: number = 30): Promise<ClientMusicTrack[]> {
  const searchTerm = query.trim() || "popular";
  const offset = (page - 1) * limit;

  for (const clientId of SOUNDCLOUD_CLIENT_IDS) {
    try {
      const res = await fetch(
        `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(searchTerm)}&client_id=${clientId}&limit=${limit}&offset=${offset}`,
        { signal: AbortSignal.timeout(4000) }
      );
      if (!res.ok) continue;

      const data = await res.json();
      return (data?.collection || [])
        .filter((t: any) => {
          const seconds = Math.round((t.duration || 0) / 1000);
          return seconds >= 20 && seconds <= 1200;
        })
        .map((t: any) => {
          const seconds = Math.round((t.duration || 0) / 1000);
          return {
            id: `sc_${t.id}`,
            rawId: t.id,
            name: t.title || "Untitled Track",
            artist: t.user?.username || "SoundCloud Artist",
            isVerified: Boolean(t.user?.verified),
            album: t.genre || "SoundCloud",
            duration: seconds,
            formattedDuration: formatDuration(seconds),
            pic: (t.artwork_url || t.user?.avatar_url || "").replace("-large", "-t500x500"),
            source: "soundcloud",
            isrc: t.isrc,
          };
        });
    } catch {}
  }
  return [];
}
