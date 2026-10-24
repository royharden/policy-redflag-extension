import { analyze } from './analyze';
import { detectBaseline } from './baseline';
import { scoreSpans, type ScoreCard, type SpanLabel } from './evaluate';
import { CATEGORY_IDS, type CategoryId } from './types';

export const CORPUS_PROVENANCE =
  'Hand-written synthetic policies created for this repository on 2026-10-23. They are not customer contracts and they are not copied from UNFAIR-ToS, CUAD, or OPP-115.';

export interface FixtureLabel {
  categoryId: CategoryId;
  quote: string;
}

export interface Fixture {
  id: string;
  title: string;
  text: string;
  labels: readonly FixtureLabel[];
  provenance: string;
}

function policy(id: string, title: string, lines: readonly string[], labels: readonly FixtureLabel[]): Fixture {
  return { id, title, text: lines.join('\n'), labels, provenance: CORPUS_PROVENANCE };
}

export const CORPUS: readonly Fixture[] = [
  policy(
    'member-box',
    'Northwind Hobby Box membership terms',
    [
      'Northwind Hobby Box membership terms',
      '',
      'You agree to binding arbitration for any dispute with us.',
      'We may modify these terms at any time without notice.',
      'In no event shall we be liable for indirect damages.',
      'Our liability is limited to the fees you paid last month.',
      'We may sell your personal information to advertising partners.',
      'Your subscription will automatically renew until you cancel.',
      'You grant us a perpetual, irrevocable license to use your photos.',
    ],
    [
      { categoryId: 'arbitration', quote: 'You agree to binding arbitration for any dispute with us.' },
      { categoryId: 'unilateral_change', quote: 'We may modify these terms at any time without notice.' },
      { categoryId: 'liability_cap', quote: 'In no event shall we be liable for indirect damages.' },
      { categoryId: 'liability_cap', quote: 'Our liability is limited to the fees you paid last month.' },
      { categoryId: 'data_sale_or_share', quote: 'We may sell your personal information to advertising partners.' },
      { categoryId: 'auto_renewal', quote: 'Your subscription will automatically renew until you cancel.' },
      {
        categoryId: 'broad_content_license',
        quote: 'You grant us a perpetual, irrevocable license to use your photos.',
      },
    ],
  ),
  policy(
    'paraphrase-arbitration',
    'Northwind dispute note',
    [
      'Northwind dispute note',
      '',
      'Disputes go to a private decision maker instead of a court, and you cannot join other customers in one case.',
    ],
    [
      {
        categoryId: 'arbitration',
        quote:
          'Disputes go to a private decision maker instead of a court, and you cannot join other customers in one case.',
      },
    ],
  ),
  policy(
    'near-miss',
    'Northwind plain-language promises',
    [
      'Northwind plain-language promises',
      '',
      'We do not require binding arbitration.',
      'We will never sell your personal information.',
      'Your plan will not automatically renew.',
      'We do not modify these terms without telling you in the product.',
      'Our liability is not limited to the price of a sticker.',
      'You do not grant us a license to use your photos.',
    ],
    [],
  ),
  policy(
    'loose-bulletin',
    'Northwind community bulletin',
    [
      'Northwind community bulletin',
      '',
      'We share our annual report with the public and renew our commitment to plain language.',
      'This license page describes the software license we bought for the studio.',
      'We may modify our office hours when the weather is bad.',
      'Liability for parking tickets stays with the driver.',
    ],
    [],
  ),
  policy(
    'only-arbitration',
    'Arbitration clause',
    ['You agree to binding arbitration for any dispute with us.'],
    [{ categoryId: 'arbitration', quote: 'You agree to binding arbitration for any dispute with us.' }],
  ),
  policy(
    'only-change',
    'Change clause',
    ['We may modify these terms when we ship a new hobby kit.'],
    [{ categoryId: 'unilateral_change', quote: 'We may modify these terms when we ship a new hobby kit.' }],
  ),
  policy(
    'only-sale',
    'Sale clause',
    ['We may sell your personal information to sponsors.'],
    [{ categoryId: 'data_sale_or_share', quote: 'We may sell your personal information to sponsors.' }],
  ),
  policy(
    'only-renewal',
    'Renewal clause',
    ['Your subscription will automatically renew each season.'],
    [{ categoryId: 'auto_renewal', quote: 'Your subscription will automatically renew each season.' }],
  ),
];

export const SAMPLE_FIXTURE = CORPUS[0];

export const RECORDED_DRAFT = `{
  "flags": [
    {
      "categoryId": "arbitration",
      "quote": "binding arbitration",
      "severity": "high",
      "note": "Recorded quote copied from the sample."
    },
    {
      "categoryId": "arbitration",
      "quote": "this quote is not in the policy",
      "severity": "high",
      "note": "Recorded quote that must be dropped."
    }
  ]
}`;

export interface CorpusReport {
  missingQuotes: string[];
  strict: ScoreCard;
  loose: ScoreCard;
}

export function compareBaselines(corpus: readonly Fixture[] = CORPUS): CorpusReport {
  const missingQuotes: string[] = [];
  const gold: SpanLabel[] = [];
  for (const fixture of corpus) {
    for (const label of fixture.labels) {
      const start = fixture.text.indexOf(label.quote);
      if (start < 0) {
        missingQuotes.push(`${fixture.id}: ${label.quote}`);
        continue;
      }
      gold.push({
        docId: fixture.id,
        categoryId: label.categoryId,
        start,
        end: start + label.quote.length,
      });
    }
  }
  return {
    missingQuotes,
    strict: scoreMode(corpus, gold, 'strict'),
    loose: scoreMode(corpus, gold, 'loose'),
  };
}

function scoreMode(corpus: readonly Fixture[], gold: readonly SpanLabel[], mode: 'strict' | 'loose'): ScoreCard {
  const predicted: SpanLabel[] = [];
  for (const fixture of corpus) {
    const result = analyze({
      text: fixture.text,
      enabledCategoryIds: CATEGORY_IDS,
      candidates: detectBaseline(fixture.text, mode),
    });
    for (const flag of result.flags) {
      predicted.push({
        docId: fixture.id,
        categoryId: flag.categoryId,
        start: flag.start,
        end: flag.end,
      });
    }
  }
  return scoreSpans(gold, predicted);
}
