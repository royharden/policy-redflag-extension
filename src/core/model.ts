import { boundedPreview, LIMITS, type Candidate, type EngineId, type Rejection } from './types';

/**
 * Strict model/recorded response parser (PLAN.md section 5).
 * Accepts exactly one JSON object with a `flags` array, optionally wrapped in ONE outer JSON code fence,
 * with surrounding whitespace. No think-tag stripping, brace scanning, string edits or prose repair.
 * The hosted client that used to live here is retained, unreachable, in ./legacy/hosted-client.ts.
 */

export const PARSER_VERSION = 'parser/1';

export type ParseFailureCode = 'bad_json' | 'bad_schema' | 'response_too_large' | 'too_many_candidates';

export interface ParseItemError {
  index: number;
  preview: string;
  detail: string;
}

export type ParseOutcome =
  | { ok: true; candidates: Candidate[]; itemErrors: ParseItemError[] }
  | { ok: false; code: ParseFailureCode; detail: string; preview: string };

const FENCE = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/;
const ALLOWED_FLAG_KEYS = new Set(['categoryId', 'reasonCode', 'quote', 'explanation', 'sectionId', 'start', 'end']);

function failure(code: ParseFailureCode, detail: string, raw: string): ParseOutcome {
  return { ok: false, code, detail, preview: boundedPreview(raw) };
}

export interface ParseOptions {
  engine: EngineId;
  engineVersion: string;
  /** Recorded files may carry offsets; model offsets are dropped (models use the quote-only path). */
  acceptOffsets?: boolean;
  snapshotRef?: Candidate['snapshotRef'];
}

export function parseFlagsResponse(raw: unknown, options: ParseOptions): ParseOutcome {
  if (typeof raw !== 'string') return failure('bad_json', 'The response is not text.', String(raw));
  if (raw.length > LIMITS.maxResponse) {
    return failure('response_too_large', `The response exceeds ${LIMITS.maxResponse} UTF-16 units.`, raw);
  }
  let body = raw.trim();
  if (body.startsWith('```')) {
    const fenced = FENCE.exec(body);
    if (!fenced || (fenced[1] ?? '').includes('```')) {
      return failure('bad_json', 'Only one outer JSON code fence is allowed.', raw);
    }
    body = (fenced[1] ?? '').trim();
  }
  if (!body.startsWith('{')) return failure('bad_json', 'The response must be one JSON object.', raw);
  let parsed: unknown;
  try {
    // JSON.parse rejects leading/trailing prose and multiple objects.
    parsed = JSON.parse(body);
  } catch {
    return failure('bad_json', 'The response is not a single valid JSON object.', raw);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return failure('bad_schema', 'The response must be a JSON object.', raw);
  }
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== 'flags') {
    return failure('bad_schema', 'The object must contain only a "flags" array.', raw);
  }
  const flags = (parsed as { flags: unknown }).flags;
  if (!Array.isArray(flags)) return failure('bad_schema', '"flags" must be an array.', raw);
  if (flags.length > LIMITS.maxModelCandidates) {
    return failure('too_many_candidates', `More than ${LIMITS.maxModelCandidates} flags; nothing was accepted.`, raw);
  }
  const candidates: Candidate[] = [];
  const itemErrors: ParseItemError[] = [];
  flags.forEach((item: unknown, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      itemErrors.push({ index, preview: boundedPreview(item), detail: 'A flag must be an object.' });
      return;
    }
    const row = item as Record<string, unknown>;
    const unknownKey = Object.keys(row).find((key) => !ALLOWED_FLAG_KEYS.has(key));
    if (unknownKey) {
      itemErrors.push({ index, preview: boundedPreview(item), detail: `Unknown field "${boundedPreview(unknownKey)}".` });
      return;
    }
    const candidate: Candidate = {
      categoryId: row.categoryId,
      quote: row.quote,
      engine: options.engine,
      engineVersion: options.engineVersion,
    };
    if ('reasonCode' in row) candidate.reasonCode = row.reasonCode;
    if ('explanation' in row) candidate.explanation = row.explanation;
    if ('sectionId' in row) candidate.sectionId = row.sectionId;
    if (options.acceptOffsets && ('start' in row || 'end' in row)) {
      candidate.start = row.start;
      candidate.end = row.end;
    }
    if (options.snapshotRef) candidate.snapshotRef = options.snapshotRef;
    candidates.push(candidate);
  });
  return { ok: true, candidates, itemErrors };
}

/** Malformed flag items become bad_schema rejections shown in Diagnostics. */
export function itemErrorRejections(errors: readonly ParseItemError[], engine: EngineId): Rejection[] {
  return errors.map((error) => ({
    code: 'bad_schema',
    engine,
    preview: error.preview,
    detail: `Flag ${error.index}: ${error.detail}`,
  }));
}
