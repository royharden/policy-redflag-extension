// Side panel: shows the scan for the active tab of THIS window only, settings, Diagnostics and Clear.
// All page/model text is rendered with textContent (never innerHTML).
import './sidepanel.css';
import { orderedCategories, reasonLabel, type CategoryId, type Finding, type Occurrence, type ReasonCode, type ScanResult } from '../core';
import { mountLocalModel, type LocalModelHost } from './local-model';
import { CHANNEL, type CatalogView, type PanelResponse, type StoredTabScan, type TabView } from './protocol';

const app = document.querySelector('#app');
if (!app) throw new Error('The side panel is missing its root element.');

let windowId: number | undefined;
let activeTabId: number | undefined;
let catalog: CatalogView = { categories: [], rulebooks: [] };
let enabled: CategoryId[] = [];
let view: TabView | null = null;
const occurrenceIndex = new Map<string, number>();

const statusLine = el('p', 'status');
const scanArea = el('div', 'scan');
const controls = el('section', 'controls');
const modelArea = el('section', 'model');
const footer = el('section', 'footer');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function send(message: Record<string, unknown>): Promise<PanelResponse> {
  try {
    return ((await chrome.runtime.sendMessage({ channel: CHANNEL, ...message })) as PanelResponse) ?? { ok: false, error: 'No response.' };
  } catch {
    return { ok: false, error: 'The extension worker did not answer. Try again.' };
  }
}

/* ----------------------------- labels ----------------------------- */

const STATE_TEXT: Record<string, string> = {
  idle: 'Click the toolbar icon on a Terms or Privacy page to capture it.',
  capturing: 'Capturing the page…',
  ready: 'Captured.',
  analyzing: 'Checking the captured text…',
  complete: 'All captured text checked by the rules.',
  partial: 'Partial result: see coverage and the display limit below.',
  no_categories: 'No categories selected. Nothing was checked — this is not a safety result.',
  unsupported: 'This page cannot be scanned.',
  permission_required: 'Chrome did not allow access to this page. Click the toolbar icon again.',
  downloading: 'Downloading the local model…',
  cancelled: 'Cancelled.',
  stale: 'The page changed after capture.',
  error: 'Something went wrong.',
};

function provenanceLabel(finding: Finding): string {
  const names = finding.provenance.map((item) =>
    item.engine === 'rules' ? 'Rules' : item.engine === 'recorded' ? 'Recorded' : item.engine === 'on-device' ? 'On-device model' : 'Keyword baseline',
  );
  return [...new Set(names)].join(' + ');
}

function categoryLabel(id: CategoryId): string {
  return catalog.categories.find((item) => item.id === id)?.label ?? id;
}

/* ----------------------------- rendering ----------------------------- */

function renderControls() {
  controls.replaceChildren();
  const heading = el('h2', undefined, 'Rulebook');
  const select = el('select');
  const presetId = presetFor(enabled);
  for (const book of catalog.rulebooks) {
    const option = el('option', undefined, book.label);
    option.value = book.id;
    select.append(option);
  }
  const custom = el('option', undefined, 'Custom');
  custom.value = 'custom';
  select.append(custom);
  select.value = presetId;
  select.addEventListener('change', () => {
    const book = catalog.rulebooks.find((item) => item.id === select.value);
    if (book) void applyCategories([...book.categoryIds]);
  });
  const checks = el('div', 'checks');
  for (const category of catalog.categories) {
    const label = el('label', 'check');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = enabled.includes(category.id);
    box.addEventListener('change', () => {
      const next = box.checked ? [...enabled, category.id] : enabled.filter((id) => id !== category.id);
      void applyCategories(next);
    });
    label.append(box, document.createTextNode(` ${category.label}`));
    checks.append(label);
  }
  controls.append(heading, select, checks);
}

function presetFor(ids: readonly CategoryId[]): string {
  const key = orderedCategories(ids).join('|');
  return catalog.rulebooks.find((book) => orderedCategories(book.categoryIds).join('|') === key)?.id ?? 'custom';
}

async function applyCategories(next: CategoryId[]) {
  enabled = orderedCategories(next);
  renderControls();
  await send({ type: 'set-settings', settings: { enabledCategoryIds: enabled } });
  const scan = view?.scan;
  if (scan && activeTabId !== undefined) {
    const response = await send({ type: 'reanalyze', tabId: activeTabId, scanId: scan.snapshot.scanId, enabledCategoryIds: enabled });
    if (response.ok && response.view) setView(response.view);
    else statusLine.textContent = response.error ?? 'The rulebook could not be applied.';
  }
}

function renderQuote(finding: Finding, occurrence: Occurrence, text: string): HTMLElement {
  const wrapper = el('div', 'evidence');
  const quote = el('blockquote');
  const slice = text.slice(occurrence.start, occurrence.end);
  if (finding.expanded && (occurrence.matched.start !== occurrence.start || occurrence.matched.end !== occurrence.end)) {
    const from = occurrence.matched.start - occurrence.start;
    const to = occurrence.matched.end - occurrence.start;
    quote.append(document.createTextNode(slice.slice(0, from)), el('mark', undefined, slice.slice(from, to)), document.createTextNode(slice.slice(to)));
  } else {
    quote.textContent = slice;
  }
  wrapper.append(quote);
  if (slice.length > 320) {
    // Visual collapse only; the full stored quote is in the DOM.
    quote.classList.add('clamped');
    const toggle = el('button', 'link', 'Expand');
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      const clamped = quote.classList.toggle('clamped');
      toggle.textContent = clamped ? 'Expand' : 'Collapse';
    });
    wrapper.append(toggle);
  }
  return wrapper;
}

function renderFinding(scan: StoredTabScan, finding: Finding): HTMLElement {
  const card = el('article', 'finding');
  const index = Math.min(occurrenceIndex.get(finding.id) ?? 0, finding.occurrences.length - 1);
  const occurrence = finding.occurrences[index] as Occurrence;
  const title = el('h3', undefined, categoryLabel(finding.categoryId));
  const reasons = el('p', 'reasons', finding.reasonCodes.map((code) => reasonLabel(code as ReasonCode)).join(' · '));
  const badge = el('p', 'badge', 'Quote verified — category not verified.');
  const meta = el(
    'p',
    'meta',
    [finding.sectionLabel ? `Section: ${finding.sectionLabel}` : 'No section heading', provenanceLabel(finding)].join(' · '),
  );
  card.append(title, reasons, badge, renderQuote(finding, occurrence, scan.snapshot.text), el('p', 'explanation', finding.explanation), meta);
  if (finding.expanded) card.append(el('p', 'note', 'A shorter quote was expanded to its full sentence; the matched words are marked.'));
  if (finding.overlapping > 0) card.append(el('p', 'note', `${finding.overlapping} overlapping prediction(s) of this category are folded into this card.`));
  const actions = el('div', 'actions');
  const jump = el('button', 'secondary', 'Jump to quote');
  jump.type = 'button';
  jump.disabled = view?.live === 'stale' || scan.liveStale;
  jump.addEventListener('click', () => void doJump(scan, finding, occurrence));
  actions.append(jump);
  if (finding.ambiguous) {
    const counter = el('span', 'meta', `Occurrence ${index + 1} of ${finding.occurrences.length} (the same quote appears more than once)`);
    const next = el('button', 'link', 'Next occurrence');
    next.type = 'button';
    next.addEventListener('click', () => {
      occurrenceIndex.set(finding.id, (index + 1) % finding.occurrences.length);
      render();
    });
    actions.append(counter, next);
  }
  card.append(actions);
  return card;
}

async function doJump(scan: StoredTabScan, finding: Finding, occurrence: Occurrence) {
  if (activeTabId !== scan.tabId) {
    statusLine.textContent = 'This scan belongs to another tab.';
    return;
  }
  statusLine.textContent = 'Jumping…';
  const response = await send({ type: 'jump', tabId: scan.tabId, scanId: scan.snapshot.scanId, findingId: finding.id, occurrenceId: occurrence.id });
  if (response.ok && response.jump) {
    statusLine.textContent = response.jump.visible
      ? `Highlighted on the page${response.jump.openedDetails ? ' (a collapsed section was opened)' : ''}.`
      : 'Scrolled to the quote, but it may not be visible on screen.';
  } else {
    statusLine.textContent = response.error ?? 'Jump failed. Click the toolbar icon to capture again.';
  }
}

function renderCoverage(result: ScanResult, scan: StoredTabScan): HTMLElement {
  const block = el('section', 'coverage');
  block.append(el('h2', undefined, 'Coverage'));
  const capture = scan.snapshot.coverage;
  block.append(el('p', undefined, 'Captured region: page body, listed exclusions.'));
  const list = el('ul', 'meta');
  for (const item of capture.exclusions) list.append(el('li', undefined, `Excluded: ${item}`));
  block.append(list);
  block.append(
    el(
      'p',
      capture.truncated ? 'warning' : 'meta',
      capture.truncated
        ? `Capture stopped at the ${capture.cap.toLocaleString()}-character cap. Later page text was not captured; its length is unknown.`
        : `${capture.capturedLength.toLocaleString()} characters captured.`,
    ),
  );
  if (capture.collapsedSegments > 0) {
    block.append(el('p', 'meta', `${capture.collapsedSegments} text segment(s) came from closed sections; Jump opens them.`));
  }
  const table = el('table');
  const head = el('tr');
  for (const label of ['Engine', 'State', 'Processed', 'Skipped', 'Failed']) head.append(el('th', undefined, label));
  table.append(head);
  for (const item of result.coverage) {
    const row = el('tr');
    const units = (spans: { start: number; end: number }[]) => spans.reduce((sum, span) => sum + span.end - span.start, 0).toLocaleString();
    for (const value of [item.engine, item.failureCode ? `${item.state} (${item.failureCode})` : item.state, units(item.processed), units(item.skipped), units(item.failed)]) {
      row.append(el('td', undefined, value));
    }
    table.append(row);
  }
  block.append(table);
  return block;
}

function renderDiagnostics(result: ScanResult): HTMLElement {
  const details = el('details', 'diagnostics');
  details.append(el('summary', undefined, `Diagnostics (${result.rejections.length} rejected)`));
  const { counts } = result;
  details.append(
    el(
      'p',
      'meta',
      `Candidates ${counts.candidates} · accepted ${counts.accepted} · rejected ${counts.rejected} · expanded ${counts.expanded} · ambiguous ${counts.ambiguous} · shown ${counts.displayed}`,
    ),
  );
  const list = el('ul');
  for (const rejection of result.rejections.slice(0, 50)) {
    const line = el('li');
    line.append(el('code', undefined, rejection.code), document.createTextNode(` ${rejection.engine}: `), el('span', 'preview', rejection.preview || '(empty)'));
    if (rejection.detail) line.append(el('span', 'meta', ` — ${rejection.detail}`));
    list.append(line);
  }
  if (result.rejections.length > 50) list.append(el('li', 'meta', `${result.rejections.length - 50} more not shown.`));
  details.append(list);
  return details;
}

function renderScan() {
  scanArea.replaceChildren();
  if (!view) return;
  const scan = view.scan;
  if (!scan) {
    if (view.evicted) statusLine.textContent = 'This tab’s earlier scan was removed to save memory. Click the toolbar icon to capture again.';
    else if (view.status?.state === 'capturing') statusLine.textContent = STATE_TEXT.capturing;
    else if (view.status?.reason) statusLine.textContent = view.status.reason;
    else statusLine.textContent = STATE_TEXT.idle;
    return;
  }
  const result = scan.result;
  statusLine.textContent = STATE_TEXT[result.state] ?? result.state;
  // A newer toolbar action (capturing, failed, unsupported, storage_limit) is shown above the older scan.
  const newer = view.status && view.status.operationId !== scan.operationId ? view.status : null;
  if (newer && newer.state !== result.state) {
    statusLine.textContent = newer.reason ?? STATE_TEXT[newer.state] ?? newer.state;
    if (newer.state !== 'capturing') scanArea.append(el('p', 'warning', 'The latest toolbar capture did not finish. The results below are from the previous capture.'));
  }
  const where = el('p', 'meta', `${scan.snapshot.title || 'Untitled page'} — ${scan.snapshot.url}`);
  const when = el('p', 'meta', `Captured ${new Date(scan.snapshot.capturedAt).toLocaleString()}.`);
  scanArea.append(where, when);
  if (scan.liveStale || view.live === 'stale') {
    scanArea.append(el('p', 'warning', 'The live page changed after capture. These findings remain valid for the captured snapshot only. Click the toolbar icon to capture again.'));
  } else if (view.live === 'missing') {
    scanArea.append(el('p', 'warning', 'This page is no longer connected to the scan (reloaded or the extension restarted). Results are from the saved snapshot; click the toolbar icon before using Jump.'));
  }
  if (result.state === 'no_categories') {
    scanArea.append(el('p', 'warning', STATE_TEXT.no_categories));
  } else {
    if (result.findingLimitReached) {
      scanArea.append(el('p', 'warning', `Display limit reached: showing the first ${result.findings.length} findings. Coverage below is still accurate.`));
    }
    if (result.findings.length === 0) {
      scanArea.append(el('p', undefined, 'No findings for the selected categories. This does not mean the terms are safe.'));
    }
    for (const finding of result.findings) scanArea.append(renderFinding(scan, finding));
  }
  scanArea.append(renderCoverage(result, scan), renderDiagnostics(result));
}

function renderFooter() {
  footer.replaceChildren();
  footer.append(
    el(
      'p',
      'meta',
      'This scan stays in browser session memory (not on disk) until you Clear it, navigate or close the tab, or restart the browser or extension. Closing this panel keeps it.',
    ),
  );
  if (view?.scan) {
    const clear = el('button', 'secondary', 'Clear');
    clear.type = 'button';
    clear.addEventListener('click', () => {
      void (async () => {
        if (activeTabId === undefined) return;
        const response = await send({ type: 'clear', tabId: activeTabId, scanId: view?.scan?.snapshot.scanId });
        if (response.ok && response.view) setView(response.view);
        statusLine.textContent = 'Cleared. Click the toolbar icon to capture again.';
      })();
    });
    footer.append(clear);
  }
}

function render() {
  renderControls();
  renderScan();
  renderFooter();
  modelHost.refresh();
}

function setView(next: TabView) {
  if (next.tabId !== activeTabId) return;
  const sameScan = view?.scan?.snapshot.scanId === next.scan?.snapshot.scanId;
  if (!sameScan) occurrenceIndex.clear();
  // An unverified refresh keeps the last verified bridge state for the same scan.
  if (sameScan && next.live === 'unknown' && view) next = { ...next, live: view.live };
  view = next;
  render();
}

async function loadTab(tabId: number | undefined, verify: boolean, reset = true) {
  activeTabId = tabId;
  if (reset) {
    view = null;
    occurrenceIndex.clear();
  }
  if (tabId === undefined) {
    render();
    return;
  }
  const response = await send({ type: 'get-tab', tabId, verify });
  if (response.ok && response.view) setView(response.view);
  else statusLine.textContent = response.error ?? STATE_TEXT.idle;
}

/* ----------------------------- local model host ----------------------------- */

const modelHost: LocalModelHost & { refresh(): void } = (() => {
  const host = mountLocalModel(modelArea, {
    currentScan: () => (view?.scan && view.scan.tabId === activeTabId ? view.scan : null),
    enabledCategories: () => enabled,
    commit: async (run) => {
      if (activeTabId === undefined) return { ok: false, error: 'No tab.' };
      const response = await send({ type: 'commit-model', tabId: activeTabId, run });
      if (response.ok && response.view) setView(response.view);
      return response;
    },
    saveOptIn: async (value) => {
      await send({ type: 'set-settings', settings: { localModelEnabled: value } });
    },
  });
  return host;
})();

/* ----------------------------- startup ----------------------------- */

app.append(
  el('h1', undefined, 'Policy Red Flag'),
  el('p', 'meta', 'Click the toolbar icon on a Terms or Privacy page to capture it. Controls here re-check the saved snapshot; they cannot grant access to another page.'),
  statusLine,
  controls,
  scanArea,
  modelArea,
  footer,
);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'session' || activeTabId === undefined) return;
  const keys = [`scan:${activeTabId}`, `status:${activeTabId}`, `evicted:${activeTabId}`];
  if (keys.some((key) => key in changes)) void loadTab(activeTabId, false, false);
});

chrome.tabs.onActivated.addListener((info) => {
  if (info.windowId !== windowId) return;
  void loadTab(info.tabId, true);
});

void (async () => {
  const boot = await send({ type: 'bootstrap' });
  catalog = boot.catalog ?? catalog;
  enabled = orderedCategories(boot.settings?.enabledCategoryIds ?? []);
  modelHost.setOptIn(boot.settings?.localModelEnabled === true);
  const current = await chrome.windows.getCurrent();
  windowId = current.id;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  // Reopening the panel revalidates the bridge before Jump is offered.
  await loadTab(tab?.id, true);
})();
