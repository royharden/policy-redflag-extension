// Deliberately opened developer page (chrome-extension://<id>/extension/eval.html). Runs the SAME shipped
// adapter, prompt, parser, validator and per-item budgets over frozen gold items and lets the user export
// model-run.jsonl with an ordinary file download. Never a scanner: it reads no tabs and stores nothing.
import './sidepanel.css';
import { analyze, CATEGORY_IDS, CORE_VERSION, PARSER_VERSION, PROMPT_VERSION, sha256Hex, type CategoryId } from '../core';
import {
  ADAPTER_VERSION,
  BUDGETS,
  checkAvailability,
  createSession,
  destroySession,
  LocalModelError,
  runInference,
  type ReadySession,
} from '../core/on-device';

/** Shape written by scripts/prepare-gold.ts (see eval/LABELLING.md). */
interface GoldItem {
  id: string;
  groupId: string;
  split: 'dev' | 'held-out';
  text: string;
  textHash: string;
  evaluatedCategories: CategoryId[];
}

const RUN_FORMAT = 'model-run/1';
const app = document.querySelector('#app');
if (!app) throw new Error('Missing root element.');

let manifestText: string | null = null;
let manifestHash: string | null = null;
let items: GoldItem[] = [];
let splitHashes: Record<string, string> = {};
let session: ReadySession | null = null;
let controller: AbortController | null = null;
let records: string[] = [];
let availability: { status: string; raw: string | null } | null = null;

const log = document.createElement('pre');
log.className = 'meta';
const status = document.createElement('p');
status.className = 'status';
const controls = document.createElement('div');
controls.className = 'actions';

function say(line: string) {
  log.textContent = `${log.textContent ?? ''}${line}\n`;
}

function button(label: string, onClick: () => void, secondary = false): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  if (secondary) node.className = 'secondary';
  node.addEventListener('click', onClick);
  return node;
}

function parseJsonl(text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as unknown);
}

function isGoldItem(value: unknown): value is GoldItem {
  const row = value as Partial<GoldItem>;
  return (
    !!row &&
    typeof row.id === 'string' &&
    typeof row.groupId === 'string' &&
    (row.split === 'dev' || row.split === 'held-out') &&
    typeof row.text === 'string' &&
    typeof row.textHash === 'string' &&
    Array.isArray(row.evaluatedCategories)
  );
}

/** Load the frozen manifest and split files bundled under eval-data/ (copied at extension build time). */
async function loadBundled() {
  try {
    const manifestResponse = await fetch('../eval-data/MANIFEST.json');
    if (!manifestResponse.ok) throw new Error('missing');
    manifestText = await manifestResponse.text();
    const manifest = JSON.parse(manifestText) as { splits?: Record<string, { file: string; sha256: string }> };
    const loaded: GoldItem[] = [];
    splitHashes = {};
    for (const [name, entry] of Object.entries(manifest.splits ?? {})) {
      const response = await fetch(`../eval-data/${entry.file}`);
      if (!response.ok) throw new Error(`missing ${entry.file}`);
      const text = await response.text();
      const actual = await sha256Hex(text);
      if (actual !== entry.sha256) throw new Error(`hash mismatch for ${entry.file}; refusing to run`);
      splitHashes[name] = actual;
      for (const row of parseJsonl(text)) {
        if (!isGoldItem(row)) throw new Error(`malformed item in ${entry.file}`);
        if (row.split !== name) throw new Error(`item ${row.id} is labelled ${row.split} but listed under ${name}`);
        if ((await sha256Hex(row.text)) !== row.textHash) throw new Error(`text hash mismatch for ${row.id}`);
        loaded.push(row);
      }
    }
    manifestHash = await sha256Hex(manifestText);
    items = loaded;
    say(`Loaded ${items.length} frozen items (manifest ${manifestHash.slice(0, 12)}…).`);
  } catch (error) {
    items = [];
    manifestText = null;
    say(
      `No frozen gold bundle loaded (${error instanceof Error ? error.message : 'error'}). ` +
        'Run scripts/prepare-gold.ts and rebuild the extension; nothing was measured.',
    );
  }
  render();
}

async function activate() {
  const report = await checkAvailability();
  availability = { status: report.status, raw: report.raw };
  say(`Availability: ${report.status}${report.raw ? ` (browser said "${report.raw}")` : ''}.`);
  if (report.status === 'unsupported_api' || report.status === 'unavailable') {
    await recordUnavailable(report.status);
    return;
  }
  controller = new AbortController();
  render();
  try {
    session = await createSession({
      categoryIds: [...CATEGORY_IDS],
      signal: controller.signal,
      onProgress: (loaded) => {
        status.textContent = `Downloading model: ${Math.round(loaded * 100)}%`;
      },
    });
    say('Local model ready.');
  } catch (error) {
    const code = error instanceof LocalModelError ? error.code : 'create_failed';
    say(`Activation failed: ${code}.`);
    if (code !== 'cancelled') await recordUnavailable(code);
  } finally {
    controller = null;
    render();
  }
}

async function header(selected: GoldItem[], split: string, capabilities: unknown) {
  const manifest = chrome.runtime.getManifest();
  return JSON.stringify({
    recordType: 'header',
    format: RUN_FORMAT,
    manifestHash,
    splitName: split,
    splitHash: splitHashes[split] ?? null,
    itemCount: selected.length,
    versions: { core: CORE_VERSION, prompt: PROMPT_VERSION, parser: PARSER_VERSION, adapter: ADAPTER_VERSION, build: manifest.version },
    browser: navigator.userAgent,
    availability,
    capabilities,
    modelIdentity: 'unknown',
    options: BUDGETS,
    startedAt: new Date().toISOString(),
  });
}

/** Unsupported hardware produces an unavailable status artifact, never zero-prediction rows. */
async function recordUnavailable(code: string) {
  const report = await checkAvailability();
  records = [
    await header([], selectedSplit(), report.capabilities),
    JSON.stringify({ recordType: 'status', status: 'unavailable', failureCode: code, at: new Date().toISOString() }),
  ];
  say('Recorded an unavailable status artifact. Export it to keep the evidence; it contains no predictions.');
  render();
}

function selectedSplit(): string {
  return splitSelect.value;
}

async function start() {
  if (!session) return;
  const split = selectedSplit();
  const selected = items.filter((item) => item.split === split);
  if (!selected.length) {
    say(`No items in split "${split}".`);
    return;
  }
  const ctl = new AbortController();
  controller = ctl;
  records = [await header(selected, split, session.capabilities)];
  render();
  let done = 0;
  try {
    for (const item of selected) {
      if (ctl.signal.aborted) break;
      status.textContent = `Item ${done + 1} of ${selected.length}: ${item.id}`;
      const started = performance.now();
      const outcome = await runInference({ session, text: item.text, scanId: item.id, revision: 0, signal: ctl.signal });
      const { predictions, result } = analyze({
        snapshot: { scanId: item.id, revision: 0, text: item.text, sections: [] },
        enabledCategoryIds: CATEGORY_IDS,
        candidates: outcome.candidates,
        extraRejections: outcome.extraRejections,
        coverage: [outcome.coverage],
        displayLimit: null,
      });
      records.push(
        JSON.stringify({
          recordType: 'item',
          itemId: item.id,
          groupId: item.groupId,
          split: item.split,
          inputHash: item.textHash,
          status: outcome.coverage.state,
          failureCode: outcome.coverage.failureCode ?? null,
          coverage: outcome.coverage,
          chunks: outcome.chunkReports,
          candidates: outcome.candidates,
          validated: predictions.map((finding) => ({
            categoryId: finding.categoryId,
            reasonCodes: finding.reasonCodes,
            occurrences: finding.occurrences.map(({ start, end, matched }) => ({ start, end, matched })),
            expanded: finding.expanded,
            ambiguous: finding.ambiguous,
          })),
          counts: result.counts,
          rejectionCodes: result.rejections.map((item) => item.code),
          ms: Math.round(performance.now() - started),
        }),
      );
      if (outcome.coverage.state !== 'cancelled') done += 1;
    }
  } catch (error) {
    say(`Run stopped by an unexpected error: ${error instanceof Error ? error.message : String(error)}. Records so far are kept; the footer marks the run incomplete.`);
    records.push(JSON.stringify({ recordType: 'error', message: error instanceof Error ? error.message : String(error) }));
  } finally {
    controller = null;
  }
  records.push(JSON.stringify({ recordType: 'footer', completed: done, cancelled: ctl.signal.aborted, finishedAt: new Date().toISOString() }));
  status.textContent = ctl.signal.aborted ? `Cancelled after ${done} item(s).` : `Finished ${done} item(s). Export the run file.`;
  render();
}

function exportRun() {
  if (!records.length) return;
  const blob = new Blob([`${records.join('\n')}\n`], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'model-run.jsonl';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const splitSelect = document.createElement('select');
for (const name of ['dev', 'held-out']) {
  const option = document.createElement('option');
  option.value = name;
  option.textContent = name;
  splitSelect.append(option);
}

function render() {
  controls.replaceChildren();
  const running = controller !== null;
  if (!session) {
    const go = button('Check support and activate local model', () => void activate());
    go.disabled = running;
    controls.append(go);
  } else {
    const go = button('Start run', () => void start());
    go.disabled = running || !items.length;
    controls.append(go);
  }
  if (running) controls.append(button('Cancel', () => controller?.abort(), true));
  const save = button('Export model-run.jsonl', exportRun, true);
  save.disabled = running || !records.length;
  controls.append(save);
}

const heading = document.createElement('h1');
heading.textContent = 'Local model evaluation';
const intro = document.createElement('p');
intro.className = 'meta';
intro.textContent =
  'Developer page. Runs the shipped on-device adapter over the frozen gold items bundled with this build and exports model-run.jsonl for scripts/evaluate.ts. No page or history data is used. Freeze settings before running held-out items, and do not tune on held-out results.';
const splitLabel = document.createElement('label');
splitLabel.textContent = 'Split';
splitLabel.append(splitSelect);
app.append(heading, intro, splitLabel, status, controls, log);

window.addEventListener('pagehide', () => {
  controller?.abort();
  destroySession(session);
});

render();
void loadBundled();
