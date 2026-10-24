import type { Candidate, CandidateSource, CategoryId } from './types';

interface Span {
  start: number;
  end: number;
}

type Searcher = (text: string) => Span[];

interface Rule {
  id: CategoryId;
  note: string;
  negate: boolean;
  strict: Searcher[];
  loose: Searcher[];
}

function negated(text: string, matchIndex: number): boolean {
  const boundary = Math.max(
    text.lastIndexOf('.', matchIndex - 1),
    text.lastIndexOf('!', matchIndex - 1),
    text.lastIndexOf('?', matchIndex - 1),
    text.lastIndexOf('\n', matchIndex - 1),
  );
  const prefix = text.slice(boundary + 1, matchIndex);
  return /\b(not|never|no|neither)\b/i.test(prefix);
}

function regexSpans(source: string, negate: boolean): Searcher {
  return (text) => {
    const expression = new RegExp(source, 'gi');
    const spans: Span[] = [];
    let match: RegExpExecArray | null;
    while ((match = expression.exec(text)) !== null) {
      if (match[0].length === 0) {
        expression.lastIndex += 1;
        continue;
      }
      if (negate && negated(text, match.index)) continue;
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
    return spans;
  };
}

function pairSpans(verbs: string, objects: string, radius: number, negate: boolean): Searcher {
  return (text) => {
    const verbExpression = new RegExp(verbs, 'gi');
    const spans: Span[] = [];
    let match: RegExpExecArray | null;
    while ((match = verbExpression.exec(text)) !== null) {
      if (match[0].length === 0) {
        verbExpression.lastIndex += 1;
        continue;
      }
      if (negate && negated(text, match.index)) continue;
      const lo = Math.max(0, match.index - radius);
      const hi = Math.min(text.length, match.index + match[0].length + radius);
      const region = text.slice(lo, hi);
      const objectMatch = new RegExp(objects, 'i').exec(region);
      if (!objectMatch) continue;
      const verbStart = match.index - lo;
      const verbEnd = verbStart + match[0].length;
      const objectStart = objectMatch.index;
      const objectEnd = objectMatch.index + objectMatch[0].length;
      spans.push({
        start: lo + Math.min(verbStart, objectStart),
        end: lo + Math.max(verbEnd, objectEnd),
      });
    }
    return spans;
  };
}

const RULES: readonly Rule[] = [
  {
    id: 'arbitration',
    note: 'Private arbitration or a waiver of a class or jury proceeding.',
    negate: true,
    strict: [
      regexSpans('\\bbinding arbitration\\b', true),
      regexSpans('\\bclass action waiver\\b', true),
      regexSpans('\\bjury trial waiver\\b', true),
      regexSpans('\\bwaive the right to a jury\\b', true),
    ],
    loose: [regexSpans('\\barbitrat', true)],
  },
  {
    id: 'unilateral_change',
    note: 'The service can change the agreement on its own.',
    negate: true,
    strict: [
      regexSpans('\\bwe may (?:modify|change|update|amend) (?:these|this|the) (?:terms|agreement|policy)\\b', true),
      regexSpans('\\breserve the right to (?:change|modify|amend) (?:these|this|the) (?:terms|agreement|policy)\\b', true),
    ],
    loose: [regexSpans('\\bmodify\\b', true), regexSpans('\\bamend\\b', true)],
  },
  {
    id: 'liability_cap',
    note: 'A cap or disclaimer on what the service will pay.',
    negate: true,
    strict: [
      regexSpans('\\blimitation of liability\\b', true),
      regexSpans('\\bliability is limited to\\b', true),
      regexSpans('\\bin no event shall we be liable\\b', true),
    ],
    loose: [regexSpans('\\bliability\\b', true)],
  },
  {
    id: 'data_sale_or_share',
    note: 'A sale or share of personal information.',
    negate: true,
    strict: [
      pairSpans(
        '\\b(?:sell|selling|sold|share|sharing|shared)\\b',
        '\\b(?:personal data|personal information|your data|your information)\\b',
        80,
        true,
      ),
    ],
    loose: [regexSpans('\\bshare\\b', true), regexSpans('\\bsell\\b', true)],
  },
  {
    id: 'auto_renewal',
    note: 'A paid plan that continues unless the customer cancels.',
    negate: true,
    strict: [
      regexSpans('\\bautomatically renew(?:s|ed)?\\b', true),
      regexSpans('\\bauto-renew(?:s|ed|al)?\\b', true),
      regexSpans('\\brenews automatically\\b', true),
    ],
    loose: [regexSpans('\\brenew', true)],
  },
  {
    id: 'broad_content_license',
    note: 'A broad licence to customer content.',
    negate: true,
    strict: [
      regexSpans('\\bperpetual,\\s+irrevocable\\b', true),
      regexSpans('\\bworldwide,\\s+royalty-free\\b', true),
      regexSpans('\\byou grant us\\b[\\s\\S]{0,80}\\blicen[cs]e\\b', true),
    ],
    loose: [regexSpans('\\blicen[cs]e\\b', true)],
  },
];

function takeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((left, right) => left.start - right.start || left.end - right.end);
  const kept: Span[] = [];
  for (const span of sorted) {
    const seen = kept.some((item) => item.start === span.start && item.end === span.end);
    if (seen) continue;
    kept.push(span);
    if (kept.length === 3) break;
  }
  return kept;
}

export function detectBaseline(text: string, mode: 'strict' | 'loose'): Candidate[] {
  const source: CandidateSource = mode === 'strict' ? 'strict-baseline' : 'loose-baseline';
  const candidates: Candidate[] = [];
  for (const rule of RULES) {
    const searchers = mode === 'strict' ? rule.strict : rule.loose;
    const spans = takeSpans(searchers.flatMap((search) => search(text)));
    for (const span of spans) {
      candidates.push({
        categoryId: rule.id,
        quote: text.slice(span.start, span.end),
        start: span.start,
        end: span.end,
        source,
        note: rule.note,
      });
    }
  }
  return candidates;
}
