import { ClientMusicTrack } from "./types";

const noResults = async (_query?: string, _page?: number, _limit?: number): Promise<ClientMusicTrack[]> => [];

export const fetchClientDeezer = noResults;
export const fetchClientOctave = noResults;
export const fetchClientYouTube = noResults;
export const fetchClientSoundCloud = noResults;

export async function resolveClientTrackAudio(_track: any): Promise<{ url: string; duration?: number }> {
  return { url: "", duration: 0 };
}
