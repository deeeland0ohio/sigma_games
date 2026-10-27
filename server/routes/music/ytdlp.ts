/**
 * yt-dlp audio extraction.
 *
 * The anonymous InnerTube calls in `youtubeStream.ts` get "Sign in to confirm
 * you're not a bot" from most datacenter IPs. yt-dlp is a real extractor with
 * proper player clients and handles that far better, so when the binary is
 * present it is tried after InnerTube fails.
 *
 * Optional on purpose: the server must run fine without it (returns null).
 * `YT_DLP_PATH` overrides the binary location; `YT_DLP_DISABLED=1` turns it off.
 */
import { execFile } from "child_process";
import { existsSync } from "fs";

const CANDIDATE_BINARIES = [
  process.env.YT_DLP_PATH,
  "/usr/local/bin/yt-dlp",
  "/usr/bin/yt-dlp",
  process.env.HOME ? `${process.env.HOME}/.local/bin/yt-dlp` : undefined,
  "yt-dlp",
].filter((value): value is string => Boolean(value));

let cachedBinary: string | null | undefined;

function binary(): string | null {
  if (process.env.YT_DLP_DISABLED === "1") return null;
  if (cachedBinary !== undefined) return cachedBinary;

  for (const candidate of CANDIDATE_BINARIES) {
    // Bare names are resolved through PATH by execFile; absolute paths are checked.
    if (!candidate.includes("/")) {
      cachedBinary = candidate;
      return cachedBinary;
    }
    if (existsSync(candidate)) {
      cachedBinary = candidate;
      return cachedBinary;
    }
  }
  cachedBinary = null;
  return cachedBinary;
}

export function isYtDlpAvailable(): boolean {
  return binary() !== null;
}

function run(args: string[], timeoutMs: number): Promise<string | null> {
  const bin = binary();
  if (!bin) return Promise.resolve(null);

  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) {
          // Blocked, geo-limited or the video is gone: no audio, not an error.
          resolve(null);
          return;
        }
        resolve(String(stdout || ""));
      }
    );
  });
}

export interface YtDlpStream {
  url: string;
  duration?: number;
}

/** Direct audio URL for one video id, or null when yt-dlp is missing/blocked. */
export async function resolveWithYtDlp(videoId: string): Promise<YtDlpStream | null> {
  const id = String(videoId || "").replace(/^yt_/, "").trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  if (!isYtDlpAvailable()) return null;

  const watchUrl = `https://www.youtube.com/watch?v=${id}`;

  const audioUrl = await run(
    [
      "-f", "bestaudio[ext=m4a]/bestaudio",
      "-g",
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      "--extractor-args", "youtube:player_client=android_vr,tv_simply,web_safari",
      watchUrl,
    ],
    25000
  );

  if (!audioUrl) return null;
  const url = audioUrl
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("http"))
    .pop();

  if (!url) return null;

  const durationText = await run(
    ["--print", "%(duration)s", "--no-playlist", "--no-warnings", watchUrl],
    15000
  );
  const duration = durationText?.split("\n")[0]?.trim();
  const parsed = duration ? Math.round(Number(duration)) : 0;

  return { url, duration: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined };
}
