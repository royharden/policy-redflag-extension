import { CATEGORY_IDS, REASON_CODES, UNSPECIFIED_REASON, type CategoryId, type ReasonCode } from './types';

export interface Category {
  id: CategoryId;
  label: string;
  summary: string;
  scope: string;
  reasons: readonly { code: ReasonCode; label: string }[];
  /**
   * Historical grade weight, read only by the retained grade.ts module. Grades are not part of the
   * selected behavior or result schemas (PLAN.md section 2).
   */
  weight: number;
}

const REASON_LABELS: Record<Exclude<ReasonCode, typeof UNSPECIFIED_REASON>, string> = {
  auto_renews: 'Renews automatically',
  price_change_on_renewal: 'Price can change on renewal',
  cancel_hurdle: 'Cancellation hurdle',
  binding_arbitration: 'Binding arbitration',
  class_action_waiver: 'Class action waiver',
  jury_waiver: 'Jury trial waiver',
  modify_any_time: 'Provider may modify terms',
  notice_by_posting: 'Notice by posting only',
  sale: 'Sale of personal information',
  sharing_third_party: 'Sharing with third parties',
  sharing_advertising: 'Sharing for advertising',
  damages_cap: 'Monetary damages cap',
  exclusion_of_damages: 'Exclusion of damages or liability',
  perpetual_irrevocable: 'Perpetual or irrevocable licence',
  sublicensable: 'Sublicensable licence',
  ai_training: 'Use of content for AI training',
};

function reasons(id: CategoryId) {
  return [
    ...REASON_CODES[id].map((code) => ({ code, label: REASON_LABELS[code] })),
    { code: UNSPECIFIED_REASON, label: 'Unspecified' },
  ] as const;
}

export const CATEGORIES: readonly Category[] = [
  {
    id: 'arbitration',
    label: 'Arbitration and dispute waivers',
    summary: 'Sends disputes to private arbitration or waives a class action or jury trial.',
    scope: 'Distinct dispute restrictions.',
    reasons: reasons('arbitration'),
    weight: 20,
  },
  {
    id: 'unilateral_change',
    label: 'Unilateral change',
    summary: 'Lets the provider change the terms on its own.',
    scope: 'Provider amendment rights; assent by use alone is not enough.',
    reasons: reasons('unilateral_change'),
    weight: 12,
  },
  {
    id: 'liability_cap',
    label: 'Liability limits',
    summary: 'Caps or excludes what the provider pays if something goes wrong.',
    scope: 'Monetary caps and explicit damages exclusions; a bare AS IS or no-warranty notice is not enough.',
    reasons: reasons('liability_cap'),
    weight: 16,
  },
  {
    id: 'data_sale_or_share',
    label: 'Data sale or sharing',
    summary: 'Sells personal information or shares it with third parties or advertisers.',
    scope: 'Sale, third-party sharing and advertising sharing are distinguished.',
    reasons: reasons('data_sale_or_share'),
    weight: 18,
  },
  {
    id: 'auto_renewal',
    label: 'Auto-renewal',
    summary: 'A paid plan continues, may change price, or is hard to cancel.',
    scope: 'Recurrence, renewal price changes and contextual cancellation hurdles.',
    reasons: reasons('auto_renewal'),
    weight: 18,
  },
  {
    id: 'broad_content_license',
    label: 'Broad content licence',
    summary: 'Takes broad rights to posts, photos or other user content.',
    scope: 'Broad user-content rights; AI training needs supporting content-rights context.',
    reasons: reasons('broad_content_license'),
    weight: 16,
  },
];

export const CATEGORY_BY_ID = Object.fromEntries(
  CATEGORIES.map((category) => [category.id, category]),
) as Record<CategoryId, Category>;

export function everyCategoryId(): CategoryId[] {
  return [...CATEGORY_IDS];
}

export function reasonLabel(code: ReasonCode): string {
  return code === UNSPECIFIED_REASON ? 'Unspecified' : REASON_LABELS[code];
}

/** Historical helper retained for the grade module; not used by selected behavior. */
export function assertCategoryWeights(): number {
  return CATEGORIES.reduce((sum, category) => sum + category.weight, 0);
}
