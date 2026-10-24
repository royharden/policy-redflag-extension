export const CATEGORY_IDS = [
  'arbitration',
  'unilateral_change',
  'liability_cap',
  'data_sale_or_share',
  'auto_renewal',
  'broad_content_license',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export type Severity = 'low' | 'medium' | 'high';

export type CandidateSource = 'strict-baseline' | 'loose-baseline' | 'model' | 'recorded';

export interface Candidate {
  categoryId: string;
  quote: string;
  source: CandidateSource;
  severity?: Severity;
  note?: string;
  start?: number;
  end?: number;
}

export interface KeptFlag {
  categoryId: CategoryId;
  quote: string;
  start: number;
  end: number;
  matchCount: number;
  severity: Severity;
  note: string;
  source: CandidateSource;
}

export type DropReason =
  | 'empty-quote'
  | 'unknown-category'
  | 'category-disabled'
  | 'unmatched-quote'
  | 'duplicate';

export interface DroppedFlag {
  categoryId: string;
  quote: string;
  reason: DropReason;
  source: CandidateSource;
}

export interface Grade {
  score: number;
  letter: 'A' | 'B' | 'C' | 'D' | 'F';
  categoriesFlagged: CategoryId[];
}

export interface AnalyzeResult {
  flags: KeptFlag[];
  dropped: DroppedFlag[];
  grade: Grade;
}

export function isCategoryId(value: string): value is CategoryId {
  return (CATEGORY_IDS as readonly string[]).includes(value);
}

export function isSeverity(value: unknown): value is Severity {
  return value === 'low' || value === 'medium' || value === 'high';
}
