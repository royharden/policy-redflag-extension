import { CATEGORY_IDS, type CategoryId } from './types';

export interface SpanLabel {
  docId: string;
  categoryId: CategoryId;
  start: number;
  end: number;
}

export interface CategoryScore {
  categoryId: CategoryId;
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
}

export interface ScoreCard {
  perCategory: CategoryScore[];
  micro: {
    tp: number;
    fp: number;
    fn: number;
    precision: number | null;
    recall: number | null;
  };
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

function overlaps(left: SpanLabel, right: SpanLabel): boolean {
  return left.docId === right.docId && left.start < right.end && right.start < left.end;
}

/** One gold span matches at most one prediction. A match is any overlap in the same document and category. */
export function scoreSpans(gold: readonly SpanLabel[], predicted: readonly SpanLabel[]): ScoreCard {
  const perCategory = CATEGORY_IDS.map((categoryId) => {
    const goldItems = gold.filter((item) => item.categoryId === categoryId);
    const predictions = predicted.filter((item) => item.categoryId === categoryId);
    const used = new Set<number>();
    let tp = 0;
    for (const item of goldItems) {
      const matchIndex = predictions.findIndex((candidate, index) => !used.has(index) && overlaps(item, candidate));
      if (matchIndex >= 0) {
        used.add(matchIndex);
        tp += 1;
      }
    }
    const fp = predictions.length - used.size;
    const fn = goldItems.length - tp;
    return {
      categoryId,
      tp,
      fp,
      fn,
      precision: ratio(tp, tp + fp),
      recall: ratio(tp, tp + fn),
    };
  });
  const totals = perCategory.reduce(
    (sum, row) => ({ tp: sum.tp + row.tp, fp: sum.fp + row.fp, fn: sum.fn + row.fn }),
    { tp: 0, fp: 0, fn: 0 },
  );
  return {
    perCategory,
    micro: {
      ...totals,
      precision: ratio(totals.tp, totals.tp + totals.fp),
      recall: ratio(totals.tp, totals.tp + totals.fn),
    },
  };
}

export function formatRate(value: number | null): string {
  if (value === null) return 'n/a';
  return `${Math.round(value * 1000) / 10}%`;
}
