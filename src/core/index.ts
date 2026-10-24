// Shared core used by the web lab, the extension and the evaluation scripts.
// The on-device adapter (./on-device) is deliberately NOT exported here: only extension document
// entrypoints import it. The historical grade (./grade) and hosted client (./legacy) are not exported.
export { analyze, fullCoverage, type AnalyzableSnapshot, type AnalyzeInput, type AnalyzeOutput } from './analyze';
export { detectBaseline, LOOSE_VERSION, RULES_VERSION, scanLoose, scanStrict } from './baseline';
export { CATEGORIES, CATEGORY_BY_ID, everyCategoryId, reasonLabel, type Category } from './categories';
export {
  ACME_TERMS_TEXT,
  compareBaselines,
  CORPUS,
  CORPUS_PROVENANCE,
  RECORDED_DRAFT,
  SAMPLE_FIXTURE,
  SEMANTIC_AUDIT_DRAFT,
  type CorpusReport,
  type Fixture,
  type FixtureLabel,
} from './fixtures';
export {
  f1,
  formatRate,
  iou,
  maximumMatching,
  METRICS_VERSION,
  RELAXED_IOU_THRESHOLD,
  scoreSpans,
  type CategoryScore,
  type MatchMode,
  type ScoreCard,
  type SpanLabel,
} from './evaluate';
export { itemErrorRejections, parseFlagsResponse, PARSER_VERSION, type ParseOutcome } from './model';
export { buildChunkPrompt, flagsResponseSchema, MAX_CHUNK_UNITS, neutralizeDelimiters, PROMPT_VERSION } from './prompt';
export { findOccurrences, isCompleteSentence, locateByOffsets, locateByQuote, prepareDocument } from './quote';
export {
  categoriesForRulebook,
  coerceSettings,
  CUSTOM_PRESET_ID,
  defaultSettings,
  matchingRulebookId,
  orderedCategories,
  RULEBOOK_VERSION,
  RULEBOOKS,
  type Rulebook,
  type UserSettings,
} from './rulebooks';
export { splitByRanges, type TextPart } from './spans';
export {
  containingSentence,
  countWords,
  deriveSections,
  normalize,
  NORMALIZATION_VERSION,
  normalizeWithMap,
  rawInterval,
  segmentSentences,
  sha256Hex,
} from './text';
export * from './types';
