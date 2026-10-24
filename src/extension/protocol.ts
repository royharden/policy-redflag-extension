// Message and storage contracts shared by the worker, the side panel and the evaluation page.
import {
  isCategoryId,
  isEngineId,
  LIMITS,
  type Candidate,
  type CategoryId,
  type DocumentSnapshot,
  type EngineCoverage,
  type Rejection,
  type ScanResult,
  type ScanState,
  type UserSettings,
} from '../core';

export const CHANNEL = 'policy-redflag';

/** Model output produced in an extension document and validated again by the worker. */
export interface ModelRun {
  runVersion: 1;
  scanId: string;
  revision: number;
  enabledCategoryIds: CategoryId[];
  candidates: Candidate[];
  extraRejections: Rejection[];
  coverage: EngineCoverage;
  /** Reported model identity, or "unknown". Never invented. */
  modelIdentity: string;
  adapterVersion: string;
  promptVersion: string;
  startedAt: string;
  finishedAt: string;
}

/** One latest scan per tab, kept only in chrome.storage.session. */
export interface StoredTabScan {
  storageVersion: 1;
  tabId: number;
  windowId: number;
  browserDocumentId: string;
  snapshot: DocumentSnapshot;
  enabledCategoryIds: CategoryId[];
  operationId: string;
  result: ScanResult;
  model?: ModelRun;
  /** The live page changed after capture: saved evidence stays valid for the old snapshot only. */
  liveStale: boolean;
  lastUsed: number;
}

export interface TabStatus {
  state: ScanState;
  reason?: string;
  operationId: string;
}

export interface TabView {
  tabId: number;
  scan: StoredTabScan | null;
  /** Set when this tab's scan was evicted (LRU / quota): a toolbar recapture is required. */
  evicted: string | null;
  status: TabStatus | null;
  live: 'live' | 'stale' | 'missing' | 'unknown';
}

export interface CatalogView {
  categories: { id: CategoryId; label: string; summary: string; reasons: readonly { code: string; label: string }[] }[];
  rulebooks: { id: string; label: string; description: string; categoryIds: CategoryId[] }[];
}

export interface PanelResponse {
  ok: boolean;
  error?: string;
  code?: string;
  view?: TabView;
  settings?: UserSettings;
  catalog?: CatalogView;
  coreVersion?: string;
  jump?: { visible: boolean; openedDetails: number; painted: string };
}

const MAX_RUN_CANDIDATES = LIMITS.maxModelCandidates * 8;

export function isModelRun(value: unknown): value is ModelRun {
  const run = value as Partial<ModelRun> | undefined;
  if (!run || run.runVersion !== 1 || typeof run.scanId !== 'string' || !Number.isInteger(run.revision)) return false;
  if (!Array.isArray(run.enabledCategoryIds) || !run.enabledCategoryIds.every(isCategoryId)) return false;
  if (!Array.isArray(run.candidates) || run.candidates.length > MAX_RUN_CANDIDATES) return false;
  if (!run.candidates.every((item) => item && typeof item === 'object' && isEngineId((item as Candidate).engine))) return false;
  if (!Array.isArray(run.extraRejections) || run.extraRejections.length > MAX_RUN_CANDIDATES) return false;
  const coverage = run.coverage as EngineCoverage | undefined;
  if (!coverage || coverage.engine !== 'on-device' || !Array.isArray(coverage.processed)) return false;
  return typeof run.modelIdentity === 'string' && typeof run.adapterVersion === 'string' && typeof run.promptVersion === 'string';
}
