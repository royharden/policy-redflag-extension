import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkAvailability, createSession, destroySession, planChunks, runInference, BUDGETS } from '../src/core/on-device';

afterEach(() => vi.unstubAllGlobals());

describe('local model without a real model or download', () => {
  it('reports unsupported honestly and refuses activation', async () => {
    vi.stubGlobal('LanguageModel', undefined);
    expect((await checkAvailability()).status).toBe('unsupported_api');
    await expect(createSession({ categoryIds: ['auto_renewal'], signal: new AbortController().signal })).rejects.toMatchObject({ code: 'unsupported_api' });
  });

  it('does not create a session when the device reports unavailable', async () => {
    const create = vi.fn();
    vi.stubGlobal('LanguageModel', { availability: async () => 'unavailable', create });
    await expect(createSession({ categoryIds: ['auto_renewal'], signal: new AbortController().signal })).rejects.toMatchObject({ code: 'unavailable' });
    expect(create).not.toHaveBeenCalled();
  });

  it('uses a fresh context, reports processed intervals and destroys both contexts', async () => {
    const context = { prompt: vi.fn(async () => '{"flags":[]}'), destroy: vi.fn(), measureInputUsage: async () => 25 };
    const base = { inputQuota: 4096, inputUsage: 100, clone: vi.fn(async () => context), destroy: vi.fn() };
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create: async () => base });
    const signal = new AbortController().signal;
    const session = await createSession({ categoryIds: ['auto_renewal'], signal });
    const text = 'Your membership automatically renews each year.';
    const outcome = await runInference({ session, text, scanId: 'synthetic', revision: 0, signal });
    expect(base.clone).toHaveBeenCalledOnce();
    expect(outcome.coverage).toMatchObject({ state: 'complete', processed: [{ start: 0, end: text.length }], failed: [], skipped: [] });
    expect(outcome.candidates).toEqual([]);
    expect(outcome.modelIdentity).toBe('unknown');
    expect(context.destroy).toHaveBeenCalledOnce();
    destroySession(session);
    expect(base.destroy).toHaveBeenCalledOnce();
  });

  it('fails an oversized token budget before prompting and destroys the context', async () => {
    const context = { prompt: vi.fn(), destroy: vi.fn(), measureInputUsage: async () => 4000 };
    const base = { inputQuota: 4096, inputUsage: 100, clone: async () => context, destroy: vi.fn() };
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create: async () => base });
    const signal = new AbortController().signal;
    const session = await createSession({ categoryIds: ['auto_renewal'], signal });
    const outcome = await runInference({ session, text: 'Synthetic policy text.', scanId: 'capacity', revision: 0, signal });
    expect(outcome.coverage).toMatchObject({ state: 'failed', failureCode: 'over_context', processed: [] });
    expect(context.prompt).not.toHaveBeenCalled();
    expect(context.destroy).toHaveBeenCalledOnce();
    destroySession(session);
  });

  it('does not prompt after an already-cancelled scan and reports skipped scope', async () => {
    const fresh = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const text = 'Synthetic policy text.';
    const outcome = await runInference({
      session: { base: { prompt: vi.fn() }, categoryIds: ['auto_renewal'], capabilities: { api: true, availability: true, create: true, clone: false, measureInputUsage: false, inputQuota: false, responseConstraint: 'unknown' }, baseUsage: null, quota: null, fresh },
      text, scanId: 'cancelled', revision: 0, signal: controller.signal,
    });
    expect(outcome.coverage).toMatchObject({ state: 'cancelled', failureCode: 'cancelled', skipped: [{ start: 0, end: text.length }] });
    expect(fresh).not.toHaveBeenCalled();
  });

  it('caps chunk count, size and overlap while exposing uncaptured model scope', () => {
    const text = 'Synthetic sentence about a policy. '.repeat(5000);
    const { chunks, skipped } = planChunks(text);
    expect(chunks).toHaveLength(BUDGETS.maxChunks);
    for (const [index, chunk] of chunks.entries()) {
      expect(chunk.end - chunk.start).toBeLessThanOrEqual(BUDGETS.maxChunkUnits);
      if (index) expect(chunks[index - 1]!.end - chunk.start).toBeLessThanOrEqual(BUDGETS.maxOverlapUnits);
    }
    expect(skipped).toEqual([{ start: chunks[chunks.length - 1]!.end, end: text.length }]);
  });
});
