import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core/analyze';
import { scanStrict } from '../../src/core/baseline';
import { maximumMatching, scoreSpans, spansMatch } from '../../src/core/evaluate';
import { parseFlagsResponse } from '../../src/core/model';
import { coerceSettings, matchingRulebookId } from '../../src/core/rulebooks';
import { normalize, normalizeWithMap, rawInterval } from '../../src/core/text';
import { CATEGORY_IDS, LIMITS, type Candidate } from '../../src/core/types';

// RV-owned acceptance cases derive their expected behavior from PLAN.md, not implementation output.
const sentence = 'Your membership automatically renews every year.';
const base = { categoryId: 'auto_renewal', reasonCode: 'auto_renews', engine: 'recorded', engineVersion: 'rv/1' } as const;
function check(text: string, candidates: Candidate[]) {
  return analyze({ snapshot: { scanId: 'rv', revision: 0, text, sections: [] }, enabledCategoryIds: CATEGORY_IDS, candidates }).result;
}

describe('RV evidence contracts', () => {
  it('maps a quote after an astral symbol back to the entire original whitespace interval', () => {
    const text = '\u{1F680} Intro. We\u00a0 \t sell your data.';
    const map = normalizeWithMap(text);
    const needle = 'We sell your data.';
    const start = map.normalized.indexOf(needle);
    const span = rawInterval(map, start, start + needle.length)!;
    expect(span.start).toBe(text.indexOf('We'));
    expect(text.slice(span.start, span.end)).toBe('We\u00a0 \t sell your data.');
    expect(normalize(text.slice(span.start, span.end))).toBe(needle);
  });

  it.each([
    ['We sell your data.', 'we sell your data.'],
    ['We sell your data\u2014today.', 'We sell your data-today.'],
    ['We sell your \ufb01les.', 'We sell your files.'],
    ['We sell your da\u200bta.', 'We sell your data.'],
  ])('does not fold unsupported distinctions: %s', (raw, altered) => {
    expect(check(raw, [{ ...base, quote: altered }]).rejections[0]?.code).toBe('not_found');
  });

  it('rejects a genuine prefix followed by invented text in full', () => {
    expect(check(sentence, [{ ...base, quote: `${sentence} You owe a million dollars.` }]).rejections[0]?.code).toBe('not_found');
  });

  it('never re-searches a recorded quote with incorrect explicit offsets', () => {
    expect(check(sentence, [{ ...base, quote: sentence, start: 1, end: sentence.length }]).rejections[0]?.code).toBe('bad_offsets');
  });

  it.each([1, 2, 5, 6])('keeps quote-only occurrence multiplicity explicit (%i)', (count) => {
    const result = check(Array(count).fill(sentence).join('\n'), [{ ...base, quote: sentence }]);
    if (count > 5) {
      expect(result.rejections[0]?.code).toBe('too_ambiguous');
      expect(result.findings).toHaveLength(0);
    } else {
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.occurrences).toHaveLength(count);
      expect(result.findings[0]?.ambiguous).toBe(count > 1);
    }
  });

  it('separates presence from semantic correctness', () => {
    const result = check(sentence, [{ ...base, categoryId: 'arbitration', reasonCode: 'binding_arbitration', quote: sentence }]);
    expect(result.findings).toHaveLength(1);
    const scored = scoreSpans(
      [{ itemId: 'rv', categoryId: 'auto_renewal', start: 0, end: sentence.length }],
      [{ itemId: 'rv', categoryId: 'arbitration', start: 0, end: sentence.length }],
    );
    expect(scored.micro.tp).toBe(0);
    expect(scored.micro.fp).toBe(1);
    expect(scored.micro.fn).toBe(1);
  });
});

describe('RV strict parser and settings', () => {
  const options = { engine: 'on-device', engineVersion: 'rv/1' } as const;
  it.each(['null', '[]', 'true', '{"flags":[]} trailing', 'prefix {"flags":[]}', '{"flags":[]} {"flags":[]}', '<think>ok</think>{"flags":[]}'])('rejects an untrusted envelope: %s', (raw) => {
    expect(parseFlagsResponse(raw, options).ok).toBe(false);
  });
  it('accepts empty flags in one outer JSON fence', () => {
    expect(parseFlagsResponse(' \n```json\n{"flags":[]}\n```\n', options)).toEqual({ ok: true, candidates: [], itemErrors: [] });
  });
  it('fails a candidate-array cap rather than accepting a prefix', () => {
    const parsed = parseFlagsResponse(JSON.stringify({ flags: Array(LIMITS.maxModelCandidates + 1).fill({ ...base, quote: sentence }) }), options);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe('too_many_candidates');
  });
  it('treats preset equality as a set and drops undeclared stored fields', () => {
    expect(matchingRulebookId(['broad_content_license', 'auto_renewal', 'auto_renewal'])).toBe('billing-and-content');
    const settings = coerceSettings({ enabledCategoryIds: [], localModelEnabled: 'yes', policyText: 'synthetic private text', endpoint: 'https://invalid.example' });
    expect(settings.enabledCategoryIds).toEqual([]);
    expect(settings.localModelEnabled).toBe(false);
    expect(Object.keys(settings).sort()).toEqual(['enabledCategoryIds', 'localModelEnabled', 'presetId', 'settingsVersion']);
    expect(check(sentence, scanStrict(sentence)).findings.length).toBeGreaterThan(0);
    const empty = analyze({ snapshot: { scanId: 'rv', revision: 0, text: sentence, sections: [] }, enabledCategoryIds: [], candidates: scanStrict(sentence) }).result;
    expect(empty.state).toBe('no_categories');
    expect(empty.findings).toEqual([]);
  });
});

describe('RV metric counterexamples', () => {
  it('finds an augmenting-path match rather than losing recall to a greedy choice', () => {
    expect(maximumMatching([{ start: 0, end: 5 }, { start: 5, end: 10 }], [{ start: 0, end: 10 }, { start: 1, end: 2 }], 'detection')).toBe(2);
  });
  it('does not turn containment into precise localization', () => {
    expect(spansMatch({ start: 10, end: 20 }, { start: 0, end: 100 }, 'detection')).toBe(true);
    expect(spansMatch({ start: 10, end: 20 }, { start: 0, end: 100 }, 'relaxed')).toBe(false);
    expect(spansMatch({ start: 10, end: 20 }, { start: 10, end: 30 }, 'relaxed')).toBe(true);
    expect(spansMatch({ start: 10, end: 20 }, { start: 10, end: 30 }, 'exact')).toBe(false);
  });
  it('counts one ambiguous prediction at most once and preserves undefined empty rates', () => {
    expect(maximumMatching([{ start: 0, end: 4 }, { start: 10, end: 14 }], [{ start: 0, end: 4, alternatives: [{ start: 10, end: 14 }] }], 'exact')).toBe(1);
    const score = scoreSpans([], []);
    expect(score.micro.precision).toBeNull();
    expect(score.micro.recall).toBeNull();
    expect(score.micro.f1).toBeNull();
  });
});
