/**
 * Score the strict and loose rule baselines (and, optionally, a real eval.html model run) on a frozen
 * gold split. This script is the ONLY writer of results/results.json and results/results.md.
 *
 *   npm run eval -- --split dev
 *   npm run eval -- --split held-out --model-run path/to/model-run.jsonl
 *
 * Node never calls Chrome APIs or substitutes a hosted model. A model run is merged only when its
 * header matches this manifest, split and versions, and every item's input hash matches.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../src/core/analyze';
import { LOOSE_VERSION, RULES_VERSION, scanLoose, scanStrict } from '../src/core/baseline';
import { formatRate, METRICS_VERSION, RELAXED_IOU_THRESHOLD, scoreSpans, type MatchMode, type ScoreCard, type SpanLabel } from '../src/core/evaluate';
import { GOLD_SCHEMA_VERSION, rng, seedHash, SPLITS, validateGoldItem, type GoldItem, type GoldManifest, type SplitName } from '../src/core/gold';
import { CORE_VERSION, type CategoryId, type Interval } from '../src/core/types';
import { PROMPT_VERSION } from '../src/core/prompt';
import { PARSER_VERSION } from '../src/core/model';
import { ADAPTER_VERSION } from '../src/core/on-device';

// fileURLToPath decodes %20 etc. (the project path contains a space) and handles Windows drive letters.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// eval.html exports chrome.runtime.getManifest().version, not the npm package version.
const BUILD_VERSION = (JSON.parse(readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8')) as { version: string }).version;
const MODES: MatchMode[] = ['detection', 'exact', 'relaxed'];
const BOOTSTRAP_SAMPLES = 1000;

function fail(message: string): never {
  console.error(`evaluate: ${message}`);
  process.exit(1);
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

/* ----------------------------- load frozen gold ----------------------------- */

function loadGold(manifestPath: string, split: SplitName) {
  if (!existsSync(manifestPath)) fail(`manifest not found: ${manifestPath}. Run npm run eval:prepare first.`);
  const manifestText = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText) as GoldManifest;
  if (manifest.schemaVersion !== GOLD_SCHEMA_VERSION) fail(`unsupported gold schema ${manifest.schemaVersion}`);
  const entry = manifest.splits[split];
  if (!entry) fail(`split ${split} missing from manifest`);
  const file = path.join(path.dirname(manifestPath), entry.file);
  const text = readFileSync(file, 'utf8');
  if (sha256(text) !== entry.sha256) fail(`hash mismatch for ${entry.file}; the frozen split was modified`);
  if (split === 'held-out' && manifest.heldOutFrozen.sha256 !== entry.sha256) fail('held-out file does not match the frozen held-out hash');
  const items = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as GoldItem);
  for (const item of items) {
    if (item.split !== split) fail(`item ${item.id} is labelled ${item.split}, listed under ${split} (leakage)`);
    if (manifest.groups[item.groupId] !== split) fail(`group ${item.groupId} is not assigned to ${split} (leakage)`);
    if (sha256(item.text) !== item.textHash) fail(`text hash mismatch for ${item.id}`);
    const problems = validateGoldItem(item);
    if (problems.length) fail(problems.join('; '));
    // This scorer has no per-unit completeness mask. Refuse unknown negatives rather
    // than converting missing annotations into false positives or invented precision.
    if (item.labelCompleteness !== 'complete') fail(`item ${item.id}: partial or incomplete labels cannot be scored; complete the evaluated categories first`);
  }
  return { manifest, manifestHash: sha256(manifestText), splitHash: entry.sha256, items };
}

/* ----------------------------- predictions ----------------------------- */

interface EngineRow {
  name: string;
  /** Predictions for each item, restricted to that item's evaluated categories. */
  predictions: Map<string, SpanLabel[]>;
  attempted: number;
  status: Record<string, number>;
  shares?: Record<string, number | null>;
  coverageUnits?: { processed: number; skipped: number; failed: number; total: number };
}

function goldSpans(items: readonly GoldItem[]): SpanLabel[] {
  return items.flatMap((item) => item.labels.map((label) => ({ itemId: item.id, categoryId: label.categoryId, start: label.start, end: label.end })));
}

function toSpans(item: GoldItem, findings: readonly { categoryId: CategoryId; occurrences: readonly Interval[] }[]): SpanLabel[] {
  return findings
    .filter((finding) => item.evaluatedCategories.includes(finding.categoryId))
    .flatMap((finding) => {
      const [first, ...rest] = finding.occurrences;
      return first
        ? [{ itemId: item.id, categoryId: finding.categoryId, start: first.start, end: first.end, alternatives: rest.map(({ start, end }) => ({ start, end })) }]
        : [];
    });
}

function ruleRow(items: readonly GoldItem[], mode: 'strict' | 'loose'): EngineRow {
  const predictions = new Map<string, SpanLabel[]>();
  for (const item of items) {
    const candidates = mode === 'strict' ? scanStrict(item.text, item.evaluatedCategories) : scanLoose(item.text, item.evaluatedCategories);
    // Pure baseline evaluation is uncapped (displayLimit: null).
    const { predictions: units } = analyze({
      snapshot: { scanId: item.id, revision: 0, text: item.text, sections: [] },
      enabledCategoryIds: item.evaluatedCategories,
      candidates,
      displayLimit: null,
    });
    predictions.set(item.id, toSpans(item, units));
  }
  return { name: mode, predictions, attempted: items.length, status: { complete: items.length } };
}

interface ModelRecord {
  recordType: string;
  [key: string]: unknown;
}

function modelRow(runPath: string, items: readonly GoldItem[], gold: ReturnType<typeof loadGold>, split: SplitName): { row: EngineRow | null; header: ModelRecord; note: string } {
  const lines = readFileSync(runPath, 'utf8').split(/\r?\n/).filter((line) => line.trim());
  const records = lines.map((line) => JSON.parse(line) as ModelRecord);
  const header = records[0];
  if (!header || header.recordType !== 'header' || header.format !== 'model-run/1') fail('model run has no model-run/1 header');
  if (header.manifestHash !== gold.manifestHash) fail('model run was made against a different manifest');
  if (header.splitName !== split || header.splitHash !== gold.splitHash) fail('model run split/hash does not match the requested split');
  const versions = header.versions as Record<string, string> | undefined;
  for (const [key, expected] of Object.entries({ core: CORE_VERSION, prompt: PROMPT_VERSION, parser: PARSER_VERSION, adapter: ADAPTER_VERSION, build: BUILD_VERSION })) {
    if (versions?.[key] !== expected) fail(`model run ${key} version ${versions?.[key]} does not match ${expected}`);
  }
  const status = records.find((record) => record.recordType === 'status');
  if (status && status.status === 'unavailable') {
    // Unsupported hardware: validate provenance first, then omit numerical model rows.
    return { row: null, header, note: `On-device model unavailable (${String(status.failureCode)}); not measured.` };
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  const predictions = new Map<string, SpanLabel[]>();
  const statusCounts: Record<string, number> = {};
  const shareCounts = { expanded: 0, ambiguous: 0, rejected: 0, accepted: 0, candidates: 0, badJsonChunks: 0, chunks: 0 };
  const coverage = { processed: 0, skipped: 0, failed: 0, total: 0 };
  for (const record of records.filter((item) => item.recordType === 'item')) {
    const item = byId.get(String(record.itemId));
    if (!item) fail(`model run contains unknown item ${String(record.itemId)}`);
    if (record.inputHash !== item.textHash) fail(`input hash mismatch for ${item.id}`);
    const state = String(record.status);
    statusCounts[state] = (statusCounts[state] ?? 0) + 1;
    const validated = (record.validated as { categoryId: CategoryId; occurrences: Interval[] }[]) ?? [];
    predictions.set(item.id, toSpans(item, validated));
    const counts = record.counts as Record<string, number> | undefined;
    if (counts) {
      shareCounts.expanded += counts.expanded ?? 0;
      shareCounts.ambiguous += counts.ambiguous ?? 0;
      shareCounts.rejected += counts.rejected ?? 0;
      shareCounts.accepted += counts.accepted ?? 0;
      shareCounts.candidates += counts.candidates ?? 0;
    }
    for (const chunk of (record.chunks as { status: string }[]) ?? []) {
      shareCounts.chunks += 1;
      if (chunk.status === 'bad_json' || chunk.status === 'bad_schema') shareCounts.badJsonChunks += 1;
    }
    const cov = record.coverage as { processed: Interval[]; skipped: Interval[]; failed: Interval[] } | undefined;
    const units = (spans: Interval[] | undefined) => (spans ?? []).reduce((sum, span) => sum + span.end - span.start, 0);
    coverage.processed += units(cov?.processed);
    coverage.skipped += units(cov?.skipped);
    coverage.failed += units(cov?.failed);
    coverage.total += item.text.length;
  }
  // Attempted items that are missing or failed stay in full-target reporting with no predictions.
  const missing = items.filter((item) => !predictions.has(item.id));
  for (const item of missing) {
    predictions.set(item.id, []);
    statusCounts.missing = (statusCounts.missing ?? 0) + 1;
  }
  // Undefined denominators are null (rendered as 'undefined'), never NaN or 0.
  const ratioOf = (numerator: number, denominator: number): number | null => (denominator ? numerator / denominator : null);
  return {
    row: {
      name: `on-device:${String(header.modelIdentity ?? 'unknown')}`,
      predictions,
      attempted: items.length,
      status: statusCounts,
      shares: {
        expandedOfAccepted: ratioOf(shareCounts.expanded, shareCounts.accepted),
        ambiguousOfAccepted: ratioOf(shareCounts.ambiguous, shareCounts.accepted),
        rejectedOfCandidates: ratioOf(shareCounts.rejected, shareCounts.candidates),
        badJsonOfChunks: ratioOf(shareCounts.badJsonChunks, shareCounts.chunks),
      },
      coverageUnits: coverage,
    },
    header,
    note: missing.length ? `${missing.length} item(s) had no model record and count as attempted with no predictions.` : '',
  };
}

function unionRow(left: EngineRow, right: EngineRow): EngineRow {
  const predictions = new Map<string, SpanLabel[]>();
  for (const [itemId, spans] of left.predictions) {
    const merged = [...spans];
    for (const span of right.predictions.get(itemId) ?? []) {
      if (!merged.some((other) => other.categoryId === span.categoryId && other.start === span.start && other.end === span.end)) merged.push(span);
    }
    predictions.set(itemId, merged);
  }
  return { name: `strict-union-${right.name}`, predictions, attempted: left.attempted, status: right.status, coverageUnits: right.coverageUnits };
}

/* ----------------------------- scoring ----------------------------- */

/**
 * Detection is scored at the labelled clause/sentence units (PLAN.md section 7): each prediction is mapped
 * onto the units it overlaps and deduplicated per (item, category, unit), so several fragments of one unit
 * count once. Exact and relaxed localization keep the raw predicted spans.
 */
function unitPredictions(item: GoldItem, spans: readonly SpanLabel[]): SpanLabel[] {
  const unitsOf = (span: Interval) => item.units.filter((unit) => unit.start < span.end && span.start < unit.end);
  const seen = new Set<string>();
  const out: SpanLabel[] = [];
  for (const span of spans) {
    const primary = unitsOf(span);
    const alternatives = (span.alternatives ?? []).flatMap(unitsOf);
    // One prediction is one unit (at most one TP): a span crossing units counts at its first unit only.
    const targets = primary.length ? primary.slice(0, 1) : [{ start: span.start, end: span.end }];
    for (const unit of targets) {
      const key = `${span.categoryId}|${unit.start}-${unit.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ itemId: item.id, categoryId: span.categoryId, start: unit.start, end: unit.end, alternatives });
    }
  }
  return out;
}

function score(items: readonly GoldItem[], row: EngineRow, mode: MatchMode): ScoreCard {
  const gold = goldSpans(items);
  const predicted = items.flatMap((item) => {
    const spans = row.predictions.get(item.id) ?? [];
    return mode === 'detection' ? unitPredictions(item, spans) : spans;
  });
  return scoreSpans(gold, predicted, mode);
}

/** Group bootstrap (resampling groups, seeded) for detection micro-F1: a rough interval, not a guarantee. */
function bootstrapF1(items: readonly GoldItem[], row: EngineRow): { low: number | null; high: number | null; samples: number } {
  const groups = [...new Set(items.map((item) => item.groupId))].sort();
  if (groups.length < 2) return { low: null, high: null, samples: 0 };
  const random = rng(seedHash(`bootstrap:${row.name}`));
  const values: number[] = [];
  for (let sample = 0; sample < BOOTSTRAP_SAMPLES; sample += 1) {
    const chosen: GoldItem[] = [];
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[Math.floor(random() * groups.length)];
      chosen.push(...items.filter((item) => item.groupId === group).map((item, copy) => ({ ...item, id: `${item.id}#${sample}-${index}-${copy}` })));
    }
    const renamed: EngineRow = {
      ...row,
      predictions: new Map(chosen.map((item) => [item.id, (row.predictions.get(item.id.split('#')[0] as string) ?? []).map((span) => ({ ...span, itemId: item.id }))])),
    };
    const card = score(chosen, renamed, 'detection');
    if (card.micro.f1 !== null) values.push(card.micro.f1);
  }
  values.sort((a, b) => a - b);
  if (!values.length) return { low: null, high: null, samples: 0 };
  return { low: values[Math.floor(values.length * 0.025)] ?? null, high: values[Math.floor(values.length * 0.975)] ?? null, samples: values.length };
}

function errorAudit(items: readonly GoldItem[], row: EngineRow, limit = 15) {
  const fps: string[] = [];
  const fns: string[] = [];
  for (const item of items) {
    const predicted = row.predictions.get(item.id) ?? [];
    for (const label of item.labels) {
      if (!predicted.some((span) => span.categoryId === label.categoryId && span.start < label.end && label.start < span.end)) {
        fns.push(`${item.id} [${label.categoryId}] ${item.text.slice(label.start, label.end).slice(0, 160)}`);
      }
    }
    for (const span of predicted) {
      if (!item.labels.some((label) => label.categoryId === span.categoryId && span.start < label.end && label.start < span.end)) {
        fps.push(`${item.id} [${span.categoryId}] ${item.text.slice(span.start, span.end).slice(0, 160)}`);
      }
    }
  }
  return { falsePositives: fps.slice(0, limit), falseNegatives: fns.slice(0, limit), totals: { falsePositives: fps.length, falseNegatives: fns.length } };
}

/* ----------------------------- report ----------------------------- */

function table(card: ScoreCard): string {
  const rows = card.perCategory.map(
    (row) => `| ${row.categoryId} | ${row.support} | ${row.tp} | ${row.fp} | ${row.fn} | ${formatRate(row.precision)} | ${formatRate(row.recall)} | ${formatRate(row.f1)} |`,
  );
  return [
    '| Category | Support | TP | FP | FN | Precision | Recall | F1 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...rows,
    `| **micro** | ${card.micro.support} | ${card.micro.tp} | ${card.micro.fp} | ${card.micro.fn} | ${formatRate(card.micro.precision)} | ${formatRate(card.micro.recall)} | ${formatRate(card.micro.f1)} |`,
    `| **macro** (${card.macro.definedCategories} defined) | | | | | ${formatRate(card.macro.precision)} | ${formatRate(card.macro.recall)} | ${formatRate(card.macro.f1)} |`,
  ].join('\n');
}

function main() {
  const split = (option('split') ?? 'dev') as SplitName;
  if (!SPLITS.includes(split)) fail(`--split must be one of ${SPLITS.join(', ')}`);
  const manifestPath = path.resolve(option('manifest') ?? path.join(ROOT, 'eval/gold/MANIFEST.json'));
  const gold = loadGold(manifestPath, split);
  const items = gold.items;
  const rows: EngineRow[] = [ruleRow(items, 'loose'), ruleRow(items, 'strict')];
  const notes: string[] = [];
  let modelHeader: ModelRecord | null = null;
  const runPath = option('model-run');
  if (runPath) {
    const model = modelRow(path.resolve(runPath), items, gold, split);
    modelHeader = model.header;
    if (model.note) notes.push(model.note);
    if (model.row) rows.push(model.row, unionRow(rows[1] as EngineRow, model.row));
  } else {
    notes.push('On-device model: not measured (no validated eval.html model-run.jsonl was supplied).');
  }

  const results = rows.map((row) => ({
    engine: row.name,
    attempted: row.attempted,
    status: row.status,
    shares: row.shares ?? null,
    coverageUnits: row.coverageUnits ?? null,
    scores: Object.fromEntries(MODES.map((mode) => [mode, score(items, row, mode)])),
    detectionMicroF1Bootstrap95: bootstrapF1(items, row),
    errorAudit: errorAudit(items, row),
  }));

  const output = {
    resultsVersion: 'results/1',
    generatedAt: new Date().toISOString(),
    split,
    manifest: { path: path.relative(ROOT, manifestPath).replace(/\\/g, '/'), sha256: gold.manifestHash, splitSha256: gold.splitHash, heldOutFrozen: gold.manifest.heldOutFrozen },
    versions: { core: CORE_VERSION, rules: RULES_VERSION, loose: LOOSE_VERSION, metrics: METRICS_VERSION, modelRun: modelHeader?.versions ?? null },
    parameters: { matchModes: MODES, relaxedIouThreshold: RELAXED_IOU_THRESHOLD, bootstrapSamples: BOOTSTRAP_SAMPLES, baselineDisplayLimit: null },
    support: { items: items.length, groups: new Set(items.map((item) => item.groupId)).size, perCategory: gold.manifest.counts[split] },
    provenance: gold.manifest.sources,
    sampling: 'Synthetic seed documents with deliberately chosen hard negatives; precision on this sampled set is not real-world prevalence precision.',
    limitations: [
      gold.manifest.tuningExposure,
      'Detection counts a prediction overlapping a labelled unit; exact needs equal offsets; relaxed needs IoU >= 0.5.',
      'Ambiguous quote-only predictions are one unit that may match through any recorded occurrence.',
      'A located quote proves text presence, not category correctness; wrong-category real quotes count as FP/FN here.',
      ...notes,
    ],
    results,
  };

  const outDir = path.resolve(option('out') ?? path.join(ROOT, 'results'));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'results.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  const md = [
    `# Measured results (${split})`,
    '',
    `Generated ${output.generatedAt} by scripts/evaluate.ts. Manifest ${gold.manifestHash.slice(0, 16)}…, split ${gold.splitHash.slice(0, 16)}…, core ${CORE_VERSION}, rules ${RULES_VERSION}.`,
    '',
    '## Limitations',
    '',
    ...output.limitations.map((line) => `- ${line}`),
    '',
    ...results.flatMap((result) => [
      `## ${result.engine}`,
      '',
      `Attempted ${result.attempted} item(s). Status: ${JSON.stringify(result.status)}.` +
        (result.detectionMicroF1Bootstrap95.low !== null
          ? ` Detection micro-F1 group-bootstrap 95% interval: ${formatRate(result.detectionMicroF1Bootstrap95.low)}–${formatRate(result.detectionMicroF1Bootstrap95.high)}.`
          : ''),
      '',
      ...MODES.flatMap((mode) => [`### ${mode}`, '', table(result.scores[mode] as ScoreCard), '']),
      `Error audit (first examples; overlap-based listing): ${result.errorAudit.totals.falsePositives} FP, ${result.errorAudit.totals.falseNegatives} FN.`,
      '',
      ...result.errorAudit.falsePositives.map((line) => `- FP ${line}`),
      ...result.errorAudit.falseNegatives.map((line) => `- FN ${line}`),
      '',
    ]),
  ].join('\n');
  writeFileSync(path.join(outDir, 'results.md'), md, 'utf8');
  console.log(`evaluate: wrote ${path.relative(ROOT, outDir)}/results.json and results.md for split ${split}.`);
  for (const result of results) {
    const card = result.scores.detection as ScoreCard;
    console.log(`  ${result.engine}: detection micro P ${formatRate(card.micro.precision)} R ${formatRate(card.micro.recall)} F1 ${formatRate(card.micro.f1)}`);
  }
}

main();
