// MV3 service worker. Owns toolbar-authorized capture, identities, per-tab session storage, lifecycle
// cleanup and current-operation checks. It never runs inference and never fetches anything.
import {
  analyze,
  CATEGORIES,
  coerceSettings,
  CORE_VERSION,
  defaultSettings,
  EXTRACTION_VERSION,
  fullCoverage,
  isCategoryId,
  LIMITS,
  orderedCategories,
  PROTOCOL_VERSION,
  RULEBOOKS,
  RULES_VERSION,
  scanStrict,
  sha256Hex,
  type Candidate,
  type CaptureCoverage,
  type CategoryId,
  type DocumentSnapshot,
  type EngineCoverage,
  type Rejection,
  type ScanResult,
  type Section,
  type Segment,
  type UserSettings,
} from '../core';
import {
  CHANNEL,
  isModelRun,
  type ModelRun,
  type PanelResponse,
  type StoredTabScan,
  type TabView,
} from './protocol';

const SCAN_PREFIX = 'scan:';
const TOMBSTONE_PREFIX = 'evicted:';
const MAX_TABS = 3;
const SESSION_BUDGET_BYTES = 6 * 1024 * 1024;
const EXCLUSIONS: CaptureCoverage['exclusions'] = [
  'script/style/noscript/template/svg/iframe',
  'form controls and editable content',
  'navigation',
  'hidden content (except closed native details)',
  'frames, shadow DOM and lazy-loaded content',
];

// Restrict session storage to trusted extension contexts (the default; stated explicitly).
void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => undefined);

/* ----------------------------- per-tab serialization ----------------------------- */

const tabLocks = new Map<number, Promise<unknown>>();
/** Latest operation per tab. Completions for older operations are discarded. In-memory only: after a
 * worker restart the stored scan's operationId is authoritative. */
const currentOperation = new Map<number, string>();
/**
 * Pending toolbar capture per tab. Only a newer capture, navigation, tab close or Clear replaces it, and
 * while it is pending, re-analysis and model commits on the old snapshot are refused, so a user's explicit
 * recapture can never be silently cancelled by older work.
 */
const pendingCapture = new Map<number, string>();
let storageLock: Promise<unknown> = Promise.resolve();

/** Serialize list/evict/write across ALL tabs so the 3-tab / 6 MiB bounds hold under concurrency. */
function withStorageLock<T>(task: () => Promise<T>): Promise<T> {
  const next = storageLock.then(task, task);
  storageLock = next.catch(() => undefined);
  return next;
}

const BRIDGE_VERSION = 'bridge/1';

function withTabLock<T>(tabId: number, task: () => Promise<T>): Promise<T> {
  const previous = tabLocks.get(tabId) ?? Promise.resolve();
  const next = previous.then(task, task);
  tabLocks.set(
    tabId,
    next.catch(() => undefined),
  );
  return next;
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/* ----------------------------- storage ----------------------------- */

async function readSettings(): Promise<UserSettings> {
  const stored = await chrome.storage.local.get('settings');
  return coerceSettings(stored.settings);
}

async function writeSettings(settings: UserSettings): Promise<void> {
  await chrome.storage.local.set({ settings });
}

async function readTabScan(tabId: number): Promise<StoredTabScan | null> {
  const key = `${SCAN_PREFIX}${tabId}`;
  const stored = await chrome.storage.session.get(key);
  const value = stored[key];
  return value && typeof value === 'object' ? (value as StoredTabScan) : null;
}

function approximateBytes(value: unknown): number {
  // JSON length is a conservative proxy when getBytesInUse is unavailable for session storage.
  return JSON.stringify(value).length * 2;
}

async function sessionBytes(keys: string[] | null): Promise<number> {
  try {
    return await chrome.storage.session.getBytesInUse(keys);
  } catch {
    const all = await chrome.storage.session.get(keys);
    return approximateBytes(all);
  }
}

async function listScanTabs(): Promise<{ tabId: number; lastUsed: number }[]> {
  const all = await chrome.storage.session.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(SCAN_PREFIX))
    .map(([key, value]) => ({ tabId: Number(key.slice(SCAN_PREFIX.length)), lastUsed: (value as StoredTabScan).lastUsed ?? 0 }));
}

/**
 * Write one tab scan, evicting least-recently-used OTHER tabs (with a recapture tombstone) until at most
 * MAX_TABS scans and SESSION_BUDGET_BYTES are used. A scan that cannot fit alone returns storage_limit.
 * Policy text is never written anywhere except chrome.storage.session.
 */
function commitTabScan(scan: StoredTabScan): Promise<'ok' | 'storage_limit'> {
  return withStorageLock(() => commitTabScanUnlocked(scan));
}

async function commitTabScanUnlocked(scan: StoredTabScan): Promise<'ok' | 'storage_limit'> {
  const key = `${SCAN_PREFIX}${scan.tabId}`;
  const size = approximateBytes({ [key]: scan });
  if (size > SESSION_BUDGET_BYTES) return 'storage_limit';
  const others = (await listScanTabs()).filter((item) => item.tabId !== scan.tabId).sort((a, b) => a.lastUsed - b.lastUsed);
  while (others.length >= MAX_TABS || (others.length > 0 && (await sessionBytes(null)) - (await sessionBytes([key])) + size > SESSION_BUDGET_BYTES)) {
    const victim = others.shift();
    if (!victim) break;
    await evictTab(victim.tabId, 'evicted');
  }
  try {
    await chrome.storage.session.set({ [key]: scan });
    await chrome.storage.session.remove(`${TOMBSTONE_PREFIX}${scan.tabId}`);
  } catch {
    return 'storage_limit';
  }
  return 'ok';
}

async function evictTab(tabId: number, reason: 'evicted' | 'storage_limit'): Promise<void> {
  const scan = await readTabScan(tabId);
  await chrome.storage.session.remove(`${SCAN_PREFIX}${tabId}`);
  await chrome.storage.session.set({ [`${TOMBSTONE_PREFIX}${tabId}`]: { reason, at: Date.now() } });
  if (scan) void releaseBridge(scan).catch(() => undefined);
}

/** Discard all runtime data for a tab (navigation, tab close, Clear). */
/**
 * Invalidate in-memory operations for a tab. Called synchronously at event time (navigation, Clear,
 * close) so a capture started AFTER the event is never cancelled by a queued discard.
 */
function invalidateTab(tabId: number): void {
  currentOperation.delete(tabId);
  pendingCapture.delete(tabId);
}

/** Remove a tab's stored runtime data (scan, tombstone, status). */
async function discardStored(tabId: number): Promise<void> {
  await chrome.storage.session.remove([`${SCAN_PREFIX}${tabId}`, `${TOMBSTONE_PREFIX}${tabId}`, `status:${tabId}`]);
}

async function setStatus(tabId: number, status: TabView['status']): Promise<void> {
  await chrome.storage.session.set({ [`status:${tabId}`]: status });
}

/* ----------------------------- analysis ----------------------------- */

function rulesCandidates(snapshot: DocumentSnapshot, enabled: readonly CategoryId[]): Candidate[] {
  return scanStrict(snapshot.text, enabled).map((candidate) => ({
    ...candidate,
    snapshotRef: { scanId: snapshot.scanId, revision: snapshot.revision },
  }));
}

/** Rules always run; a model run is merged only if it matches this snapshot and these categories. */
function combine(snapshot: DocumentSnapshot, enabled: readonly CategoryId[], operationId: string, model: ModelRun | undefined): ScanResult {
  const ordered = orderedCategories(enabled);
  const modelMatches =
    model &&
    model.scanId === snapshot.scanId &&
    model.revision === snapshot.revision &&
    model.enabledCategoryIds.join('|') === ordered.join('|');
  const coverage: EngineCoverage[] = [fullCoverage('rules', RULES_VERSION, snapshot.text.length)];
  const candidates: Candidate[] = rulesCandidates(snapshot, ordered);
  const extraRejections: Rejection[] = [];
  if (model && modelMatches) {
    coverage.push(model.coverage);
    candidates.push(...model.candidates.map((candidate) => ({ ...candidate, engine: 'on-device' as const })));
    extraRejections.push(...model.extraRejections);
  }
  return analyze({
    snapshot,
    enabledCategoryIds: ordered,
    candidates,
    operationId,
    requestedEngines: model && modelMatches ? ['rules', 'on-device'] : ['rules'],
    coverage,
    extraRejections,
  }).result;
}

/* ----------------------------- capture ----------------------------- */

function supportedUrl(url: string | undefined): { ok: true } | { ok: false; reason: string } {
  if (!url) return { ok: false, reason: 'Chrome did not share this page with the extension. Click the toolbar icon on an http or https page.' };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'This page address could not be read.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https pages can be scanned. Browser pages, files and extension pages are not supported.' };
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'chromewebstore.google.com' || (host === 'chrome.google.com' && parsed.pathname.startsWith('/webstore'))) {
    return { ok: false, reason: 'Chrome does not allow extensions to read the Chrome Web Store.' };
  }
  return { ok: true };
}

interface CapturePayload {
  ok: true;
  protocolVersion: number;
  extractionVersion: string;
  nonce: string;
  revision: number;
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  collapsedSegments: number;
  segments: Segment[];
  sections: Section[];
}

function validInterval(value: unknown, length: number): value is { start: number; end: number } {
  const row = value as { start?: unknown; end?: unknown };
  return (
    !!row &&
    Number.isInteger(row.start) &&
    Number.isInteger(row.end) &&
    (row.start as number) >= 0 &&
    (row.end as number) <= length &&
    (row.start as number) <= (row.end as number)
  );
}

function parseCapture(value: unknown): CapturePayload | null {
  const row = value as Partial<CapturePayload> | undefined;
  if (!row || row.ok !== true || row.protocolVersion !== PROTOCOL_VERSION || row.extractionVersion !== EXTRACTION_VERSION) return null;
  if (typeof row.text !== 'string' || row.text.length > LIMITS.captureCap || typeof row.nonce !== 'string') return null;
  if (!Array.isArray(row.segments) || !Array.isArray(row.sections)) return null;
  const length = row.text.length;
  const segments = row.segments.filter((item): item is Segment => validInterval(item, length) && typeof item.id === 'string');
  const sections = row.sections.filter(
    (item): item is Section => validInterval(item, length) && typeof item.id === 'string' && typeof item.label === 'string',
  );
  if (segments.length !== row.segments.length) return null;
  return {
    ok: true,
    protocolVersion: row.protocolVersion,
    extractionVersion: row.extractionVersion,
    nonce: row.nonce,
    revision: Number.isInteger(row.revision) ? (row.revision as number) : 0,
    url: typeof row.url === 'string' ? row.url : '',
    title: typeof row.title === 'string' ? row.title.slice(0, 300) : '',
    text: row.text,
    truncated: row.truncated === true,
    collapsedSegments: Number.isInteger(row.collapsedSegments) ? (row.collapsedSegments as number) : 0,
    segments: segments.map((item) => ({ id: item.id, start: item.start, end: item.end, virtual: item.virtual === true, collapsed: item.collapsed === true })),
    sections: sections.map((item) => ({ id: item.id, label: item.label.slice(0, 120), start: item.start, end: item.end })),
  };
}

function captureError(error: unknown): { state: 'permission_required' | 'error'; reason: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (/cannot access|permission|not allowed|cannot be scripted|extensions gallery/i.test(message)) {
    return {
      state: 'permission_required',
      reason: 'Chrome did not allow access to this page. Click the toolbar icon again on a normal http or https page.',
    };
  }
  return { state: 'error', reason: 'The page could not be read. Reload it and click the toolbar icon again.' };
}

async function captureTab(tab: chrome.tabs.Tab): Promise<void> {
  const tabId = tab.id;
  if (tabId === undefined) return;
  const operationId = newId('op');
  currentOperation.set(tabId, operationId);
  pendingCapture.set(tabId, operationId);
  const isCurrent = () => pendingCapture.get(tabId) === operationId;
  const finish = () => {
    if (isCurrent()) pendingCapture.delete(tabId);
  };
  const supported = supportedUrl(tab.url);
  await withTabLock(tabId, async () => {
    if (!isCurrent()) return;
    await setStatus(tabId, supported.ok ? { state: 'capturing', operationId } : { state: 'unsupported', reason: supported.reason, operationId });
  });
  if (!supported.ok) {
    finish();
    return;
  }

  let browserDocumentId = 'unknown';
  let payload: CapturePayload | null = null;
  try {
    const injected = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['page-agent.js'] });
    browserDocumentId = injected[0]?.documentId ?? 'unknown';
    const response = await chrome.tabs.sendMessage(
      tabId,
      { channel: CHANNEL, protocolVersion: PROTOCOL_VERSION, type: 'capture', scanId: operationId },
      browserDocumentId !== 'unknown' ? { frameId: 0, documentId: browserDocumentId } : { frameId: 0 },
    );
    payload = parseCapture(response);
    if (!payload) {
      const reason = (response as { reason?: unknown } | undefined)?.reason;
      throw new Error(typeof reason === 'string' ? reason : 'The page bridge returned an unexpected capture.');
    }
  } catch (error) {
    const failure = captureError(error);
    await withTabLock(tabId, async () => {
      if (!isCurrent()) return;
      await setStatus(tabId, { state: failure.state, reason: failure.reason, operationId });
      finish();
    });
    return;
  }

  const capture = payload;
  let textHash: string;
  let settings: UserSettings;
  try {
    textHash = await sha256Hex(capture.text);
    settings = await readSettings();
  } catch {
    await withTabLock(tabId, async () => {
      if (!isCurrent()) return;
      await setStatus(tabId, { state: 'error', reason: 'The capture could not be processed. Click the toolbar icon again.', operationId });
      finish();
    });
    return;
  }
  await withTabLock(tabId, async () => {
    // Re-check identity after every await: a newer click, navigation, tab close or Clear wins.
    if (!isCurrent()) return;
    finish();
    currentOperation.set(tabId, operationId);
    const snapshot: DocumentSnapshot = {
      protocolVersion: PROTOCOL_VERSION,
      extractionVersion: capture.extractionVersion,
      scanId: operationId,
      tabId,
      frameId: 0,
      documentId: `${browserDocumentId}:${capture.nonce}`,
      bridgeNonce: capture.nonce,
      revision: capture.revision,
      url: tab.url ?? capture.url,
      title: tab.title ?? capture.title,
      textHash,
      text: capture.text,
      sections: capture.sections,
      segments: capture.segments,
      coverage: {
        region: 'body',
        exclusions: EXCLUSIONS,
        capturedLength: capture.text.length,
        cap: LIMITS.captureCap,
        truncated: capture.truncated,
        collapsedSegments: capture.collapsedSegments,
      },
      capturedAt: new Date().toISOString(),
    };
    const scan: StoredTabScan = {
      storageVersion: 1,
      tabId,
      windowId: tab.windowId ?? -1,
      browserDocumentId,
      snapshot,
      enabledCategoryIds: settings.enabledCategoryIds,
      operationId,
      result: combine(snapshot, settings.enabledCategoryIds, operationId, undefined),
      liveStale: false,
      lastUsed: Date.now(),
    };
    if (!scan.snapshot.text.trim()) {
      await setStatus(tabId, { state: 'error', reason: 'No eligible text was found in the page body.', operationId });
      return;
    }
    const written = await commitTabScan(scan);
    if (written !== 'ok') {
      // The previous scan is outdated by this explicit recapture: drop it rather than keep showing it.
      await chrome.storage.session.remove(`${SCAN_PREFIX}${tabId}`);
      await setStatus(tabId, { state: 'error', reason: 'storage_limit: this page is too large to keep in session memory.', operationId });
      return;
    }
    await setStatus(tabId, { state: scan.result.state, operationId });
  });
}

function refuseWhileCapturing(tabId: number): void {
  if (pendingCapture.has(tabId)) throw new Error('A new toolbar capture is in progress for this tab. Wait for it to finish.');
}

/* ----------------------------- bridge helpers ----------------------------- */

async function sendToBridge(scan: StoredTabScan, message: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const response = await chrome.tabs.sendMessage(
      scan.tabId,
      { channel: CHANNEL, protocolVersion: PROTOCOL_VERSION, nonce: scan.snapshot.bridgeNonce, ...message },
      scan.browserDocumentId !== 'unknown' ? { frameId: 0, documentId: scan.browserDocumentId } : { frameId: 0 },
    );
    return response && typeof response === 'object' ? (response as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function releaseBridge(scan: StoredTabScan): Promise<void> {
  await sendToBridge(scan, { type: 'release' });
}

/** Revalidate that the stored document still has a live bridge with this scan's node map. */
async function verifyBridge(scan: StoredTabScan): Promise<'live' | 'stale' | 'missing'> {
  const ping = await sendToBridge(scan, { type: 'ping' });
  if (!ping || ping.ok !== true || ping.nonce !== scan.snapshot.bridgeNonce || ping.bridgeVersion !== BRIDGE_VERSION) return 'missing';
  if (!Array.isArray(ping.scanIds) || !ping.scanIds.includes(scan.snapshot.scanId)) return 'missing';
  return ping.stale === true ? 'stale' : 'live';
}

/* ----------------------------- panel commands ----------------------------- */

function catalog() {
  return {
    categories: CATEGORIES.map(({ id, label, summary, reasons }) => ({ id, label, summary, reasons })),
    rulebooks: RULEBOOKS.map(({ id, label, description, categoryIds }) => ({ id, label, description, categoryIds: [...categoryIds] })),
  };
}

async function tabView(tabId: number, verify: boolean): Promise<TabView> {
  const stored = await chrome.storage.session.get([`${SCAN_PREFIX}${tabId}`, `${TOMBSTONE_PREFIX}${tabId}`, `status:${tabId}`]);
  const scan = (stored[`${SCAN_PREFIX}${tabId}`] as StoredTabScan | undefined) ?? null;
  const tombstone = stored[`${TOMBSTONE_PREFIX}${tabId}`] as { reason: string } | undefined;
  const status = stored[`status:${tabId}`] as TabView['status'] | undefined;
  let live: TabView['live'] = 'unknown';
  if (scan && verify) {
    live = scan.liveStale ? 'stale' : await verifyBridge(scan);
    if (live === 'stale' && !scan.liveStale) await markLiveStale(tabId, scan.snapshot.scanId);
  }
  return { tabId, scan, evicted: tombstone ? tombstone.reason : null, status: status ?? null, live };
}

async function markLiveStale(tabId: number, scanId: string): Promise<void> {
  await withTabLock(tabId, async () => {
    const scan = await readTabScan(tabId);
    if (!scan || scan.snapshot.scanId !== scanId || scan.liveStale) return;
    await chrome.storage.session.set({ [`${SCAN_PREFIX}${tabId}`]: { ...scan, liveStale: true } });
  });
}

async function reanalyze(tabId: number, scanId: string, enabledCategoryIds: CategoryId[]): Promise<TabView> {
  const settings = await readSettings();
  await writeSettings({ ...settings, enabledCategoryIds, presetId: coerceSettings({ enabledCategoryIds }).presetId });
  refuseWhileCapturing(tabId);
  const operationId = newId('op');
  currentOperation.set(tabId, operationId);
  await withTabLock(tabId, async () => {
    refuseWhileCapturing(tabId);
    const scan = await readTabScan(tabId);
    if (!scan || scan.snapshot.scanId !== scanId) throw new Error('This scan is gone. Click the toolbar icon to capture again.');
    if (currentOperation.get(tabId) !== operationId) return;
    // Category changes invalidate the previous view and any model completion for other settings.
    const model = scan.model && scan.model.enabledCategoryIds.join('|') === orderedCategories(enabledCategoryIds).join('|') ? scan.model : undefined;
    const next: StoredTabScan = {
      ...scan,
      enabledCategoryIds,
      operationId,
      model,
      result: combine(scan.snapshot, enabledCategoryIds, operationId, model),
      lastUsed: Date.now(),
    };
    const written = await commitTabScan(next);
    if (written !== 'ok') throw new Error('storage_limit: the re-analysed result does not fit in session memory.');
    await setStatus(tabId, { state: next.result.state, operationId });
  });
  return tabView(tabId, false);
}

async function commitModel(tabId: number, run: ModelRun): Promise<TabView> {
  refuseWhileCapturing(tabId);
  const operationAtCall = currentOperation.get(tabId);
  await withTabLock(tabId, async () => {
    refuseWhileCapturing(tabId);
    // A re-analysis (category change) requested after this call wins; never overwrite it.
    if (currentOperation.get(tabId) !== operationAtCall) {
      throw new Error('Settings changed while the local model result was being saved. Its output was discarded.');
    }
    const scan = await readTabScan(tabId);
    if (!scan || scan.snapshot.scanId !== run.scanId || scan.snapshot.revision !== run.revision) {
      throw new Error('The scan changed while the local model was running. Its output was discarded.');
    }
    if (orderedCategories(scan.enabledCategoryIds).join('|') !== run.enabledCategoryIds.join('|')) {
      throw new Error('Categories changed while the local model was running. Its output was discarded.');
    }
    const operationId = newId('op');
    currentOperation.set(tabId, operationId);
    const next: StoredTabScan = {
      ...scan,
      operationId,
      model: run,
      result: combine(scan.snapshot, scan.enabledCategoryIds, operationId, run),
      lastUsed: Date.now(),
    };
    const written = await commitTabScan(next);
    if (written !== 'ok') throw new Error('storage_limit: the model result does not fit in session memory.');
    await setStatus(tabId, { state: next.result.state, operationId });
  });
  return tabView(tabId, false);
}

async function jumpTo(tabId: number, scanId: string, findingId: string, occurrenceId: string): Promise<PanelResponse> {
  const scan = await readTabScan(tabId);
  if (!scan || scan.snapshot.scanId !== scanId) return { ok: false, error: 'This scan is gone. Click the toolbar icon to capture again.' };
  const finding = scan.result.findings.find((item) => item.id === findingId);
  const occurrence = finding?.occurrences.find((item) => item.id === occurrenceId);
  if (!finding || !occurrence) return { ok: false, error: 'That finding is not part of the current result.' };
  if (scan.liveStale) return { ok: false, code: 'stale', error: 'The page changed after capture. Click the toolbar icon to capture again.' };
  const live = await verifyBridge(scan);
  if (live !== 'live') {
    if (live === 'stale') await markLiveStale(tabId, scanId);
    return {
      ok: false,
      code: live,
      error:
        live === 'stale'
          ? 'The page changed after capture. Click the toolbar icon to capture again.'
          : 'The page is no longer connected to this scan. Click the toolbar icon to capture again.',
    };
  }
  const others = scan.result.findings.flatMap((item) => item.occurrences.map(({ start, end }) => ({ start, end })));
  const response = await sendToBridge(scan, {
    type: 'jump',
    scanId,
    start: occurrence.start,
    end: occurrence.end,
    expected: scan.snapshot.text.slice(occurrence.start, occurrence.end),
    others,
  });
  if (!response) return { ok: false, code: 'missing', error: 'The page did not answer. Click the toolbar icon to capture again.' };
  if (response.ok !== true) {
    if (response.code === 'stale') await markLiveStale(tabId, scanId);
    return { ok: false, code: String(response.code ?? 'error'), error: String(response.reason ?? 'Jump failed.') };
  }
  await withTabLock(tabId, async () => {
    const current = await readTabScan(tabId);
    if (current && current.snapshot.scanId === scanId) {
      await chrome.storage.session.set({ [`${SCAN_PREFIX}${tabId}`]: { ...current, lastUsed: Date.now() } });
    }
  });
  return { ok: true, jump: { visible: response.visible === true, openedDetails: Number(response.openedDetails ?? 0), painted: String(response.painted) } };
}

async function clearTab(tabId: number, scanId: string | undefined): Promise<TabView> {
  invalidateTab(tabId);
  await withTabLock(tabId, async () => {
    const scan = await readTabScan(tabId);
    if (scan && (!scanId || scan.snapshot.scanId === scanId)) await releaseBridge(scan);
    await discardStored(tabId);
  });
  return tabView(tabId, false);
}

function fromOwnExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && !sender.tab && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
}

function intArg(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

async function handlePanel(message: Record<string, unknown>): Promise<PanelResponse> {
  const tabId = intArg(message.tabId);
  switch (message.type) {
    case 'bootstrap': {
      return { ok: true, settings: await readSettings(), catalog: catalog(), coreVersion: CORE_VERSION };
    }
    case 'get-tab': {
      if (tabId === null) return { ok: false, error: 'Missing tab.' };
      return { ok: true, view: await tabView(tabId, message.verify === true) };
    }
    case 'reanalyze': {
      if (tabId === null || typeof message.scanId !== 'string' || !Array.isArray(message.enabledCategoryIds)) return { ok: false, error: 'Bad request.' };
      return { ok: true, view: await reanalyze(tabId, message.scanId, orderedCategories(message.enabledCategoryIds.filter(isCategoryId))) };
    }
    case 'set-settings': {
      const settings = coerceSettings({ ...(await readSettings()), ...(message.settings as object) });
      await writeSettings(settings);
      return { ok: true, settings };
    }
    case 'jump': {
      if (tabId === null || typeof message.scanId !== 'string' || typeof message.findingId !== 'string' || typeof message.occurrenceId !== 'string') {
        return { ok: false, error: 'Bad request.' };
      }
      return jumpTo(tabId, message.scanId, message.findingId, message.occurrenceId);
    }
    case 'clear': {
      if (tabId === null) return { ok: false, error: 'Missing tab.' };
      return { ok: true, view: await clearTab(tabId, typeof message.scanId === 'string' ? message.scanId : undefined) };
    }
    case 'commit-model': {
      if (tabId === null || !isModelRun(message.run)) return { ok: false, error: 'Bad model run.' };
      return { ok: true, view: await commitModel(tabId, message.run) };
    }
    default:
      return { ok: false, error: 'Unknown panel command.' };
  }
}

/* ----------------------------- listeners (registered synchronously) ----------------------------- */

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const stored = await chrome.storage.local.get('settings');
    // Coercion drops any historical BYOK fields from the earlier build.
    await chrome.storage.local.set({ settings: stored.settings ? coerceSettings(stored.settings) : defaultSettings() });
  })();
});

chrome.action.onClicked.addListener((tab) => {
  // sidePanel.open must run inside the user gesture, before any await.
  if (tab.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  }
  void captureTab(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object' || (message as { channel?: unknown }).channel !== CHANNEL) return undefined;
  const command = message as Record<string, unknown>;
  if (command.type === 'bridge-stale') {
    // From a content script: must be our extension, a tab, frame 0, and the stored document.
    const tabId = sender.tab?.id;
    if (sender.id !== chrome.runtime.id || tabId === undefined || sender.frameId !== 0) return undefined;
    void (async () => {
      const scan = await readTabScan(tabId);
      if (!scan || command.nonce !== scan.snapshot.bridgeNonce) return;
      if (scan.browserDocumentId !== 'unknown' && sender.documentId && sender.documentId !== scan.browserDocumentId) return;
      await markLiveStale(tabId, scan.snapshot.scanId);
    })();
    return undefined;
  }
  if (!fromOwnExtensionPage(sender)) return undefined;
  handlePanel(command).then(sendResponse, (error: unknown) =>
    sendResponse({ ok: false, error: error instanceof Error ? error.message : 'The extension command failed.' }),
  );
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  invalidateTab(tabId);
  void withTabLock(tabId, () => discardStored(tabId));
});

chrome.tabs.onReplaced.addListener((_addedTabId, removedTabId) => {
  invalidateTab(removedTabId);
  void withTabLock(removedTabId, () => discardStored(removedTabId));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Any navigation (including same-origin and reload) starts with status "loading": discard that tab's
  // scan and invalidate a capture that started on the old document. URLs are not read here.
  if (changeInfo.status !== 'loading') return;
  invalidateTab(tabId);
  void withTabLock(tabId, () => discardStored(tabId));
});
