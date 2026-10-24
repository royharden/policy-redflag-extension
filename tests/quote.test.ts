import { describe, expect, it } from 'vitest';
import { findQuote } from '../src/core/quote';
import { normalizeWithMap } from '../src/core/text';

describe('normalizeWithMap', () => {
  it('collapses whitespace and keeps a map back to the original', () => {
    const original = 'hello   world';
    const mapped = normalizeWithMap(original);
    expect(mapped.normalized).toBe('hello world');
    expect(mapped.mapToOriginal).toHaveLength(mapped.normalized.length);
    expect(original[mapped.mapToOriginal[0] ?? 0]).toBe('h');
    expect(original[mapped.mapToOriginal[mapped.mapToOriginal.length - 1] ?? 0]).toBe('d');
  });
});

describe('findQuote', () => {
  it('matches through extra spaces and a non-breaking space', () => {
    const original = 'We agree to  binding\u00A0arbitration today.';
    const match = findQuote(original, 'binding arbitration');
    expect(match).not.toBeNull();
    expect(match?.quote).toBe(original.slice(match?.start, match?.end));
    expect(match?.quote.toLowerCase()).toContain('binding');
    expect(match?.quote.toLowerCase()).toContain('arbitration');
  });

  it('folds curly quotes and does not change case', () => {
    const original = 'He said \u201Cbinding arbitration\u201D is required.';
    expect(findQuote(original, '"binding arbitration"')?.quote).toContain('binding arbitration');
    expect(findQuote('Binding arbitration is required.', 'binding arbitration')).toBeNull();
  });

  it('drops a one-character typo and counts repeated exact quotes', () => {
    expect(findQuote('binding arbitration', 'binding arbitraton')).toBeNull();
    const repeated = findQuote('binding arbitration, then binding arbitration again.', 'binding arbitration');
    expect(repeated?.matchCount).toBe(2);
    expect(repeated?.start).toBe(0);
  });
});
