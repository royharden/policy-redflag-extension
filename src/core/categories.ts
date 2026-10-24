import { CATEGORY_IDS, type CategoryId, type Severity } from './types';

export interface Category {
  id: CategoryId;
  label: string;
  weight: number;
  defaultSeverity: Severity;
  summary: string;
}

export const CATEGORIES: readonly Category[] = [
  {
    id: 'arbitration',
    label: 'Arbitration and class waiver',
    weight: 20,
    defaultSeverity: 'high',
    summary: 'Sends disputes to private arbitration or waives a class or jury proceeding.',
  },
  {
    id: 'unilateral_change',
    label: 'Unilateral change',
    weight: 12,
    defaultSeverity: 'medium',
    summary: 'Lets the service change the terms on its own.',
  },
  {
    id: 'liability_cap',
    label: 'Liability cap',
    weight: 16,
    defaultSeverity: 'medium',
    summary: 'Limits what the service will pay if something goes wrong.',
  },
  {
    id: 'data_sale_or_share',
    label: 'Data sale or sharing',
    weight: 18,
    defaultSeverity: 'high',
    summary: 'Sells or shares personal information.',
  },
  {
    id: 'auto_renewal',
    label: 'Auto-renewal',
    weight: 18,
    defaultSeverity: 'high',
    summary: 'Continues a paid plan unless the customer cancels.',
  },
  {
    id: 'broad_content_license',
    label: 'Broad content licence',
    weight: 16,
    defaultSeverity: 'medium',
    summary: 'Takes a broad licence to photos, posts, or other customer content.',
  },
];

export const CATEGORY_BY_ID = Object.fromEntries(
  CATEGORIES.map((category) => [category.id, category]),
) as Record<CategoryId, Category>;

export function assertCategoryWeights(): number {
  return CATEGORIES.reduce((sum, category) => sum + category.weight, 0);
}

export function everyCategoryId(): CategoryId[] {
  return [...CATEGORY_IDS];
}
