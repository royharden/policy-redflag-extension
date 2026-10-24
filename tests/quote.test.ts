import { describe, expect, it } from 'vitest';
import { locateByOffsets, locateByQuote, prepareDocument } from '../src/core/quote';
import { normalize, normalizeWithMap, rawInterval, segmentSentences } from '../src/core/text';

function doc(text: string, sections: { id: string; label: string; start: number; end: number }[] = []) {
  return prepareDocument({ text, sections });
}

describe('normalization', () => {
  it('collapses whitespace runs and folds only the allowed spaces and quotes', () => {
    expect(normalize('  a \t\n b c d e f  ')).toBe('a b c d e f');
    expect(normalize('“quoted” ‘single’')).toBe('"quoted" \'single\'');
  });

  it('does not fold case, dashes, zero-width characters or compatibility forms', () => {
    expect(normalize('Binding')).not.toBe(normalize('binding'));
    expect(normalize('auto–renew')).toBe('auto–renew');
    expect(normalize('a​b')).toBe('a​b');
    expect(normalize('a﻿b')).toBe('a﻿b');
    expect(normalize('ﬁle')).toBe('ﬁle');
  });

  it('round-trips raw intervals, including astral characters', () => {
    const raw = 'x 😀  you  agree';
    const map = normalizeWithMap(raw);
    const at = map.normalized.indexOf('you agree');
    const span = rawInterval(map, at, at + 'you agree'.length);
    expect(span).not.toBeNull();
    expect(raw.slice(span!.start, span!.end)).toBe('you  agree');
    expect(normalize(raw.slice(span!.start, span!.end))).toBe('you agree');
    const emoji = map.normalized.indexOf('😀');
    expect(rawInterval(map, emoji, emoji + 2)).toEqual({ start: 2, end: 4 });
  });
});

describe('segmentation', () => {
  it('protects legal abbreviations and list markers', () => {
    const text = 'ACME Inc. may share data, e.g. usage data, in the U.S. only. We stop.\n1. Billing applies.';
    const sentences = segmentSentences(text).map((span) => text.slice(span.start, span.end));
    expect(sentences).toEqual([
      'ACME Inc. may share data, e.g. usage data, in the U.S. only.',
      'We stop.',
      '1. Billing applies.',
    ]);
  });
});

describe('offsets path', () => {
  const text = 'Intro line.\nYou agree to binding arbitration for any dispute.';
  const quote = 'You agree to binding arbitration for any dispute.';
  const start = text.indexOf(quote);

  it('accepts an exact slice', () => {
    const outcome = locateByOffsets(doc(text), quote, start, start + quote.length, undefined);
    expect(outcome.ok).toBe(true);
  });

  it('locates exactly one occurrence for offsets, even when the same sentence repeats', () => {
    const line = 'Your plan renews automatically each year.';
    const repeated = Array(7).fill(line).join('\n');
    const second = line.length + 1;
    const outcome = locateByOffsets(doc(repeated), line, second, second + line.length, undefined);
    expect(outcome.ok && outcome.value.occurrences.map((item) => item.span)).toEqual([{ start: second, end: second + line.length }]);
    expect(outcome.ok && outcome.value.ambiguous).toBe(false);
  });

  it('rejects bad offsets and never re-searches them', () => {
    expect(locateByOffsets(doc(text), quote, start + 1, start + quote.length + 1, undefined)).toMatchObject({ ok: false, code: 'bad_offsets' });
    expect(locateByOffsets(doc(text), quote, 1.5, 4, undefined)).toMatchObject({ ok: false, code: 'bad_offsets' });
    expect(locateByOffsets(doc(text), quote, -1, 4, undefined)).toMatchObject({ ok: false, code: 'bad_offsets' });
  });

  it('rejects an unknown section and offsets outside a known section', () => {
    const sections = [{ id: 's1', label: 'Intro', start: 0, end: 11 }];
    expect(locateByOffsets(doc(text, sections), quote, start, start + quote.length, 'nope')).toMatchObject({ code: 'invalid_section' });
    expect(locateByOffsets(doc(text, sections), quote, start, start + quote.length, 's1')).toMatchObject({ code: 'bad_offsets' });
  });
});

describe('quote-only path', () => {
  const text = 'Plans renew.\nYour plan automatically renews each month until you cancel.\nWe may share data.';

  it('accepts a full quote through whitespace and curly-quote folding', () => {
    const outcome = locateByQuote(doc(text), 'Your plan  automatically renews each month until you cancel.', undefined);
    expect(outcome.ok).toBe(true);
  });

  it('rejects a fabricated quote and a real prefix plus invented suffix', () => {
    expect(locateByQuote(doc(text), 'We sell your browsing history to brokers.', undefined)).toMatchObject({ code: 'not_found' });
    expect(locateByQuote(doc(text), 'Your plan automatically renews each month until you cancel and we keep your deposit.', undefined)).toMatchObject({
      code: 'not_found',
    });
  });

  it('expands a unique meaningful fragment to its sentence and marks it', () => {
    const outcome = locateByQuote(doc(text), 'automatically renews', undefined);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const [first] = outcome.value.occurrences;
    expect(outcome.value.expanded).toBe(true);
    expect(text.slice(first!.span.start, first!.span.end)).toBe('Your plan automatically renews each month until you cancel.');
    expect(text.slice(first!.matched.start, first!.matched.end)).toBe('automatically renews');
  });

  it('rejects generic and repeated short fragments', () => {
    expect(locateByQuote(doc(text), 'We may', undefined)).toMatchObject({ code: 'insufficient_context' });
    const repeated = 'Fees apply monthly.\nFees apply yearly.';
    expect(locateByQuote(doc(repeated), 'Fees apply', undefined)).toMatchObject({ code: 'insufficient_context' });
  });

  it('accepts a short complete sentence', () => {
    const outcome = locateByQuote(doc('Intro.\nWe sell your data.\nEnd.'), 'We sell your data.', undefined);
    expect(outcome).toMatchObject({ ok: true });
  });

  it('marks 2-5 occurrences ambiguous and rejects more than five', () => {
    const line = 'You agree to binding arbitration.';
    const two = locateByQuote(doc(`${line}\n${line}`), line, undefined);
    expect(two.ok && two.value.ambiguous && two.value.occurrences.length).toBe(2);
    const six = locateByQuote(doc(Array(6).fill(line).join('\n')), line, undefined);
    expect(six).toMatchObject({ code: 'too_ambiguous' });
  });

  it('searches only inside a known section', () => {
    const sections = [{ id: 'a', label: 'A', start: 0, end: 12 }];
    expect(locateByQuote(doc(text, sections), 'Your plan automatically renews each month until you cancel.', 'a')).toMatchObject({ code: 'not_found' });
  });
});
