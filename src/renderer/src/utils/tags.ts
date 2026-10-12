export interface Tag {
  name: string;
  count: number;
}

const VIDEO_EXT_RE = /\.(mov|mp4|mkv|webm|m4v|avi|flv|wmv|mpg|mpeg|3gp|m2ts|ts|hevc)$/i;
const SEPARATOR_RE = /[\s\-_.\[\](){}:,'/\\|]+/;
const NUMERIC_RE = /^\d+$/;
const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'in', 'on', 'to', 'for', 'with', 'at', 'by', 'from',
  'as', 'is', 'it', 'or', 'be', 'but', 'if', 'not', 'are', 'was', 'were', 'will',
  'would', 'could', 'should', 'has', 'have', 'had', 'do', 'does', 'did', 'this',
  'that', 'these', 'those', 'which', 'who', 'what', 'when', 'where', 'why', 'how',
  '&'
]);

function isMostlyNumeric(t: string): boolean {
  let digits = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c >= 48 && c <= 57) digits++;
  }
  return digits / t.length >= 0.5;
}

function tokenizeRaw(filename: string): string[] {
  return filename
    .replace(VIDEO_EXT_RE, '')
    .toLowerCase()
    .split(SEPARATOR_RE)
    .filter(Boolean);
}

// Token caches: countVideosByTag/getMatchingTags used to call
// tokenizeRaw(filename) once per (video, tag) pair — O(V·T)
// tokenizations on the React thread. Cache by input string so each
// distinct filename/tag is tokenized once per session.
const rawTokenCache = new Map<string, string[]>();
const tagTokenCache = new Map<string, string[]>();
const TOKEN_CACHE_LIMIT = 20000;

function tokenizeRawCached(filename: string): string[] {
  const hit = rawTokenCache.get(filename);
  if (hit) return hit;
  const toks = tokenizeRaw(filename);
  if (rawTokenCache.size >= TOKEN_CACHE_LIMIT) rawTokenCache.clear();
  rawTokenCache.set(filename, toks);
  return toks;
}

function tagTokensCached(tagName: string): string[] {
  const hit = tagTokenCache.get(tagName);
  if (hit) return hit;
  const toks = tagName.toLowerCase().split(/\s+/).filter(Boolean);
  if (tagTokenCache.size >= TOKEN_CACHE_LIMIT) tagTokenCache.clear();
  tagTokenCache.set(tagName, toks);
  return toks;
}

export function __clearTagCaches(): void {
  rawTokenCache.clear();
  tagTokenCache.clear();
}

function isFilterable(token: string): boolean {
  return NUMERIC_RE.test(token) || isMostlyNumeric(token) || STOPWORDS.has(token);
}

function tokenize(filename: string): string[] {
  return tokenizeRaw(filename).filter((t) => !isFilterable(t));
}

export function matchesTag(filename: string, tagName: string): boolean {
  return matchesTagTokens(tokenizeRawCached(filename), tagTokensCached(tagName));
}

function matchesTagTokens(fileTokens: ReadonlyArray<string>, tagTokens: ReadonlyArray<string>): boolean {
  if (tagTokens.length === 0) return false;
  for (let start = 0; start < fileTokens.length; start++) {
    let i = start;
    let j = 0;
    while (i < fileTokens.length && j < tagTokens.length) {
      if (fileTokens[i] === tagTokens[j]) {
        i++;
        j++;
      } else if (isFilterable(fileTokens[i])) {
        i++;
      } else {
        break;
      }
    }
    if (j === tagTokens.length) return true;
  }
  return false;
}

function* ngrams(tokens: string[], min: number): Generator<string[]> {
  for (let len = min; len <= tokens.length; len++) {
    for (let i = 0; i + len <= tokens.length; i++) {
      yield tokens.slice(i, i + len);
    }
  }
}

function titleCase(s: string): string {
  return s
    .split(' ')
    .map((w) => (w.length === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function normaliseTagName(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w.length === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function extractTags(filenames: string[]): Tag[] {
  type Entry = { tokens: string[]; files: Set<string> };
  const byKey = new Map<string, Entry>();

  for (const f of filenames) {
    const seen = new Set<string>();
    for (const ng of ngrams(tokenize(f), 2)) {
      const key = ng.join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      let entry = byKey.get(key);
      if (!entry) {
        entry = { tokens: ng, files: new Set() };
        byKey.set(key, entry);
      }
      entry.files.add(f);
    }
  }

  const candidates: Entry[] = [];
  for (const e of byKey.values()) {
    if (e.files.size >= 2) candidates.push(e);
  }

  candidates.sort((a, b) => b.tokens.length - a.tokens.length);

  const winners: Entry[] = [];
  for (const c of candidates) {
    const fullyCovered = winners.some((w) => {
      for (const f of c.files) {
        if (!w.files.has(f)) return false;
      }
      return true;
    });
    if (fullyCovered) continue;
    winners.push(c);
  }

  return winners
    .map((c) => ({ name: titleCase(c.tokens.join(' ')), count: c.files.size }))
    .sort((a, b) => a.name.localeCompare(b.name) || b.count - a.count);
}

export function getSubfolderSegments(folder: string, root: string): string[] {
  let relative: string;
  if (folder === root) {
    return [];
  }
  if (folder.startsWith(root + '/')) {
    relative = folder.slice(root.length + 1);
  } else {
    relative = folder;
  }
  return relative.split('/').filter(Boolean);
}

export function findRoot(folder: string, roots: string[]): string | null {
  for (const r of roots) {
    if (folder === r || folder.startsWith(r + '/')) return r;
  }
  return null;
}

export function videoMatchesTag(
  video: { filename: string; folder: string; tags?: ReadonlyArray<string>; excludedTags?: ReadonlyArray<string> },
  tagName: string,
  roots: string[],
  globalExcluded?: ReadonlySet<string> | ReadonlyArray<string>
): boolean {
  const lc = tagName.toLowerCase();
  if (video.excludedTags && video.excludedTags.some((t) => t.toLowerCase() === lc)) {
    return false;
  }
  // Explicit user tags win over the global blocklist so a globally
  // deleted tag can still be re-added to an individual video.
  if (video.tags && video.tags.some((t) => t.toLowerCase() === lc)) return true;
  if (globalExcluded) {
    if (globalExcluded instanceof Set) {
      // Hot path: callers pass a pre-lowercased Set.
      if ((globalExcluded as ReadonlySet<string>).has(lc)) return false;
    } else {
      for (const s of globalExcluded) {
        if (s.toLowerCase() === lc) return false;
      }
    }
  }
  const fileTokens = tokenizeRawCached(video.filename);
  if (matchesTagTokens(fileTokens, tagTokensCached(tagName))) return true;
  const root = findRoot(video.folder, roots);
  if (!root) return false;
  const segments = getSubfolderSegments(video.folder, root);
  if (segments.length === 0) return false;
  return segments.some((seg) => matchesTagTokens(tokenizeRawCached(seg), tagTokensCached(tagName)));
}

export function getMatchingTags(
  video: { filename: string; folder: string; tags?: ReadonlyArray<string>; excludedTags?: ReadonlyArray<string> },
  tags: ReadonlyArray<Tag>,
  roots: string[],
  globalExcluded?: ReadonlySet<string> | ReadonlyArray<string>
): string[] {
  const matches: string[] = [];
  for (const t of tags) {
    if (videoMatchesTag(video, t.name, roots, globalExcluded)) matches.push(t.name);
  }
  matches.sort((a, b) => a.localeCompare(b));
  return matches;
}

// Count, per tag name, the number of videos that would be shown when the
// tag is selected. Uses the same videoMatchesTag predicate as the click
// filter, so the sidebar count and the filtered view can never drift out
// of sync (the previous implementation only counted explicit user tags
// for tags that weren't auto-detected, which under-reported counts for
// tags like "Alura Jenson" that auto-match via folder/filename segments).
export function countVideosByTag(
  videos: ReadonlyArray<{
    filename: string;
    folder: string;
    tags?: ReadonlyArray<string>;
    excludedTags?: ReadonlyArray<string>;
  }>,
  tagNames: ReadonlyArray<string>,
  roots: string[],
  globalExcluded?: ReadonlySet<string> | ReadonlyArray<string>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of tagNames) counts.set(name, 0);
  if (tagNames.length === 0) return counts;
  const candidates: Tag[] = tagNames.map((name) => ({ name, count: 0 }));
  for (const v of videos) {
    for (const name of getMatchingTags(v, candidates, roots, globalExcluded)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}

export function extractTagsWithFolders(
  items: Array<{ filename: string; folder: string }>,
  roots: string[]
): Tag[] {
  const base = extractTags(items.map((i) => i.filename));
  if (base.length === 0) return base;

  const tagNames = base.map((t) => t.name);
  const baseFilesByTag: Set<string>[] = tagNames.map(() => new Set());
  for (let i = 0; i < items.length; i++) {
    const fk = String(i);
    const f = items[i].filename;
    for (let t = 0; t < tagNames.length; t++) {
      if (matchesTag(f, tagNames[t])) baseFilesByTag[t].add(fk);
    }
  }

  const enriched = base.map((t) => ({ name: t.name, count: t.count }));
  for (let i = 0; i < items.length; i++) {
    const fk = String(i);
    const item = items[i];
    const root = findRoot(item.folder, roots);
    if (!root) continue;
    const segments = getSubfolderSegments(item.folder, root);
    if (segments.length === 0) continue;
    for (let t = 0; t < tagNames.length; t++) {
      if (baseFilesByTag[t].has(fk)) continue;
      const tagName = tagNames[t];
      let matched = false;
      for (const seg of segments) {
        if (matchesTag(seg, tagName)) {
          matched = true;
          break;
        }
      }
      if (matched) enriched[t].count++;
    }
  }

  enriched.sort((a, b) => a.name.localeCompare(b.name) || b.count - a.count);
  return enriched;
}
