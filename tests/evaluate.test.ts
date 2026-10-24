import { describe, expect, it } from 'vitest';
import { compareBaselines } from '../src/core/fixtures';
import { scoreSpans } from '../src/core/evaluate';

describe('scoreSpans', () => {
  it('counts a true positive, a false positive, and a false negative', () => {
    const card = scoreSpans(
      [
        { docId: 'one', categoryId: 'arbitration', start: 0, end: 10 },
        { docId: 'one', categoryId: 'arbitration', start: 40, end: 50 },
      ],
      [
        { docId: 'one', categoryId: 'arbitration', start: 5, end: 15 },
        { docId: 'one', categoryId: 'arbitration', start: 20, end: 30 },
      ],
    );
    const row = card.perCategory.find((item) => item.categoryId === 'arbitration');
    expect(row).toMatchObject({ tp: 1, fp: 1, fn: 1, precision: 0.5, recall: 0.5 });
  });
});

describe('synthetic corpus', () => {
  it('resolves every gold quote and separates the strict and loose baselines', () => {
    const report = compareBaselines();
    expect(report.missingQuotes).toEqual([]);
    expect(report.strict.micro.recall).not.toBeNull();
    expect(report.strict.micro.precision).not.toBeNull();
    expect(report.loose.micro.precision).not.toBeNull();
    expect(report.strict.micro.recall ?? 1).toBeLessThan(1);
    expect(report.loose.micro.precision ?? 1).toBeLessThan(report.strict.micro.precision ?? 0);
  });
});
