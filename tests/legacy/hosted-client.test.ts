import { describe, expect, it } from 'vitest';
import {
  assertModelEndpoint,
  completeChat,
  ModelRequestError,
  parseModelFlags,
} from '../src/core/model';

describe('model endpoint', () => {
  it('allows public https and local http, and blocks metadata and private hosts', () => {
    expect(assertModelEndpoint('https://api.example.com/v1/chat/completions').protocol).toBe('https:');
    expect(assertModelEndpoint('http://127.0.0.1:11434/v1/chat/completions').hostname).toBe('127.0.0.1');
    expect(() => assertModelEndpoint('http://example.com/v1')).toThrow(ModelRequestError);
    expect(() => assertModelEndpoint('http://169.254.169.254/latest')).toThrow(ModelRequestError);
    expect(() => assertModelEndpoint('https://192.168.0.5/v1')).toThrow(ModelRequestError);
    expect(() => assertModelEndpoint('https://metadata.google.internal/')).toThrow(ModelRequestError);
  });
});

describe('completeChat', () => {
  it('does not call fetch when the key is blank', async () => {
    let called = false;
    await expect(
      completeChat({ endpoint: 'https://api.example.com/v1/chat/completions', apiKey: '  ', model: 'demo' }, 'prompt', async () => {
        called = true;
        return new Response('{}');
      }),
    ).rejects.toBeInstanceOf(ModelRequestError);
    expect(called).toBe(false);
  });

  it('rejects a non-JSON success body', async () => {
    await expect(
      completeChat(
        { endpoint: 'https://api.example.com/v1/chat/completions', apiKey: 'secret', model: 'demo' },
        'prompt',
        async () => new Response('not-json', { status: 200 }),
      ),
    ).rejects.toThrow(/did not return JSON/);
  });
});

describe('parseModelFlags', () => {
  it('reads a fenced JSON object and rejects prose', () => {
    const parsed = parseModelFlags('```json\n{"flags":[{"categoryId":"arbitration","quote":"binding arbitration"}]}\n```');
    expect(parsed.error).toBeUndefined();
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]?.quote).toBe('binding arbitration');
    expect(parseModelFlags('no flags here').error).toMatch(/did not return JSON/);
    expect(parseModelFlags('{"note":"missing array"}').error).toMatch(/no flags array/);
  });
});
