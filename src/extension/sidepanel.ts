import './sidepanel.css';

const CHANNEL = 'policy-redflag';

interface CategoryInfo {
  id: string;
  label: string;
  summary: string;
}

interface RulebookInfo {
  id: string;
  label: string;
  description: string;
  categoryIds: string[];
}

interface FlagView {
  categoryId: string;
  quote: string;
  start: number;
  end: number;
  matchCount: number;
  severity: string;
  note: string;
  source: string;
}

interface ResultView {
  flags: FlagView[];
  dropped: { categoryId: string; quote: string; reason: string; source: string }[];
  grade: { score: number; letter: string; categoriesFlagged: string[] };
}

interface ScanView {
  tabId: number;
  href: string;
  title: string;
  text: string;
  truncated: boolean;
  error?: string;
  highlightError?: string;
  baseline: ResultView;
  modelResult?: ResultView;
  modelError?: string;
  enabledCategoryIds: string[];
  rulebookId: string;
}

interface SettingsView {
  rulebookId: string;
  enabledCategoryIds: string[];
  model: { mode: string; endpoint: string; model: string; apiKey: string };
}

interface Bootstrap {
  ok: boolean;
  error?: string;
  settings?: SettingsView;
  scan?: ScanView | null;
  categories?: CategoryInfo[];
  rulebooks?: RulebookInfo[];
}

const app = document.querySelector('#app');
if (!app) throw new Error('The side panel is missing its root element.');

const status = document.createElement('p');
status.className = 'note';
const rulebookSelect = document.createElement('select');
const checks = document.createElement('div');
const results = document.createElement('div');
const endpointInput = document.createElement('input');
const modelInput = document.createElement('input');
const keyInput = document.createElement('input');
const modeSelect = document.createElement('select');
keyInput.type = 'password';
keyInput.autocomplete = 'off';
endpointInput.autocomplete = 'off';
modelInput.autocomplete = 'off';

let categories: CategoryInfo[] = [];
let rulebooks: RulebookInfo[] = [];
let enabled = new Set<string>();
let scan: ScanView | null = null;

function addOption(select: HTMLSelectElement, value: string, label: string) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function matchingBook(ids: readonly string[]): string {
  const key = [...ids].sort().join('|');
  for (const book of rulebooks) {
    if ([...book.categoryIds].sort().join('|') === key) return book.id;
  }
  return 'custom';
}

function selectedIds(): string[] {
  return categories.map((category) => category.id).filter((id) => enabled.has(id));
}

async function send(message: Record<string, unknown>): Promise<Bootstrap & { scan?: ScanView }> {
  return (await chrome.runtime.sendMessage({ channel: CHANNEL, ...message })) as Bootstrap & { scan?: ScanView };
}

function persistSettings() {
  const ids = selectedIds();
  return chrome.storage.local.set({
    settings: {
      rulebookId: matchingBook(ids),
      enabledCategoryIds: ids,
      model: {
        mode: modeSelect.value,
        endpoint: endpointInput.value,
        model: modelInput.value,
        apiKey: keyInput.value,
      },
    },
  });
}

function renderChecks() {
  checks.replaceChildren();
  for (const category of categories) {
    const label = document.createElement('label');
    label.className = 'check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = enabled.has(category.id);
    box.addEventListener('change', () => {
      if (box.checked) enabled.add(category.id);
      else enabled.delete(category.id);
      rulebookSelect.value = matchingBook(selectedIds());
      void (async () => {
        await persistSettings();
        if (!scan?.text) return;
        const response = await send({
          type: 'reanalyze',
          enabledCategoryIds: selectedIds(),
          rulebookId: rulebookSelect.value,
        });
        if (response.ok && response.scan) renderScan(response.scan);
        else status.textContent = response.error || 'The rulebook could not be applied.';
      })();
    });
    label.append(box, document.createTextNode(` ${category.label}`));
    checks.append(label);
  }
}

function renderResult(heading: string, result: ResultView) {
  const block = document.createElement('section');
  const title = document.createElement('h2');
  title.textContent = heading;
  const grade = document.createElement('p');
  grade.className = 'grade';
  grade.textContent = `${result.grade.letter} ${result.grade.score}/100`;
  block.append(title, grade);
  if (result.flags.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No kept flags for the selected categories.';
    block.append(empty);
  }
  for (const flag of result.flags) {
    const article = document.createElement('article');
    const name = document.createElement('h3');
    const category = categories.find((item) => item.id === flag.categoryId);
    name.textContent = `${category?.label || flag.categoryId} · ${flag.severity}`;
    const quote = document.createElement('blockquote');
    quote.textContent = flag.quote;
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `Characters ${flag.start}–${flag.end}. ${flag.matchCount} match(es). ${flag.source}.`;
    const note = document.createElement('p');
    note.textContent = flag.note;
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'secondary';
    jump.textContent = 'Jump to quote';
    jump.addEventListener('click', () => {
      if (!scan) return;
      void (async () => {
        try {
          const response = (await chrome.tabs.sendMessage(scan.tabId, {
            channel: CHANNEL,
            type: 'highlight',
            scroll: true,
            ranges: [{ start: flag.start, end: flag.end }],
          })) as { ok?: boolean; reason?: string } | undefined;
          status.textContent = response?.ok
            ? 'Highlighted on the page.'
            : response?.reason || 'Jump failed. Click the toolbar icon on that page again.';
        } catch {
          status.textContent = 'Jump failed. Click the toolbar icon on that page again. The quote is still listed here.';
        }
      })();
    });
    article.append(name, quote, meta, note, jump);
    block.append(article);
  }
  if (result.dropped.length > 0) {
    const dropped = document.createElement('h3');
    dropped.textContent = 'Dropped';
    const list = document.createElement('ul');
    for (const item of result.dropped) {
      const line = document.createElement('li');
      line.textContent = `${item.reason}: ${item.quote.trim() || '(empty quote)'}`;
      list.append(line);
    }
    block.append(dropped, list);
  }
  return block;
}

function renderScan(next: ScanView | null) {
  scan = next;
  results.replaceChildren();
  if (!next) {
    status.textContent = 'Click the toolbar icon to read the current page.';
    return;
  }
  if (next.error) {
    status.textContent = next.error;
    return;
  }
  const where = document.createElement('p');
  where.className = 'meta';
  where.textContent = next.title ? `${next.title} — ${next.href}` : next.href || 'Last scan';
  results.append(where);
  if (next.truncated) {
    const cap = document.createElement('p');
    cap.className = 'note';
    cap.textContent = 'The page text was capped at 200,000 characters.';
    results.append(cap);
  }
  if (next.highlightError) {
    const highlight = document.createElement('p');
    highlight.className = 'note';
    highlight.textContent = next.highlightError;
    results.append(highlight);
  }
  results.append(renderResult('Baseline', next.baseline));
  if (next.modelError) {
    const error = document.createElement('p');
    error.className = 'error';
    error.textContent = next.modelError;
    results.append(error);
  }
  if (next.modelResult) results.append(renderResult('Model quotes that matched', next.modelResult));
  status.textContent = 'Scan stored for this page. Click the toolbar icon to read a different page.';
}

function applySettings(settings: SettingsView | undefined) {
  enabled = new Set(settings?.enabledCategoryIds || categories.map((category) => category.id));
  const book = matchingBook([...enabled]);
  rulebookSelect.value = book === 'custom' ? 'custom' : settings?.rulebookId || book;
  if (![...rulebookSelect.options].some((option) => option.value === rulebookSelect.value)) {
    rulebookSelect.value = 'custom';
  }
  endpointInput.value = settings?.model.endpoint || '';
  modelInput.value = settings?.model.model || '';
  keyInput.value = settings?.model.apiKey || '';
  modeSelect.value = settings?.model.mode || 'off';
  renderChecks();
}

rulebookSelect.addEventListener('change', () => {
  const book = rulebooks.find((item) => item.id === rulebookSelect.value);
  if (!book) return;
  enabled = new Set(book.categoryIds);
  renderChecks();
  void (async () => {
    await persistSettings();
    if (!scan?.text) return;
    const response = await send({ type: 'reanalyze', enabledCategoryIds: selectedIds(), rulebookId: book.id });
    if (response.ok && response.scan) renderScan(response.scan);
    else status.textContent = response.error || 'The rulebook could not be applied.';
  })();
});

const runButton = document.createElement('button');
runButton.type = 'button';
runButton.textContent = 'Run model on last page';
runButton.addEventListener('click', () => {
  if (modeSelect.value === 'off') {
    status.textContent = 'Choose an on-device or hosted model. The baseline does not need one.';
    return;
  }
  if (modeSelect.value === 'https') {
    let pattern = '';
    try {
      const url = new URL(endpointInput.value);
      pattern = `${url.protocol}//${url.host}/*`;
    } catch {
      status.textContent = 'Model endpoint must be a full URL. No flags were invented.';
      return;
    }
    const requested = chrome.permissions.request({ origins: [pattern] });
    void (async () => {
      const granted = await requested;
      if (!granted) {
        status.textContent = 'Chrome did not grant that model host. No flags were invented.';
        return;
      }
      await runModel();
    })();
    return;
  }
  void runModel();
});

async function runModel() {
  await persistSettings();
  status.textContent = 'Asking the model. Unmatched quotes will be dropped.';
  const response = await send({
    type: 'run-model',
    mode: modeSelect.value,
    endpoint: endpointInput.value,
    model: modelInput.value,
    apiKey: keyInput.value,
    enabledCategoryIds: selectedIds(),
  });
  if (response.scan) renderScan(response.scan);
  if (!response.ok) status.textContent = response.error || 'The model request failed. No flags were invented.';
}

const heading = document.createElement('h1');
heading.textContent = 'Policy Red Flag';
const hint = document.createElement('p');
hint.textContent = 'Click the toolbar icon to read the page you are on. A button here cannot grant that access.';
const rulebookLabel = document.createElement('label');
rulebookLabel.textContent = 'Rulebook';
rulebookLabel.append(rulebookSelect);
const modeLabel = document.createElement('label');
modeLabel.textContent = 'Model';
for (const [value, label] of [
  ['off', 'Baseline only'],
  ['on-device', 'On-device LanguageModel'],
  ['https', 'Hosted HTTPS endpoint'],
] as const) {
  addOption(modeSelect, value, label);
}
modeLabel.append(modeSelect);
const endpointLabel = document.createElement('label');
endpointLabel.textContent = 'Chat-completions URL';
endpointLabel.append(endpointInput);
const modelLabel = document.createElement('label');
modelLabel.textContent = 'Model name';
modelLabel.append(modelInput);
const keyLabel = document.createElement('label');
keyLabel.textContent = 'API key';
keyLabel.append(keyInput);
const actions = document.createElement('div');
actions.className = 'actions';
actions.append(runButton);

app.append(
  heading,
  hint,
  status,
  rulebookLabel,
  checks,
  results,
  modeLabel,
  endpointLabel,
  modelLabel,
  keyLabel,
  actions,
);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'session' || !changes.scan) return;
  const next = changes.scan.newValue;
  if (next && typeof next === 'object') renderScan(next as ScanView);
});

void (async () => {
  const response = await send({ type: 'bootstrap' });
  categories = response.categories || [];
  rulebooks = response.rulebooks || [];
  addOption(rulebookSelect, 'custom', 'Custom');
  for (const book of rulebooks) addOption(rulebookSelect, book.id, book.label);
  applySettings(response.settings);
  renderScan(response.scan || null);
})();
