export interface NormalizedText {
  normalized: string;
  mapToOriginal: number[];
}

const FOLDS: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': "'",
  '\u201B': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u00A0': ' ',
  '\u2007': ' ',
  '\u2009': ' ',
  '\u202F': ' ',
  '\uFEFF': '',
};

function isSpace(char: string): boolean {
  return /\s/u.test(char);
}

function fold(char: string): string {
  return Object.prototype.hasOwnProperty.call(FOLDS, char) ? FOLDS[char] : char;
}

/**
 * Collapse whitespace and fold a fixed set of quote and space characters.
 * Matching is case-sensitive after this step. This is not an edit-distance match.
 */
export function normalizeWithMap(input: string): NormalizedText {
  let normalized = '';
  const mapToOriginal: number[] = [];
  let index = 0;

  while (index < input.length) {
    const code = input.codePointAt(index);
    if (code === undefined) break;
    const raw = String.fromCodePoint(code);
    const folded = fold(raw);
    if (folded === '') {
      index += raw.length;
      continue;
    }
    if (isSpace(folded)) {
      if (normalized.length > 0 && !normalized.endsWith(' ')) {
        normalized += ' ';
        mapToOriginal.push(index);
      }
      index += raw.length;
      while (index < input.length) {
        const nextCode = input.codePointAt(index);
        if (nextCode === undefined) break;
        const nextRaw = String.fromCodePoint(nextCode);
        const nextFolded = fold(nextRaw);
        if (nextFolded === '') {
          index += nextRaw.length;
          continue;
        }
        if (!isSpace(nextFolded)) break;
        index += nextRaw.length;
      }
      continue;
    }
    normalized += folded;
    for (let offset = 0; offset < folded.length; offset += 1) {
      mapToOriginal.push(index);
    }
    index += raw.length;
  }

  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    mapToOriginal.pop();
  }

  return { normalized, mapToOriginal };
}
