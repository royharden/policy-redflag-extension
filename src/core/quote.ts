import {
  containingSentence,
  countWords,
  normalize,
  normalizeWithMap,
  rawInterval,
  segmentSentences,
  type NormalizedText,
} from './text';
import { LIMITS, type Interval, type RejectCode, type Section } from './types';

/**
 * Evidence location. Two paths, never mixed:
 * 1. Offsets path (rules, recorded-with-offsets): exact text.slice(start, end) === quote. Bad offsets are
 *    rejected and never re-searched.
 * 2. Quote-only path (model, recorded without offsets): full-quote search over the normalized text,
 *    scoped to a known section when one is given. No fuzzy match, no prefix acceptance.
 */

export interface LocatedEvidence {
  occurrences: { span: Interval; matched: Interval }[];
  expanded: boolean;
  ambiguous: boolean;
}

export type LocateOutcome = { ok: true; value: LocatedEvidence } | { ok: false; code: RejectCode; detail: string };

export interface EvidenceDocument {
  text: string;
  sections: readonly Section[];
}

/** Cached per-document derived data (normalized map and sentence spans). */
export interface PreparedDocument extends EvidenceDocument {
  map: NormalizedText;
  sentences: Interval[];
}

export function prepareDocument(document: EvidenceDocument): PreparedDocument {
  return {
    ...document,
    map: normalizeWithMap(document.text),
    sentences: segmentSentences(document.text),
  };
}

/** Function words that make a short fragment generic ("you", "we may", "the service"). */
const GENERIC_WORDS = new Set(
  (
    'a an the and or but if of to in on at by for from with as is are be been being was were will would ' +
    'shall should may might can could must do does did not no you your yours we us our ours they them ' +
    'their it its this that these those any all some such service services site app terms policy agreement'
  ).split(' '),
);

function contentWordCount(text: string): number {
  return normalize(text)
    .toLowerCase()
    .split(' ')
    .map((word) => word.replace(/[^\p{L}\p{N}-]/gu, ''))
    .filter((word) => word.length > 1 && !GENERIC_WORDS.has(word)).length;
}

function fail(code: RejectCode, detail: string): LocateOutcome {
  return { ok: false, code, detail };
}

function trimSentenceEnd(text: string, span: Interval): Interval {
  let end = span.end;
  while (end > span.start && /[.!?;:"'’”)\]]/.test(text[end - 1] as string)) end -= 1;
  return { start: span.start, end };
}

/** True when the span is a complete source sentence (terminal punctuation optional). */
export function isCompleteSentence(document: PreparedDocument, span: Interval): boolean {
  const sentence = containingSentence(document.sentences, span.start, span.end);
  if (!sentence) return false;
  if (sentence.start !== span.start) return false;
  return span.end === sentence.end || trimSentenceEnd(document.text, sentence).end <= span.end;
}

function scopeFor(document: PreparedDocument, sectionId: string | undefined): Interval | null {
  if (sectionId === undefined) return { start: 0, end: document.text.length };
  const section = document.sections.find((item) => item.id === sectionId);
  return section ? { start: section.start, end: section.end } : null;
}

const WORD = /[\p{L}\p{N}]/u;

/** A match may not start or end in the middle of a word ("ell your data" inside "sell your data"). */
function onWordBoundaries(text: string, span: Interval): boolean {
  const before = text[span.start - 1];
  const first = text[span.start];
  const last = text[span.end - 1];
  const after = text[span.end];
  if (before !== undefined && first !== undefined && WORD.test(before) && WORD.test(first)) return false;
  if (after !== undefined && last !== undefined && WORD.test(after) && WORD.test(last)) return false;
  return true;
}

/** All raw occurrences of the full normalized needle that lie inside the raw scope, on word boundaries. */
export function findOccurrences(document: PreparedDocument, needle: string, scope: Interval): Interval[] {
  const normalizedNeedle = normalize(needle);
  if (!normalizedNeedle) return [];
  const hits: Interval[] = [];
  const haystack = document.map.normalized;
  let from = 0;
  while (from <= haystack.length - normalizedNeedle.length) {
    const at = haystack.indexOf(normalizedNeedle, from);
    if (at < 0) break;
    const raw = rawInterval(document.map, at, at + normalizedNeedle.length);
    if (raw && raw.start >= scope.start && raw.end <= scope.end && onWordBoundaries(document.text, raw)) {
      // Invariant: re-normalizing the raw slice reproduces the ENTIRE needle.
      if (normalize(document.text.slice(raw.start, raw.end)) === normalizedNeedle) hits.push(raw);
    }
    from = at + 1;
  }
  return hits;
}

function substantive(document: PreparedDocument, quote: string, span: Interval): boolean {
  return countWords(quote) >= LIMITS.substantiveWords || isCompleteSentence(document, span);
}

function classifyOccurrences(occurrences: { span: Interval; matched: Interval }[], expanded: boolean): LocateOutcome {
  if (occurrences.length === 0) return fail('not_found', 'The full quote is not in the captured text.');
  if (occurrences.length > LIMITS.ambiguousMax) {
    return fail('too_ambiguous', `The quote occurs ${occurrences.length} times (more than ${LIMITS.ambiguousMax}).`);
  }
  return { ok: true, value: { occurrences, expanded, ambiguous: occurrences.length > 1 } };
}

/**
 * Expand a short, non-substantive fragment to its containing sentence. Only allowed when the fragment
 * is unique in scope, is a meaningful non-generic phrase, and the sentence is bounded.
 */
function expandFragment(document: PreparedDocument, quote: string, hits: Interval[], scope: Interval): LocateOutcome {
  if (hits.length === 0) return fail('not_found', 'The full quote is not in the captured text.');
  if (hits.length > 1) {
    return fail('insufficient_context', 'A short fragment occurs more than once; supply the full clause.');
  }
  if (contentWordCount(quote) < 2) {
    return fail('insufficient_context', 'The fragment is too generic to identify a practice.');
  }
  const hit = hits[0] as Interval;
  const sentence = containingSentence(document.sentences, hit.start, hit.end);
  if (!sentence) return fail('insufficient_context', 'The fragment crosses a sentence boundary.');
  // Expansion stays inside the searched scope (named section and/or trusted processed interval).
  if (sentence.start < scope.start || sentence.end > scope.end) {
    return fail('insufficient_context', 'The containing sentence extends beyond the searched interval.');
  }
  if (sentence.end - sentence.start > LIMITS.maxEvidence) {
    return fail('over_max_length', 'The containing sentence is longer than the evidence limit.');
  }
  return {
    ok: true,
    value: { occurrences: [{ span: sentence, matched: hit }], expanded: true, ambiguous: false },
  };
}

/** Path 1: integer, in-range offsets whose exact slice equals the quote. */
export function locateByOffsets(
  document: PreparedDocument,
  quote: string,
  start: unknown,
  end: unknown,
  sectionId: string | undefined,
): LocateOutcome {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return fail('bad_offsets', 'Offsets must be integers.');
  const from = start as number;
  const to = end as number;
  if (from < 0 || to > document.text.length || from >= to) return fail('bad_offsets', 'Offsets are out of range.');
  if (document.text.slice(from, to) !== quote) return fail('bad_offsets', 'The text at those offsets differs from the quote.');
  const scope = scopeFor(document, sectionId);
  if (!scope) return fail('invalid_section', 'Unknown section ID.');
  if (from < scope.start || to > scope.end) return fail('bad_offsets', 'Offsets fall outside the named section.');
  const span = { start: from, end: to };
  if (!substantive(document, quote, span)) {
    return fail('insufficient_context', 'An offset quote must be at least four words or a complete sentence.');
  }
  // Exact offsets identify exactly one location. Identical text elsewhere is a separate candidate with its
  // own offsets, so the offsets path is never ambiguous and never merged with other occurrences.
  return { ok: true, value: { occurrences: [{ span, matched: span }], expanded: false, ambiguous: false } };
}

/**
 * Path 2: full-quote mapped search, section-scoped when a known section is supplied, and limited to a
 * trusted processed interval when the adapter supplies one.
 */
export function locateByQuote(
  document: PreparedDocument,
  quote: string,
  sectionId: string | undefined,
  within?: Interval,
): LocateOutcome {
  const section = scopeFor(document, sectionId);
  if (!section) return fail('invalid_section', 'Unknown section ID.');
  const scope = within
    ? { start: Math.max(section.start, within.start), end: Math.min(section.end, within.end) }
    : section;
  if (scope.start >= scope.end) return fail('not_found', 'The section is outside the processed interval.');
  const hits = findOccurrences(document, quote, scope);
  if (hits.length === 0) return fail('not_found', 'The full quote is not in the captured text.');
  const first = hits[0] as Interval;
  if (!substantive(document, quote, first)) return expandFragment(document, quote, hits, scope);
  return classifyOccurrences(
    hits.map((span) => ({ span, matched: span })),
    false,
  );
}
