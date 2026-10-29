import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core/analyze';
import { scanStrict } from '../../src/core/baseline';
import { ACME_TERMS_TEXT, RECORDED_DRAFT } from '../../src/core/fixtures';
import { parseFlagsResponse } from '../../src/core/model';
import { CATEGORY_IDS } from '../../src/core/types';

// what_bug_this_catches: overlap folding in the actual rules+recorded demo must not
// hide the plan's visible expansion and repeated-quote navigation demonstrations.
describe('RV combined recorded demonstration', () => {
  it('retains visible expansion and ambiguous occurrence metadata alongside strict rules', () => {
    const parsed = parseFlagsResponse(RECORDED_DRAFT, { engine: 'recorded', engineVersion: 'rv/1', acceptOffsets: true });
    if (!parsed.ok) throw new Error(parsed.detail);
    const { result } = analyze({
      snapshot: { scanId: 'rv-combined', revision: 0, text: ACME_TERMS_TEXT, sections: [] },
      enabledCategoryIds: CATEGORY_IDS,
      candidates: [...scanStrict(ACME_TERMS_TEXT), ...parsed.candidates],
    });
    expect(result.findings.some((finding) => finding.expanded)).toBe(true);
    expect(result.findings.some((finding) => finding.ambiguous && finding.occurrences.length === 2)).toBe(true);
    expect(result.rejections.filter((rejection) => rejection.code === 'not_found')).toHaveLength(2);
    for (const finding of result.findings) {
      for (const occurrence of finding.occurrences) {
        expect(ACME_TERMS_TEXT.slice(occurrence.start, occurrence.end)).toBe(finding.quote);
      }
    }
  });
});
