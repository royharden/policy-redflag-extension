import { describe, expect, it } from 'vitest';
import { iou, maximumMatching, scoreSpans } from '../src/core/evaluate';
import { compareBaselines } from '../src/core/fixtures';

describe('matching', () => {
  it('uses maximum-cardinality one-to-one matching, not order-dependent greedy overlap', () => {
    // Greedy would give gold A the wide prediction and leave gold B unmatched.
    const gold = [
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ];
    const predicted = [
      { start: 0, end: 30 },
      { start: 2, end: 8 },
    ];
    expect(maximumMatching(gold, predicted, 'detection')).toBe(2);
  });

  it('separates exact and IoU>=0.5 localization; whole-document spans get no localization credit', () => {
    expect(maximumMatching([{ start: 10, end: 20 }], [{ start: 10, end: 20 }], 'exact')).toBe(1);
    expect(maximumMatching([{ start: 10, end: 20 }], [{ start: 11, end: 20 }], 'exact')).toBe(0);
    expect(iou({ start: 10, end: 20 }, { start: 12, end: 20 })).toBeCloseTo(0.8);
    expect(maximumMatching([{ start: 10, end: 20 }], [{ start: 0, end: 1000 }], 'relaxed')).toBe(0);
    expect(maximumMatching([{ start: 10, end: 20 }], [{ start: 0, end: 1000 }], 'detection')).toBe(1);
  });

  it('scores repeated identical rule sentences as separate units', () => {
    const line = 'Your plan renews automatically each year.';
    const text = `${line}\n${line}`;
    const fixture = { id: 'rep', title: 'r', text, provenance: 'test', labels: [] as never[] };
    const report = compareBaselines([fixture]);
    // Two gold units would be required to check recall here; the smoke check is that both are predicted.
    expect(report.strict.perCategory.find((row) => row.categoryId === 'auto_renewal')?.fp).toBe(2);
  });

  it('lets an ambiguous prediction match gold through any occurrence, but only once', () => {
    const gold = [{ start: 50, end: 60 }];
    expect(maximumMatching(gold, [{ start: 0, end: 10, alternatives: [{ start: 50, end: 60 }] }], 'exact')).toBe(1);
    expect(maximumMatching([{ start: 0, end: 10 }, { start: 50, end: 60 }], [{ start: 0, end: 10, alternatives: [{ start: 50, end: 60 }] }], 'exact')).toBe(1);
  });

  it('marks undefined denominators instead of reporting zero', () => {
    const card = scoreSpans([], []);
    expect(card.perCategory.every((row) => row.precision === null && row.recall === null)).toBe(true);
    expect(card.macro.definedCategories).toBe(0);
  });

  it('counts a true positive, a false positive and a false negative per item and category', () => {
    const card = scoreSpans(
      [
        { itemId: 'one', categoryId: 'arbitration', start: 0, end: 10 },
        { itemId: 'one', categoryId: 'arbitration', start: 40, end: 50 },
      ],
      [
        { itemId: 'one', categoryId: 'arbitration', start: 5, end: 15 },
        { itemId: 'one', categoryId: 'arbitration', start: 20, end: 30 },
        { itemId: 'two', categoryId: 'arbitration', start: 40, end: 50 },
      ],
    );
    const row = card.perCategory.find((item) => item.categoryId === 'arbitration');
    expect(row).toMatchObject({ tp: 1, fp: 2, fn: 1, support: 2 });
  });
});

describe('Northwind smoke data (not accuracy)', () => {
  it('resolves every planted quote', () => {
    expect(compareBaselines().missingQuotes).toEqual([]);
  });
});
