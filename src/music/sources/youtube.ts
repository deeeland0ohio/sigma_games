import { ClientMusicTrack } from "./types";

export async function fetchClientYouTube(_query: string = "", _page: number = 1, _limit: number = 30): Promise<ClientMusicTrack[]> {
  return [];
}

export async function resolveClientYouTubeTrack(track: any): Promise<{ url: string; duration?: number }> {
  const videoId = String(track.rawId || track.id || "").replace(/^yt_/, "");
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return { url: "", duration: 0 };

  try {
    const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "ANDROID_VR",
            clientVersion: "1.60.19",
            deviceMake: "Oculus",
            deviceModel: "Quest 3",
            osName: "Android",
            osVersion: "12",
            hl: "en",
            gl: "US",
          },
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { url: "", duration: 0 };

    const data: any = await res.json();
    const formats: any[] = (data.streamingData?.adaptiveFormats || []).filter(
      (f: any) => String(f.mimeType || "").startsWith("audio/") && f.url
    );
    const best = formats.find((f: any) => f.mimeType.includes("mp4a")) || formats[0];
    if (!best?.url) return { url: "", duration: 0 };

    return { url: best.url, duration: Number(data.videoDetails?.lengthSeconds || 0) || undefined };
  } catch {
    return { url: "", duration: 0 };
  }
}
