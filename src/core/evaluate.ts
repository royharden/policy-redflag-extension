import { CATEGORY_IDS, type CategoryId, type Interval } from './types';

/**
 * Shared metric primitives (PLAN.md section 7). Used by scripts/evaluate.ts and smoke tests only.
 * Nothing here produces a number for display; measured results come only from scripts/evaluate.ts.
 */

export const METRICS_VERSION = 'metrics/1';
/** Frozen before any execution. */
export const RELAXED_IOU_THRESHOLD = 0.5;

export interface SpanLabel extends Interval {
  itemId: string;
  categoryId: CategoryId;
  /**
   * Predictions only: other recorded occurrences of an ambiguous quote-only prediction. The prediction is
   * still ONE unit (one TP at most); it may match gold through any of its occurrences.
   */
  alternatives?: readonly Interval[];
}

/**
 * detection: a prediction overlapping a labelled clause/sentence unit detects it.
 * exact: original offsets equal.
 * relaxed: interval IoU >= RELAXED_IOU_THRESHOLD (a whole-document span cannot reach it by containment).
 */
export type MatchMode = 'detection' | 'exact' | 'relaxed';

export interface CategoryScore {
  categoryId: CategoryId;
  tp: number;
  fp: number;
  fn: number;
  support: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface ScoreCard {
  mode: MatchMode;
  perCategory: CategoryScore[];
  micro: Omit<CategoryScore, 'categoryId'>;
  /** Mean over categories whose value is defined; null when none are. */
  macro: { precision: number | null; recall: number | null; f1: number | null; definedCategories: number };
}

export function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function f1(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null) return null;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

export function iou(left: Interval, right: Interval): number {
  const intersection = Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
  const union = Math.max(left.end, right.end) - Math.min(left.start, right.start);
  return union === 0 ? 0 : intersection / union;
}

export function spansMatch(gold: Interval, predicted: Interval, mode: MatchMode): boolean {
  if (mode === 'exact') return gold.start === predicted.start && gold.end === predicted.end;
  if (mode === 'relaxed') return iou(gold, predicted) >= RELAXED_IOU_THRESHOLD;
  return gold.start < predicted.end && predicted.start < gold.end;
}

function byPosition(left: Interval, right: Interval): number {
  return left.start - right.start || left.end - right.end;
}

/**
 * Maximum-cardinality one-to-one matching (Kuhn's augmenting paths) with deterministic tie breaks:
 * gold and predictions are processed in (start, end) order and candidate edges are tried in that order.
 * Returns the number of matched pairs.
 */
export function maximumMatching(
  gold: readonly Interval[],
  predicted: readonly (Interval & { alternatives?: readonly Interval[] })[],
  mode: MatchMode,
): number {
  const goldSorted = [...gold].sort(byPosition);
  const predSorted = [...predicted].sort(byPosition);
  const edges = goldSorted.map((item) =>
    predSorted
      .map((candidate, index) =>
        spansMatch(item, candidate, mode) || (candidate.alternatives ?? []).some((other) => spansMatch(item, other, mode)) ? index : -1,
      )
      .filter((index) => index >= 0),
  );
  const owner = new Array<number>(predSorted.length).fill(-1);
  const augment = (goldIndex: number, visited: boolean[]): boolean => {
    for (const predIndex of edges[goldIndex] ?? []) {
      if (visited[predIndex]) continue;
      visited[predIndex] = true;
      const current = owner[predIndex] ?? -1;
      if (current < 0 || augment(current, visited)) {
        owner[predIndex] = goldIndex;
        return true;
      }
    }
    return false;
  };
  let matched = 0;
  for (let goldIndex = 0; goldIndex < goldSorted.length; goldIndex += 1) {
    if (augment(goldIndex, new Array<boolean>(predSorted.length).fill(false))) matched += 1;
  }
  return matched;
}

function groupKey(label: SpanLabel): string {
  return `${label.itemId}\u0000${label.categoryId}`;
}

/** Score predictions against gold within each item/category group. */
export function scoreSpans(
  gold: readonly SpanLabel[],
  predicted: readonly SpanLabel[],
  mode: MatchMode = 'detection',
  categories: readonly CategoryId[] = CATEGORY_IDS,
): ScoreCard {
  const perCategory = categories.map((categoryId) => {
    const goldGroups = new Map<string, SpanLabel[]>();
    const predGroups = new Map<string, SpanLabel[]>();
    for (const item of gold) if (item.categoryId === categoryId) goldGroups.set(groupKey(item), [...(goldGroups.get(groupKey(item)) ?? []), item]);
    for (const item of predicted) if (item.categoryId === categoryId) predGroups.set(groupKey(item), [...(predGroups.get(groupKey(item)) ?? []), item]);
    let tp = 0;
    let goldCount = 0;
    let predCount = 0;
    for (const items of goldGroups.values()) goldCount += items.length;
    for (const items of predGroups.values()) predCount += items.length;
    for (const [key, items] of goldGroups) tp += maximumMatching(items, predGroups.get(key) ?? [], mode);
    const fp = predCount - tp;
    const fn = goldCount - tp;
    const precision = ratio(tp, tp + fp);
    const recall = ratio(tp, tp + fn);
    return { categoryId, tp, fp, fn, support: goldCount, precision, recall, f1: f1(precision, recall) };
  });
  const totals = perCategory.reduce(
    (sum, row) => ({ tp: sum.tp + row.tp, fp: sum.fp + row.fp, fn: sum.fn + row.fn, support: sum.support + row.support }),
    { tp: 0, fp: 0, fn: 0, support: 0 },
  );
  const microPrecision = ratio(totals.tp, totals.tp + totals.fp);
  const microRecall = ratio(totals.tp, totals.tp + totals.fn);
  const mean = (values: (number | null)[]) => {
    const defined = values.filter((value): value is number => value !== null);
    return defined.length ? defined.reduce((sum, value) => sum + value, 0) / defined.length : null;
  };
  return {
    mode,
    perCategory,
    micro: { ...totals, precision: microPrecision, recall: microRecall, f1: f1(microPrecision, microRecall) },
    macro: {
      precision: mean(perCategory.map((row) => row.precision)),
      recall: mean(perCategory.map((row) => row.recall)),
      f1: mean(perCategory.map((row) => row.f1)),
      definedCategories: perCategory.filter((row) => row.f1 !== null).length,
    },
  };
}

/** Undefined denominators render as an explicit marker, never as 0%. */
export function formatRate(value: number | null): string {
  if (value === null) return 'undefined';
  return `${Math.round(value * 1000) / 10}%`;
}
