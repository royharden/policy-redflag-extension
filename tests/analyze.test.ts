import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analyze';
import { scanStrict } from '../src/core/baseline';
import { ACME_TERMS_TEXT, RECORDED_DRAFT, SEMANTIC_AUDIT_DRAFT } from '../src/core/fixtures';
import { itemErrorRejections, parseFlagsResponse } from '../src/core/model';
import { CATEGORY_IDS, LIMITS, type Candidate } from '../src/core/types';

const snapshot = { scanId: 'scan-1', revision: 0, text: ACME_TERMS_TEXT, sections: [] };

function recorded(raw: string) {
  const parsed = parseFlagsResponse(raw, { engine: 'recorded', engineVersion: 'recorded/1', acceptOffsets: true });
  if (!parsed.ok) throw new Error(parsed.detail);
  return analyze({
    snapshot,
    enabledCategoryIds: CATEGORY_IDS,
    candidates: parsed.candidates,
    extraRejections: itemErrorRejections(parsed.itemErrors, 'recorded'),
  }).result;
}

describe('analyze: recorded grounding demo', () => {
  const result = recorded(RECORDED_DRAFT);

  it('accepts a full real quote, rejects a fabrication and a prefix-plus-fiction in full', () => {
    expect(result.findings.some((item) => item.reasonCodes.includes('auto_renews'))).toBe(true);
    const codes = result.rejections.map((item) => item.code).sort();
    expect(codes).toEqual(['not_found', 'not_found']);
  });

  it('expands a unique meaningful fragment and reports it', () => {
    const expanded = result.findings.find((item) => item.expanded);
    expect(expanded?.quote).toBe('We may use the content you upload under this license to train and improve our machine learning models.');
    expect(result.counts.expanded).toBe(1);
  });

  it('keeps repeated substantive quotes as one ambiguous finding with explicit occurrences', () => {
    const ambiguous = result.findings.find((item) => item.ambiguous);
    expect(ambiguous?.occurrences).toHaveLength(2);
  });

  it('preserves expansion and ambiguity when recorded evidence is combined with exact rules', () => {
    // what_bug_this_catches: the actual lab combines both engines; rule-only display
    // representatives previously hid model expansion and occurrence choices.
    const parsed = parseFlagsResponse(RECORDED_DRAFT, { engine: 'recorded', engineVersion: 'recorded/1', acceptOffsets: true });
    if (!parsed.ok) throw new Error(parsed.detail);
    const { result: combined, predictions } = analyze({ snapshot, enabledCategoryIds: CATEGORY_IDS, candidates: [...scanStrict(snapshot.text), ...parsed.candidates] });
    const expanded = combined.findings.find((item) => item.expanded);
    expect(expanded?.occurrences[0]?.matched.start).toBeGreaterThan(expanded!.occurrences[0]!.start);
    expect(expanded?.quote).toContain('machine learning models');
    expect(combined.findings.find((item) => item.ambiguous)?.occurrences).toHaveLength(2);
    expect(combined.rejections.map((item) => item.code)).toEqual(['not_found', 'not_found']);
    expect(predictions.length).toBeGreaterThan(combined.findings.length);
  });

  it('lets a wrong-category real quote pass grounding (semantic error, not a quote rejection)', () => {
    const audit = recorded(SEMANTIC_AUDIT_DRAFT);
    expect(audit.findings).toHaveLength(1);
    expect(audit.findings[0]?.categoryId).toBe('arbitration');
    expect(audit.rejections).toEqual([]);
  });
});

describe('analyze: validation and combination', () => {
  const base: Omit<Candidate, 'quote' | 'categoryId'> = { engine: 'recorded', engineVersion: 'recorded/1' };

  it('rejects schema, category, reason, disabled, empty, oversize and stale candidates', () => {
    const quote = 'Gift plans will not automatically renew.';
    const { result } = analyze({
      snapshot,
      enabledCategoryIds: ['auto_renewal'],
      candidates: [
        { ...base, categoryId: 7, quote },
        { ...base, categoryId: 'nope', quote },
        { ...base, categoryId: 'auto_renewal', reasonCode: 'sale', quote },
        { ...base, categoryId: 'arbitration', quote },
        { ...base, categoryId: 'auto_renewal', quote: '   ' },
        { ...base, categoryId: 'auto_renewal', quote: 'x'.repeat(LIMITS.maxEvidence + 1) },
        { ...base, categoryId: 'auto_renewal', quote, explanation: 'y'.repeat(LIMITS.maxExplanation + 1) },
        { ...base, categoryId: 'auto_renewal', quote, snapshotRef: { scanId: 'old', revision: 0 } },
      ],
    });
    expect(result.rejections.map((item) => item.code)).toEqual([
      'bad_schema',
      'unknown_category',
      'unknown_reason',
      'category_disabled',
      'empty',
      'over_max_length',
      'over_max_length',
      'stale_snapshot',
    ]);
    expect(result.findings).toEqual([]);
  });

  it('never trusts model offsets', () => {
    const quote = 'Gift plans will not automatically renew.';
    const { result } = analyze({
      snapshot,
      enabledCategoryIds: CATEGORY_IDS,
      candidates: [{ categoryId: 'auto_renewal', quote, start: 0, end: 3, engine: 'on-device', engineVersion: 'x' }],
    });
    expect(result.findings[0]?.quote).toBe(quote);
  });

  it('returns no_categories with no findings and no score', () => {
    const { result } = analyze({ snapshot, enabledCategoryIds: [], candidates: scanStrict(ACME_TERMS_TEXT) });
    expect(result.state).toBe('no_categories');
    expect(result.findings).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/grade|score/i);
  });

  it('deduplicates exact same-category occurrences and merges provenance', () => {
    const rules = scanStrict(ACME_TERMS_TEXT, ['auto_renewal']);
    const copy = rules.map((item) => ({ ...item, engine: 'recorded' as const, engineVersion: 'recorded/1' }));
    const { result } = analyze({ snapshot, enabledCategoryIds: CATEGORY_IDS, candidates: [...rules, ...copy] });
    const single = analyze({ snapshot, enabledCategoryIds: CATEGORY_IDS, candidates: rules }).result;
    expect(result.findings).toHaveLength(single.findings.length);
    expect(result.findings[0]?.provenance.map((item) => item.engine)).toEqual(['rules', 'recorded']);
  });

  it('caps display at the limit but keeps every prediction for scoring', () => {
    const lines = Array.from({ length: LIMITS.maxDisplayedFindings + 5 }, (_, index) => `Plan ${index} automatically renews every month.`);
    const text = lines.join('\n');
    const output = analyze({
      snapshot: { scanId: 's', revision: 0, text, sections: [] },
      enabledCategoryIds: CATEGORY_IDS,
      candidates: scanStrict(text),
    });
    expect(output.result.findingLimitReached).toBe(true);
    expect(output.result.state).toBe('partial');
    expect(output.result.findings).toHaveLength(LIMITS.maxDisplayedFindings);
    expect(output.predictions.length).toBe(LIMITS.maxDisplayedFindings + 5);
    const uncapped = analyze({
      snapshot: { scanId: 's', revision: 0, text, sections: [] },
      enabledCategoryIds: CATEGORY_IDS,
      candidates: scanStrict(text),
      displayLimit: null,
    });
    expect(uncapped.result.findings).toHaveLength(LIMITS.maxDisplayedFindings + 5);
  });
});
