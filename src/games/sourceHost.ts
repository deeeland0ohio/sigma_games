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

export function pagesUrlFor(url: string): string | null {
  const parts = parseJsdelivr(url);
  if (!parts) return null;

  return `https://${parts.owner.toLowerCase()}.github.io/${parts.repo}/${parts.path}`;
}

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

  url: string;
}

export async function fetchGameDocument(url: string): Promise<GameDocument | null> {
  const direct = await tryGet(url);
  if (direct) return { html: direct, url };

  const proxied = await tryGet(`/api/content-loader?url=${encodeURIComponent(url)}`);
  if (proxied) return { html: proxied, url };

  return null;
}
