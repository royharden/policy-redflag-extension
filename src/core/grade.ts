import { CATEGORY_BY_ID } from './categories';
import type { CategoryId, Grade } from './types';

const LETTERS: { min: number; letter: Grade['letter'] }[] = [
  { min: 90, letter: 'A' },
  { min: 75, letter: 'B' },
  { min: 60, letter: 'C' },
  { min: 40, letter: 'D' },
  { min: 0, letter: 'F' },
];

/** Score starts at 100 and subtracts each flagged category once. The weights sum to 100. */
export function gradeFlags(flags: readonly { categoryId: CategoryId }[]): Grade {
  const present = new Set(flags.map((flag) => flag.categoryId));
  let penalty = 0;
  for (const categoryId of present) penalty += CATEGORY_BY_ID[categoryId].weight;
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const letter = LETTERS.find((band) => score >= band.min)?.letter ?? 'F';
  return {
    score,
    letter,
    categoriesFlagged: [...present],
  };
}
