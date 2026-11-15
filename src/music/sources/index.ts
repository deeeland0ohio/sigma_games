import { getMusicStreamUrl } from "../api";

export async function resolveClientTrackAudio(track: any): Promise<{ url: string; duration?: number }> {
  const url = await getMusicStreamUrl(track).catch(() => "");
  return { url, duration: track?.duration };
}
