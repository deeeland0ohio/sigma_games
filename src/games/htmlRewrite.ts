// HTML surgery for game documents.
//
// Why this exists at all: the CDNs that host these games cannot be used in a
// plain <iframe src="...">. cdn.jsdelivr.net serves .html from /gh/ as
// `text/plain; charset=utf-8` together with `X-Content-Type-Options: nosniff`,
// so Chromium renders the page source as literal text instead of running it,
// and some hosts (e.g. ud-gles3games) answer with `X-Frame-Options: DENY`,
// which refuses the frame outright. The game document therefore has to be
// fetched and re-rendered on our own origin — and once it is, the tags below
// are what make it actually work there.
//
// Both the client frame and the server middleware used to carry their own copy
// of this; the rules live here so they cannot drift apart.

const GN_MATH_TO_FREEBUISNESS = /\/gh\/gn-math\//gi;

// Pinned commit hashes and stale branches go 404 once those repos move, so
// every known game repository is rewritten to its default branch.
const NORMALIZE_HASHES =
  /(https?:\/\/(?:testingcf|fastly|cdn|quantil)\.jsdelivr\.net\/gh\/(?:aDiesmos|WanoCapy|3kh0|a456pur|greenday894|HydroXide1|Noah-Is-Awesome|alexr-hub|bubbls|lonya-k|genizy|degloved-net|freebuisness)\/([a-zA-Z0-9_-]+))@[a-zA-Z0-9_.-]+(\/|$)/g;

const BLOCKED_JSDELIVR =
  /https?:\/\/(?:testingcf|fastly|cdn|quantil)\.jsdelivr\.net\/gh\/genizy\/([^\/@]+)(?:@([^\/'" >]+))?\//gi;

const HEAD_OPEN = /<head\b[^>]*>/i;
const HTML_OPEN = /<html\b[^>]*>/i;

// Sandboxed documents throw on localStorage access, which kills games that
// probe it during boot. A memory-backed stand-in keeps them alive.
export const STORAGE_POLYFILL = `<script>
(function() {
  var mem = {};
  var sessionMem = {};
  function make(store) {
    return {
      getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function(k, v) { store[k] = String(v); },
      removeItem: function(k) { delete store[k]; },
      clear: function() { for (var k in store) delete store[k]; },
      key: function(i) { return Object.keys(store)[i] || null; },
      get length() { return Object.keys(store).length; }
    };
  }
  try {
    window.localStorage.getItem('__probe__');
  } catch (e) {
    try {
      Object.defineProperty(window, 'localStorage', { value: make(mem), configurable: true, writable: true });
      Object.defineProperty(window, 'sessionStorage', { value: make(sessionMem), configurable: true, writable: true });
    } catch (err) {}
  }
})();
</script>`;

// Bundled games pop browser dialogs on load: "unofficial port" notices, ad
// prompts, "are you sure you want to leave". They are part of the downloaded
// game, not our UI, so they are switched off before the game's own scripts run.
export const POPUP_SHIM = `<script>
(function() {
  try {
    window.alert = function() {};
    window.confirm = function() { return false; };
    window.prompt = function() { return null; };
    try { window.open = function() { return null; }; } catch (e) {}
    window.onbeforeunload = null;
  } catch (e) {}
})();
</script>`;

/** Insert snippets as the first thing inside <head>, creating one if needed. */
export function injectIntoHead(html: string, snippets: string[]): string {
  const block = snippets.filter(Boolean).join('\n');
  if (!block) return html;

  const head = html.match(HEAD_OPEN);
  if (head) return html.replace(HEAD_OPEN, `${head[0]}\n${block}`);

  const htmlTag = html.match(HTML_OPEN);
  if (htmlTag) {
    return html.replace(HTML_OPEN, `${htmlTag[0]}\n<head>\n${block}\n</head>`);
  }

  return `${block}\n${html}`;
}

/**
 * Fix the CDN references inside a game document: dead commit hashes, the
 * gn-math repository that stopped serving, and the genizy repos jsdelivr
 * refuses (those are routed through our own content loader instead).
 */
export function normalizeGameHtml(html: string): string {
  return html
    .replace(GN_MATH_TO_FREEBUISNESS, '/gh/freebuisness/')
    .replace(NORMALIZE_HASHES, '$1@main$3')
    .replace(BLOCKED_JSDELIVR, (_match, repo: string, branch: string | undefined) => {
      const resolvedBranch = branch && branch !== 'latest' ? branch : 'main';
      return `/api/content-loader/raw.githubusercontent.com/genizy/${repo}/${resolvedBranch}/`;
    });
}

export interface RewriteOptions {
  /** <base href> to inject when the document does not declare one. */
  baseHref?: string;
  /** Strip third-party overlays/analytics. Off for documents we host ourselves. */
  stripWidgets?: boolean;
}

/**
 * Prepare a fetched game document for rendering on our origin: fixed CDN URLs,
 * a <base> so relative assets resolve, and the storage polyfill.
 */
export function rewriteGameHtml(html: string, options: RewriteOptions = {}): string {
  const { baseHref, stripWidgets = true } = options;

  let out = normalizeGameHtml(html);

  if (stripWidgets) {
    out = out
      .replace(/<script[^>]*src="[^"]*arc\.io[^"]*"[^>]*><\/script>/gi, '<!-- stripped overlay -->')
      .replace(/<script[^>]*src="[^"]*googletagmanager\.com[^"]*"[^>]*><\/script>/gi, '<!-- stripped analytics -->')
      .replace(/gtag\s*\([^)]*\);?/gi, '')
      // Some ports hard-code a root-relative /js/main.js that does not exist here.
      .replace(/src=["']\/js\/main\.js["']/gi, 'src="data:text/javascript,console.log(\'main.js loaded\')"');
  }

  const needsBase = baseHref && !/<base\b/i.test(out);
  return injectIntoHead(out, [POPUP_SHIM, needsBase ? `<base href="${baseHref}">` : '', STORAGE_POLYFILL]);
}

/**
 * Best guess at the directory the document's relative assets live in: the
 * directory of the first CDN asset it references, else the document's own.
 */
export function deriveBaseHref(html: string, documentUrl: string): string {
  const cdnAsset = html.match(
    /(https?:\/\/(?:testingcf|fastly|cdn|quantil)\.jsdelivr\.net\/gh\/[^\s"'><]+|https?:\/\/(?:raw\.githack\.com|rawcdn\.githack\.com)\/[^\s"'><]+)/i
  );
  if (cdnAsset?.[1]) {
    const assetUrl = cdnAsset[1];
    return assetUrl.substring(0, assetUrl.lastIndexOf('/') + 1);
  }
  if (documentUrl.startsWith('http://') || documentUrl.startsWith('https://')) {
    return documentUrl.substring(0, documentUrl.lastIndexOf('/') + 1);
  }
  if (documentUrl.startsWith('/') && typeof window !== 'undefined') {
    return window.location.origin + documentUrl.substring(0, documentUrl.lastIndexOf('/') + 1);
  }
  return '';
}
