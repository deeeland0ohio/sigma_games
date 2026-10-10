import { ClientMusicTrack, formatDuration, isAccurateMatch } from "./types";

export const SOUNDCLOUD_CLIENT_IDS = [
  "pmagYZKQF6mRtNmtRzPkXSQJ76jYHLN8",
  "Pb72ranhoyt6gw7hM7TkzUItXlMWSNSo",
  "b3e20e360f4e1f744e2de266ab0e5f29"
];

export let activeSoundCloudClientId = SOUNDCLOUD_CLIENT_IDS[0];

export async function fetchClientSoundCloud(query: string = "", page: number = 1, limit: number = 30): Promise<ClientMusicTrack[]> {
  const searchTerm = query.trim() || "popular";
  const offset = (page - 1) * limit;

  for (const clientId of SOUNDCLOUD_CLIENT_IDS) {
    try {
      const res = await fetch(
        `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(searchTerm)}&client_id=${clientId}&limit=${limit}&offset=${offset}`,
        { signal: AbortSignal.timeout(4000) }
      );
      if (res.ok) {
        activeSoundCloudClientId = clientId;
        const data = await res.json();
        const collection = data?.collection || [];

        return collection
          .filter((t: any) => {
            const dur = Math.round((t.duration || 0) / 1000);
            return dur >= 20 && dur <= 1200;
          })
          .map((t: any) => {
            const art = t.artwork_url
              ? t.artwork_url.replace("-large", "-t500x500")
              : t.user?.avatar_url
              ? t.user.avatar_url.replace("-large", "-t500x500")
              : "";
            const durSec = Math.round((t.duration || 0) / 1000);

            return {
              id: `sc_${t.id}`,
              rawId: t.id,
              name: t.title || "Untitled Track",
              artist: t.user?.username || t.user?.name || "SoundCloud Artist",
              isVerified: Boolean(t.user?.verified),
              album: t.genre || "SoundCloud",
              duration: durSec,
              formattedDuration: formatDuration(durSec),
              pic: art,
              url: "",
              source: "soundcloud",
              media: t.media,
              isrc: t.isrc,
              track_authorization: t.track_authorization
            };
          });
      }
    } catch {}
  }
  return [];
}

export async function resolveClientSoundCloudMatch(queries: string[], targetTitle?: string, targetArtist?: string): Promise<{ url: string; duration?: number } | null> {
  const clientId = activeSoundCloudClientId;
  for (const q of queries) {
    if (!q || !q.trim()) continue;
    try {
      const res = await fetch(
        `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q.trim())}&client_id=${clientId}&limit=6`,
        { signal: AbortSignal.timeout(3500) }
      );
      if (res.ok) {
        const data = await res.json();
        for (const item of data.collection || []) {
          const durSec = Math.round((item.duration || 0) / 1000);
          if (durSec < 45) continue; // Reject 30s previews

          if (targetTitle) {
            const matches = isAccurateMatch(item.title, item.user?.username || "", targetTitle, targetArtist || "");
            if (!matches) continue;
          }

          const trans = (item.media?.transcodings || []).filter((t: any) =>
            !t.url?.includes("encrypted") && !t.url?.includes("/cbcs/") && !t.url?.includes("/cenc/")
          );
          const auth = item.track_authorization ? `&track_authorization=${item.track_authorization}` : "";
          for (const t of trans) {
            const linkRes = await fetch(`${t.url}?client_id=${clientId}${auth}`, { signal: AbortSignal.timeout(3000) });
            if (linkRes.ok) {
              const linkData = await linkRes.json();
              if (linkData?.url && !linkData.url.includes("/cbcs/") && !linkData.url.includes("/cenc/")) {
                return { url: linkData.url, duration: durSec };
              }
            }
          }
        }
      }
    } catch {}
  }
  return null;
}
