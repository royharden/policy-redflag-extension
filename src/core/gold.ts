/**
 * Frozen gold format shared by scripts/prepare-gold.ts, scripts/evaluate.ts and extension/eval.html.
 * Pure TypeScript: no Node or Chrome APIs. See eval/LABELLING.md for the rubric.
 */
import { CATEGORY_IDS, REASON_CODES, type CategoryId, type Interval, type ReasonCode } from './types';

export const GOLD_SCHEMA_VERSION = 'gold/1';
export const RUBRIC_VERSION = 'rubric/1';
export const SPLIT_SEED = 'S12-20261023';
export const DEV_FRACTION = 0.7;
export const SPLITS = ['dev', 'held-out'] as const;
export type SplitName = (typeof SPLITS)[number];

export interface GoldLabel extends Interval {
  categoryId: CategoryId;
  reasonCodes: ReasonCode[];
}

export interface GoldItem {
  id: string;
  groupId: string;
  split: SplitName;
  source: string;
  title: string;
  text: string;
  textHash: string;
  evaluatedCategories: CategoryId[];
  labelCompleteness: 'complete' | 'partial';
  labels: GoldLabel[];
  /** Counted hard negatives (still ordinary negatives for scoring). */
  hardNegatives: (Interval & { categoryId: CategoryId })[];
  /** Every labelled unit span, positive or not (the clause/sentence units of the item). */
  units: Interval[];
}

export interface SplitEntry {
  file: string;
  sha256: string;
  items: number;
  groups: number;
}

export interface GoldManifest {
  schemaVersion: typeof GOLD_SCHEMA_VERSION;
  rubricVersion: string;
  seed: string;
  devFraction: number;
  sources: {
    name: string;
    kind: 'original-synthetic' | 'import';
    path: string;
    sha256: string;
    revision: string;
    licence: string;
    attribution: string;
    url?: string;
  }[];
  splits: Record<SplitName, SplitEntry>;
  groups: Record<string, SplitName>;
  counts: Record<SplitName, Record<CategoryId, { positives: number; hardNegatives: number; itemsEvaluated: number }>>;
  completeness: Record<'complete' | 'partial', number>;
  mapping: { source: string; label: string; mappedTo: string | null; reason: string }[];
  excludedLabels: Record<string, number>;
  tuningExposure: string;
  /** preparedAt is deliberately absent so re-running on identical data keeps the manifest hash stable. */
  heldOutFrozen: { sha256: string; frozenAt: string; history: { sha256: string; frozenAt: string; replacedAt: string }[] };
}

const REASON_TO_CATEGORY = new Map<string, CategoryId>(
  CATEGORY_IDS.flatMap((categoryId) => REASON_CODES[categoryId].map((code) => [code, categoryId] as const)),
);

export function categoryOfReason(code: string): CategoryId | null {
  return REASON_TO_CATEGORY.get(code) ?? null;
}

/** Deterministic 32-bit hash of a string (FNV-1a), used only to seed the split RNG. */
export function seedHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32: small deterministic PRNG. */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Group-level split: sort IDs, seeded Fisher-Yates shuffle, first ceil(70%) to dev. */
export function assignSplits(groupIds: readonly string[], seed = SPLIT_SEED, devFraction = DEV_FRACTION): Record<string, SplitName> {
  const ids = [...new Set(groupIds)].sort();
  const random = rng(seedHash(seed));
  for (let index = ids.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [ids[index], ids[swap]] = [ids[swap] as string, ids[index] as string];
  }
  const devCount = Math.ceil(ids.length * devFraction);
  return Object.fromEntries(ids.map((id, index) => [id, index < devCount ? 'dev' : 'held-out'])) as Record<string, SplitName>;
}

/** Structural and anchor validation. Returns problems; an empty list means valid. */
export function validateGoldItem(item: GoldItem): string[] {
  const problems: string[] = [];
  const where = `item ${item.id}`;
  if (!SPLITS.includes(item.split)) problems.push(`${where}: unknown split`);
  if (!item.evaluatedCategories.length) problems.push(`${where}: no evaluated categories`);
  for (const id of item.evaluatedCategories) if (!CATEGORY_IDS.includes(id)) problems.push(`${where}: unknown category ${id}`);
  const inRange = (span: Interval) => Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end <= item.text.length && span.start < span.end;
  for (const label of item.labels) {
    if (!inRange(label)) problems.push(`${where}: label anchor out of range`);
    if (!item.evaluatedCategories.includes(label.categoryId)) problems.push(`${where}: label for unevaluated category ${label.categoryId}`);
    for (const code of label.reasonCodes) {
      if (code !== 'unspecified' && categoryOfReason(code) !== label.categoryId) problems.push(`${where}: reason ${code} does not belong to ${label.categoryId}`);
    }
    if (!item.units.some((unit) => unit.start === label.start && unit.end === label.end)) problems.push(`${where}: label is not anchored to a whole unit`);
  }
  for (const unit of item.units) if (!inRange(unit) || !item.text.slice(unit.start, unit.end).trim()) problems.push(`${where}: empty or out-of-range unit`);
  return problems;
}
