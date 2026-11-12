import { fetchClientDeezer, resolveClientDeezerTrack } from "./deezer";
import { fetchClientOctave, resolveClientOctaveTrack } from "./octave";
import { fetchClientYouTube, resolveClientYouTubeTrack } from "./youtube";
import { fetchClientSoundCloud } from "./soundcloud";

export {
  fetchClientDeezer,
  resolveClientDeezerTrack,
  fetchClientOctave,
  resolveClientOctaveTrack,
  fetchClientYouTube,
  resolveClientYouTubeTrack,
  fetchClientSoundCloud
};

export async function resolveClientTrackAudio(track: any): Promise<{ url: string; duration?: number }> {
  const source = (track.source || "").toLowerCase();
  const id = String(track.rawId || track.id || "");

  if (source === "youtube" || id.startsWith("yt_")) {
    return resolveClientYouTubeTrack(track);
  }
  if (source === "deezer" || id.startsWith("dz_")) {
    return resolveClientDeezerTrack(track);
  }
  if (source === "octave" || id.startsWith("octave_")) {
    return resolveClientOctaveTrack(track);
  }
  return { url: "", duration: 0 };
}
