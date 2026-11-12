import React, { useEffect, useState } from 'react';
import { deriveBaseHref, normalizeGameHtml, rewriteGameHtml } from '../games/htmlRewrite';
import { assetBaseUrl, fetchGameDocument } from '../games/sourceHost';

export interface ContentFrameProps extends React.IframeHTMLAttributes<HTMLIFrameElement> {
  src?: string;
  srcDoc?: string;
  reloadKey?: number;
}

const HTML_CACHE_LIMIT = 8;
const gameHtmlCache = new Map<string, string>();

function cacheGet(key: string): string | undefined {
  return gameHtmlCache.get(key);
}

function cachePut(key: string, html: string) {
  gameHtmlCache.delete(key);
  gameHtmlCache.set(key, html);
  while (gameHtmlCache.size > HTML_CACHE_LIMIT) {
    const oldest = gameHtmlCache.keys().next();
    if (oldest.done) break;
    gameHtmlCache.delete(oldest.value);
  }
}

export function getJsDelivrUrl(url: string | undefined | null): string {
  if (!url || typeof url !== 'string') return '';
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname === 'raw.githubusercontent.com' || urlObj.hostname === 'raw.githack.com' || urlObj.hostname === 'rawcdn.githack.com') {
      let pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts[2] === 'refs' && pathParts[3] === 'heads') {
        pathParts.splice(2, 2);
      }
      if (pathParts.length >= 4) {
        const user = pathParts[0];
        const repo = pathParts[1];
        const branch = pathParts[2];
        const filePath = pathParts.slice(3).join('/');
        return `https://cdn.jsdelivr.net/gh/${user}/${repo}@${branch}/${filePath}`;
      }
    }
  } catch (e) {}
  return url;
}

export function cleanGameUrl(url: string | undefined | null): string {
  if (!url || typeof url !== 'string') return '';
  const cleaned = getJsDelivrUrl(url);
  if (!cleaned || typeof cleaned !== 'string') return '';
  return normalizeGameHtml(cleaned);
}

export function isVideoEmbed(url: string | undefined | null): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    const host = urlObj.hostname.toLowerCase();
    return (
      host.includes('youtube.com') ||
      host.includes('youtube-nocookie.com') ||
      host.includes('youtu.be') ||
      host.includes('tiktok.com') ||
      host.includes('vimeo.com') ||
      host.includes('dailymotion.com')
    );
  } catch (e) {
    return false;
  }
}

export function normalizeEmbedUrl(url: string | undefined | null): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();

  if (trimmed.includes('youtube.com') || trimmed.includes('youtu.be')) {
    const ytMatch = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/))([a-zA-Z0-9_-]{11})/);
    if (ytMatch && ytMatch[1]) {
      return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&rel=0`;
    }
  }

  if (trimmed.includes('tiktok.com')) {
    const ttMatch = trimmed.match(/tiktok\.com\/(?:@[^\/]+\/video\/|v\/|embed\/v2\/|embed\/v3\/|embed\/|player\/v1\/)(\d+)/i) ||
                    trimmed.match(/tiktok\.com\/.*\/(\d+)/i);
    if (ttMatch && ttMatch[1]) {
      return `https://www.tiktok.com/player/v1/${ttMatch[1]}?autoplay=1`;
    }
  }

  return cleanGameUrl(trimmed);
}

export function isLocalGame(url: string | undefined | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    trimmed.startsWith('/games/') ||
    trimmed.startsWith('/static') ||
    trimmed.startsWith('/sigmastatic') ||
    (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('//') && !trimmed.startsWith('data:'))
  );
}

const GAME_ENGINE_MARKERS = ['<canvas', 'data.unityweb', 'Module=', 'GODOT_CONFIG', 'ruffle', 'kaboom(', 'Phaser.'];

async function unwrapDocument(targetUrl: string): Promise<{ html: string; url: string } | null> {
  let currentUrl = targetUrl;

  for (let depth = 0; depth < 3; depth++) {
    const page = await fetchGameDocument(currentUrl);
    if (!page) return null;

    const hasGameEngine = GAME_ENGINE_MARKERS.some((marker) => page.html.includes(marker));
    if (hasGameEngine) return page;

    const iframeMatch = page.html.match(/<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
    const innerSrc = iframeMatch?.[1]?.trim();
    if (!innerSrc || isVideoEmbed(innerSrc) || innerSrc.startsWith('javascript:')) {
      return page;
    }
    try {
      currentUrl = cleanGameUrl(new URL(innerSrc, page.url).href);
    } catch (urlErr) {
      return page;
    }
  }

  return fetchGameDocument(currentUrl);
}

export default function ContentFrame({ src, srcDoc, reloadKey, allow, allowFullScreen = true, ...props }: ContentFrameProps) {
  const [inlineDoc, setInlineDoc] = useState<string | undefined>(srcDoc);
  const [frameSrc, setFrameSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (srcDoc) {
      setInlineDoc(srcDoc);
      setFrameSrc(undefined);
      return;
    }

    if (!src) {
      setInlineDoc(undefined);
      return;
    }

    const targetUrl = normalizeEmbedUrl(src);
    if (!targetUrl) return;

    if (isVideoEmbed(targetUrl) || isLocalGame(targetUrl)) {
      setInlineDoc(undefined);
      setFrameSrc(targetUrl);
      return;
    }

    const cached = cacheGet(targetUrl);
    if (cached) {
      setInlineDoc(cached);
      setFrameSrc(undefined);
      return;
    }

    let cancelled = false;

    (async () => {
      const resolved = await unwrapDocument(targetUrl);
      if (cancelled) return;

      if (!resolved) {
        setInlineDoc(undefined);
        setFrameSrc(targetUrl);
        return;
      }

      const baseHref = assetBaseUrl(resolved.url) ?? deriveBaseHref(resolved.html, resolved.url);
      const prepared = rewriteGameHtml(resolved.html, { baseHref });
      cachePut(targetUrl, prepared);

      if (cancelled) return;
      setInlineDoc(prepared);
      setFrameSrc(undefined);
    })();

    return () => {
      cancelled = true;
    };
  }, [src, srcDoc, reloadKey]);

  const defaultAllow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen";

  return (
    <iframe
      src={inlineDoc ? undefined : frameSrc}
      srcDoc={inlineDoc}
      allow={allow || defaultAllow}
      allowFullScreen={allowFullScreen}
      referrerPolicy={props.referrerPolicy || "strict-origin-when-cross-origin"}
      {...props}
    />
  );
}
