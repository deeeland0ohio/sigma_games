export interface TrackIdentity {
  title?: string;
  artist?: string;
  duration?: number;
}

export interface Candidate extends TrackIdentity {
  url?: string;
  mimeType?: string;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "in", "on", "of", "to", "for", "with", "by",
  "feat", "ft", "featuring", "prod", "from", "vol", "pt", "part",
  "official", "video", "music", "audio", "lyric", "lyrics", "visualizer",
  "hd", "hq", "4k", "explicit", "clean", "mv", "m", "v",
]);

const ALTERATION_MARKERS = [
  "cover", "covered", "instrumental", "karaoke", "acapella", "a cappella",
  "remix", "rmx", "bootleg", "mashup", "medley", "megamix",
  "slowed", "reverb", "sped", "speed", "nightcore", "daycore", "chipmunk",
  "8d", "boosted", "bassboost",
  "live", "concert", "reaction", "reacts", "tutorial", "lesson", "howto",
  "piano", "guitar", "violin", "orchestra", "orchestral", "quartet", "symphony",
  "lullaby", "ringtone", "8bit", "8bitmix", "tribute", "parody",
  "remake", "rework", "flip", "edit", "extended", "loop", "hour",
  "ai", "aivoice", "deepfake", "fanmade",
];

export function normalize(text: string): string {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function contentWords(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

export function titleScore(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const setA = new Set(contentWords(a));
  const setB = new Set(contentWords(b));
  if (setA.size === 0 || setB.size === 0) return 0;

  let common = 0;
  for (const word of setA) if (setB.has(word)) common++;
  const jaccard = common / (setA.size + setB.size - common);

  const oneContainsOther =
    [...setA].every((w) => setB.has(w)) || [...setB].every((w) => setA.has(w));

  return Math.max(jaccard, oneContainsOther ? 0.9 : 0);
}

export function titleCovers(targetTitle: string, candidateTitle: string): boolean {
  const target = new Set(contentWords(targetTitle));
  const candidate = new Set(contentWords(candidateTitle));
  if (target.size === 0) return false;
  for (const word of target) if (!candidate.has(word)) return false;
  return true;
}

function alterationMarkers(text: string): string[] {
  const words = new Set(contentWords(text));
  return ALTERATION_MARKERS.filter((marker) => words.has(marker));
}

function primaryArtist(artist: string): string {
  return (artist || "").split(/,|&|;|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bx\b/i)[0].trim();
}

export function artistMatches(targetArtist: string | undefined, candidateArtist: string, candidateTitle: string): boolean {
  const primary = primaryArtist(targetArtist || "");
  const targetWords = contentWords(primary).filter((w) => w.length > 2);
  if (targetWords.length === 0) return true;

  const pool = ` ${normalize(candidateArtist)} ${normalize(candidateTitle)} `;

  const compactPool = pool.replace(/ /g, "");
  return targetWords.every(
    (word) => pool.includes(` ${word} `) || pool.includes(` ${word}s `) || compactPool.includes(word)
  );
}

export function durationMatches(targetDuration?: number, candidateDuration?: number): boolean {
  if (!targetDuration || !candidateDuration) return true;
  const tolerance = Math.max(4, targetDuration * 0.04);
  return Math.abs(targetDuration - candidateDuration) <= tolerance;
}

export function identityMismatch(candidate: Candidate, target: TrackIdentity): string[] {
  if (!candidate.title || !target.title) return ["title-missing"];

  const reasons: string[] = [];
  const score = titleScore(candidate.title, target.title);
  const lengthsAgree = durationMatches(target.duration, candidate.duration);

  const allowed = new Set(alterationMarkers(target.title));
  const extra = alterationMarkers(candidate.title).filter((m) => !allowed.has(m));

  if (score < 0.85) reasons.push("title");

  const credited = artistMatches(target.artist, candidate.artist || "", candidate.title);
  const sameTrackByName =
    score === 1 && lengthsAgree && extra.length === 0 && Boolean(target.duration) && Boolean(candidate.duration);
  if (!credited && !sameTrackByName) reasons.push("artist");

  if (!lengthsAgree) reasons.push("duration");
  if (extra.length > 0) reasons.push(`altered:${extra.join(",")}`);

  return reasons;
}

export function isSameRecording(candidate: Candidate, target: TrackIdentity): boolean {
  return identityMismatch(candidate, target).length === 0;
}

export function buildQueries(identity: TrackIdentity): string[] {
  const title = (identity.title || "").trim();
  const artist = primaryArtist(identity.artist || "");
  const queries: string[] = [];
  if (title && artist) queries.push(`${title} ${artist}`);
  if (title) queries.push(title);
  return queries.filter((q, i, all) => q && all.indexOf(q) === i);
}
