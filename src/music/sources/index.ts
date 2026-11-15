import { ClientMusicTrack } from "./types";
import { fetchClientAudius, resolveClientAudiusTrack } from "./audius";
import { fetchClientApple, resolveClientAppleTrack } from "./itunes";

export { fetchClientAudius, fetchClientApple };

export async function resolveClientTrackAudio(track: any): Promise<{ url: string; duration?: number }> {
  const source = String(track.source || "").toLowerCase();
  const id = String(track.rawId || track.id || "");

  if (source === "audius" || id.startsWith("audius_")) {
    return resolveClientAudiusTrack(track);
  }
  if (source === "apple" || id.startsWith("apple_")) {
    return resolveClientAppleTrack(track);
  }
  if (typeof track.previewUrl === "string" && track.previewUrl.startsWith("http")) {
    return { url: track.previewUrl };
  }
  return { url: "", duration: 0 };
}
