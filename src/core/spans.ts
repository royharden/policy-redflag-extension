import type { CategoryId } from './types';

export interface TextPart {
  text: string;
  categories: CategoryId[];
}

export function splitByRanges(
  text: string,
  ranges: readonly { start: number; end: number; categoryId: CategoryId }[],
): TextPart[] {
  const bounds = new Set<number>([0, text.length]);
  const clipped = ranges.flatMap((range) => {
    const start = Math.max(0, Math.min(text.length, range.start));
    const end = Math.max(0, Math.min(text.length, range.end));
    if (start >= end) return [];
    bounds.add(start);
    bounds.add(end);
    return [{ start, end, categoryId: range.categoryId }];
  });
  const points = [...bounds].sort((left, right) => left - right);
  const parts: TextPart[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (start === undefined || end === undefined || start === end) continue;
    const categories: CategoryId[] = [];
    for (const range of clipped) {
      if (range.start < end && start < range.end && !categories.includes(range.categoryId)) {
        categories.push(range.categoryId);
      }
    }
    parts.push({ text: text.slice(start, end), categories });
  }
  return parts;
}
