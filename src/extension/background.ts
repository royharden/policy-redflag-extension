import {
  analyze,
  analyzeBaseline,
  buildExtractionPrompt,
  CATEGORIES,
  completeChat,
  completeOnDevice,
  defaultSettings,
  isCategoryId,
  ModelRequestError,
  parseModelFlags,
  RULEBOOKS,
  type AnalyzeResult,
  type CategoryId,
  type UserSettings,
} from '../core';

const CHANNEL = 'policy-redflag';

interface ResultView {
  flags: AnalyzeResult['flags'];
  dropped: AnalyzeResult['dropped'];
  grade: AnalyzeResult['grade'];
}

interface StoredScan {
  tabId: number;
  href: string;
  title: string;
  text: string;
  truncated: boolean;
  scannedAt: string;
  error?: string;
  highlightError?: string;
  baseline: ResultView;
  modelResult?: ResultView;
  modelError?: string;
  enabledCategoryIds: CategoryId[];
  rulebookId: string;
}

interface ExtractResult {
  ok?: boolean;
  reason?: string;
  href?: string;
  title?: string;
  text?: string;
  truncated?: boolean;
}

function describeCatalog() {
  return {
    categories: CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label,
      summary: category.summary,
    })),
    rulebooks: RULEBOOKS.map((book) => ({
      id: book.id,
      label: book.label,
      description: book.description,
      categoryIds: [...book.categoryIds],
    })),
  };
}

function coerceSettings(value: unknown): UserSettings {
  const base = defaultSettings();
  if (!value || typeof value !== 'object') return base;
  const row = value as Partial<UserSettings>;
  const enabled = Array.isArray(row.enabledCategoryIds) ? row.enabledCategoryIds.filter(isCategoryId) : base.enabledCategoryIds;
  const model = row.model ?? base.model;
  return {
    rulebookId: typeof row.rulebookId === 'string' ? row.rulebookId : base.rulebookId,
    enabledCategoryIds: enabled,
    model: {
      mode: model.mode === 'on-device' || model.mode === 'https' ? model.mode : 'off',
      endpoint: typeof model.endpoint === 'string' ? model.endpoint : '',
      model: typeof model.model === 'string' ? model.model : '',
      apiKey: typeof model.apiKey === 'string' ? model.apiKey : '',
    },
  };
}

async function readSettings(): Promise<UserSettings> {
  const stored = await chrome.storage.local.get('settings');
  return coerceSettings(stored.settings);
}

function blankResult(): ResultView {
  return { flags: [], dropped: [], grade: { score: 100, letter: 'A', categoriesFlagged: [] } };
}

async function writeScan(scan: StoredScan): Promise<void> {
  await chrome.storage.session.set({ scan });
}

async function readScan(): Promise<StoredScan | null> {
  const stored = await chrome.storage.session.get('scan');
  const scan = stored.scan;
  if (!scan || typeof scan !== 'object') return null;
  return scan as StoredScan;
}

async function paint(tabId: number, flags: ResultView['flags']): Promise<string | undefined> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      channel: CHANNEL,
      type: 'highlight',
      scroll: false,
      ranges: flags.map((flag) => ({ start: flag.start, end: flag.end })),
    })) as { ok?: boolean; reason?: string } | undefined;
    if (response && response.ok === false) {
      return response.reason || 'The page could not highlight those offsets.';
    }
    return undefined;
  } catch {
    return 'The page highlight did not answer. The flags still use the extracted text.';
  }
}

async function scanTab(tabId: number): Promise<void> {
  const settings = await readSettings();
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['page-agent.js'] });
    const extracted = (await chrome.tabs.sendMessage(tabId, { channel: CHANNEL, type: 'extract' })) as ExtractResult;
    if (!extracted?.ok || typeof extracted.text !== 'string') {
      await writeScan(errorScan(tabId, settings, extracted?.reason || 'The page did not return text.'));
      return;
    }
    if (!extracted.text.trim()) {
      await writeScan(errorScan(tabId, settings, 'No text was found in this page.'));
      return;
    }
    const baseline = analyzeBaseline(extracted.text, settings.enabledCategoryIds);
    const scan: StoredScan = {
      tabId,
      href: extracted.href || '',
      title: extracted.title || '',
      text: extracted.text,
      truncated: Boolean(extracted.truncated),
      scannedAt: new Date().toISOString(),
      baseline,
      enabledCategoryIds: settings.enabledCategoryIds,
      rulebookId: settings.rulebookId,
    };
    scan.highlightError = await paint(tabId, baseline.flags);
    await writeScan(scan);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'The page could not be read.';
    await writeScan(
      errorScan(
        tabId,
        settings,
        `${detail} Chrome blocks scripting on browser pages and the Chrome Web Store. Open an http or https page and click the icon again.`,
      ),
    );
  }
}

function errorScan(tabId: number, settings: UserSettings, error: string): StoredScan {
  return {
    tabId,
    href: '',
    title: '',
    text: '',
    truncated: false,
    scannedAt: new Date().toISOString(),
    error,
    baseline: blankResult(),
    enabledCategoryIds: settings.enabledCategoryIds,
    rulebookId: settings.rulebookId,
  };
}

async function reanalyze(enabledCategoryIds: CategoryId[], rulebookId: string): Promise<StoredScan> {
  const settings = await readSettings();
  await chrome.storage.local.set({
    settings: { ...settings, enabledCategoryIds, rulebookId },
  });
  const current = await readScan();
  if (!current || current.error || !current.text) {
    throw new Error('Click the toolbar icon to read a page before changing the rulebook.');
  }
  const baseline = analyzeBaseline(current.text, enabledCategoryIds);
  const next: StoredScan = {
    ...current,
    baseline,
    enabledCategoryIds,
    rulebookId,
    modelResult: undefined,
    modelError: undefined,
    highlightError: await paint(current.tabId, baseline.flags),
  };
  await writeScan(next);
  return next;
}

async function runModel(body: {
  mode?: string;
  endpoint?: string;
  model?: string;
  apiKey?: string;
  enabledCategoryIds?: unknown;
}): Promise<StoredScan> {
  const current = await readScan();
  if (!current || current.error || !current.text) {
    throw new Error('Click the toolbar icon to read a page before running a model.');
  }
  const enabled = Array.isArray(body.enabledCategoryIds)
    ? body.enabledCategoryIds.filter(isCategoryId)
    : current.enabledCategoryIds;
  const prompt = buildExtractionPrompt(current.text, enabled);
  try {
    const raw =
      body.mode === 'on-device'
        ? await completeOnDevice(prompt)
        : await completeChat({
            endpoint: body.endpoint || '',
            apiKey: body.apiKey || '',
            model: body.model || '',
          });
    const parsed = parseModelFlags(raw, 'model');
    if (parsed.error) throw new ModelRequestError(parsed.error);
    const modelResult = analyze({ text: current.text, enabledCategoryIds: enabled, candidates: parsed.candidates });
    const next: StoredScan = { ...current, modelResult, modelError: undefined, enabledCategoryIds: enabled };
    next.highlightError = await paint(current.tabId, [...current.baseline.flags, ...modelResult.flags]);
    await writeScan(next);
    return next;
  } catch (error) {
    const modelError =
      error instanceof Error ? error.message : 'The model request failed. No flags were invented.';
    const next: StoredScan = { ...current, modelError, modelResult: undefined };
    await writeScan(next);
    return next;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const stored = await chrome.storage.local.get('settings');
    if (!stored.settings) await chrome.storage.local.set({ settings: defaultSettings() });
  })();
});

chrome.action.onClicked.addListener((tab) => {
  const tabId = tab.id;
  const windowId = tab.windowId;
  if (tabId === undefined || windowId === undefined) return;
  const opened = chrome.sidePanel.open({ windowId });
  void (async () => {
    try {
      await opened;
    } catch {
      // The panel may already be open. The scan still has to run from this click.
    }
    await scanTab(tabId);
  })();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;
  const command = message as { channel?: string; type?: string };
  if (command.channel !== CHANNEL) return;
  void (async () => {
    try {
      if (command.type === 'bootstrap') {
        const settings = await readSettings();
        sendResponse({ ok: true, settings, scan: await readScan(), ...describeCatalog() });
        return;
      }
      if (command.type === 'reanalyze') {
        const body = message as { enabledCategoryIds?: unknown; rulebookId?: string };
        const enabled = Array.isArray(body.enabledCategoryIds) ? body.enabledCategoryIds.filter(isCategoryId) : [];
        sendResponse({ ok: true, scan: await reanalyze(enabled, body.rulebookId || 'custom') });
        return;
      }
      if (command.type === 'run-model') {
        sendResponse({ ok: true, scan: await runModel(message as { mode?: string }) });
        return;
      }
      sendResponse({ ok: false, error: 'Unknown panel command.' });
    } catch (error) {
      const text = error instanceof Error ? error.message : 'The extension command failed.';
      sendResponse({ ok: false, error: text });
    }
  })();
  return true;
});
