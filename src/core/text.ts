import type { Interval } from './types';

/**
 * Normalized text plus, for every normalized UTF-16 unit, the raw [start, end) interval it came from.
 * A collapsed whitespace run maps to the whole raw run.
 */
export interface NormalizedText {
  normalized: string;
  rawStart: number[];
  rawEnd: number[];
}

/** Ordinary whitespace that collapses. No zero-width, joiner or BOM characters. */
const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f', '\v', ' ', ' ']);

/** NBSP, figure, thin and narrow no-break spaces fold to a space (and then collapse). */
const SPACE_FOLDS = new Set([' ', ' ', ' ', ' ']);

/** Fixed curly quote list. Nothing else is folded: no NFKC, case, dash or punctuation folding. */
const QUOTE_FOLDS: Readonly<Record<string, string>> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
};

export const NORMALIZATION_VERSION = 'norm/1';

function isCollapsible(unit: string): boolean {
  return WHITESPACE.has(unit) || SPACE_FOLDS.has(unit);
}

/**
 * Collapse whitespace runs, fold the fixed space and quote lists, and trim both ends.
 * Works on UTF-16 code units so astral characters keep their two-unit offsets.
 */
export function normalizeWithMap(input: string): NormalizedText {
  let normalized = '';
  const rawStart: number[] = [];
  const rawEnd: number[] = [];
  let index = 0;
  while (index < input.length) {
    const unit = input[index] as string;
    if (isCollapsible(unit)) {
      const runStart = index;
      while (index < input.length && isCollapsible(input[index] as string)) index += 1;
      if (normalized.length > 0 && index < input.length) {
        normalized += ' ';
        rawStart.push(runStart);
        rawEnd.push(index);
      }
      continue;
    }
    normalized += QUOTE_FOLDS[unit] ?? unit;
    rawStart.push(index);
    rawEnd.push(index + 1);
    index += 1;
  }
  return { normalized, rawStart, rawEnd };
}

export function normalize(input: string): string {
  return normalizeWithMap(input).normalized;
}

/** Map a normalized [start, end) back to the raw interval. */
export function rawInterval(map: NormalizedText, start: number, end: number): Interval | null {
  if (start < 0 || end > map.normalized.length || start >= end) return null;
  const rawFrom = map.rawStart[start];
  const rawTo = map.rawEnd[end - 1];
  if (rawFrom === undefined || rawTo === undefined) return null;
  return { start: rawFrom, end: rawTo };
}

export function countWords(text: string): number {
  const trimmed = normalize(text);
  if (!trimmed) return 0;
  return trimmed.split(' ').filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/**
 * Abbreviations whose trailing period does not end a sentence. Matched case-sensitively
 * against the token that ends at the period (the period included).
 */
const ABBREVIATIONS = new Set([
  'e.g.',
  'i.e.',
  'etc.',
  'vs.',
  'cf.',
  'Inc.',
  'Ltd.',
  'LLC.',
  'Co.',
  'Corp.',
  'No.',
  'Nos.',
  'Mr.',
  'Ms.',
  'Mrs.',
  'Dr.',
  'St.',
  'Art.',
  'Sec.',
  'U.S.',
  'U.K.',
  'E.U.',
  'a.m.',
  'p.m.',
]);

/** "1.", "12.", "a.", "iv." or "B." at a line start are list markers, not sentence ends. ("(b)" has no period.) */
const LIST_MARKER = /^(?:\d{1,3}|[a-z]|[ivxlc]{1,5}|[A-Z])\.$/;

function tokenBefore(text: string, periodIndex: number): string {
  let from = periodIndex;
  while (from > 0 && !isCollapsible(text[from - 1] as string) && text[from - 1] !== '(') from -= 1;
  return text.slice(from, periodIndex + 1);
}

function atLineStart(text: string, tokenStart: number): boolean {
  let at = tokenStart - 1;
  while (at >= 0 && (text[at] === ' ' || text[at] === '\t')) at -= 1;
  return at < 0 || text[at] === '\n' || text[at] === '\r';
}

/**
 * Sentence spans over raw text. Line breaks end a sentence (captured blocks are separated by
 * newlines). A terminal . ! or ? ends a sentence when followed by whitespace and not part of a
 * protected abbreviation or a leading list marker. Spans are trimmed of surrounding whitespace.
 */
export function segmentSentences(text: string, within: Interval = { start: 0, end: text.length }): Interval[] {
  const spans: Interval[] = [];
  let start = within.start;
  const push = (end: number) => {
    let from = start;
    let to = end;
    while (from < to && isCollapsible(text[from] as string)) from += 1;
    while (to > from && isCollapsible(text[to - 1] as string)) to -= 1;
    if (to > from) spans.push({ start: from, end: to });
  };
  for (let index = within.start; index < within.end; index += 1) {
    const unit = text[index] as string;
    if (unit === '\n' || unit === '\r' || unit === ' ' || unit === ' ') {
      push(index);
      start = index + 1;
      continue;
    }
    if (unit !== '.' && unit !== '!' && unit !== '?') continue;
    // Include closing quotes/brackets directly after the terminator.
    let end = index + 1;
    while (end < within.end && /["'’”)\]]/.test(text[end] as string)) end += 1;
    const next = text[end];
    if (end < within.end && next !== undefined && !isCollapsible(next)) continue;
    if (unit === '.') {
      const token = tokenBefore(text, index);
      if (ABBREVIATIONS.has(token)) continue;
      const tokenStart = index + 1 - token.length;
      if (LIST_MARKER.test(token) && atLineStart(text, tokenStart)) continue;
      // Single capital initial ("J. Smith") or a decimal number ("1.5") is not a boundary.
      if (/^[A-Z]\.$/.test(token)) continue;
    }
    push(end);
    start = end;
    index = end - 1;
  }
  push(within.end);
  return spans;
}

/** Smallest sentence span containing [start, end), or null when it crosses a sentence boundary. */
export function containingSentence(sentences: readonly Interval[], start: number, end: number): Interval | null {
  for (const sentence of sentences) {
    if (sentence.start <= start && end <= sentence.end) return sentence;
  }
  return null;
}

/** SHA-256 hex digest via Web Crypto (available in Chrome extension pages and Node 20+). */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto is not available for hashing.');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Heuristic sections for pasted text (the extension bridge derives sections from real headings).
 * A heading is a short line without terminal sentence punctuation. A section runs from its heading to
 * the next heading; text before the first heading has no section.
 */
export function deriveSections(text: string): { id: string; label: string; start: number; end: number }[] {
  const headings: { start: number; label: string }[] = [];
  let lineStart = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index < text.length && text[index] !== '\n') continue;
    const line = text.slice(lineStart, index).trim();
    if (line && line.length <= 80 && !/[.!?;:,]$/.test(line) && /[\p{L}]/u.test(line) && line.split(/\s+/).length <= 10) {
      headings.push({ start: lineStart + text.slice(lineStart, index).indexOf(line), label: line });
    }
    lineStart = index + 1;
  }
  return headings.map((heading, index) => ({
    id: `s${index}`,
    label: heading.label,
    start: heading.start,
    end: headings[index + 1]?.start ?? text.length,
  }));
}
