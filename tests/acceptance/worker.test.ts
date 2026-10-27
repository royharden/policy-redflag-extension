import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercises shipped listener wiring with a fake Chrome API. This is not a real toolbar-gesture receipt.
type Row = Record<string, unknown>;
type Listener = (...args: any[]) => unknown;
let session: Row;
let local: Row;
let listeners: Record<string, Listener>;
let sendMessage: ReturnType<typeof vi.fn>;
let access: ReturnType<typeof vi.fn>;
let execute: ReturnType<typeof vi.fn>;
let open: ReturnType<typeof vi.fn>;
let rejectScans: boolean;

function event(name: string) { return { addListener: (fn: Listener) => { listeners[name] = fn; } }; }
function area(data: Row) {
  return {
    get: vi.fn(async (keys: string | string[] | null) => keys === null ? { ...data } : Object.fromEntries((typeof keys === 'string' ? [keys] : keys).filter((key) => key in data).map((key) => [key, data[key]]))),
    set: vi.fn(async (values: Row) => {
      if (data === session && rejectScans && Object.keys(values).some((key) => key.startsWith('scan:'))) throw new Error('quota');
      Object.assign(data, values);
    }),
    remove: vi.fn(async (keys: string | string[]) => { for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key]; }),
    getBytesInUse: vi.fn(async () => JSON.stringify(data).length * 2),
    setAccessLevel: access,
  };
}
const own = { id: 'rv-extension', url: 'chrome-extension://rv-extension/extension/sidepanel.html' };
async function command(message: Row, sender: Row = own): Promise<any> {
  return new Promise((resolve) => {
    const result = listeners.message!({ channel: 'policy-redflag', ...message }, sender, resolve);
    if (result !== true) resolve(undefined);
  });
}

beforeEach(async () => {
  session = {}; local = {}; listeners = {};
  rejectScans = false;
  access = vi.fn(async () => undefined);
  sendMessage = vi.fn(async () => ({ ok: true }));
  execute = vi.fn(async () => []);
  open = vi.fn(async () => undefined);
  vi.stubGlobal('chrome', {
    storage: { session: area(session), local: area(local) },
    runtime: { id: 'rv-extension', getURL: (p: string) => `chrome-extension://rv-extension/${p}`, onInstalled: event('installed'), onMessage: event('message') },
    action: { onClicked: event('action') }, sidePanel: { open },
    tabs: { onRemoved: event('removed'), onUpdated: event('updated'), onReplaced: event('replaced'), sendMessage },
    scripting: { executeScript: execute },
  });
  vi.resetModules();
  await import('../../src/extension/background');
});
afterEach(() => vi.unstubAllGlobals());

describe('RV worker authorization and lifecycle', () => {
  const text = 'Your membership automatically renews every year.';
  function payload() {
    return { ok: true, protocolVersion: 1, extractionVersion: 'body-walk/1', nonce: 'rv-nonce', revision: 0, text,
      segments: [{ id: 'n0', start: 0, end: text.length, virtual: false }], sections: [], truncated: false, collapsedSegments: 0 };
  }
  function toolbar(tabId: number) {
    listeners.action!({ id: tabId, windowId: 7, url: `https://synthetic.invalid/terms/${tabId}`, title: 'Synthetic' });
  }
  async function capture(tabId: number) {
    sendMessage.mockImplementation(async (_tab, message) => message.type === 'capture' ? payload() : { ok: true });
    toolbar(tabId);
    await vi.waitFor(() => expect(session[`scan:${tabId}`]).toBeDefined());
  }

  it('registers all critical listeners and restricts session access', () => {
    expect(Object.keys(listeners).sort()).toEqual(['action', 'installed', 'message', 'removed', 'replaced', 'updated']);
    expect(access).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  });

  it.each([
    { id: 'foreign', url: own.url },
    { id: own.id, url: 'https://invalid.example' },
    { ...own, tab: { id: 1 }, frameId: 0 },
  ])('refuses panel commands from an untrusted sender (%j)', async (sender) => {
    session['scan:1'] = { marker: 'retain' };
    expect(await command({ type: 'clear', tabId: 1 }, sender)).toBeUndefined();
    expect(session['scan:1']).toEqual({ marker: 'retain' });
  });

  it('returns the explicitly requested tab and reconstructs state after worker reload', async () => {
    session['scan:1'] = { marker: 'one' };
    session['scan:2'] = { marker: 'two' };
    const before = await command({ type: 'get-tab', tabId: 2 });
    expect(before.view.scan).toEqual({ marker: 'two' });
    vi.resetModules();
    await import('../../src/extension/background');
    const after = await command({ type: 'get-tab', tabId: 1 });
    expect(after.view.scan).toEqual({ marker: 'one' });
    expect((await command({ type: 'get-tab', tabId: 3 })).view.scan).toBeNull();
  });

  it.each(['removed', 'updated', 'replaced'])('discards only the affected tab on %s', async (name) => {
    Object.assign(session, { 'scan:1': {}, 'status:1': {}, 'evicted:1': {}, 'scan:2': { marker: 'retain' } });
    if (name === 'updated') listeners.updated!(1, { status: 'loading' });
    else if (name === 'replaced') listeners.replaced!(7, 1);
    else listeners.removed!(1);
    await vi.waitFor(() => expect(session['scan:1']).toBeUndefined());
    expect(session['status:1']).toBeUndefined();
    expect(session['evicted:1']).toBeUndefined();
    expect(session['scan:2']).toEqual({ marker: 'retain' });
  });

  it('does not discard on an ordinary complete event or persist policy text during bootstrap', async () => {
    session['scan:1'] = { marker: 'retain' };
    listeners.updated!(1, { status: 'complete' });
    const response = await command({ type: 'bootstrap' });
    expect(response.ok).toBe(true);
    expect(session['scan:1']).toEqual({ marker: 'retain' });
    expect(local).toEqual({});
  });

  it('opens synchronously before injection and captures only frame zero without persistent policy text', async () => {
    await capture(1);
    expect(open.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0]!);
    expect(execute).toHaveBeenCalledWith({ target: { tabId: 1, frameIds: [0] }, files: ['page-agent.js'] });
    expect(local).toEqual({});
    expect((await command({ type: 'get-tab', tabId: 1 })).view.scan.result.findings).toHaveLength(1);
  });

  it('evicts the oldest scan when a fourth tab is captured', async () => {
    for (const id of [1, 2, 3, 4]) await capture(id);
    expect(Object.keys(session).filter((key) => key.startsWith('scan:')).sort()).toEqual(['scan:2', 'scan:3', 'scan:4']);
    expect((await command({ type: 'get-tab', tabId: 1 })).view.evicted).toBe('evicted');
  });

  it('Clear releases the bridge and removes the selected scan only', async () => {
    await capture(1); await capture(2);
    const result = await command({ type: 'clear', tabId: 1 });
    expect(result.view.scan).toBeNull();
    expect(session['scan:2']).toBeDefined();
    expect(sendMessage.mock.calls.some((call) => call[0] === 1 && call[1].type === 'release')).toBe(true);
    expect(local).toEqual({});
  });

  it('drops a capture that resolves after navigation', async () => {
    let resolveCapture!: (value: unknown) => void;
    sendMessage.mockImplementation(async (_tab, message) => message.type === 'capture' ? new Promise((resolve) => { resolveCapture = resolve; }) : { ok: true });
    toolbar(1);
    await vi.waitFor(() => expect(resolveCapture).toBeDefined());
    listeners.updated!(1, { status: 'loading' });
    resolveCapture(payload());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(session['scan:1']).toBeUndefined();
    expect(session['status:1']).toBeUndefined();
  });

  it('reports storage_limit without falling back to persistent storage', async () => {
    rejectScans = true;
    sendMessage.mockImplementation(async () => payload());
    toolbar(1);
    await vi.waitFor(() => expect((session['status:1'] as { reason?: string })?.reason).toMatch(/storage_limit/));
    expect(session['scan:1']).toBeUndefined();
    expect(local).toEqual({});
  });
});
