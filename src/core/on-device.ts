/**
 * Opt-in on-device model adapter for Chrome's built-in Prompt API (LanguageModel).
 * Imported ONLY by extension document entrypoints (side panel, eval.html) — never by the worker or
 * the web lab, and not exported from ./index. Policy text never leaves the device; only the model
 * download (handled by Chrome) may use the network.
 *
 * Feature detection is by method presence; no API version is assumed and legacy availability strings
 * are reported as "unknown" rather than treated as proof of support. See
 * https://developer.chrome.com/docs/ai/prompt-api — validate against it before relying on behavior.
 */
import { parseFlagsResponse } from './model';
import { buildChunkPrompt, flagsResponseSchema, MAX_CHUNK_UNITS, PROMPT_VERSION } from './prompt';
import { segmentSentences } from './text';
import {
  boundedPreview,
  type Candidate,
  type CategoryId,
  type EngineCoverage,
  type Interval,
  type Rejection,
} from './types';

export const ADAPTER_VERSION = 'on-device/1';

export const BUDGETS = {
  maxChunkUnits: MAX_CHUNK_UNITS,
  maxOverlapUnits: 500,
  maxChunks: 8,
  promptTimeoutMs: 10_000,
  scanTimeoutMs: 60_000,
  /** Tokens reserved for the JSON response when the session reports a quota. */
  outputReserveTokens: 1_024,
} as const;

/* ----------------------------- structural API types (feature-detected) ----------------------------- */

interface PromptOptions {
  signal?: AbortSignal;
  responseConstraint?: unknown;
}

interface LanguageModelSessionLike {
  prompt(input: string, options?: PromptOptions): Promise<string>;
  destroy?: () => void;
  clone?: (options?: { signal?: AbortSignal }) => Promise<LanguageModelSessionLike>;
  measureInputUsage?: (input: string, options?: PromptOptions) => Promise<number>;
  inputQuota?: number;
  inputUsage?: number;
}

interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void;
}

interface LanguageModelApiLike {
  availability?: (options?: unknown) => Promise<string>;
  create?: (options?: Record<string, unknown>) => Promise<LanguageModelSessionLike>;
}

export type AvailabilityStatus = 'unsupported_api' | 'unavailable' | 'downloadable' | 'downloading' | 'available' | 'unknown';

export interface Capabilities {
  api: boolean;
  availability: boolean;
  create: boolean;
  clone: boolean;
  measureInputUsage: boolean;
  inputQuota: boolean;
  responseConstraint: 'unknown';
}

export interface AvailabilityReport {
  status: AvailabilityStatus;
  /** The raw string the browser returned, for diagnostics. */
  raw: string | null;
  capabilities: Capabilities;
}

const LANGUAGE_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

function api(): LanguageModelApiLike | null {
  const candidate = (globalThis as { LanguageModel?: unknown }).LanguageModel;
  return candidate && (typeof candidate === 'object' || typeof candidate === 'function') ? (candidate as LanguageModelApiLike) : null;
}

export async function checkAvailability(): Promise<AvailabilityReport> {
  const model = api();
  const capabilities: Capabilities = {
    api: Boolean(model),
    availability: typeof model?.availability === 'function',
    create: typeof model?.create === 'function',
    clone: false,
    measureInputUsage: false,
    inputQuota: false,
    responseConstraint: 'unknown',
  };
  if (!model || !capabilities.create) return { status: 'unsupported_api', raw: null, capabilities };
  if (!capabilities.availability) return { status: 'unknown', raw: null, capabilities };
  let raw: string;
  try {
    raw = String(await model.availability?.(LANGUAGE_OPTIONS));
  } catch {
    return { status: 'unknown', raw: 'availability() threw', capabilities };
  }
  const known: AvailabilityStatus[] = ['unavailable', 'downloadable', 'downloading', 'available'];
  const status = (known as string[]).includes(raw) ? (raw as AvailabilityStatus) : 'unknown';
  return { status, raw, capabilities };
}

/* ----------------------------- sessions ----------------------------- */

export interface ReadySession {
  base: LanguageModelSessionLike;
  categoryIds: CategoryId[];
  capabilities: Capabilities;
  /** Input tokens consumed by the system prompt, when the session reports it. */
  baseUsage: number | null;
  quota: number | null;
  /** Create a fresh context (clone of the base session, else a new session with the same system prompt). */
  fresh(signal: AbortSignal): Promise<LanguageModelSessionLike>;
}

export class LocalModelError extends Error {
  constructor(
    readonly code: 'unsupported_api' | 'unavailable' | 'cancelled' | 'create_failed' | 'timeout',
    message: string,
  ) {
    super(message);
    this.name = 'LocalModelError';
  }
}

/**
 * Explicit user activation: may start the Chrome model download (progress reported 0..1) and creates a
 * base session holding the system prompt. Cancel with the signal; destroy with destroySession.
 */
export async function createSession(options: {
  categoryIds: readonly CategoryId[];
  signal: AbortSignal;
  onProgress?: (loaded: number) => void;
}): Promise<ReadySession> {
  const model = api();
  if (!model?.create) throw new LocalModelError('unsupported_api', 'This browser has no on-device LanguageModel API.');
  const report = await checkAvailability();
  if (report.status === 'unavailable') throw new LocalModelError('unavailable', 'The on-device model is unavailable on this device.');
  const system = buildChunkPrompt({ chunkText: '', categoryIds: options.categoryIds, chunkIndex: 0, chunkCount: 1 }).system;
  let base: LanguageModelSessionLike;
  try {
    base = await model.create({
      ...LANGUAGE_OPTIONS,
      signal: options.signal,
      initialPrompts: [{ role: 'system', content: system }],
      monitor(monitor: DownloadMonitor) {
        monitor.addEventListener('downloadprogress', (event) => options.onProgress?.(event.loaded));
      },
    });
  } catch (error) {
    if (options.signal.aborted) throw new LocalModelError('cancelled', 'Model activation was cancelled.');
    throw new LocalModelError('create_failed', `The on-device model could not start: ${boundedPreview(error instanceof Error ? error.message : String(error))}`);
  }
  const capabilities: Capabilities = {
    ...report.capabilities,
    clone: typeof base.clone === 'function',
    measureInputUsage: typeof base.measureInputUsage === 'function',
    inputQuota: typeof base.inputQuota === 'number',
  };
  const create = model.create.bind(model);
  return {
    base,
    categoryIds: [...options.categoryIds],
    capabilities,
    baseUsage: typeof base.inputUsage === 'number' ? base.inputUsage : null,
    quota: typeof base.inputQuota === 'number' ? base.inputQuota : null,
    fresh: (signal) =>
      base.clone ? base.clone({ signal }) : create({ ...LANGUAGE_OPTIONS, signal, initialPrompts: [{ role: 'system', content: system }] }),
  };
}

export function destroySession(session: ReadySession | null): void {
  try {
    session?.base.destroy?.();
  } catch {
    // Destroying twice or after a browser-side failure is harmless.
  }
}

/* ----------------------------- chunking ----------------------------- */

export interface Chunk extends Interval {
  index: number;
}

/**
 * Split the captured text into <= maxChunkUnits chunks with <= maxOverlapUnits overlap, ending on a
 * sentence boundary where possible. At most maxChunks are produced; the rest is reported as skipped.
 */
export function planChunks(text: string): { chunks: Chunk[]; skipped: Interval[] } {
  const sentences = segmentSentences(text);
  const chunks: Chunk[] = [];
  let start = 0;
  while (start < text.length && chunks.length < BUDGETS.maxChunks) {
    const hardEnd = Math.min(text.length, start + BUDGETS.maxChunkUnits);
    let end = hardEnd;
    if (hardEnd < text.length) {
      const boundary = [...sentences].reverse().find((item) => item.end <= hardEnd && item.end > start + BUDGETS.maxChunkUnits / 2);
      if (boundary) end = boundary.end;
    }
    chunks.push({ index: chunks.length, start, end });
    if (end >= text.length) break;
    // Overlap: restart at the start of the sentence containing (end - overlap), within the overlap budget.
    const overlapFrom = Math.max(start + 1, end - BUDGETS.maxOverlapUnits);
    const sentence = sentences.find((item) => item.start >= overlapFrom && item.start < end);
    start = sentence ? sentence.start : end;
  }
  const covered = chunks.length ? (chunks[chunks.length - 1] as Chunk).end : 0;
  return { chunks, skipped: covered < text.length ? [{ start: covered, end: text.length }] : [] };
}

/* ----------------------------- inference ----------------------------- */

export interface InferenceOutcome {
  candidates: Candidate[];
  extraRejections: Rejection[];
  coverage: EngineCoverage;
  chunkReports: { index: number; start: number; end: number; status: string; detail?: string; ms: number; inputUsage?: number }[];
  modelIdentity: string;
  adapterVersion: string;
  promptVersion: string;
}

function withTimeout(parent: AbortSignal, ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  parent.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * Run the bounded chunk loop with the SAME prompt/parser as every other path. Each chunk uses a fresh
 * context so nothing carries over between chunks or documents. No automatic retry. Quotes are searched
 * only inside that chunk's interval.
 */
export async function runInference(options: {
  session: ReadySession;
  text: string;
  scanId: string;
  revision: number;
  signal: AbortSignal;
  now?: () => number;
}): Promise<InferenceOutcome> {
  const now = options.now ?? (() => Date.now());
  const { session, text } = options;
  const { chunks, skipped } = planChunks(text);
  const processed: Interval[] = [];
  const failed: Interval[] = [];
  const skippedAll: Interval[] = [...skipped];
  const candidates: Candidate[] = [];
  const extraRejections: Rejection[] = [];
  const chunkReports: InferenceOutcome['chunkReports'] = [];
  const deadline = now() + BUDGETS.scanTimeoutMs;
  const schema = flagsResponseSchema(session.categoryIds);
  let failureCode: string | undefined;

  for (const chunk of chunks) {
    if (options.signal.aborted) {
      failureCode = 'cancelled';
      skippedAll.push({ start: chunk.start, end: chunk.end });
      continue;
    }
    if (now() >= deadline) {
      failureCode ??= 'scan_timeout';
      skippedAll.push({ start: chunk.start, end: chunk.end });
      continue;
    }
    const started = now();
    const user = buildChunkPrompt({
      chunkText: text.slice(chunk.start, chunk.end),
      categoryIds: session.categoryIds,
      chunkIndex: chunk.index,
      chunkCount: chunks.length,
    }).user;
    const budget = withTimeout(options.signal, Math.min(BUDGETS.promptTimeoutMs, Math.max(0, deadline - now())));
    let context: LanguageModelSessionLike | null = null;
    try {
      context = await session.fresh(budget.signal);
      let inputUsage: number | undefined;
      if (context.measureInputUsage && session.quota !== null) {
        inputUsage = await context.measureInputUsage(user, { responseConstraint: schema, signal: budget.signal });
        const available = session.quota - (session.baseUsage ?? 0) - BUDGETS.outputReserveTokens;
        if (inputUsage > available) throw new Error('over_context');
      }
      const raw = await context.prompt(user, { responseConstraint: schema, signal: budget.signal });
      const parsed = parseFlagsResponse(raw, {
        engine: 'on-device',
        engineVersion: ADAPTER_VERSION,
        snapshotRef: { scanId: options.scanId, revision: options.revision },
      });
      if (!parsed.ok) throw new Error(parsed.code);
      for (const candidate of parsed.candidates) candidates.push({ ...candidate, searchScope: { start: chunk.start, end: chunk.end } });
      for (const item of parsed.itemErrors) {
        extraRejections.push({ code: 'bad_schema', engine: 'on-device', preview: item.preview, detail: `Chunk ${chunk.index + 1}, flag ${item.index}: ${item.detail}` });
      }
      processed.push({ start: chunk.start, end: chunk.end });
      chunkReports.push({ index: chunk.index, start: chunk.start, end: chunk.end, status: 'ok', ms: now() - started, inputUsage });
    } catch (error) {
      const code = options.signal.aborted
        ? 'cancelled'
        : budget.signal.aborted
          ? 'prompt_timeout'
          : error instanceof Error && /^(over_context|bad_json|bad_schema|response_too_large|too_many_candidates)$/.test(error.message)
            ? error.message
            : 'prompt_failed';
      failureCode ??= code;
      failed.push({ start: chunk.start, end: chunk.end });
      chunkReports.push({ index: chunk.index, start: chunk.start, end: chunk.end, status: code, ms: now() - started });
    } finally {
      budget.cancel();
      try {
        context?.destroy?.();
      } catch {
        // ignore
      }
    }
  }

  const state: EngineCoverage['state'] = options.signal.aborted
    ? 'cancelled'
    : processed.length === 0
      ? 'failed'
      : failed.length || skippedAll.length
        ? 'partial'
        : 'complete';
  return {
    candidates,
    extraRejections,
    coverage: { engine: 'on-device', engineVersion: ADAPTER_VERSION, state, processed, skipped: skippedAll, failed, failureCode },
    chunkReports,
    // The Prompt API exposes no model identifier; never invent one.
    modelIdentity: 'unknown',
    adapterVersion: ADAPTER_VERSION,
    promptVersion: PROMPT_VERSION,
  };
}
