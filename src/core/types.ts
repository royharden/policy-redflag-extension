/**
 * Versioned contracts shared by the extension, the paste lab and the evaluation scripts.
 * Offsets are zero-based, end-exclusive UTF-16 code units into DocumentSnapshot.text.
 */

export const PROTOCOL_VERSION = 1;
export const EXTRACTION_VERSION = 'body-walk/1';
export const CORE_VERSION = 'core/1';
export const RESULT_VERSION = 'result/1';

export const CATEGORY_IDS = [
  'arbitration',
  'unilateral_change',
  'liability_cap',
  'data_sale_or_share',
  'auto_renewal',
  'broad_content_license',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export const REASON_CODES = {
  auto_renewal: ['auto_renews', 'price_change_on_renewal', 'cancel_hurdle'],
  arbitration: ['binding_arbitration', 'class_action_waiver', 'jury_waiver'],
  unilateral_change: ['modify_any_time', 'notice_by_posting'],
  data_sale_or_share: ['sale', 'sharing_third_party', 'sharing_advertising'],
  liability_cap: ['damages_cap', 'exclusion_of_damages'],
  broad_content_license: ['perpetual_irrevocable', 'sublicensable', 'ai_training'],
} as const satisfies Record<CategoryId, readonly string[]>;

/** Imported or model labels that carry no supported sub-reason use this code. */
export const UNSPECIFIED_REASON = 'unspecified';

export type ReasonCode =
  | (typeof REASON_CODES)[CategoryId][number]
  | typeof UNSPECIFIED_REASON;

/** Hard limits from PLAN.md section 5. Oversize input is rejected, never clipped. */
export const LIMITS = {
  captureCap: 200_000,
  maxEvidence: 1_200,
  maxExplanation: 280,
  maxModelCandidates: 100,
  maxDisplayedFindings: 100,
  maxResponse: 256_000,
  maxPreview: 500,
  ambiguousMax: 5,
  substantiveWords: 4,
} as const;

export interface Interval {
  start: number;
  end: number;
}

export interface Section extends Interval {
  id: string;
  label: string;
}

/**
 * A captured text segment. Live segments map to original Text nodes inside the page bridge only;
 * virtual segments are block separators that exist in the snapshot text but not in the page.
 */
export interface Segment extends Interval {
  id: string;
  virtual: boolean;
  /** Text hidden solely by a closed native <details> ancestor. */
  collapsed?: boolean;
}

export type CaptureExclusion =
  | 'script/style/noscript/template/svg/iframe'
  | 'form controls and editable content'
  | 'navigation'
  | 'hidden content (except closed native details)'
  | 'frames, shadow DOM and lazy-loaded content';

export interface CaptureCoverage {
  region: 'body';
  exclusions: readonly CaptureExclusion[];
  capturedLength: number;
  cap: number;
  /** True when the cap was reached. The amount of untraversed text is not known. */
  truncated: boolean;
  collapsedSegments: number;
}

export interface DocumentSnapshot {
  protocolVersion: number;
  extractionVersion: string;
  scanId: string;
  tabId: number;
  frameId: 0;
  /** Browser document identity where available plus the bridge document nonce. */
  documentId: string;
  bridgeNonce: string;
  revision: number;
  url: string;
  title: string;
  textHash: string;
  text: string;
  sections: readonly Section[];
  segments: readonly Segment[];
  coverage: CaptureCoverage;
  capturedAt: string;
}

export type EngineId = 'rules' | 'loose' | 'recorded' | 'on-device';

export const ENGINE_IDS: readonly EngineId[] = ['rules', 'loose', 'recorded', 'on-device'];

/** Raw candidate from an engine, a recorded file or a model. Fields are unchecked until validation. */
export interface Candidate {
  categoryId: unknown;
  reasonCode?: unknown;
  quote: unknown;
  explanation?: unknown;
  engine: EngineId;
  engineVersion: string;
  sectionId?: unknown;
  start?: unknown;
  end?: unknown;
  /** When present, must match the snapshot being analysed. */
  snapshotRef?: { scanId: string; revision: number };
  /**
   * Trusted search scope set by the local adapter (the processed chunk interval), never by model output.
   * Quote-only search is limited to this interval (intersected with a named section).
   */
  searchScope?: Interval;
}

export interface Occurrence extends Interval {
  id: string;
  /** Matched span before expansion; equals start/end unless expanded. */
  matched: Interval;
  sectionId?: string;
}

export interface Provenance {
  engine: EngineId;
  engineVersion: string;
}

/** One accepted, located prediction. Kept uncapped for scoring. */
export interface Prediction {
  categoryId: CategoryId;
  reasonCode: ReasonCode;
  explanation: string;
  occurrences: Occurrence[];
  expanded: boolean;
  ambiguous: boolean;
  provenance: Provenance;
}

/** Display unit. A located quote proves text presence only, not category correctness. */
export interface Finding {
  id: string;
  categoryId: CategoryId;
  reasonCodes: ReasonCode[];
  /** Original raw slice of the first recorded occurrence. Never clipped. */
  quote: string;
  explanation: string;
  sectionId?: string;
  sectionLabel?: string;
  occurrences: Occurrence[];
  ambiguous: boolean;
  expanded: boolean;
  provenance: Provenance[];
  /** Other accepted predictions that overlap this representative (same category). */
  overlapping: number;
}

export const REJECT_CODES = [
  'bad_schema',
  'unknown_category',
  'unknown_reason',
  'category_disabled',
  'invalid_section',
  'empty',
  'not_found',
  'bad_offsets',
  'over_max_length',
  'insufficient_context',
  'too_ambiguous',
  'stale_snapshot',
] as const;

export type RejectCode = (typeof REJECT_CODES)[number];

export interface Rejection {
  code: RejectCode;
  engine: EngineId;
  categoryId?: string;
  /** Bounded preview (<= LIMITS.maxPreview). Render as text only. */
  preview: string;
  detail?: string;
}

export type EngineState =
  | 'not_requested'
  | 'complete'
  | 'partial'
  | 'unavailable'
  | 'downloading'
  | 'failed'
  | 'cancelled';

export interface EngineCoverage {
  engine: EngineId;
  engineVersion: string;
  state: EngineState;
  processed: Interval[];
  skipped: Interval[];
  failed: Interval[];
  failureCode?: string;
}

export type ScanState =
  | 'idle'
  | 'capturing'
  | 'ready'
  | 'analyzing'
  | 'complete'
  | 'partial'
  | 'no_categories'
  | 'unsupported'
  | 'permission_required'
  | 'downloading'
  | 'cancelled'
  | 'stale'
  | 'error';

export interface ResultCounts {
  candidates: number;
  accepted: number;
  rejected: number;
  expanded: number;
  ambiguous: number;
  displayed: number;
}

export interface ScanResult {
  resultVersion: string;
  coreVersion: string;
  scanId: string;
  operationId: string;
  revision: number;
  rulebookVersion: string;
  presetId: string;
  enabledCategoryIds: CategoryId[];
  requestedEngines: EngineId[];
  effectiveEngines: EngineId[];
  engineVersions: Partial<Record<EngineId, string>>;
  state: ScanState;
  failureCode?: string;
  findings: Finding[];
  rejections: Rejection[];
  counts: ResultCounts;
  /** True when display capacity was reached; coverage stays accurate. */
  findingLimitReached: boolean;
  coverage: EngineCoverage[];
}

/** Historical grade shape kept only so the retained grade.ts module compiles. Not part of results. */
export interface Grade {
  score: number;
  letter: 'A' | 'B' | 'C' | 'D' | 'F';
  categoriesFlagged: CategoryId[];
}

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && (CATEGORY_IDS as readonly string[]).includes(value);
}

export function isReasonFor(categoryId: CategoryId, value: unknown): value is ReasonCode {
  if (value === UNSPECIFIED_REASON) return true;
  return typeof value === 'string' && (REASON_CODES[categoryId] as readonly string[]).includes(value);
}

export function isEngineId(value: unknown): value is EngineId {
  return typeof value === 'string' && (ENGINE_IDS as readonly string[]).includes(value);
}

export function boundedPreview(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  return text.length > LIMITS.maxPreview ? `${text.slice(0, LIMITS.maxPreview - 1)}…` : text;
}
