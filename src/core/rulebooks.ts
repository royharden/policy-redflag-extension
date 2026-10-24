import { everyCategoryId } from './categories';
import { CATEGORY_IDS, isCategoryId, type CategoryId } from './types';

/** Version of the preset table. Recorded on every ScanResult as rulebookVersion. */
export const RULEBOOK_VERSION = 'presets/1';

export const CUSTOM_PRESET_ID = 'custom';

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
    description: 'Arbitration, unilateral change and liability limits.',
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
    description: 'Auto-renewal and broad licences to user content.',
    categoryIds: ['auto_renewal', 'broad_content_license'],
  },
];

/**
 * Persisted settings (chrome.storage.local in the extension). No provider key, endpoint or policy text.
 * localModelEnabled is the user's explicit opt-in; it does not prove the model is available.
 */
export interface UserSettings {
  settingsVersion: 1;
  presetId: string;
  enabledCategoryIds: CategoryId[];
  localModelEnabled: boolean;
}

export function defaultSettings(): UserSettings {
  return {
    settingsVersion: 1,
    presetId: 'consumer-core',
    enabledCategoryIds: everyCategoryId(),
    localModelEnabled: false,
  };
}

/** Category IDs in stable CATEGORY_IDS order, deduplicated. */
export function orderedCategories(ids: readonly unknown[]): CategoryId[] {
  const wanted = new Set(ids.filter(isCategoryId));
  return CATEGORY_IDS.filter((id) => wanted.has(id));
}

export function categoriesForRulebook(id: string): CategoryId[] | null {
  const book = RULEBOOKS.find((item) => item.id === id);
  return book ? [...book.categoryIds] : null;
}

/** Equal toggle sets identify a preset; anything else is custom. */
export function matchingRulebookId(ids: readonly CategoryId[]): string {
  const key = orderedCategories(ids).join('|');
  for (const book of RULEBOOKS) {
    if (orderedCategories(book.categoryIds).join('|') === key) return book.id;
  }
  return CUSTOM_PRESET_ID;
}

/** Coerce untrusted stored settings. Unknown fields (including any historical API key) are dropped. */
export function coerceSettings(value: unknown): UserSettings {
  const base = defaultSettings();
  if (!value || typeof value !== 'object') return base;
  const row = value as Record<string, unknown>;
  const enabledCategoryIds = Array.isArray(row.enabledCategoryIds)
    ? orderedCategories(row.enabledCategoryIds)
    : base.enabledCategoryIds;
  return {
    settingsVersion: 1,
    presetId: matchingRulebookId(enabledCategoryIds),
    enabledCategoryIds,
    localModelEnabled: row.localModelEnabled === true,
  };
}
