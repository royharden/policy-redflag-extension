import { detectBaseline } from './baseline';
import { CATEGORY_BY_ID } from './categories';
import { gradeFlags } from './grade';
import { countExact, findQuote } from './quote';
import {
  isCategoryId,
  isSeverity,
  type AnalyzeResult,
  type Candidate,
  type CategoryId,
  type DroppedFlag,
  type KeptFlag,
  type Severity,
} from './types';

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

export interface AnalyzeInput {
  text: string;
  enabledCategoryIds: readonly CategoryId[];
  candidates: readonly Candidate[];
}

function overlaps(left: KeptFlag, right: KeptFlag): boolean {
  return left.start < right.end && right.start < left.end;
}

function prefer(current: KeptFlag, next: KeptFlag): KeptFlag {
  if (SEVERITY_RANK[next.severity] !== SEVERITY_RANK[current.severity]) {
    return SEVERITY_RANK[next.severity] > SEVERITY_RANK[current.severity] ? next : current;
  }
  const nextLength = next.end - next.start;
  const currentLength = current.end - current.start;
  return nextLength > currentLength ? next : current;
}

function locatedSlice(text: string, candidate: Candidate): { start: number; end: number; quote: string; matchCount: number } | null {
  const { start, end, quote } = candidate;
  if (typeof start === 'number' && typeof end === 'number') {
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < 0 || end > text.length || start >= end) return null;
    if (text.slice(start, end) !== quote) return null;
    return { start, end, quote, matchCount: countExact(text, quote) };
  }
  return findQuote(text, quote);
}

export function analyze(input: AnalyzeInput): AnalyzeResult {
  const enabled = new Set(input.enabledCategoryIds);
  const dropped: DroppedFlag[] = [];
  const kept: KeptFlag[] = [];

  for (const candidate of input.candidates) {
    const quote = candidate.quote ?? '';
    if (quote.trim().length === 0) {
      dropped.push({ categoryId: candidate.categoryId, quote, reason: 'empty-quote', source: candidate.source });
      continue;
    }
    if (!isCategoryId(candidate.categoryId)) {
      dropped.push({ categoryId: candidate.categoryId, quote, reason: 'unknown-category', source: candidate.source });
      continue;
    }
    if (!enabled.has(candidate.categoryId)) {
      dropped.push({
        categoryId: candidate.categoryId,
        quote,
        reason: 'category-disabled',
        source: candidate.source,
      });
      continue;
    }
    const located = locatedSlice(input.text, candidate);
    if (!located) {
      dropped.push({
        categoryId: candidate.categoryId,
        quote,
        reason: 'unmatched-quote',
        source: candidate.source,
      });
      continue;
    }
    const category = CATEGORY_BY_ID[candidate.categoryId];
    const flag: KeptFlag = {
      categoryId: candidate.categoryId,
      quote: located.quote,
      start: located.start,
      end: located.end,
      matchCount: located.matchCount,
      severity: isSeverity(candidate.severity) ? candidate.severity : category.defaultSeverity,
      note: candidate.note?.trim() || category.summary,
      source: candidate.source,
    };
    const overlapIndex = kept.findIndex((item) => item.categoryId === flag.categoryId && overlaps(item, flag));
    if (overlapIndex >= 0) {
      kept[overlapIndex] = prefer(kept[overlapIndex], flag);
      continue;
    }
    kept.push(flag);
  }

  kept.sort((left, right) => left.start - right.start || left.categoryId.localeCompare(right.categoryId));
  return { flags: kept, dropped, grade: gradeFlags(kept) };
}

export function analyzeBaseline(
  text: string,
  enabledCategoryIds: readonly CategoryId[],
  extra: readonly Candidate[] = [],
): AnalyzeResult {
  return analyze({
    text,
    enabledCategoryIds,
    candidates: [...detectBaseline(text, 'strict'), ...extra],
  });
}
