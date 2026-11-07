import { Router, Request, Response } from "express";
import { Readable } from "stream";

const router = Router();

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const FORWARDED_HEADERS = ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

// MIME type lookup helper
function getMimeType(urlPath: string, headerType: string | null): string {
  const cleanPath = urlPath.split('?')[0].toLowerCase();
  if (cleanPath.endsWith('.wasm')) return 'application/wasm';
  if (cleanPath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (cleanPath.endsWith('.mjs')) return 'application/javascript; charset=utf-8';
  if (cleanPath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (cleanPath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (cleanPath.endsWith('.html') || cleanPath.endsWith('.htm')) return 'text/html; charset=utf-8';
  if (cleanPath.endsWith('.png')) return 'image/png';
  if (cleanPath.endsWith('.jpg') || cleanPath.endsWith('.jpeg')) return 'image/jpeg';
  if (cleanPath.endsWith('.gif')) return 'image/gif';
  if (cleanPath.endsWith('.webp')) return 'image/webp';
  if (cleanPath.endsWith('.svg')) return 'image/svg+xml';
  if (cleanPath.endsWith('.ico')) return 'image/x-icon';
  if (cleanPath.endsWith('.data') || cleanPath.endsWith('.unityweb') || cleanPath.endsWith('.bin')) return 'application/octet-stream';
  if (cleanPath.endsWith('.mp3')) return 'audio/mpeg';
  if (cleanPath.endsWith('.ogg')) return 'audio/ogg';
  if (cleanPath.endsWith('.wav')) return 'audio/wav';
  if (cleanPath.endsWith('.woff2')) return 'font/woff2';
  if (cleanPath.endsWith('.woff')) return 'font/woff';
  if (cleanPath.endsWith('.ttf')) return 'font/ttf';
  if (cleanPath.endsWith('.otf')) return 'font/otf';

  if (headerType && headerType !== 'text/plain') {
    return headerType;
  }
  return 'text/html; charset=utf-8';
}

/** jsdelivr refuses some repositories outright; GitHub raw still has them. */
function mapBlockedRepository(url: string): string {
  const genizyMatch = url.match(/https?:\/\/(?:testingcf|fastly|cdn|quantil)\.jsdelivr\.net\/gh\/genizy\/([^/@]+)(?:@([^/]+))?\/(.*)/i);
  if (genizyMatch) {
    const repo = genizyMatch[1];
    const branch = genizyMatch[2] && genizyMatch[2] !== 'latest' ? genizyMatch[2] : 'main';
    return `https://raw.githubusercontent.com/genizy/${repo}/${branch}/${genizyMatch[3]}`;
  }
  return url;
}

async function fetchUpstream(url: string, range?: string): Promise<globalThis.Response> {
  // `identity` matters: Node's fetch decompresses gzip bodies but keeps the
  // compressed Content-Length header, so forwarding that header would cut the
  // stream short. Plain bytes make the length we forward truthful.
  const headers: Record<string, string> = { "User-Agent": BROWSER_UA, "Accept-Encoding": "identity" };
  if (range) headers.Range = range;
  return fetch(url, { headers });
}

async function fetchWithFallback(
  targetUrl: string,
  range?: string
): Promise<{ response: globalThis.Response; finalUrl: string } | null> {
  try {
    const url = mapBlockedRepository(targetUrl);
    const resp = await fetchUpstream(url, range);

    // jsdelivr 403s on repos it refuses to serve: retry from GitHub raw.
    if (resp.status === 403 && url.includes('jsdelivr.net/gh/')) {
      const ghMatch = url.match(/https?:\/\/[^/]+\.jsdelivr\.net\/gh\/([^/@]+)\/([^/@]+)(?:@([^/]+))?\/(.*)/i);
      if (ghMatch) {
        const [, owner, repo, branch, rest] = ghMatch;
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch && branch !== 'latest' ? branch : 'main'}/${rest}`;
        const rawResp = await fetchUpstream(rawUrl, range);
        if (rawResp.ok || rawResp.status === 206) {
          return { response: rawResp, finalUrl: rawUrl };
        }
      }
    }

    // A repo that renamed its default branch from main to master.
    if (resp.status === 404 && url.includes('raw.githubusercontent.com/') && url.includes('/main/')) {
      const masterUrl = url.replace('/main/', '/master/');
      const masterResp = await fetchUpstream(masterUrl, range);
      if (masterResp.ok || masterResp.status === 206) {
        return { response: masterResp, finalUrl: masterUrl };
      }
    }

    return { response: resp, finalUrl: url };
  } catch (e) {
    return null;
  }
}

async function handleContentLoad(targetUrl: string, req: Request, res: Response) {
  const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
  const result = await fetchWithFallback(targetUrl.trim(), range);

  if (!result) {
    return res.status(502).send("Fetch failed");
  }

  const { response, finalUrl } = result;
  const isPartial = response.status === 206;

  if (!response.ok && !isPartial) {
    return res.status(response.status).send(`Failed to fetch remote asset: ${response.statusText || response.status}`);
  }

  res.status(response.status);
  res.setHeader('Content-Type', getMimeType(finalUrl, response.headers.get('content-type')));
  // A server that ignores `identity` hands us an encoded body: its length and
  // range headers describe the encoded bytes, so they cannot be forwarded.
  const encoded = response.headers.get('content-encoding');
  const canDescribeBody = !encoded || encoded === 'identity';
  if (canDescribeBody) {
    for (const header of FORWARDED_HEADERS) {
      const value = response.headers.get(header);
      if (value) res.setHeader(header, value);
    }
  } else {
    const range_ = response.headers.get('content-range');
    if (range_) res.setHeader('Content-Range', range_);
    res.setHeader('Content-Encoding', encoded!);
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');
  // `no-transform` keeps the compression middleware out of the way: rewriting
  // the body would break the byte ranges games rely on to resume big assets.
  res.setHeader('Cache-Control', 'public, max-age=3600, no-transform');

  if (!response.body) {
    return res.end();
  }

  // Stream instead of buffering: some of these assets are tens of megabytes
  // (Godot .pck/.wasm, Unity .data) and used to be held entirely in memory
  // before the first byte was sent.
  const stream = Readable.fromWeb(response.body as any);
  res.on('close', () => stream.destroy());
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

// Server-side content loader for query format: /api/content-loader?url=...
router.get("/content-loader", async (req: Request, res: Response) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).send("Missing url parameter");
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return res.status(400).send("Invalid URL protocol");
    }

    await handleContentLoad(url, req, res);
  } catch (err: any) {
    console.error("Content loader query error:", err);
    if (!res.headersSent) {
      res.status(500).send(err.message || "Failed to fetch URL");
    }
  }
});

// Path format support: /api/content-loader/raw.githubusercontent.com/... or /api/content-loader/https://...
router.get("/content-loader/*", async (req: Request, res: Response) => {
  try {
    const fullPath = req.params[0];
    if (!fullPath) {
      return res.status(400).send("Missing path parameter");
    }

    let url = fullPath;
    if (url.startsWith('http:/') && !url.startsWith('http://')) {
      url = url.replace('http:/', 'http://');
    } else if (url.startsWith('https:/') && !url.startsWith('https://')) {
      url = url.replace('https:/', 'https://');
    } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    await handleContentLoad(url, req, res);
  } catch (err: any) {
    console.error("Content loader path error:", err);
    if (!res.headersSent) {
      res.status(500).send(err.message || "Failed to fetch URL path");
    }
  }
});

export default router;
