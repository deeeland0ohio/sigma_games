// Where to fetch a game's document from, and where its own files live.
//
// Every catalogue we import points at `cdn.jsdelivr.net/gh/<owner>/<repo>@<ref>/`.
// jsdelivr is a file host: it sends `.html` as `text/plain` with nosniff, so a
// bare <iframe src> prints the game's source instead of running it. The fix is
// simply to fetch the text and run it ourselves - which is what ContentFrame
// does. jsdelivr is the right place to fetch from because it sends
// `access-control-allow-origin: *` (so the browser can read it directly, with
// no bytes through our server) and caches for a week.
//
// What it is *not* good for is the game's own assets. Once we run the document
// on our origin, its `<script src="js/game.js">` and `<link href="style.css">`
// resolve against the base we inject. jsdelivr types those files for download;
// GitHub Pages serves the same repo as a real site, with `text/javascript`,
// `text/css` and `application/wasm`, which is what a browser will actually
// execute. So for repos that publish a Pages site we point the base there and
// leave the document fetch on jsdelivr.

// Repos verified to serve their files with correct types on GitHub Pages
// (curl: 200 + text/html for documents, text/javascript for scripts).
const PAGES_SITE_REPOS = new Set([
  'wanocapy/chickenkingsvault',
  'adiesmos/htmlfiles',
  'noahsamazingtutoringhelp/noahs-calculus-tutor',
  'dskjfoisjfsjio/alexrsworld',
]);

const FETCH_TIMEOUT_MS = 12000;

export interface JsdelivrPath {
  owner: string;
  repo: string;
  ref: string;
  path: string;
}

/** Split a jsdelivr `/gh/owner/repo@ref/path` URL into its parts. */
export function parseJsdelivr(url: string): JsdelivrPath | null {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)jsdelivr\.net$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/^\/gh\/([^/@]+)\/([^/@]+)@([^/]+)\/(.+)$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2], ref: match[3], path: match[4] };
  } catch {
    return null;
  }
}

/** GitHub Pages equivalent of a jsdelivr URL, if the repo publishes one. */
export function pagesUrlFor(url: string): string | null {
  const parts = parseJsdelivr(url);
  if (!parts) return null;
  // The subdomain is always the lowercased owner; the repo segment keeps its case.
  return `https://${parts.owner.toLowerCase()}.github.io/${parts.repo}/${parts.path}`;
}

/**
 * Base URL for the game's own relative files: its Pages directory when the repo
 * has one, otherwise null so the caller can fall back to the document's own
 * directory on jsdelivr.
 */
export function assetBaseUrl(documentUrl: string): string | null {
  const parts = parseJsdelivr(documentUrl);
  if (!parts) return null;
  if (!PAGES_SITE_REPOS.has(`${parts.owner}/${parts.repo}`.toLowerCase())) return null;
  const dir = parts.path.slice(0, parts.path.lastIndexOf('/') + 1);
  return `https://${parts.owner.toLowerCase()}.github.io/${parts.repo}/${dir}`;
}

async function tryGet(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    const text = await response.text();
    return text.trim().length > 0 ? text : null;
  } catch {
    return null;
  }
}

export interface GameDocument {
  html: string;
  /** The URL that actually answered - use it to resolve relative assets. */
  url: string;
}

/**
 * Fetch a game document as text: the CDN first (direct, no server bytes), then
 * our own loader for hosts that refuse cross-origin reads.
 */
export async function fetchGameDocument(url: string): Promise<GameDocument | null> {
  const direct = await tryGet(url);
  if (direct) return { html: direct, url };

  const proxied = await tryGet(`/api/content-loader?url=${encodeURIComponent(url)}`);
  if (proxied) return { html: proxied, url };

  return null;
}
