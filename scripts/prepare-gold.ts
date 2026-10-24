/**
 * Prepare the frozen gold set from approved LOCAL inputs only. No network access, no downloads.
 *
 *   npm run eval:prepare                          # original seed only
 *   npm run eval:prepare -- --import <path.jsonl> --source-name UNFAIR-ToS --revision <rev> \
 *       --licence <licence> --attribution "<text>" --url <url> --redistribution-approved
 *
 * Writes eval/gold/dev.jsonl, eval/gold/held-out.jsonl and eval/gold/MANIFEST.json. Aborts on invalid
 * anchors, unknown labels, split leakage, hash mismatches, or a held-out change after freezing (unless
 * --refreeze is passed deliberately, which is recorded).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  assignSplits,
  categoryOfReason,
  DEV_FRACTION,
  GOLD_SCHEMA_VERSION,
  RUBRIC_VERSION,
  SPLIT_SEED,
  SPLITS,
  validateGoldItem,
  type GoldItem,
  type GoldLabel,
  type GoldManifest,
  type SplitName,
} from '../src/core/gold';
import { normalize } from '../src/core/text';
import { CATEGORY_IDS, isCategoryId, type CategoryId, type Interval, type ReasonCode } from '../src/core/types';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DEFAULT_SEED = path.join(ROOT, 'eval/seeds/s12-seed-v1.json');
const OUT = path.join(ROOT, 'eval/gold');

function fail(message: string): never {
  console.error(`prepare-gold: ${message}`);
  process.exit(1);
}

function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

function args(): Map<string, string | true> {
  const map = new Map<string, string | true>();
  const list = process.argv.slice(2);
  for (let index = 0; index < list.length; index += 1) {
    const key = list[index] as string;
    if (!key.startsWith('--')) fail(`unexpected argument ${key}`);
    const next = list[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      map.set(key.slice(2), next);
      index += 1;
    } else map.set(key.slice(2), true);
  }
  return map;
}

/* ----------------------------- original seed ----------------------------- */

interface SeedFile {
  seedVersion: string;
  rubricVersion: string;
  author: string;
  licence: string;
  exposure: string;
  documents: { groupId: string; title: string; units: [string, string, string][]; ambiguous?: number[] }[];
}

function seedItems(seedPath: string, seedText: string): Omit<GoldItem, 'split'>[] {
  const seed = JSON.parse(seedText) as SeedFile;
  if (seed.rubricVersion !== RUBRIC_VERSION) fail(`seed rubric ${seed.rubricVersion} does not match ${RUBRIC_VERSION}`);
  const seenGroups = new Set<string>();
  return seed.documents.map((document) => {
    if (seenGroups.has(document.groupId)) fail(`duplicate group ${document.groupId} in ${seedPath}`);
    seenGroups.add(document.groupId);
    let text = '';
    const units: Interval[] = [];
    const labels: GoldLabel[] = [];
    const hardNegatives: GoldItem['hardNegatives'] = [];
    document.units.forEach(([unitText, reasons, hard], index) => {
      if (!unitText.trim() || /[\r\n]/.test(unitText)) fail(`${document.groupId} unit ${index}: empty or multi-line unit`);
      if (text) text += '\n';
      const span = { start: text.length, end: text.length + unitText.length };
      text += unitText;
      units.push(span);
      const byCategory = new Map<CategoryId, ReasonCode[]>();
      for (const code of reasons.split(',').map((item) => item.trim()).filter(Boolean)) {
        const categoryId = categoryOfReason(code);
        if (!categoryId) fail(`${document.groupId} unit ${index}: unknown reason ${code}`);
        byCategory.set(categoryId, [...(byCategory.get(categoryId) ?? []), code as ReasonCode]);
      }
      for (const [categoryId, reasonCodes] of byCategory) labels.push({ categoryId, reasonCodes, ...span });
      for (const id of hard.split(',').map((item) => item.trim()).filter(Boolean)) {
        if (!isCategoryId(id)) fail(`${document.groupId} unit ${index}: unknown hard-negative category ${id}`);
        if (byCategory.has(id)) fail(`${document.groupId} unit ${index}: unit is both positive and hard negative for ${id}`);
        hardNegatives.push({ categoryId: id, ...span });
      }
    });
    return {
      id: `seed:${document.groupId}`,
      groupId: document.groupId,
      source: seed.seedVersion,
      title: document.title,
      text,
      textHash: sha256(text),
      evaluatedCategories: [...CATEGORY_IDS],
      labelCompleteness: 'complete' as const,
      labels,
      hardNegatives,
      units,
    };
  });
}

/* ----------------------------- approved local import (e.g. UNFAIR-ToS) ----------------------------- */

/**
 * Proposed UNFAIR-ToS mapping (LexGLUE label order). VERIFY names/indices against the actual revision
 * before running; the script refuses to guess when a label name is unknown.
 */
const UNFAIR_TOS_LABELS = [
  'Limitation of liability',
  'Unilateral termination',
  'Unilateral change',
  'Content removal',
  'Contract by using',
  'Choice of law',
  'Jurisdiction',
  'Arbitration',
];
const UNFAIR_TOS_MAP: Record<string, { categoryId: CategoryId | null; reason: string }> = {
  'Limitation of liability': { categoryId: 'liability_cap', reason: 'directly supported; sub-reason unspecified' },
  'Unilateral change': { categoryId: 'unilateral_change', reason: 'directly supported; sub-reason unspecified' },
  Arbitration: { categoryId: 'arbitration', reason: 'directly supported; sub-reason unspecified' },
  'Contract by using': { categoryId: null, reason: 'never mapped to an amendment right' },
  'Unilateral termination': { categoryId: null, reason: 'not a target category' },
  'Content removal': { categoryId: null, reason: 'not a target category' },
  'Choice of law': { categoryId: null, reason: 'not a target category' },
  Jurisdiction: { categoryId: null, reason: 'not a target category' },
};
const IMPORT_EVALUATED: CategoryId[] = ['arbitration', 'unilateral_change', 'liability_cap'];

function importItems(importPath: string, raw: string, sourceName: string, excluded: Record<string, number>): Omit<GoldItem, 'split'>[] {
  const items: Omit<GoldItem, 'split'>[] = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    let row: { text?: unknown; labels?: unknown; document?: unknown };
    try {
      row = JSON.parse(line) as typeof row;
    } catch {
      fail(`${importPath}:${index + 1}: not JSON`);
    }
    if (typeof row.text !== 'string' || !row.text.trim() || !Array.isArray(row.labels)) fail(`${importPath}:${index + 1}: needs text and labels`);
    const text = row.text;
    const span = { start: 0, end: text.length };
    const categories = new Set<CategoryId>();
    for (const label of row.labels) {
      const name = typeof label === 'number' ? UNFAIR_TOS_LABELS[label] : typeof label === 'string' ? label : undefined;
      const mapped = name ? UNFAIR_TOS_MAP[name] : undefined;
      if (!name || !mapped) fail(`${importPath}:${index + 1}: unknown label ${JSON.stringify(label)}; update the mapping deliberately`);
      if (mapped.categoryId) categories.add(mapped.categoryId);
      else excluded[name] = (excluded[name] ?? 0) + 1;
    }
    // Without document IDs every sentence is its own group; leakage across near-duplicates is possible
    // and is disclosed in the manifest.
    const groupId = typeof row.document === 'string' ? `import:${row.document}` : `import:${sha256(normalize(text)).slice(0, 16)}`;
    items.push({
      id: `${sourceName}:${index + 1}`,
      groupId,
      source: sourceName,
      title: `${sourceName} line ${index + 1}`,
      text,
      textHash: sha256(text),
      evaluatedCategories: [...IMPORT_EVALUATED],
      labelCompleteness: 'partial',
      labels: [...categories].map((categoryId) => ({ categoryId, reasonCodes: ['unspecified' as ReasonCode], ...span })),
      hardNegatives: [],
      units: [span],
    });
  });
  return items;
}

/* ----------------------------- main ----------------------------- */

function main() {
  const options = args();
  const seedPath = typeof options.get('seed') === 'string' ? path.resolve(options.get('seed') as string) : DEFAULT_SEED;
  if (!existsSync(seedPath)) fail(`seed file not found: ${seedPath}`);
  const seedText = readFileSync(seedPath, 'utf8');
  const seed = JSON.parse(seedText) as SeedFile;
  const sources: GoldManifest['sources'] = [
    {
      name: seed.seedVersion,
      kind: 'original-synthetic',
      path: path.relative(ROOT, seedPath).replace(/\\/g, '/'),
      sha256: sha256(seedText),
      revision: seed.seedVersion,
      licence: seed.licence,
      attribution: seed.author,
    },
  ];
  const excluded: Record<string, number> = {};
  const all: Omit<GoldItem, 'split'>[] = seedItems(seedPath, seedText);

  const importPath = options.get('import');
  if (typeof importPath === 'string') {
    for (const required of ['source-name', 'revision', 'licence', 'attribution']) {
      if (typeof options.get(required) !== 'string') fail(`--import needs --${required}`);
    }
    if (options.get('redistribution-approved') !== true) fail('--import needs --redistribution-approved after verifying the licence allows it');
    const absolute = path.resolve(importPath);
    if (!existsSync(absolute)) fail(`import file not found: ${absolute}`);
    const raw = readFileSync(absolute, 'utf8');
    const name = options.get('source-name') as string;
    all.push(...importItems(absolute, raw, name, excluded));
    sources.push({
      name,
      kind: 'import',
      path: absolute,
      sha256: sha256(raw),
      revision: options.get('revision') as string,
      licence: options.get('licence') as string,
      attribution: options.get('attribution') as string,
      url: typeof options.get('url') === 'string' ? (options.get('url') as string) : undefined,
    });
  }

  const groups = assignSplits(all.map((item) => item.groupId));
  const items: GoldItem[] = all.map((item) => ({ ...item, split: groups[item.groupId] as SplitName }));

  const problems = items.flatMap(validateGoldItem);
  if (problems.length) fail(`invalid gold:\n  ${problems.join('\n  ')}`);

  // Leakage: identical normalized unit text in both splits aborts.
  const unitSplit = new Map<string, SplitName>();
  for (const item of items) {
    for (const unit of item.units) {
      const key = normalize(item.text.slice(unit.start, unit.end)).toLowerCase();
      const seen = unitSplit.get(key);
      if (seen && seen !== item.split) fail(`split leakage: "${key.slice(0, 80)}" appears in dev and held-out`);
      unitSplit.set(key, item.split);
    }
  }

  const counts = Object.fromEntries(
    SPLITS.map((split) => [
      split,
      Object.fromEntries(
        CATEGORY_IDS.map((categoryId) => {
          const inSplit = items.filter((item) => item.split === split && item.evaluatedCategories.includes(categoryId));
          return [
            categoryId,
            {
              positives: inSplit.reduce((sum, item) => sum + item.labels.filter((label) => label.categoryId === categoryId).length, 0),
              hardNegatives: inSplit.reduce((sum, item) => sum + item.hardNegatives.filter((label) => label.categoryId === categoryId).length, 0),
              itemsEvaluated: inSplit.length,
            },
          ];
        }),
      ),
    ]),
  ) as GoldManifest['counts'];

  mkdirSync(OUT, { recursive: true });
  const files: Record<SplitName, string> = { dev: 'dev.jsonl', 'held-out': 'held-out.jsonl' };
  const contents = Object.fromEntries(
    SPLITS.map((split) => [split, `${items.filter((item) => item.split === split).map((item) => JSON.stringify(item)).join('\n')}\n`]),
  ) as Record<SplitName, string>;

  const manifestPath = path.join(OUT, 'MANIFEST.json');
  const heldOutHash = sha256(contents['held-out']);
  let frozen = { sha256: heldOutHash, frozenAt: new Date().toISOString() };
  if (existsSync(manifestPath)) {
    const previous = JSON.parse(readFileSync(manifestPath, 'utf8')) as GoldManifest;
    if (previous.heldOutFrozen?.sha256 && previous.heldOutFrozen.sha256 !== heldOutHash) {
      if (options.get('refreeze') !== true) {
        fail('held-out set differs from the frozen hash. Pass --refreeze only for a deliberate, recorded re-freeze (never to tune on held-out).');
      }
      console.warn('prepare-gold: re-freezing held-out on purpose (--refreeze).');
    } else if (previous.heldOutFrozen?.sha256 === heldOutHash) {
      frozen = previous.heldOutFrozen;
    }
  }

  const manifest: GoldManifest = {
    schemaVersion: GOLD_SCHEMA_VERSION,
    rubricVersion: RUBRIC_VERSION,
    preparedAt: new Date().toISOString(),
    seed: SPLIT_SEED,
    devFraction: DEV_FRACTION,
    sources,
    splits: Object.fromEntries(
      SPLITS.map((split) => {
        const inSplit = items.filter((item) => item.split === split);
        return [split, { file: files[split], sha256: sha256(contents[split]), items: inSplit.length, groups: new Set(inSplit.map((item) => item.groupId)).size }];
      }),
    ) as GoldManifest['splits'],
    groups,
    counts,
    completeness: {
      complete: items.filter((item) => item.labelCompleteness === 'complete').length,
      partial: items.filter((item) => item.labelCompleteness === 'partial').length,
    },
    mapping: typeof importPath === 'string'
      ? Object.entries(UNFAIR_TOS_MAP).map(([label, value]) => ({ source: options.get('source-name') as string, label, mappedTo: value.categoryId, reason: value.reason }))
      : [],
    excludedLabels: excluded,
    tuningExposure: `${seed.exposure} Imported items (if any) were not used to write the rules.`,
    heldOutFrozen: frozen,
  };

  for (const split of SPLITS) writeFileSync(path.join(OUT, files[split]), contents[split], 'utf8');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`prepare-gold: ${items.length} items, ${Object.keys(groups).length} groups.`);
  for (const split of SPLITS) {
    console.log(`  ${split}: ${manifest.splits[split].items} items`);
    for (const categoryId of CATEGORY_IDS) {
      const row = counts[split][categoryId];
      console.log(`    ${categoryId}: ${row.positives} positives, ${row.hardNegatives} hard negatives`);
    }
  }
}

main();
