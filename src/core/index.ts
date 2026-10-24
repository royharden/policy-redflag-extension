export { analyze, analyzeBaseline, type AnalyzeInput } from './analyze';
export { detectBaseline } from './baseline';
export { CATEGORIES, CATEGORY_BY_ID, assertCategoryWeights } from './categories';
export { compareBaselines, CORPUS, CORPUS_PROVENANCE, RECORDED_DRAFT, SAMPLE_FIXTURE } from './fixtures';
export type { CorpusReport, Fixture, FixtureLabel } from './fixtures';
export { formatRate, scoreSpans } from './evaluate';
export type { CategoryScore, ScoreCard, SpanLabel } from './evaluate';
export { gradeFlags } from './grade';
export { completeChat, endpointPermissionPattern, ModelRequestError, parseModelFlags, assertModelEndpoint } from './model';
export { completeOnDevice } from './on-device';
export type { ChatSettings } from './model';
export { buildExtractionPrompt } from './prompt';
export { findQuote } from './quote';
export {
  categoriesForRulebook,
  defaultSettings,
  matchingRulebookId,
  RULEBOOKS,
} from './rulebooks';
export type { ModelSettings, Rulebook, UserSettings } from './rulebooks';
export { splitByRanges } from './spans';
export type { TextPart } from './spans';
export { normalizeWithMap } from './text';
export { CATEGORY_IDS, isCategoryId, isSeverity } from './types';
export type {
  AnalyzeResult,
  Candidate,
  CandidateSource,
  CategoryId,
  DroppedFlag,
  DropReason,
  Grade,
  KeptFlag,
  Severity,
} from './types';
