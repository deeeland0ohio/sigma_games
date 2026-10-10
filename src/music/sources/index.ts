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

  if (source === "deezer" || id.startsWith("dz_")) {
    return resolveClientDeezerTrack(track);
  }
  if (source === "octave" || id.startsWith("octave_")) {
    return resolveClientOctaveTrack(track);
  }
  if (source === "youtube" || id.startsWith("yt_") || (id.length === 11 && !id.includes("_"))) {
    return resolveClientYouTubeTrack(track);
  }
  if (source === "soundcloud" || id.startsWith("sc_")) {
    return resolveClientYouTubeTrack(track);
  }

  return resolveClientDeezerTrack(track);
}
