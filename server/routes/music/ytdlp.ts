/**
 * yt-dlp audio extraction.
 *
 * The anonymous InnerTube calls in `youtubeStream.ts` get "Sign in to confirm
 * you're not a bot" from most datacenter IPs. yt-dlp is a real extractor with
 * proper player clients and handles that far better, so when the binary is
 * present it is tried after InnerTube fails.
 *
 * Two rules keep this safe to run on a small container:
 *
 *  - One process per video, bounded by the caller's deadline. yt-dlp is a
 *    Go/Python binary that costs real memory, so spawning it per candidate for
 *    a minute at a time is how a 512MB instance gets OOM-killed (Cloud Run
 *    answers 503).
 *  - The resolved URL is cached. googlevideo URLs stay valid for hours, so
 *    playing the same track twice costs zero extra processes.
 *
 * Optional on purpose: the server must run fine without it (returns null).
 * `YT_DLP_PATH` overrides the binary location; `YT_DLP_DISABLED=1` turns it off.
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { getCached, setCache } from "./types";

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

/** Where the binary was found, for diagnostics only. */
export function ytDlpBinaryPath(): string | null {
  return binary();
}

let warnedAboutCookies = false;

/**
 * Extra process arguments.
 *
 * YouTube refuses anonymous extraction from flagged datacenter IPs. That is
 * decided by the IP, not by us, so the escape hatches are configuration:
 *
 *  - `YT_DLP_PROXY` — extract through a proxy / VPS that is not flagged. This
 *    is the reliable fix; it is also what running on a residential-ish host
 *    does for you.
 *  - `YT_DLP_COOKIES_FILE` — a Netscape-format cookies.txt from an account.
 *    Cheaper to try, but YouTube increasingly also wants a PO token, so it may
 *    still be refused (and a flagged account is at risk).
 *  - `YT_DLP_EXTRA_ARGS` — anything else, space separated, e.g.
 *    `--extractor-args youtube:getpot_bgutil_baseurl=http://127.0.0.1:4416`
 *    when you run a PO-token provider alongside the app.
 */
function extraArgs(): string[] {
  const args: string[] = [];

  const proxy = process.env.YT_DLP_PROXY?.trim();
  if (proxy) args.push("--proxy", proxy);

  const cookies = process.env.YT_DLP_COOKIES_FILE?.trim();
  if (cookies) {
    if (existsSync(cookies)) {
      args.push("--cookies", cookies);
    } else if (!warnedAboutCookies) {
      warnedAboutCookies = true;
      console.warn(`[music] YT_DLP_COOKIES_FILE is set to ${cookies}, which does not exist`);
    }
  }

  const extra = process.env.YT_DLP_EXTRA_ARGS?.trim();
  if (extra) args.push(...extra.split(/\s+/).filter(Boolean));

  return args;
}

/** What yt-dlp is configured with, without revealing any secret value. */
export function ytDlpConfig(): { proxy: boolean; cookies: boolean; extraArgs: boolean } {
  return {
    proxy: Boolean(process.env.YT_DLP_PROXY?.trim()),
    cookies: Boolean(process.env.YT_DLP_COOKIES_FILE?.trim()),
    extraArgs: Boolean(process.env.YT_DLP_EXTRA_ARGS?.trim()),
  };
}

/** yt-dlp costs ~100MB of memory per process; never run more than this at once. */
const MAX_CONCURRENT = 2;
const SPAWN_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 20 * 60 * 1000;

let active = 0;

function run(args: string[], timeoutMs: number): Promise<string | null> {
  const bin = binary();
  if (!bin) return Promise.resolve(null);

  active++;
  return new Promise((resolve) => {
    const done = (value: string | null) => {
      active--;
      resolve(value);
    };

    try {
      execFile(
        bin,
        args,
        { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true },
        (error, stdout) => {
          if (error) {
            // Blocked, geo-limited or the video is gone: no audio, not an error.
            done(null);
            return;
          }
          done(String(stdout || ""));
        }
      );
    } catch {
      done(null);
    }
  });
}

export interface YtDlpStream {
  url: string;
  duration?: number;
}

/**
 * Direct audio URL for one video id, or null when yt-dlp is missing, busy,
 * blocked, or out of time.
 */
export async function resolveWithYtDlp(videoId: string, deadline?: number): Promise<YtDlpStream | null> {
  const id = String(videoId || "").replace(/^yt_/, "").trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  if (!isYtDlpAvailable()) return null;

  const cacheKey = `ytdlp:${id}`;
  const cached = getCached<YtDlpStream>(cacheKey);
  if (cached) return cached;

  const left = deadline ? deadline - Date.now() : SPAWN_TIMEOUT_MS;
  if (left < 2500) return null;
  if (active >= MAX_CONCURRENT) return null;

  const stdout = await run(
    [
      "-f",
      "bestaudio[ext=m4a]/bestaudio",
      "-g",
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      "--no-cache-dir",
      "--socket-timeout",
      "5",
      "--retries",
      "1",
      "--extractor-args",
      "youtube:player_client=android_vr,tv_simply,web_safari",
      ...extraArgs(),
      `https://www.youtube.com/watch?v=${id}`,
    ],
    Math.max(2500, Math.min(SPAWN_TIMEOUT_MS, left))
  );

  if (!stdout) return null;

  const url = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("http"))
    .pop();

  if (!url) return null;

  const stream: YtDlpStream = { url };
  setCache(cacheKey, stream, CACHE_TTL_MS);
  return stream;
}
