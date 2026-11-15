import { fetchClientDeezer, resolveClientDeezerTrack } from "./deezer";
import { fetchClientOctave, resolveClientOctaveTrack } from "./octave";
import { fetchClientYouTube } from "./youtube";
import { fetchClientSoundCloud } from "./soundcloud";

export {
  fetchClientDeezer,
  resolveClientDeezerTrack,
  fetchClientOctave,
  resolveClientOctaveTrack,
  fetchClientYouTube,
  fetchClientSoundCloud
};

export async function resolveClientTrackAudio(track: any): Promise<{ url: string; duration?: number }> {
  const source = (track.source || "").toLowerCase();
  const id = String(track.rawId || track.id || "");

  if (source === "youtube" || id.startsWith("yt_")) {
    return { url: "", duration: 0 };
  }
  if (source === "deezer" || id.startsWith("dz_")) {
    return resolveClientDeezerTrack(track);
  }
  if (source === "octave" || id.startsWith("octave_")) {
    return resolveClientOctaveTrack(track);
  }
  return { url: "", duration: 0 };
}
