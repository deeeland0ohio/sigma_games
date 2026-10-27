/**
 * Recording identity.
 *
 * The music sources are catalogs of *metadata* (Deezer, iTunes, YouTube,
 * SoundCloud) and the audio often has to come from somewhere else. That is
 * where "right name, right cover art, wrong song" comes from: a search on
 * another catalog returns a cover, a remix, a sped-up edit or an instrumental,
 * and we play it under the original's title.
 *
 * Everything here exists to answer one question:
 *   "is this candidate really the same recording as the track the user picked?"
 *
 * Title + artist + duration must all agree, and the candidate may not carry an
 * alteration marker (cover/karaoke/remix/sped up/...) that the original does
 * not have. If we cannot prove identity, the caller must NOT use that audio.
 */

export interface TrackIdentity {
  title?: string;
  artist?: string;
  duration?: number; // seconds
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

/**
 * Words that mean "this is a different recording". If a candidate has one of
 * these and the original does not, the candidate is rejected.
 */
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

/** 0..1 — how close two titles are. 1 means identical after normalisation. */
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

  // "Blinding Lights" vs "Blinding Lights Remastered" should count as a match;
  // the alteration check is what rejects genuinely different recordings.
  const oneContainsOther =
    [...setA].every((w) => setB.has(w)) || [...setB].every((w) => setA.has(w));

  return Math.max(jaccard, oneContainsOther ? 0.9 : 0);
}

/**
 * Every meaningful word of `targetTitle` appears in `candidateTitle`.
 *
 * User uploads conventionally append the artist to the title
 * ("Let Down - Radiohead"), which a plain similarity score punishes even
 * though the recording is the right one. Extra words are allowed; missing
 * words are not, so a shorter or different title fails.
 */
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

/** "Drake, Future feat. X" -> "Drake". Collabs are listed inconsistently. */
function primaryArtist(artist: string): string {
  return (artist || "").split(/,|&|;|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bx\b/i)[0].trim();
}

/** Is the target's artist actually credited on this candidate? */
export function artistMatches(targetArtist: string | undefined, candidateArtist: string, candidateTitle: string): boolean {
  const primary = primaryArtist(targetArtist || "");
  const targetWords = contentWords(primary).filter((w) => w.length > 2);
  if (targetWords.length === 0) return true; // no artist known: rely on title + duration

  const pool = ` ${normalize(candidateArtist)} ${normalize(candidateTitle)} `;
  // Channels glue names together ("TheWeekndVEVO"), so compare both the
  // spaced and the compact form. Every part of the primary artist must appear.
  const compactPool = pool.replace(/ /g, "");
  return targetWords.every(
    (word) => pool.includes(` ${word} `) || pool.includes(` ${word}s `) || compactPool.includes(word)
  );
}

/** Durations agree within 4% (min 4s). Unknown durations are not evidence either way. */
export function durationMatches(targetDuration?: number, candidateDuration?: number): boolean {
  if (!targetDuration || !candidateDuration) return true;
  const tolerance = Math.max(4, targetDuration * 0.04);
  return Math.abs(targetDuration - candidateDuration) <= tolerance;
}

/**
 * The one gate every audio candidate has to pass, plus the reason it failed.
 *
 * Returning the reasons (instead of a bare boolean) is what makes
 * `/api/music/debug` able to say "rejected: artist, duration" for a candidate
 * instead of leaving us guessing why a track fell back to a preview.
 */
export function identityMismatch(candidate: Candidate, target: TrackIdentity): string[] {
  if (!candidate.title || !target.title) return ["title-missing"];

  const reasons: string[] = [];
  if (titleScore(candidate.title, target.title) < 0.85) reasons.push("title");
  if (!artistMatches(target.artist, candidate.artist || "", candidate.title)) reasons.push("artist");
  if (!durationMatches(target.duration, candidate.duration)) reasons.push("duration");

  // An altered recording is only acceptable when the user asked for it,
  // e.g. a track literally titled "... (Remix)".
  // A candidate cannot be shorter than the song by more than the tolerance;
  // that is how 30-second previews used to slip in as "full" tracks.
  const allowed = new Set(alterationMarkers(target.title));
  const extra = alterationMarkers(candidate.title).filter((m) => !allowed.has(m));
  if (extra.length > 0) reasons.push(`altered:${extra.join(",")}`);

  return reasons;
}

export function isSameRecording(candidate: Candidate, target: TrackIdentity): boolean {
  return identityMismatch(candidate, target).length === 0;
}

/** Search terms for finding a track on another catalog, best first. */
export function buildQueries(identity: TrackIdentity): string[] {
  const title = (identity.title || "").trim();
  const artist = primaryArtist(identity.artist || "");
  const queries: string[] = [];
  if (title && artist) queries.push(`${title} ${artist}`);
  if (title) queries.push(title);
  return queries.filter((q, i, all) => q && all.indexOf(q) === i);
}
