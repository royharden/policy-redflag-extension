import { normalizeWithMap } from './text';

export interface QuoteMatch {
  start: number;
  end: number;
  quote: string;
  matchCount: number;
}

function characterWidth(text: string, index: number): number {
  const code = text.codePointAt(index);
  if (code === undefined) return 1;
  return code > 0xffff ? 2 : 1;
}

/** Whitespace-normalized substring match. Returns null when the quote is not in the buffer. */
export function findQuote(original: string, quote: string): QuoteMatch | null {
  const documentMap = normalizeWithMap(original);
  const needle = normalizeWithMap(quote).normalized;
  if (needle.length === 0) return null;

  const hits: number[] = [];
  let from = 0;
  while (from <= documentMap.normalized.length) {
    const at = documentMap.normalized.indexOf(needle, from);
    if (at < 0) break;
    hits.push(at);
    from = at + needle.length;
  }
  if (hits.length === 0) return null;

  const startNorm = hits[0];
  const endNorm = startNorm + needle.length;
  const start = documentMap.mapToOriginal[startNorm];
  const last = documentMap.mapToOriginal[endNorm - 1];
  if (start === undefined || last === undefined) return null;
  const end = last + characterWidth(original, last);
  return {
    start,
    end,
    quote: original.slice(start, end),
    matchCount: hits.length,
  };
}

export function countExact(text: string, quote: string): number {
  if (quote.length === 0) return 0;
  let count = 0;
  let from = 0;
  while (from <= text.length) {
    const at = text.indexOf(quote, from);
    if (at < 0) break;
    count += 1;
    from = at + quote.length;
  }
  return count;
}
