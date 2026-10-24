// Side-panel controls for the opt-in on-device model. Inference runs here (an extension document),
// never in the worker. Closing the panel cancels inference; nothing unfinished is committed.
import { orderedCategories, PROMPT_VERSION, type CategoryId } from '../core';
import {
  ADAPTER_VERSION,
  checkAvailability,
  createSession,
  destroySession,
  LocalModelError,
  runInference,
  type AvailabilityReport,
  type ReadySession,
} from '../core/on-device';
import type { ModelRun, PanelResponse, StoredTabScan } from './protocol';

export interface LocalModelHost {
  setOptIn(value: boolean): void;
}

export interface LocalModelContext {
  currentScan(): StoredTabScan | null;
  enabledCategories(): CategoryId[];
  commit(run: ModelRun): Promise<PanelResponse>;
  saveOptIn(value: boolean): Promise<void>;
}

type Phase = 'off' | 'checking' | 'idle' | 'activating' | 'ready' | 'running';

const AVAILABILITY_TEXT: Record<AvailabilityReport['status'], string> = {
  unsupported_api: 'Unavailable: this browser has no on-device LanguageModel API.',
  unavailable: 'Unavailable: Chrome reports the on-device model cannot run on this device.',
  downloadable: 'Available after a one-time model download by Chrome.',
  downloading: 'Chrome is downloading the model.',
  available: 'Ready to activate.',
  unknown: 'Support could not be confirmed; activation may fail.',
};

export function mountLocalModel(container: HTMLElement, context: LocalModelContext): LocalModelHost & { refresh(): void } {
  let optIn = false;
  let phase: Phase = 'off';
  let report: AvailabilityReport | null = null;
  let session: ReadySession | null = null;
  let controller: AbortController | null = null;
  let progress = 0;
  let message = '';

  const text = (tag: string, value: string, className?: string) => {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  };

  const button = (label: string, onClick: () => void, secondary = false) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    if (secondary) node.className = 'secondary';
    node.addEventListener('click', onClick);
    return node;
  };

  function cancel() {
    controller?.abort();
    controller = null;
  }

  function dropSession() {
    destroySession(session);
    session = null;
  }

  async function refreshAvailability() {
    phase = 'checking';
    render();
    report = await checkAvailability();
    phase = session ? 'ready' : 'idle';
    render();
  }

  async function activate() {
    const categories = orderedCategories(context.enabledCategories());
    if (!categories.length) {
      message = 'Select at least one category first.';
      render();
      return;
    }
    dropSession();
    controller = new AbortController();
    phase = 'activating';
    progress = 0;
    message = '';
    render();
    try {
      session = await createSession({
        categoryIds: categories,
        signal: controller.signal,
        onProgress: (loaded) => {
          progress = loaded;
          render();
        },
      });
      phase = 'ready';
      message = 'Local model ready.';
    } catch (error) {
      phase = 'idle';
      message = error instanceof LocalModelError ? error.message : 'The local model could not start.';
      await commitUnavailable(error instanceof LocalModelError ? error.code : 'create_failed');
    } finally {
      controller = null;
      render();
    }
  }

  /** Record an honest unavailable/failed model state alongside the independent rules result. */
  async function commitUnavailable(code: string) {
    const scan = context.currentScan();
    if (!scan || code === 'cancelled') return;
    const now = new Date().toISOString();
    await context.commit({
      runVersion: 1,
      scanId: scan.snapshot.scanId,
      revision: scan.snapshot.revision,
      enabledCategoryIds: orderedCategories(scan.enabledCategoryIds),
      candidates: [],
      extraRejections: [],
      coverage: {
        engine: 'on-device',
        engineVersion: ADAPTER_VERSION,
        state: code === 'unsupported_api' || code === 'unavailable' ? 'unavailable' : 'failed',
        processed: [],
        skipped: [{ start: 0, end: scan.snapshot.text.length }],
        failed: [],
        failureCode: code,
      },
      modelIdentity: 'unknown',
      adapterVersion: ADAPTER_VERSION,
      promptVersion: PROMPT_VERSION,
      startedAt: now,
      finishedAt: now,
    });
  }

  async function run() {
    const scan = context.currentScan();
    if (!scan || !session) return;
    const categories = orderedCategories(scan.enabledCategoryIds);
    if (categories.join('|') !== session.categoryIds.join('|')) {
      message = 'Categories changed since activation. Activate the local model again.';
      dropSession();
      phase = 'idle';
      render();
      return;
    }
    const ctl = new AbortController();
    controller = ctl;
    phase = 'running';
    message = 'Running the local model on the saved snapshot…';
    render();
    const startedAt = new Date().toISOString();
    try {
      const outcome = await runInference({
        session,
        text: scan.snapshot.text,
        scanId: scan.snapshot.scanId,
        revision: scan.snapshot.revision,
        signal: ctl.signal,
      });
      if (ctl.signal.aborted) {
        message = 'Cancelled. Nothing from this run was kept.';
        return;
      }
      // Re-check the current operation before committing: edits/settings/tab changes discard the run.
      const now = context.currentScan();
      if (!now || now.snapshot.scanId !== scan.snapshot.scanId || orderedCategories(context.enabledCategories()).join('|') !== categories.join('|')) {
        message = 'The scan or categories changed while the model ran. Its output was discarded.';
        return;
      }
      const response = await context.commit({
        runVersion: 1,
        scanId: scan.snapshot.scanId,
        revision: scan.snapshot.revision,
        enabledCategoryIds: categories,
        candidates: outcome.candidates,
        extraRejections: outcome.extraRejections,
        coverage: outcome.coverage,
        modelIdentity: outcome.modelIdentity,
        adapterVersion: outcome.adapterVersion,
        promptVersion: outcome.promptVersion,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
      message = response.ok
        ? `Local model finished (${outcome.coverage.state}). Model findings are labelled "On-device model".`
        : response.error ?? 'The model result was not accepted.';
    } finally {
      controller = null;
      phase = session ? 'ready' : 'idle';
      render();
    }
  }

  function render() {
    container.replaceChildren();
    container.append(text('h2', 'Local model (optional)'));
    const label = document.createElement('label');
    label.className = 'check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = optIn;
    box.addEventListener('change', () => {
      optIn = box.checked;
      void context.saveOptIn(optIn);
      if (!optIn) {
        cancel();
        dropSession();
        phase = 'off';
        render();
      } else void refreshAvailability();
    });
    label.append(box, document.createTextNode(' Use the on-device model. Policy text stays on this device; Chrome may download the model once.'));
    container.append(label);
    if (!optIn) {
      container.append(text('p', 'Off. Findings come from the keyless rules only.', 'meta'));
      return;
    }
    if (phase === 'checking') container.append(text('p', 'Checking on-device model support…', 'meta'));
    if (report) {
      container.append(text('p', AVAILABILITY_TEXT[report.status], report.status === 'available' ? 'meta' : 'note'));
      if (report.raw) container.append(text('p', `Browser reported: ${report.raw}`, 'meta'));
    }
    const actions = document.createElement('div');
    actions.className = 'actions';
    const scan = context.currentScan();
    if (phase === 'activating') {
      container.append(text('p', progress > 0 && progress < 1 ? `Downloading model: ${Math.round(progress * 100)}%` : 'Starting the local model…', 'meta'));
      actions.append(button('Cancel', cancel, true));
    } else if (phase === 'running') {
      actions.append(button('Cancel', cancel, true));
    } else if (phase === 'ready') {
      const go = button('Run on this scan', () => void run());
      go.disabled = !scan;
      actions.append(go, button('Turn off', () => {
        dropSession();
        phase = 'idle';
        render();
      }, true));
    } else if (report && report.status !== 'unsupported_api' && report.status !== 'unavailable') {
      actions.append(button(report.status === 'downloadable' ? 'Download and activate' : 'Activate', () => void activate()));
    } else if (report && scan) {
      actions.append(button('Record unavailable', () => void commitUnavailable(report?.status ?? 'unavailable'), true));
    }
    container.append(actions);
    if (message) container.append(text('p', message, 'meta'));
  }

  window.addEventListener('pagehide', () => {
    cancel();
    dropSession();
  });

  render();
  return {
    setOptIn(value: boolean) {
      optIn = value;
      if (optIn) void refreshAvailability();
      else render();
    },
    refresh() {
      if (phase !== 'running' && phase !== 'activating') render();
    },
  };
}
