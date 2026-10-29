import { CATEGORY_BY_ID } from './categories';
import { locateByOffsets, locateByQuote, prepareDocument, type PreparedDocument } from './quote';
import { RULEBOOK_VERSION, matchingRulebookId, orderedCategories } from './rulebooks';
import {
  boundedPreview,
  CATEGORY_IDS,
  CORE_VERSION,
  isCategoryId,
  isEngineId,
  isReasonFor,
  LIMITS,
  RESULT_VERSION,
  UNSPECIFIED_REASON,
  type Candidate,
  type CategoryId,
  type EngineCoverage,
  type EngineId,
  type Finding,
  type Occurrence,
  type Prediction,
  type Provenance,
  type Rejection,
  type ReasonCode,
  type ScanResult,
  type ScanState,
  type Section,
} from './types';

export interface AnalyzableSnapshot {
  scanId: string;
  revision: number;
  text: string;
  sections: readonly Section[];
}

export interface AnalyzeInput {
  snapshot: AnalyzableSnapshot;
  enabledCategoryIds: readonly CategoryId[];
  candidates: readonly Candidate[];
  operationId?: string;
  requestedEngines?: readonly EngineId[];
  coverage?: readonly EngineCoverage[];
  /** Display capacity. null means uncapped (pure evaluation). */
  displayLimit?: number | null;
  /** Reuse a prepared document across calls on the same immutable snapshot. */
  prepared?: PreparedDocument;
  /** Rejections raised before validation (e.g. malformed items from the strict parser). */
  extraRejections?: readonly Rejection[];
}

export interface AnalyzeOutput {
  result: ScanResult;
  /**
   * Scoring units: every accepted prediction after exact same-category occurrence deduplication
   * (reasons/provenance merged), before overlap folding and the display cap. Uncapped.
   */
  predictions: Finding[];
}

const ENGINE_ORDER: Record<EngineId, number> = { rules: 0, recorded: 1, 'on-device': 2, loose: 3 };
const CATEGORY_ORDER = new Map<CategoryId, number>(CATEGORY_IDS.map((id, index) => [id, index]));

type Validation = { ok: true; prediction: Prediction } | { ok: false; rejection: Rejection };

function reject(candidate: Candidate, code: Rejection['code'], detail?: string): Validation {
  return {
    ok: false,
    rejection: {
      code,
      engine: isEngineId(candidate.engine) ? candidate.engine : 'recorded',
      categoryId: typeof candidate.categoryId === 'string' ? boundedPreview(candidate.categoryId) : undefined,
      preview: boundedPreview(candidate.quote ?? ''),
      detail,
    },
  };
}

function validate(
  candidate: Candidate,
  document: PreparedDocument,
  snapshot: AnalyzableSnapshot,
  enabled: ReadonlySet<CategoryId>,
): Validation {
  if (!candidate || typeof candidate !== 'object') {
    return { ok: false, rejection: { code: 'bad_schema', engine: 'recorded', preview: boundedPreview(candidate) } };
  }
  if (candidate.snapshotRef) {
    const ref = candidate.snapshotRef;
    if (ref.scanId !== snapshot.scanId || ref.revision !== snapshot.revision) {
      return reject(candidate, 'stale_snapshot', 'The candidate was produced for a different snapshot.');
    }
  }
  if (!isEngineId(candidate.engine) || typeof candidate.engineVersion !== 'string') {
    return reject(candidate, 'bad_schema', 'Missing engine provenance.');
  }
  if (typeof candidate.quote !== 'string' || typeof candidate.categoryId !== 'string') {
    return reject(candidate, 'bad_schema', 'categoryId and quote must be strings.');
  }
  if (candidate.explanation !== undefined && typeof candidate.explanation !== 'string') {
    return reject(candidate, 'bad_schema', 'explanation must be a string.');
  }
  if (candidate.sectionId !== undefined && typeof candidate.sectionId !== 'string') {
    return reject(candidate, 'bad_schema', 'sectionId must be a string.');
  }
  if (candidate.reasonCode !== undefined && typeof candidate.reasonCode !== 'string') {
    return reject(candidate, 'bad_schema', 'reasonCode must be a string.');
  }
  const quote = candidate.quote;
  if (quote.trim().length === 0) return reject(candidate, 'empty', 'Empty quote.');
  if (!isCategoryId(candidate.categoryId)) return reject(candidate, 'unknown_category');
  const categoryId = candidate.categoryId;
  const reasonCode: ReasonCode = candidate.reasonCode === undefined ? UNSPECIFIED_REASON : (candidate.reasonCode as ReasonCode);
  if (!isReasonFor(categoryId, reasonCode)) return reject(candidate, 'unknown_reason');
  if (!enabled.has(categoryId)) return reject(candidate, 'category_disabled');
  if (quote.length > LIMITS.maxEvidence) return reject(candidate, 'over_max_length', 'Quote exceeds the evidence limit.');
  const explanation = (candidate.explanation as string | undefined)?.trim() ?? '';
  if (explanation.length > LIMITS.maxExplanation) {
    return reject(candidate, 'over_max_length', 'Explanation exceeds 280 characters.');
  }
  const sectionId = candidate.sectionId as string | undefined;
  const scope = candidate.searchScope === undefined ? undefined : validScope(candidate.searchScope, snapshot.text.length);
  if (candidate.searchScope !== undefined && !scope) return reject(candidate, 'bad_schema', 'Malformed search scope.');
  // Model offsets are never trusted: model candidates always use the quote-only path.
  const useOffsets = candidate.engine !== 'on-device' && (candidate.start !== undefined || candidate.end !== undefined);
  const located = useOffsets
    ? locateByOffsets(document, quote, candidate.start, candidate.end, sectionId)
    : locateByQuote(document, quote, sectionId, scope);
  if (!located.ok) return reject(candidate, located.code, located.detail);
  // The displayed raw slice can be longer than the quote when whitespace runs collapse.
  if (located.value.occurrences.some(({ span }) => span.end - span.start > LIMITS.maxEvidence)) {
    return reject(candidate, 'over_max_length', 'The located evidence exceeds the evidence limit.');
  }
  const occurrences: Occurrence[] = located.value.occurrences
    .map(({ span, matched }) => ({
      id: `o${span.start}-${span.end}`,
      start: span.start,
      end: span.end,
      matched: { start: matched.start, end: matched.end },
      sectionId: sectionAt(snapshot.sections, span.start)?.id,
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  return {
    ok: true,
    prediction: {
      categoryId,
      reasonCode,
      explanation: explanation || CATEGORY_BY_ID[categoryId].summary,
      occurrences,
      expanded: located.value.expanded,
      ambiguous: located.value.ambiguous,
      provenance: { engine: candidate.engine, engineVersion: candidate.engineVersion },
    },
  };
}

/** Fail closed: a malformed adapter scope never widens the search. */
function validScope(scope: Candidate['searchScope'], length: number): { start: number; end: number } | undefined {
  if (!scope || typeof scope !== 'object' || !Number.isInteger(scope.start) || !Number.isInteger(scope.end)) return undefined;
  if (scope.start < 0 || scope.end > length || scope.start >= scope.end) return undefined;
  return { start: scope.start, end: scope.end };
}

function sectionAt(sections: readonly Section[], offset: number): Section | undefined {
  let best: Section | undefined;
  for (const section of sections) {
    if (section.start <= offset && offset < section.end) {
      if (!best || section.end - section.start < best.end - best.start) best = section;
    }
  }
  return best;
}

function occurrenceKey(prediction: Prediction): string {
  return `${prediction.categoryId}|${prediction.occurrences.map((item) => `${item.start}-${item.end}`).join(',')}`;
}

function overlaps(left: Finding, right: Finding): boolean {
  return left.occurrences.some((a) => right.occurrences.some((b) => a.start < b.end && b.start < a.end));
}

function firstStart(finding: Finding): number {
  return finding.occurrences[0]?.start ?? 0;
}

function firstLength(finding: Finding): number {
  const first = finding.occurrences[0];
  return first ? first.end - first.start : 0;
}

/** Deterministic display order: earliest, then longer, then category order, then engine order. */
function compareFindings(left: Finding, right: Finding): number {
  return (
    firstStart(left) - firstStart(right) ||
    firstLength(right) - firstLength(left) ||
    (CATEGORY_ORDER.get(left.categoryId) ?? 0) - (CATEGORY_ORDER.get(right.categoryId) ?? 0) ||
    (ENGINE_ORDER[left.provenance[0]?.engine ?? 'rules'] ?? 0) - (ENGINE_ORDER[right.provenance[0]?.engine ?? 'rules'] ?? 0)
  );
}

function mergeProvenance(list: Provenance[], next: Provenance) {
  if (!list.some((item) => item.engine === next.engine && item.engineVersion === next.engineVersion)) list.push(next);
  list.sort((left, right) => ENGINE_ORDER[left.engine] - ENGINE_ORDER[right.engine]);
}

/**
 * Validate and combine candidates deterministically. Exact same-category occurrences are deduplicated
 * (reasons and provenance merged). Overlapping non-identical spans of one category keep a single display
 * representative; every accepted prediction is retained for scoring. Categories are never merged.
 */
export function analyze(input: AnalyzeInput): AnalyzeOutput {
  const { snapshot } = input;
  const enabledCategoryIds = orderedCategories(input.enabledCategoryIds);
  const enabled = new Set(enabledCategoryIds);
  const document = input.prepared ?? prepareDocument(snapshot);
  const displayLimit = input.displayLimit === undefined ? LIMITS.maxDisplayedFindings : input.displayLimit;
  const coverage = [...(input.coverage ?? [])];
  const requestedEngines = [
    ...new Set(input.requestedEngines ?? input.candidates.map((candidate) => candidate?.engine).filter(isEngineId)),
  ];
  const engineVersions: Partial<Record<EngineId, string>> = {};
  for (const item of coverage) engineVersions[item.engine] = item.engineVersion;
  for (const candidate of input.candidates) {
    if (isEngineId(candidate?.engine) && typeof candidate.engineVersion === 'string') {
      engineVersions[candidate.engine] ??= candidate.engineVersion;
    }
  }
  const effectiveEngines = coverage.length
    ? coverage.filter((item) => item.state === 'complete' || item.state === 'partial').map((item) => item.engine)
    : requestedEngines;

  const base = {
    resultVersion: RESULT_VERSION,
    coreVersion: CORE_VERSION,
    scanId: snapshot.scanId,
    operationId: input.operationId ?? `${snapshot.scanId}:analyze`,
    revision: snapshot.revision,
    rulebookVersion: RULEBOOK_VERSION,
    presetId: matchingRulebookId(enabledCategoryIds),
    enabledCategoryIds,
    requestedEngines,
    effectiveEngines,
    engineVersions,
    coverage,
  };

  if (enabledCategoryIds.length === 0) {
    return {
      predictions: [],
      result: {
        ...base,
        state: 'no_categories',
        findings: [],
        rejections: [],
        counts: { candidates: input.candidates.length, accepted: 0, rejected: 0, expanded: 0, ambiguous: 0, displayed: 0 },
        findingLimitReached: false,
      },
    };
  }

  const accepted: Prediction[] = [];
  const rejections: Rejection[] = [...(input.extraRejections ?? [])];
  for (const candidate of input.candidates) {
    const outcome = validate(candidate, document, snapshot, enabled);
    if (outcome.ok) accepted.push(outcome.prediction);
    else rejections.push(outcome.rejection);
  }

  // Exact same-category occurrence sets collapse into one finding.
  const byKey = new Map<string, Finding>();
  for (const prediction of accepted) {
    const key = occurrenceKey(prediction);
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.reasonCodes.includes(prediction.reasonCode)) existing.reasonCodes.push(prediction.reasonCode);
      mergeProvenance(existing.provenance, prediction.provenance);
      if (prediction.expanded && !existing.expanded) {
        // Equal context spans can come from an exact rule and an expanded model quote.
        // Keep the model's matched subspan with its expansion disclosure.
        existing.expanded = true;
        existing.occurrences = prediction.occurrences;
      }
      continue;
    }
    const first = prediction.occurrences[0] as Occurrence;
    const section = first.sectionId ? snapshot.sections.find((item) => item.id === first.sectionId) : undefined;
    byKey.set(key, {
      id: `${prediction.categoryId}:${first.start}-${first.end}`,
      categoryId: prediction.categoryId,
      reasonCodes: [prediction.reasonCode],
      quote: snapshot.text.slice(first.start, first.end),
      explanation: prediction.explanation,
      sectionId: section?.id,
      sectionLabel: section?.label,
      occurrences: prediction.occurrences,
      ambiguous: prediction.ambiguous,
      expanded: prediction.expanded,
      provenance: [prediction.provenance],
      overlapping: 0,
    });
  }

  // Scoring units keep their own copies; display representatives below may absorb overlaps.
  const sorted = [...byKey.values()].sort(compareFindings);
  const predictions = sorted.map((finding) => ({
    ...finding,
    reasonCodes: [...finding.reasonCodes],
    provenance: [...finding.provenance],
  }));
  // Overlapping, non-identical findings of one category: keep the first in deterministic order.
  const representatives: Finding[] = [];
  // A quote-only prediction with explicit alternatives must survive overlap folding
  // with exact rule hits at those same locations. Scoring copies above stay unchanged.
  const displayOrder = [...sorted].sort((left, right) => Number(right.ambiguous) - Number(left.ambiguous) || compareFindings(left, right));
  for (const finding of displayOrder) {
    const holder = representatives.find((item) => item.categoryId === finding.categoryId && overlaps(item, finding));
    if (holder) {
      holder.overlapping += 1;
      for (const code of finding.reasonCodes) if (!holder.reasonCodes.includes(code)) holder.reasonCodes.push(code);
      for (const provenance of finding.provenance) mergeProvenance(holder.provenance, provenance);
      continue;
    }
    representatives.push(finding);
  }
  representatives.sort(compareFindings);

  const findingLimitReached = displayLimit !== null && representatives.length > displayLimit;
  const findings = findingLimitReached ? representatives.slice(0, displayLimit as number) : representatives;
  const partialCoverage = coverage.some((item) => item.state === 'partial');
  const state: ScanState = findingLimitReached || partialCoverage ? 'partial' : 'complete';

  return {
    predictions,
    result: {
      ...base,
      state,
      findings,
      rejections,
      counts: {
        candidates: input.candidates.length + (input.extraRejections?.length ?? 0),
        accepted: accepted.length,
        rejected: rejections.length,
        expanded: accepted.filter((item) => item.expanded).length,
        ambiguous: accepted.filter((item) => item.ambiguous).length,
        displayed: findings.length,
      },
      findingLimitReached,
    },
  };
}

/** Coverage entry for an engine that processed the whole captured text. */
export function fullCoverage(engine: EngineId, engineVersion: string, length: number): EngineCoverage {
  return {
    engine,
    engineVersion,
    state: 'complete',
    processed: length > 0 ? [{ start: 0, end: length }] : [],
    skipped: [],
    failed: [],
  };
}
