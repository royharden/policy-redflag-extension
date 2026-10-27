import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { assignSplits, validateGoldItem, type GoldItem, type GoldManifest } from '../../src/core/gold';

const root = process.cwd();
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const manifest = JSON.parse(readFileSync(path.join(root, 'eval/gold/MANIFEST.json'), 'utf8')) as GoldManifest;
const readItems = (split: 'dev' | 'held-out') => readFileSync(path.join(root, 'eval/gold', manifest.splits[split].file), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as GoldItem);

describe('RV frozen gold integrity', () => {
  it('has anchored, hash-matching, disjoint groups and the required original seed floors', () => {
    const all = [...readItems('dev'), ...readItems('held-out')];
    expect(all).toHaveLength(33);
    expect(assignSplits(all.map((item) => item.groupId))).toEqual(manifest.groups);
    for (const split of ['dev', 'held-out'] as const) {
      expect(sha(readFileSync(path.join(root, 'eval/gold', manifest.splits[split].file), 'utf8'))).toBe(manifest.splits[split].sha256);
    }
    for (const item of all) {
      expect(validateGoldItem(item), item.id).toEqual([]);
      expect(sha(item.text)).toBe(item.textHash);
      expect(manifest.groups[item.groupId]).toBe(item.split);
    }
    for (const category of ['auto_renewal', 'data_sale_or_share', 'broad_content_license']) {
      expect(all.flatMap((item) => item.labels).filter((label) => label.categoryId === category).length).toBeGreaterThanOrEqual(20);
      expect(all.flatMap((item) => item.hardNegatives).filter((label) => label.categoryId === category).length).toBeGreaterThanOrEqual(40);
    }
  });

  function scoreFixture(kind: 'valid' | 'hash' | 'anchor' | 'group' | 'partial') {
    const dir = mkdtempSync(path.join(tmpdir(), 's12-rv-gold-'));
    const text = 'Your membership automatically renews every year.';
    const item: GoldItem = {
      id: 'rv-synthetic', groupId: 'rv-group', split: 'dev', source: 'rv-original', title: 'Synthetic contract probe',
      text, textHash: sha(text), evaluatedCategories: ['auto_renewal'], labelCompleteness: kind === 'partial' ? 'partial' : 'complete',
      labels: kind === 'partial' ? [] : [{ categoryId: 'auto_renewal', reasonCodes: ['auto_renews'], start: 0, end: text.length }],
      hardNegatives: [], units: [{ start: 0, end: text.length }],
    };
    if (kind === 'anchor') item.labels[0]!.end += 1;
    const content = JSON.stringify(item) + '\n';
    const local: GoldManifest = structuredClone(manifest);
    local.groups = { 'rv-group': kind === 'group' ? 'held-out' : 'dev' };
    local.splits.dev = { file: 'dev.jsonl', sha256: kind === 'hash' ? 'invalid' : sha(content), items: 1, groups: 1 };
    local.counts.dev.auto_renewal = { positives: item.labels.length, hardNegatives: 0, itemsEvaluated: 1 };
    writeFileSync(path.join(dir, 'dev.jsonl'), content);
    writeFileSync(path.join(dir, 'MANIFEST.json'), JSON.stringify(local));
    const result = spawnSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/evaluate.ts', '--', '--split', 'dev', '--manifest', path.join(dir, 'MANIFEST.json'), '--out', path.join(dir, 'results')], { cwd: root, encoding: 'utf8', timeout: 60_000 });
    expect(result.error).toBeUndefined();
    return { ...result, report: result.status === 0 ? JSON.parse(readFileSync(path.join(dir, 'results/results.json'), 'utf8')) : null };
  }

  it('accepts a valid fixture as the tamper-test positive control', () => {
    const result = scoreFixture('valid');
    expect(result.status, result.stderr).toBe(0);
    expect(result.report.results.find((row: { engine: string }) => row.engine === 'strict').scores.detection.micro.tp).toBe(1);
  }, 65_000);

  it.each(['hash', 'anchor', 'group'] as const)('rejects a corrupt %s fixture', (kind) => {
    const result = scoreFixture(kind);
    expect(result.status, result.stdout + result.stderr).not.toBe(0);
  }, 65_000);

  // what_bug_this_catches: missing annotations in partial sources are unknown, not negatives (PLAN section 7).
  it('does not count an unannotated practice in a partial source as a false positive', () => {
    const result = scoreFixture('partial');
    // Refusing unsupported partial scoring is acceptable; silently producing an FP is not.
    if (result.status === 0) {
      expect(result.report.results.find((row: { engine: string }) => row.engine === 'strict').scores.detection.micro.fp).toBe(0);
    } else {
      expect(result.stderr).toMatch(/partial|incomplete/i);
    }
  }, 65_000);
});
