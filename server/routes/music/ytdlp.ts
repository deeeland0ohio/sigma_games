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

export function ytDlpBinaryPath(): string | null {
  return binary();
}

function proxyUrl(): { value: string | null; source: "env" | "file" | null } {
  const direct = process.env.YT_DLP_PROXY?.trim();
  if (direct) return { value: direct, source: "env" };

  const file = process.env.YT_DLP_PROXY_FILE?.trim();
  if (file && existsSync(file)) {
    try {
      const value = readFileSync(file, "utf8").trim();
      if (value) return { value, source: "file" };
    } catch {
    }
  }

  return { value: null, source: null };
}

let warnedAboutCookies = false;

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

const MAX_CONCURRENT = Math.max(1, Number(process.env.YT_DLP_MAX_CONCURRENT) || 1);

export function ytDlpMaxConcurrent(): number {
  return MAX_CONCURRENT;
}
const SPAWN_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 20 * 60 * 1000;

let active = 0;

interface RunResult {
  stdout: string | null;
  error: string | null;
}

export function redact(text: string | null | undefined): string {
  if (!text) return "";
  return text

    .replace(/\/\/[^\s:@/]+:[^\s@/]+@/g, "//***:***@")
    .replace(/(--proxy)\s+\S+/g, "$1 ***")

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
