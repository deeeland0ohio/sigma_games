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

/**
 * Client-side last resort, used only when /api/music/url did not answer.
 *
 * This used to search every other catalog for something with a similar title,
 * which is exactly how the wrong song ended up playing under the right name.
 * Now it only ever returns audio that belongs to the track itself:
 *   - YouTube: the exact video id that was clicked
 *   - Deezer / Octave: the track's own 30-second preview
 *   - SoundCloud: nothing (its streams need the server's client id)
 */
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
