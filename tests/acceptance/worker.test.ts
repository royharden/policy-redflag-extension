import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercises shipped listener wiring with a fake Chrome API. This is not a real toolbar-gesture receipt.
type Row = Record<string, unknown>;
type Listener = (...args: any[]) => unknown;
let session: Row;
let local: Row;
let listeners: Record<string, Listener>;
let sendMessage: ReturnType<typeof vi.fn>;
let access: ReturnType<typeof vi.fn>;

function event(name: string) { return { addListener: (fn: Listener) => { listeners[name] = fn; } }; }
function area(data: Row) {
  return {
    get: vi.fn(async (keys: string | string[] | null) => keys === null ? { ...data } : Object.fromEntries((typeof keys === 'string' ? [keys] : keys).filter((key) => key in data).map((key) => [key, data[key]]))),
    set: vi.fn(async (values: Row) => { Object.assign(data, values); }),
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
  access = vi.fn(async () => undefined);
  sendMessage = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('chrome', {
    storage: { session: area(session), local: area(local) },
    runtime: { id: 'rv-extension', getURL: (p: string) => `chrome-extension://rv-extension/${p}`, onInstalled: event('installed'), onMessage: event('message') },
    action: { onClicked: event('action') }, sidePanel: { open: vi.fn(async () => undefined) },
    tabs: { onRemoved: event('removed'), onUpdated: event('updated'), onReplaced: event('replaced'), sendMessage },
    scripting: { executeScript: vi.fn(async () => []) },
  });
  vi.resetModules();
  await import('../../src/extension/background');
});
afterEach(() => vi.unstubAllGlobals());

describe('RV worker authorization and lifecycle', () => {
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
});
