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
 *
 * Whether YouTube answers at all is decided by the host's IP, which the server
 * cannot change — hence the proxy / cookies / extra-args escape hatches below.
 * `probeYtDlp()` reports what actually happened, so a deployment can be
 * diagnosed (`/api/music/debug`) instead of quietly returning previews.
 */
import { execFile } from "child_process";
import { existsSync, readFileSync } from "fs";
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

/**
 * The proxy URL, from the environment or from a mounted secret file.
 *
 * `YT_DLP_PROXY_FILE` exists so the credential does not have to sit in a plain
 * environment variable: mount the secret as a file and point at it. The file is
 * re-read on every extraction, so rotating the secret needs no code change.
 */
function proxyUrl(): { value: string | null; source: "env" | "file" | null } {
  const direct = process.env.YT_DLP_PROXY?.trim();
  if (direct) return { value: direct, source: "env" };

  const file = process.env.YT_DLP_PROXY_FILE?.trim();
  if (file && existsSync(file)) {
    try {
      const value = readFileSync(file, "utf8").trim();
      if (value) return { value, source: "file" };
    } catch {
      // unreadable secret file: behave as if no proxy is configured
    }
  }

  return { value: null, source: null };
}

let warnedAboutCookies = false;

/**
 * Extra process arguments.
 *
 *  - `YT_DLP_PROXY` / `YT_DLP_PROXY_FILE` — extract through an IP YouTube does
 *    not block. This is the reliable fix.
 *  - `YT_DLP_COOKIES_FILE` — a Netscape-format cookies.txt from an account.
 *    Cheaper to try, but YouTube increasingly also wants a PO token, so it may
 *    still be refused (and a flagged account is at risk).
 *  - `YT_DLP_EXTRA_ARGS` — anything else, space separated, e.g.
 *    `--extractor-args youtube:getpot_bgutil_baseurl=http://127.0.0.1:4416`
 *    when you run a PO-token provider alongside the app.
 */
function extraArgs(): string[] {
  const args: string[] = [];

  const proxy = proxyUrl();
  if (proxy.value) args.push("--proxy", proxy.value);

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
export function ytDlpConfig(): {
  proxy: boolean;
  proxySource: "env" | "file" | null;
  cookies: boolean;
  extraArgs: boolean;
} {
  const proxy = proxyUrl();
  return {
    proxy: Boolean(proxy.value),
    proxySource: proxy.source,
    cookies: Boolean(process.env.YT_DLP_COOKIES_FILE?.trim()),
    extraArgs: Boolean(process.env.YT_DLP_EXTRA_ARGS?.trim()),
  };
}

/** yt-dlp costs ~100MB of memory per process; never run more than this at once. */
const MAX_CONCURRENT = 2;
const SPAWN_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 20 * 60 * 1000;

let active = 0;

interface RunResult {
  stdout: string | null;
  error: string | null;
}

/** Strip credentials a tool might echo back (proxy URL, cookies path). */
export function redact(text: string | null | undefined): string {
  if (!text) return "";
  return text
    // Credentials embedded in any URL (a proxy like http://user:pass@host:port)
    .replace(/\/\/[^\s:@/]+:[^\s@/]+@/g, "//***:***@")
    .replace(/(--proxy)\s+\S+/g, "$1 ***")
    // Only when it really is a path: yt-dlp's own advice text mentions
    // "--cookies" too, and blanking the following word there is just noise.
    .replace(/(--cookies)\s+\S*\/\S*/g, "$1 ***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function run(args: string[], timeoutMs: number): Promise<RunResult> {
  const bin = binary();
  if (!bin) return Promise.resolve({ stdout: null, error: "yt-dlp binary not found" });

  active++;
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: RunResult) => {
      if (settled) return;
      settled = true;
      active--;
      resolve(result);
    };

    try {
      execFile(
        bin,
        args,
        { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            // Blocked, geo-limited or the video is gone: no audio, not a crash.
            // stderr carries yt-dlp's own reason ("Sign in to confirm..."), while
            // the Error message is a shell-ish summary that can contain the
            // proxy URL, so stderr is preferred and everything is redacted.
            const message = String(stderr || "").trim() || error.message;
            done({ stdout: null, error: redact(message) });
            return;
          }
          done({ stdout: String(stdout || ""), error: null });
        }
      );
    } catch (err: any) {
      done({ stdout: null, error: redact(err?.message || "failed to start yt-dlp") });
    }
  });
}

function buildArgs(id: string): string[] {
  return [
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
  ];
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

  const { stdout } = await run(
    buildArgs(id),
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

export interface YtDlpProbe {
  ok: boolean;
  elapsedMs: number;
  stream?: "hls" | "progressive";
  error?: string;
}

/**
 * Same call as `resolveWithYtDlp`, but it reports *why* instead of null.
 * Used by `/api/music/debug` to tell "the IP is blocked" apart from "the proxy
 * is misconfigured" apart from "the binary is missing".
 */
export async function probeYtDlp(videoId: string, deadline?: number): Promise<YtDlpProbe> {
  const started = Date.now();
  const id = String(videoId || "").replace(/^yt_/, "").trim();

  if (!isYtDlpAvailable()) {
    return { ok: false, elapsedMs: 0, error: "yt-dlp binary not found" };
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return { ok: false, elapsedMs: 0, error: "invalid videoId (expected 11 characters)" };
  }

  const left = deadline ? deadline - Date.now() : 15000;
  if (left < 2500) return { ok: false, elapsedMs: 0, error: "not enough time left to probe" };

  const { stdout, error } = await run(buildArgs(id), Math.max(2500, Math.min(15000, left)));
  const elapsedMs = Date.now() - started;

  const url = (stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("http"))
    .pop();

  if (url) {
    return { ok: true, elapsedMs, stream: url.includes(".m3u8") ? "hls" : "progressive" };
  }

  return { ok: false, elapsedMs, error: redact(error || "no audio URL returned") };
}
