import { everyCategoryId } from './categories';
import { CATEGORY_IDS, type CategoryId } from './types';

export interface Rulebook {
  id: string;
  label: string;
  description: string;
  categoryIds: readonly CategoryId[];
}

export const RULEBOOKS: readonly Rulebook[] = [
  {
    id: 'consumer-core',
    label: 'Consumer core',
    description: 'All six categories.',
    categoryIds: CATEGORY_IDS,
  },
  {
    id: 'dispute-and-liability',
    label: 'Disputes and liability',
    description: 'Arbitration, unilateral change, and liability caps.',
    categoryIds: ['arbitration', 'unilateral_change', 'liability_cap'],
  },
  {
    id: 'privacy-sale',
    label: 'Data sale or sharing',
    description: 'Only clauses about selling or sharing personal information.',
    categoryIds: ['data_sale_or_share'],
  },
  {
    id: 'billing-and-content',
    label: 'Billing and content',
    description: 'Auto-renewal and broad licences to customer content.',
    categoryIds: ['auto_renewal', 'broad_content_license'],
  },
];

export interface ModelSettings {
  mode: 'off' | 'on-device' | 'https';
  endpoint: string;
  model: string;
  apiKey: string;
}

export interface UserSettings {
  rulebookId: string;
  enabledCategoryIds: CategoryId[];
  model: ModelSettings;
}

export function defaultSettings(): UserSettings {
  return {
    rulebookId: 'consumer-core',
    enabledCategoryIds: everyCategoryId(),
    model: { mode: 'off', endpoint: '', model: '', apiKey: '' },
  };
}

export function categoriesForRulebook(id: string): CategoryId[] {
  const book = RULEBOOKS.find((item) => item.id === id);
  return book ? [...book.categoryIds] : everyCategoryId();
}

export function matchingRulebookId(ids: readonly CategoryId[]): string {
  const key = [...ids].sort().join('|');
  for (const book of RULEBOOKS) {
    if ([...book.categoryIds].sort().join('|') === key) return book.id;
  }
  return 'custom';
}
