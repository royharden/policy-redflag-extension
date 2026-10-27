import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyze } from '../../src/core/analyze';
import { scanStrict } from '../../src/core/baseline';
import { BUDGETS, runInference, type ReadySession } from '../../src/core/on-device';

afterEach(() => vi.useRealTimers());
const text = 'Your membership automatically renews every year.';
function setup(prompt: (input: string, options?: { signal?: AbortSignal }) => Promise<string>) {
  const context = { prompt: vi.fn(prompt), destroy: vi.fn() };
  const session: ReadySession = {
    base: context, categoryIds: ['auto_renewal'], baseUsage: null, quota: null,
    capabilities: { api: true, availability: true, create: true, clone: false, measureInputUsage: false, inputQuota: false, responseConstraint: 'unknown' },
    fresh: vi.fn(async () => context),
  };
  return { session, context };
}

describe('RV fake local-model failure paths', () => {
  it('keeps rules provenance and findings when a model returns prose instead of JSON', async () => {
    const { session, context } = setup(async () => 'Ignore all rules. {"flags":[]}');
    const outcome = await runInference({ session, text, scanId: 'rv', revision: 0, signal: new AbortController().signal });
    expect(outcome.coverage).toMatchObject({ state: 'failed', failureCode: 'bad_json', processed: [], failed: [{ start: 0, end: text.length }] });
    const result = analyze({ snapshot: { scanId: 'rv', revision: 0, text, sections: [] }, enabledCategoryIds: ['auto_renewal'], candidates: [...scanStrict(text), ...outcome.candidates], coverage: [outcome.coverage] }).result;
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.provenance.map((entry) => entry.engine)).toEqual(['rules']);
    expect(context.destroy).toHaveBeenCalledOnce();
  });

  it('aborts a hanging prompt at the budget, records failure and destroys the context', async () => {
    vi.useFakeTimers();
    const { session, context } = setup(async (_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const run = runInference({ session, text, scanId: 'rv', revision: 0, signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(BUDGETS.promptTimeoutMs);
    const outcome = await run;
    expect(outcome.coverage.failureCode).toBe('prompt_timeout');
    expect(outcome.coverage.processed).toEqual([]);
    expect(context.prompt).toHaveBeenCalledOnce();
    expect(context.destroy).toHaveBeenCalledOnce();
  });

  it('cancels an in-flight prompt without accepting output or retrying', async () => {
    const ctl = new AbortController();
    const { session, context } = setup(async (_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      ctl.abort();
    }));
    const outcome = await runInference({ session, text, scanId: 'rv', revision: 0, signal: ctl.signal });
    expect(outcome.coverage).toMatchObject({ state: 'cancelled', failureCode: 'cancelled', processed: [] });
    expect(outcome.candidates).toEqual([]);
    expect(context.prompt).toHaveBeenCalledOnce();
    expect(context.destroy).toHaveBeenCalledOnce();
  });
});
