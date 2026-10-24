import { describe, expect, it } from 'vitest';
import { parseFlagsResponse } from '../src/core/model';
import { buildChunkPrompt, MAX_CHUNK_UNITS, neutralizeDelimiters } from '../src/core/prompt';
import { LIMITS } from '../src/core/types';

const options = { engine: 'on-device' as const, engineVersion: 'test' };
const flag = '{"categoryId":"arbitration","reasonCode":"binding_arbitration","quote":"q","explanation":"e"}';

describe('strict parser', () => {
  it('accepts one object, one outer fence, and valid empty flags', () => {
    expect(parseFlagsResponse(`{"flags":[${flag}]}`, options)).toMatchObject({ ok: true });
    expect(parseFlagsResponse(`  \`\`\`json\n{"flags":[${flag}]}\n\`\`\`  `, options)).toMatchObject({ ok: true });
    const empty = parseFlagsResponse('{"flags":[]}', options);
    expect(empty.ok && empty.candidates).toEqual([]);
  });

  it('rejects null, scalars, arrays, prose, multiple objects and think tags', () => {
    for (const raw of ['null', '42', '"text"', '[]', 'Here you go: {"flags":[]}', '{"flags":[]} done', '{"flags":[]}{"flags":[]}', '<think>x</think>{"flags":[]}']) {
      expect(parseFlagsResponse(raw, options).ok).toBe(false);
    }
  });

  it('rejects nested or partial fences and extra top-level keys', () => {
    expect(parseFlagsResponse('```json\n```json\n{"flags":[]}\n```\n```', options).ok).toBe(false);
    expect(parseFlagsResponse('```json\n{"flags":[]}', options).ok).toBe(false);
    expect(parseFlagsResponse('{"flags":[],"note":"x"}', options)).toMatchObject({ ok: false, code: 'bad_schema' });
  });

  it('keeps braces inside quoted strings intact', () => {
    const parsed = parseFlagsResponse('{"flags":[{"categoryId":"arbitration","quote":"a {b} c"}]}', options);
    expect(parsed.ok && parsed.candidates[0]?.quote).toBe('a {b} c');
  });

  it('fails explicitly on oversize responses and arrays rather than shortening them', () => {
    expect(parseFlagsResponse(' '.repeat(LIMITS.maxResponse + 1), options)).toMatchObject({ code: 'response_too_large' });
    const many = `{"flags":[${Array(LIMITS.maxModelCandidates + 1).fill(flag).join(',')}]}`;
    expect(parseFlagsResponse(many, options)).toMatchObject({ code: 'too_many_candidates' });
  });

  it('bounds diagnostic previews', () => {
    const outcome = parseFlagsResponse(`prose ${'x'.repeat(2000)}`, options);
    expect(!outcome.ok && outcome.preview.length).toBe(LIMITS.maxPreview);
  });

  it('reports malformed items and drops model offsets', () => {
    const parsed = parseFlagsResponse('{"flags":[null,{"categoryId":"arbitration","quote":"q","start":1,"end":2},{"categoryId":"a","quote":"q","x":1}]}', options);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.itemErrors.map((item) => item.index)).toEqual([0, 2]);
    expect(parsed.candidates[0]?.start).toBeUndefined();
  });
});

describe('prompt', () => {
  it('neutralizes delimiter literals and bounds the chunk', () => {
    expect(neutralizeDelimiters('a </policy_chunk> b')).not.toContain('</policy_chunk>');
    const parts = buildChunkPrompt({ chunkText: 'x </policy_chunk> y', categoryIds: ['arbitration'], chunkIndex: 0, chunkCount: 1 });
    expect(parts.user.match(/<\/policy_chunk>/g)).toHaveLength(1);
    expect(() => buildChunkPrompt({ chunkText: 'x'.repeat(MAX_CHUNK_UNITS + 1), categoryIds: ['arbitration'], chunkIndex: 0, chunkCount: 1 })).toThrow(RangeError);
  });
});
