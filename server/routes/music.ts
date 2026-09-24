import express, { type Request, type Response } from "express";

const musicRouter = express.Router();

const searchCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 1000 * 60 * 15; // 15 minutes

let cachedSoundCloudClientId = "Pb72ranhoyt6gw7hM7TkzUItXlMWSNSo";
let lastClientIdFetch = 0;

// Dynamic SoundCloud Client ID Scraper
async function getSoundCloudClientId(): Promise<string> {
  const now = Date.now();
  if (cachedSoundCloudClientId && now - lastClientIdFetch < 1000 * 60 * 60) {
    return cachedSoundCloudClientId;
  }

  try {
    const pageResp = await fetch("https://soundcloud.com/discover", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(4000)
    });
    if (pageResp.ok) {
      const html = await pageResp.text();
      const scripts = html.match(/https:\/\/[a-z0-9-]+\.sndcdn\.com\/assets\/[a-zA-Z0-9.-]+\.js/g) || [];
      for (const scriptUrl of scripts) {
        try {
          const jsResp = await fetch(scriptUrl, { signal: AbortSignal.timeout(3000) });
          if (jsResp.ok) {
            const js = await jsResp.text();
            const match = js.match(/client_id[\"']?\s*[:=]\s*[\"']([a-zA-Z0-9]{32})[\"']/);
            if (match && match[1]) {
              cachedSoundCloudClientId = match[1];
              lastClientIdFetch = now;
              return match[1];
            }
          }
        } catch {}
      }
    }
  } catch (err: any) {
    console.warn("SoundCloud client_id refresh warning:", err?.message);
  }

  return cachedSoundCloudClientId || "Pb72ranhoyt6gw7hM7TkzUItXlMWSNSo";
}

function formatSeconds(secs: number): string {
  if (!secs || isNaN(secs) || secs <= 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Clean title string for deduplication and matching
function cleanTitle(str: string): string {
  return (str || "")
    .toLowerCase()
    .replace(/[\(\)\[\]\{\}\-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Check if query is asking for sped up or slowed versions
export function isSpedUpQuery(q: string): boolean {
  return /\b(sped\s*up|speed\s*up|speedup|speed-up|nightcore|fast\s*version|accelerated|\bsped\b)\b/i.test(q || "");
}

export function isSlowedQuery(q: string): boolean {
  return /\b(slowed|slow\s*\+\s*reverb|slow\s*reverb|slow\s*down|chopped\s*and\s*screwed|screwed)\b/i.test(q || "");
}

export function detectTrackEditType(title: string): 'sped_up' | 'slowed' | 'none' {
  const t = (title || "").toLowerCase();
  if (/\b(sped\s*up|speed\s*up|speedup|speed-up|nightcore|accelerated|chipmunk|\bsped\b)\b/i.test(t)) {
    return 'sped_up';
  }
  if (/\b(slowed|slow\s*\+\s*reverb|slow\s*reverb|slow\s*down|chopped\s*and\s*screwed|screwed)\b/i.test(t)) {
    return 'slowed';
  }
  return 'none';
}

// Ensures track titles says (Sped Up) or (Slowed) / (Slowed + Reverb)
export function formatSongTitle(title: string, userQuery: string = ""): {
  formattedTitle: string;
  isSpedUp: boolean;
  isSlowed: boolean;
} {
  let t = (title || "").trim();
  const editType = detectTrackEditType(t);
  const qSpedUp = isSpedUpQuery(userQuery);
  const qSlowed = isSlowedQuery(userQuery);

  const isSpedUp = editType === 'sped_up' || qSpedUp;
  const isSlowed = !isSpedUp && (editType === 'slowed' || qSlowed);

  if (isSpedUp) {
    if (!/\(sped\s*up\)/i.test(t)) {
      t = t
        .replace(/[-–—]\s*(sped\s*up|speed\s*up|speedup|nightcore|\bsped\b).*/i, "")
        .replace(/\[(sped\s*up|speed\s*up|speedup|nightcore|\bsped\b)[^\]]*\]/gi, "")
        .replace(/\((sped\s*up|speed\s*up|speedup|nightcore|\bsped\b)[^\)]*\)/gi, "")
        .replace(/\b(sped\s*up|speed\s*up|speedup|nightcore|\bsped\b)\b/gi, "")
        .replace(/\(\s*\)/g, "")
        .replace(/\[\s*\]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      t = `${t} (Sped Up)`;
    } else {
      t = t.replace(/\(sped\s*up\)/i, "(Sped Up)");
    }
    return { formattedTitle: t, isSpedUp: true, isSlowed: false };
  }

  if (isSlowed) {
    const hasReverb = /reverb/i.test(t) || /reverb/i.test(userQuery);
    const tag = hasReverb ? "(Slowed + Reverb)" : "(Slowed)";
    if (!/\(slowed(\s*(\+|and)\s*reverb)?\)/i.test(t)) {
      t = t
        .replace(/[-–—]\s*(slowed.*)/i, "")
        .replace(/\[(slowed[^\]]*)\]/gi, "")
        .replace(/\((slowed[^\)]*)\)/gi, "")
        .replace(/\bslowed(\s*(\+|and)\s*reverb)?\b/gi, "")
        .replace(/\(\s*\)/g, "")
        .replace(/\[\s*\]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      t = `${t} ${tag}`;
    } else {
      t = t.replace(/\(slowed(\s*(\+|and)\s*reverb)?\)/i, tag);
    }
    return { formattedTitle: t, isSpedUp: false, isSlowed: true };
  }

  return { formattedTitle: t, isSpedUp: false, isSlowed: false };
}

// Low-quality / junk keywords that should be excluded unless specifically searched
const JUNK_KEYWORDS = [
  "instrumental",
  "karaoke",
  "parody",
  "teaser",
  "snippet",
  "leak",
  "earrape"
];

function isUnwantedEdit(title: string, rawQuery: string = ""): boolean {
  const t = (title || "").toLowerCase();
  const q = (rawQuery || "").toLowerCase();

  const userWantsSpedUp = isSpedUpQuery(q);
  const userWantsSlowed = isSlowedQuery(q);
  const trackEdit = detectTrackEditType(t);

  if (userWantsSpedUp && trackEdit === 'sped_up') {
    return false;
  }

  if (userWantsSlowed && trackEdit === 'slowed') {
    return false;
  }

  if (!userWantsSpedUp && trackEdit === 'sped_up') {
    return true;
  }

  if (!userWantsSlowed && trackEdit === 'slowed') {
    return true;
  }

  for (const kw of JUNK_KEYWORDS) {
    if (t.includes(kw) && !q.includes(kw)) {
      return true;
    }
  }

  return false;
}

// Smart Relevance & Verification Scoring Algorithm
function calculateRelevanceScore(t: any, rawQuery: string): number {
  if (!t) return 0;

  const title = (t.title || "").toLowerCase();
  const username = (t.user?.username || "").toLowerCase();
  const name = (t.user?.name || "").toLowerCase();
  const cleanQ = cleanTitle(rawQuery);

  let score = 0;

  // Severe penalty for unwanted edits/sped-up tracks when NOT requested
  if (isUnwantedEdit(title, rawQuery)) {
    score -= 2000;
  }

  const userWantsSpedUp = isSpedUpQuery(rawQuery);
  const userWantsSlowed = isSlowedQuery(rawQuery);
  const trackEdit = detectTrackEditType(title);

  if (userWantsSpedUp && trackEdit === 'sped_up') {
    score += 600; // Prioritize requested sped up versions
  } else if (userWantsSlowed && trackEdit === 'slowed') {
    score += 600; // Prioritize requested slowed versions
  } else if ((userWantsSpedUp || userWantsSlowed) && trackEdit === 'none') {
    score -= 300; // Demote standard versions when user specifically asked for an edit
  }

  // 1. Verified Artist / Official Badge Boost (+500 points)
  if (t.user?.verified) {
    score += 500;
  }

  // 2. Exact Title or Exact Artist Match (+300 to +600 points)
  const cleanT = cleanTitle(title);
  if (cleanQ && cleanT === cleanQ) {
    score += 600;
  } else if (cleanQ && cleanT.includes(cleanQ)) {
    score += 300;
  }

  // Check if query contains or matches the uploader's artist handle
  const queryWords = cleanQ.split(" ").filter(w => w.length > 2);
  for (const word of queryWords) {
    if (username.includes(word) || name.includes(word)) {
      score += 200;
    }
  }

  // 3. Official Producer / Distributor Keywords (+150 points)
  if (
    title.includes("official") ||
    title.includes("original") ||
    username.includes("records") ||
    username.includes("official") ||
    username.includes("vevo")
  ) {
    score += 150;
  }

  // 4. Playback & Engagement Popularity Scale (Logarithmic)
  const plays = t.playback_count || 0;
  const likes = t.likes_count || t.favoritings_count || 0;

  if (plays > 0) {
    score += Math.log10(plays + 1) * 40;
  }
  if (likes > 0) {
    score += Math.log10(likes + 1) * 25;
  }

  return score;
}

// Filter out DRM encrypted transcodings (Widevine/FairPlay cbcs/cenc/abr)
function isPlayableTranscoding(tr: any): boolean {
  if (!tr) return false;
  const protocol = (tr.format?.protocol || "").toLowerCase();
  const preset = (tr.preset || "").toLowerCase();
  const url = (tr.url || "").toLowerCase();

  if (protocol.includes("encrypted") || protocol.includes("drm")) return false;
  if (preset.includes("abr")) return false;
  if (url.includes("/cenc/") || url.includes("/cbcs/")) return false;
  return true;
}

// Extract first playable unencrypted audio stream URL from transcodings
async function extractPlayableUrlFromTranscodings(transcodings: any[], clientId: string, authParam: string): Promise<string> {
  if (!Array.isArray(transcodings) || transcodings.length === 0) return "";

  // Prioritize direct progressive MP3 streams first for instant HTML5 playback, then non-DRM HLS
  const sorted = [...transcodings].filter(isPlayableTranscoding).sort((a, b) => {
    const aProg = (a.format?.protocol || "").toLowerCase().includes("progressive");
    const bProg = (b.format?.protocol || "").toLowerCase().includes("progressive");
    if (aProg && !bProg) return -1;
    if (!aProg && bProg) return 1;
    return 0;
  });

  for (const tr of sorted) {
    try {
      const resp = await fetch(`${tr.url}?client_id=${clientId}${authParam}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(3000)
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.url && !data.url.includes("/cbcs/") && !data.url.includes("/cenc/")) {
          return data.url;
        }
      }
    } catch {}
  }
  return "";
}

// Extract guaranteed playable audio stream for any track
async function resolveSoundCloudStream(trackOrId: any, clientId: string): Promise<{ url: string; duration?: number }> {
  let track = typeof trackOrId === "object" ? trackOrId : null;
  const rawId = typeof trackOrId === "object" ? trackOrId.rawId || trackOrId.id : trackOrId;

  // 1. Fetch full track metadata directly by track ID if needed
  if (rawId && (!track || !track.track_authorization || !track.media?.transcodings)) {
    try {
      const resp = await fetch(`https://api-v2.soundcloud.com/tracks/${rawId}?client_id=${clientId}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(4000)
      });
      if (resp.ok) {
        track = await resp.json();
      }
    } catch {}
  }

  if (!track) return { url: "" };

  const origDurationSec = Math.round((track.duration || 0) / 1000);
  const authParam = track.track_authorization
    ? `&track_authorization=${encodeURIComponent(track.track_authorization)}`
    : "";

  // 2. Test playable unencrypted transcodings on the exact track object
  if (track.media && Array.isArray(track.media.transcodings)) {
    const playUrl = await extractPlayableUrlFromTranscodings(track.media.transcodings, clientId, authParam);
    if (playUrl) {
      return { url: playUrl, duration: origDurationSec };
    }
  }

  // 3. Dynamic search fallback if direct track resolution yielded empty
  const origTitle = cleanTitle(track.title || "");
  const origArtist = cleanTitle(track.user?.username || "");

  if (origTitle || origArtist) {
    const query = `${track.title || ""} ${track.user?.username || ""}`.trim();
    try {
      const searchResp = await fetch(`https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${clientId}&limit=12`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(4000)
      });
      if (searchResp.ok) {
        const sData = await searchResp.json();
        const collection = sData?.collection || [];

        // Pass 1: Strict match on BOTH Title AND Artist AND Duration (within 15s or 10%), rejecting edits/sped-up
        for (const item of collection) {
          if (isUnwantedEdit(item.title || "", query)) continue;
          const itemTitle = cleanTitle(item.title || "");
          const itemArtist = cleanTitle(item.user?.username || "");
          const itemDurSec = Math.round((item.duration || 0) / 1000);

          const titleMatch = origTitle && (itemTitle.includes(origTitle) || origTitle.includes(itemTitle));
          const artistMatch = origArtist && (itemArtist.includes(origArtist) || origArtist.includes(itemArtist) || itemTitle.includes(origArtist));
          const durMatch = origDurationSec === 0 || (Math.abs(itemDurSec - origDurationSec) <= 15 && (origDurationSec <= 20 || Math.abs(itemDurSec - origDurationSec) / origDurationSec <= 0.10));

          if (titleMatch && artistMatch && durMatch) {
            const itemAuth = item.track_authorization
              ? `&track_authorization=${encodeURIComponent(item.track_authorization)}`
              : "";
            const playUrl = await extractPlayableUrlFromTranscodings(item.media?.transcodings || [], clientId, itemAuth);
            if (playUrl) return { url: playUrl, duration: origDurationSec || itemDurSec };
          }
        }

        // Pass 2: Match Title AND Duration (within 12s), rejecting edits/sped-up
        for (const item of collection) {
          if (isUnwantedEdit(item.title || "", query)) continue;
          const itemTitle = cleanTitle(item.title || "");
          const itemDurSec = Math.round((item.duration || 0) / 1000);

          const titleMatch = origTitle && (itemTitle.includes(origTitle) || origTitle.includes(itemTitle));
          const durMatch = origDurationSec === 0 || (Math.abs(itemDurSec - origDurationSec) <= 12 && (origDurationSec <= 20 || Math.abs(itemDurSec - origDurationSec) / origDurationSec <= 0.08));

          if (titleMatch && durMatch) {
            const itemAuth = item.track_authorization
              ? `&track_authorization=${encodeURIComponent(item.track_authorization)}`
              : "";
            const playUrl = await extractPlayableUrlFromTranscodings(item.media?.transcodings || [], clientId, itemAuth);
            if (playUrl) return { url: playUrl, duration: origDurationSec || itemDurSec };
          }
        }
      }
    } catch {}
  }

  return { url: "", duration: 0 };
}

function mapTrack(t: any, rawQuery: string = ""): any {
  const art = t.artwork_url
    ? t.artwork_url.replace("-large", "-t500x500")
    : t.user?.avatar_url
    ? t.user.avatar_url.replace("-large", "-t500x500")
    : "";

  const durationSec = Math.round((t.duration || 0) / 1000);
  const rawTitle = t.title || "Untitled Track";
  const { formattedTitle, isSpedUp, isSlowed } = formatSongTitle(rawTitle, rawQuery);

  return {
    id: `sc_${t.id}`,
    rawId: t.id,
    name: formattedTitle,
    artist: t.user?.username || t.user?.name || "Artist",
    isVerified: Boolean(t.user?.verified),
    album: t.genre || (t.playback_count ? `${t.playback_count.toLocaleString()} plays` : "Track"),
    duration: durationSec,
    formattedDuration: formatSeconds(durationSec),
    pic: art,
    url: "",
    lrc: t.description || "",
    source: "soundcloud",
    media: t.media,
    isSpedUp,
    isSlowed
  };
}

// Process, deduplicate, and rank tracks with Smart Relevance Algorithm
function processRankAndDeduplicate(collection: any[], rawQuery: string = "", isMixAllowed: boolean = false): any[] {
  const seenKeys = new Set<string>();
  const scoredItems: { item: any; score: number }[] = [];

  for (const raw of collection || []) {
    if (!raw || !raw.title) continue;

    const durSec = Math.round((raw.duration || 0) / 1000);

    // Skip short preview clips (< 25s)
    if (durSec > 0 && durSec < 25) continue;

    // Skip massive compilation mixes (> 15m) unless explicitly requested
    if (!isMixAllowed && durSec > 900) continue;

    // Filter out unwanted edits/sped-up tracks unless explicitly requested by user
    if (isUnwantedEdit(raw.title, rawQuery)) continue;

    const editType = detectTrackEditType(raw.title);
    const normTitle = cleanTitle(raw.title)
      .replace(/\b(remastered|remaster|radio edit|deluxe|version|edition|album version|explicit|clean|live|acoustic)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const normArtist = cleanTitle(raw.user?.username || "");
    const dedupKey = `${normTitle}::${editType}::${normArtist}`;

    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);

    const score = calculateRelevanceScore(raw, rawQuery);
    scoredItems.push({ item: raw, score });
  }

  // Sort descending by Smart Relevance Score
  scoredItems.sort((a, b) => b.score - a.score);

  return scoredItems.map(s => mapTrack(s.item, rawQuery));
}

// Generalized Genre & Category Tags Map
const GENRE_TAG_MAP: Record<string, string[]> = {
  montagem: ["montagem funk", "montagem phonk", "montagem brasil"],
  phonk: ["drift phonk", "brazilian phonk", "wave phonk"],
  funk: ["funk brasil", "funk automotivo", "funk mandelao"],
  lofi: ["lofi hip hop", "lofi beats", "lofi chill"],
  synthwave: ["synthwave 80s", "retrowave", "cyberpunk music"],
  rap: ["hip hop rap", "trap music", "boom bap"],
  pop: ["pop hits", "dance pop", "synthpop"],
  rock: ["alt rock", "hard rock", "indie rock"],
  metal: ["heavy metal", "metalcore"],
  jazz: ["smooth jazz", "jazz beats"],
  house: ["deep house", "tech house", "house music"],
  edm: ["edm festival", "electronic dance music"],
  dubstep: ["dubstep bass", "riddim"],
  drill: ["uk drill", "ny drill"],
  kpop: ["kpop hits", "kpop dance"],
  anime: ["anime ost", "anime opening"],
  gaming: ["gaming music", "vgm ost"],
  country: ["country hits", "country rock"],
  rnb: ["rnb soul", "r&b hits"],
  indie: ["indie pop", "indie rock"]
};

// Construct dynamic search queries with typo normalization
function getDynamicExpansionQueries(rawQuery: string): string[] {
  const clean = rawQuery.toLowerCase().trim();
  if (!clean) return [];

  const normalized = clean.replace(/(.)\1+/g, "$1");
  const queries = [clean];

  if (normalized !== clean && normalized.length > 2) {
    queries.push(normalized);
    queries.push(`${normalized} top hits`);
  } else {
    queries.push(`${clean} top hits`);
  }

  const words = clean.split(" ");
  for (const word of words) {
    const normWord = word.replace(/(.)\1+/g, "$1");
    if (GENRE_TAG_MAP[word]) {
      queries.push(...GENRE_TAG_MAP[word]);
    } else if (GENRE_TAG_MAP[normWord]) {
      queries.push(...GENRE_TAG_MAP[normWord]);
    }
  }

  return Array.from(new Set(queries));
}

// Fetch SoundCloud Trending tracks
async function fetchSoundCloudTrending(limit: number = 30): Promise<any[]> {
  const cacheKey = `trending:all:${limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const clientId = await getSoundCloudClientId();
  const query = "top hits 2024 2025 mainstream pop rap phonk";

  const scUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${clientId}&limit=${limit * 2}`;
  const resp = await fetch(scUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(6000)
  });

  if (!resp.ok) {
    return [];
  }

  const data = await resp.json();
  const collection = data?.collection || [];
  const songs = processRankAndDeduplicate(collection, query, false).slice(0, limit);

  searchCache.set(cacheKey, { data: songs, timestamp: Date.now() });
  return songs;
}

// Trending / Featured Real Tracks
musicRouter.get("/music/trending", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string || "30", 10) || 30, 50);
    const songs = await fetchSoundCloudTrending(limit);
    res.json({ songs });
  } catch (err: any) {
    console.error("Trending fetch error:", err?.message);
    res.status(500).json({ songs: [] });
  }
});

// Search tracks with Dynamic Genre Expansion & Smart Relevance Scoring
musicRouter.get("/music/search", async (req: Request, res: Response) => {
  try {
    const keyword = (req.query.keyword as string || "").trim();
    const page = parseInt(req.query.page as string || "1", 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string || "30", 10) || 30, 50);

    if (!keyword) {
      const songs = await fetchSoundCloudTrending(limit);
      return res.json({ songs });
    }

    const cacheKey = `search:${keyword}:${page}:${limit}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return res.json({ songs: cached.data });
    }

    const clientId = await getSoundCloudClientId();
    const offset = (page - 1) * limit;

    const expansionQueries = getDynamicExpansionQueries(keyword);
    let rawCollection: any[] = [];

    // Execute dynamic query fetches
    for (const expQuery of expansionQueries) {
      try {
        const fetchLimit = expQuery === keyword ? limit * 2 : 12;
        const scUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(expQuery)}&client_id=${clientId}&limit=${fetchLimit}&offset=${expQuery === keyword ? offset : 0}`;

        const resp = await fetch(scUrl, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(5000)
        });

        if (resp.ok) {
          const data = await resp.json();
          if (data?.collection) {
            rawCollection = [...rawCollection, ...data.collection];
          }
        }
      } catch {}
    }

    const lowerKw = keyword.toLowerCase();
    const isMixAllowed = lowerKw.includes("mix") || lowerKw.includes("compilation") || lowerKw.includes("album") || lowerKw.includes("1 hour") || lowerKw.includes("podcast");
    const finalSongs = processRankAndDeduplicate(rawCollection, keyword, isMixAllowed).slice(0, limit);

    searchCache.set(cacheKey, { data: finalSongs, timestamp: Date.now() });
    res.json({ songs: finalSongs });
  } catch (err: any) {
    console.error("Music search error:", err?.message);
    res.status(500).json({ songs: [] });
  }
});

// Resolve exact playable audio stream URL
musicRouter.get("/music/url", async (req: Request, res: Response) => {
  try {
    const idStr = String(req.query.id || "").trim();
    const source = String(req.query.source || "").toLowerCase();
    const isOctave = idStr.startsWith("octave_") || source === "octave";
    const rawId = idStr.replace("sc_", "").replace("octave_", "").trim();
    const name = (req.query.name as string || "").trim();
    const artist = (req.query.artist as string || "").trim();
    const previewUrl = (req.query.previewUrl as string || "").trim();
    const targetDuration = Number(req.query.duration) || 0;
    const isSpedUp = req.query.isSpedUp === '1' || isSpedUpQuery(name);
    const isSlowed = req.query.isSlowed === '1' || isSlowedQuery(name);

    const clientId = await getSoundCloudClientId();

    // 1. Resolve exact unencrypted track stream ONLY if it is a native SoundCloud ID
    if (!isOctave && rawId && !isNaN(Number(rawId))) {
      const stream = await resolveSoundCloudStream(rawId, clientId);
      if (stream.url) {
        return res.json({ url: stream.url, duration: stream.duration });
      }
    }

    // 2. Query full-length unencrypted stream search by song name & artist
    if (name || artist) {
      const baseName = name
        .replace(/\(sped\s*up\)/gi, "")
        .replace(/\(slowed[^\)]*\)/gi, "")
        .replace(/\([^)]*\)/g, "")
        .replace(/\[[^\]]*\]/g, "")
        .trim();
      const cleanArt = artist.replace(/feat\..*/i, "").replace(/&.*/, "").split(",")[0].trim();

      let searchQueries: string[] = [];
      if (isSpedUp) {
        searchQueries = [
          `${baseName} sped up ${cleanArt}`.trim(),
          `${baseName} sped up`.trim(),
          `${baseName} nightcore ${cleanArt}`.trim()
        ];
      } else if (isSlowed) {
        searchQueries = [
          `${baseName} slowed ${cleanArt}`.trim(),
          `${baseName} slowed reverb ${cleanArt}`.trim(),
          `${baseName} slowed`.trim()
        ];
      } else {
        searchQueries = [
          `${baseName || name} ${cleanArt || artist}`.trim(),
          baseName || name
        ];
      }

      for (const query of searchQueries) {
        try {
          const searchResp = await fetch(`https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${clientId}&limit=10`, {
            headers: { "User-Agent": "Mozilla/5.0" },
            signal: AbortSignal.timeout(2500)
          });
          if (searchResp.ok) {
            const sData = await searchResp.json();
            const collection = (sData?.collection || []).filter((item: any) => {
              if (!item || !item.title) return false;
              // Check unwanted edits according to user's edit intent
              if (isUnwantedEdit(item.title, isSpedUp ? "sped up" : isSlowed ? "slowed" : "")) return false;

              // Validate duration if targetDuration is known
              if (targetDuration > 20) {
                const itemDurSec = Math.round((item.duration || 0) / 1000);
                const maxDiff = isSpedUp || isSlowed ? 25 : 18;
                const maxPercent = isSpedUp || isSlowed ? 0.20 : 0.12;
                if (Math.abs(itemDurSec - targetDuration) > maxDiff && Math.abs(itemDurSec - targetDuration) / targetDuration > maxPercent) {
                  return false;
                }
              }
              return true;
            });

            // Score remaining candidates by relevance
            collection.sort((a: any, b: any) => {
              const aScore = calculateRelevanceScore(a, query);
              const bScore = calculateRelevanceScore(b, query);
              return bScore - aScore;
            });

            // Fast-check only the top 2 candidates
            for (const item of collection.slice(0, 2)) {
              const stream = await resolveSoundCloudStream(item, clientId);
              if (stream.url) {
                return res.json({ url: stream.url, duration: stream.duration || targetDuration });
              }
            }
          }
        } catch {}
      }
    }

    // 3. Guaranteed immediate fallback to official studio previewUrl (crystal-clear, original pitch, zero lag)
    if (previewUrl) {
      return res.json({ url: previewUrl, duration: targetDuration || 30 });
    }

    res.json({ url: "", duration: 0 });
  } catch (err: any) {
    console.error("Music URL resolve error:", err?.message);
    const previewUrl = (req.query.previewUrl as string || "").trim();
    if (previewUrl) {
      return res.json({ url: previewUrl, duration: 30 });
    }
    res.status(500).json({ url: "", duration: 0 });
  }
});

// Get picture / album art
musicRouter.get("/music/pic", async (req: Request, res: Response) => {
  const id = (req.query.id as string || "").replace("sc_", "").trim();
  const clientId = await getSoundCloudClientId();

  if (id && !isNaN(Number(id))) {
    try {
      const trackResp = await fetch(`https://api-v2.soundcloud.com/tracks/${id}?client_id=${clientId}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(3000)
      });
      if (trackResp.ok) {
        const track = await trackResp.json();
        const art = track.artwork_url ? track.artwork_url.replace("-large", "-t500x500") : track.user?.avatar_url || "";
        return res.json({ url: art });
      }
    } catch {}
  }

  res.json({ url: "" });
});

// Get track lyrics / description
musicRouter.get("/music/lyric", async (req: Request, res: Response) => {
  const id = (req.query.id as string || "").replace("sc_", "").trim();
  const clientId = await getSoundCloudClientId();

  if (id && !isNaN(Number(id))) {
    try {
      const trackResp = await fetch(`https://api-v2.soundcloud.com/tracks/${id}?client_id=${clientId}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(3000)
      });
      if (trackResp.ok) {
        const track = await trackResp.json();
        return res.json({ lyric: track.description || "" });
      }
    } catch {}
  }

  res.json({ lyric: "" });
});

// Process and deduplicate Octave tracks, filtering out unwanted sped-up edits and duplicate releases
function processAndDeduplicateOctave(rawTracks: any[], rawQuery: string = ""): any[] {
  const seenKeys = new Set<string>();
  const results: any[] = [];
  const qLower = (rawQuery || "").toLowerCase();

  for (const item of rawTracks || []) {
    if (!item || !item.title) continue;

    const rawTitle = (item.title_short || item.title || "").trim();
    const artist = (item.artist?.name || "Unknown Artist").trim();

    // Exclude unwanted edits or sped-up versions unless specifically queried
    if (isUnwantedEdit(rawTitle, qLower)) {
      continue;
    }

    const editType = detectTrackEditType(rawTitle);
    const { formattedTitle, isSpedUp, isSlowed } = formatSongTitle(rawTitle, rawQuery);

    // Core title normalization to collapse Deluxe, Remastered, Radio Edit duplicates
    const coreTitle = cleanTitle(rawTitle)
      .replace(/\b(remastered|remaster|radio edit|deluxe|version|edition|album version|explicit|clean|live|acoustic)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const coreArtist = cleanTitle(artist);
    // Dedup key includes editType so (Sped Up) or (Slowed) tracks are NOT collapsed into the normal song!
    const dedupKey = `${coreTitle}::${editType}::${coreArtist}`;

    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);

    results.push({
      id: `octave_${item.id}`,
      rawId: item.id,
      name: formattedTitle,
      artist: artist,
      album: item.album?.title || "",
      pic: item.album?.cover_big || item.artist?.picture_big || item.album?.cover_medium || "",
      url: "",
      previewUrl: item.preview || "",
      duration: item.duration || 0,
      formattedDuration: formatSeconds(item.duration || 0),
      source: "Octave",
      isSpedUp,
      isSlowed
    });
  }

  // If user searched for sped up or slowed, prioritize matching edit types at the top
  if (isSpedUpQuery(rawQuery)) {
    results.sort((a, b) => (b.isSpedUp ? 1 : 0) - (a.isSpedUp ? 1 : 0));
  } else if (isSlowedQuery(rawQuery)) {
    results.sort((a, b) => (b.isSlowed ? 1 : 0) - (a.isSlowed ? 1 : 0));
  }

  return results;
}

// Process and deduplicate iTunes tracks for Octave fallback
function processAndDeduplicateITunes(rawTracks: any[], rawQuery: string = ""): any[] {
  const seenKeys = new Set<string>();
  const results: any[] = [];
  const qLower = (rawQuery || "").toLowerCase();

  for (const item of rawTracks || []) {
    if (!item || !item.trackName) continue;

    const rawTitle = (item.trackName || "").trim();
    const artist = (item.artistName || "Unknown Artist").trim();

    if (isUnwantedEdit(rawTitle, qLower)) continue;

    const editType = detectTrackEditType(rawTitle);
    const { formattedTitle, isSpedUp, isSlowed } = formatSongTitle(rawTitle, rawQuery);

    const coreTitle = cleanTitle(rawTitle)
      .replace(/\b(remastered|remaster|radio edit|deluxe|version|edition|album version|explicit|clean|live|acoustic)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const coreArtist = cleanTitle(artist);
    const dedupKey = `${coreTitle}::${editType}::${coreArtist}`;

    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);

    const durSec = item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : 0;
    const pic = item.artworkUrl100 ? item.artworkUrl100.replace("100x100bb", "600x600bb") : "";

    results.push({
      id: `octave_${item.trackId || Math.random().toString(36).substring(2, 9)}`,
      rawId: item.trackId,
      name: formattedTitle,
      artist: artist,
      album: item.collectionName || "",
      pic: pic,
      url: "",
      previewUrl: item.previewUrl || "",
      duration: durSec,
      formattedDuration: formatSeconds(durSec),
      source: "Octave",
      isSpedUp,
      isSlowed
    });
  }

  if (isSpedUpQuery(rawQuery)) {
    results.sort((a, b) => (b.isSpedUp ? 1 : 0) - (a.isSpedUp ? 1 : 0));
  } else if (isSlowedQuery(rawQuery)) {
    results.sort((a, b) => (b.isSlowed ? 1 : 0) - (a.isSlowed ? 1 : 0));
  }

  return results;
}

// Fetch Octave Trending tracks with Deezer primary + iTunes fallback
async function fetchOctaveTrending(limit: number = 30): Promise<any[]> {
  const cacheKey = `octave_trending_${limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 1000 * 60 * 10) {
    return cached.data;
  }

  // 1. Try Deezer Chart
  try {
    const resp = await fetch("https://api.deezer.com/chart/0/tracks?limit=60", {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(4000)
    });
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data?.data) && data.data.length > 0) {
        const songs = processAndDeduplicateOctave(data.data, "").slice(0, limit);
        if (songs.length > 0) {
          searchCache.set(cacheKey, { data: songs, timestamp: Date.now() });
          return songs;
        }
      }
    }
  } catch (err: any) {
    console.warn("Deezer trending fallback to iTunes:", err?.message);
  }

  // 2. Fallback to iTunes Top Hits
  try {
    const itunesResp = await fetch("https://itunes.apple.com/search?term=top+hits+2025&entity=song&limit=60", {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(4000)
    });
    if (itunesResp.ok) {
      const itunesData = await itunesResp.json();
      if (Array.isArray(itunesData?.results) && itunesData.results.length > 0) {
        const songs = processAndDeduplicateITunes(itunesData.results, "").slice(0, limit);
        if (songs.length > 0) {
          searchCache.set(cacheKey, { data: songs, timestamp: Date.now() });
          return songs;
        }
      }
    }
  } catch (err: any) {
    console.error("iTunes trending fallback error:", err?.message);
  }

  return [];
}

// Fetch Octave Search tracks with Deezer primary + iTunes fallback
async function fetchOctaveSearch(keyword: string, limit: number = 30, page: number = 1): Promise<any[]> {
  if (!keyword) {
    return fetchOctaveTrending(limit);
  }

  const offset = (page - 1) * limit;
  const cacheKey = `octave_search_${keyword}_${page}_${limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 1000 * 60 * 10) {
    return cached.data;
  }

  // 1. Try Deezer Search
  try {
    const resp = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(keyword)}&limit=60&index=${offset}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(4000)
    });
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data?.data) && data.data.length > 0) {
        const songs = processAndDeduplicateOctave(data.data, keyword).slice(0, limit);
        if (songs.length > 0) {
          searchCache.set(cacheKey, { data: songs, timestamp: Date.now() });
          return songs;
        }
      }
    }
  } catch (err: any) {
    console.warn("Deezer search fallback to iTunes:", err?.message);
  }

  // 2. Fallback to iTunes Search
  try {
    const itunesResp = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(keyword)}&entity=song&limit=${limit * 2}&offset=${offset}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(4000)
    });
    if (itunesResp.ok) {
      const itunesData = await itunesResp.json();
      if (Array.isArray(itunesData?.results) && itunesData.results.length > 0) {
        const songs = processAndDeduplicateITunes(itunesData.results, keyword).slice(0, limit);
        if (songs.length > 0) {
          searchCache.set(cacheKey, { data: songs, timestamp: Date.now() });
          return songs;
        }
      }
    }
  } catch (err: any) {
    console.error("iTunes search error:", err?.message);
  }

  return [];
}

// Octave Music Engine Endpoints (High Quality Open Audio Engine)
musicRouter.get("/music/octave/trending", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string || "30", 10) || 30, 50);
    const songs = await fetchOctaveTrending(limit);
    res.json({ songs });
  } catch (err: any) {
    console.error("Octave trending error:", err?.message);
    res.status(500).json({ songs: [] });
  }
});

musicRouter.get("/music/octave/search", async (req: Request, res: Response) => {
  try {
    const keyword = (req.query.keyword as string || "").trim();
    const limit = Math.min(parseInt(req.query.limit as string || "30", 10) || 30, 50);
    const page = parseInt(req.query.page as string || "1", 10) || 1;

    const songs = await fetchOctaveSearch(keyword, limit, page);
    res.json({ songs });
  } catch (err: any) {
    console.error("Octave search error:", err?.message);
    res.status(500).json({ songs: [] });
  }
});

// Audio stream proxy endpoint for cross-origin / school network / Chromebook compatibility
musicRouter.get("/music/proxy", async (req: Request, res: Response) => {
  try {
    const targetUrl = req.query.url as string;
    if (!targetUrl || !targetUrl.startsWith("http")) {
      return res.status(400).send("Invalid target URL");
    }

    const rangeHeader = req.headers.range;
    const fetchHeaders: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Referer": "https://soundcloud.com/"
    };
    if (rangeHeader) {
      fetchHeaders["Range"] = rangeHeader;
    }

    const upstream = await fetch(targetUrl, {
      headers: fetchHeaders,
      signal: AbortSignal.timeout(12000)
    });

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).send("Stream fetch error");
    }

    // Pass through appropriate audio content headers
    const contentType = upstream.headers.get("content-type") || "audio/mpeg";
    const contentLength = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");
    const acceptRanges = upstream.headers.get("accept-ranges") || "bytes";

    res.status(upstream.status);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", acceptRanges);
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    if (contentRange) res.setHeader("Content-Range", contentRange);

    if (upstream.body) {
      const reader = upstream.body.getReader();
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (res.writableEnded || res.closed) break;
            res.write(Buffer.from(value));
          }
        } catch (e) {
          // Client disconnected
        } finally {
          res.end();
        }
      };
      pump();
    } else {
      res.end();
    }
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).send("Proxy error: " + err?.message);
    }
  }
});

export default musicRouter;
