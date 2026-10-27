import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from '../../src/core/types';
import { PROMPT_VERSION } from '../../src/core/prompt';
import { PARSER_VERSION } from '../../src/core/model';
import { ADAPTER_VERSION } from '../../src/core/on-device';

// what_bug_this_catches: foreign prompt/parser/adapter/build results must not be
// accepted as comparable same-build model measurements (PLAN sections 7 and 9).
describe('RV model-run provenance', () => {
  function probe(change: (header: { versions: Record<string, string>; splitHash: string }) => void, unavailable = false) {
    const root = process.cwd();
    const temp = mkdtempSync(path.join(tmpdir(), 's12-rv-model-'));
    const manifestText = readFileSync(path.join(root, 'eval/gold/MANIFEST.json'), 'utf8');
    const manifest = JSON.parse(manifestText);
    const header = {
      recordType: 'header', format: 'model-run/1',
      manifestHash: createHash('sha256').update(manifestText).digest('hex'),
      splitName: 'dev', splitHash: manifest.splits.dev.sha256,
      versions: { core: CORE_VERSION, prompt: PROMPT_VERSION, parser: PARSER_VERSION, adapter: ADAPTER_VERSION, build: JSON.parse(readFileSync(path.join(root, 'extension/manifest.json'), 'utf8')).version },
      modelIdentity: 'synthetic-contract-probe',
    };
    const run = path.join(temp, 'model-run.jsonl');
    change(header);
    writeFileSync(run, `${JSON.stringify(header)}\n${unavailable ? JSON.stringify({ recordType: 'status', status: 'unavailable', failureCode: 'unsupported_api' }) + '\n' : ''}`);
    const result = spawnSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/evaluate.ts', '--', '--split', 'dev', '--model-run', run, '--out', path.join(temp, 'results')], { cwd: root, encoding: 'utf8', timeout: 60_000 });
    expect(result.error).toBeUndefined();
    return { ...result, report: result.status === 0 ? JSON.parse(readFileSync(path.join(temp, 'results/results.json'), 'utf8')) : null };
  }

  it('accepts the real extension build version and reports all missing items in full-target scope', () => {
    const result = probe(() => undefined);
    expect(result.status, result.stderr).toBe(0);
    const row = result.report.results.find((item: { engine: string }) => item.engine === 'on-device:synthetic-contract-probe');
    expect(row.attempted).toBe(24);
    expect(row.status.missing).toBe(24);
    expect(row.scores.detection.micro.fn).toBeGreaterThan(0);
  }, 65_000);

  it.each(['core', 'prompt', 'parser', 'adapter', 'build'])('rejects a mismatched %s version', (version) => {
    const result = probe((header) => { header.versions[version] = 'foreign/999'; });
    expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
  }, 65_000);

  it.each(['core', 'prompt', 'parser', 'adapter', 'build'])('rejects a missing %s version', (version) => {
    const result = probe((header) => { delete header.versions[version]; });
    expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
  }, 65_000);

  it('keeps valid unavailable output unmeasured', () => {
    const result = probe(() => undefined, true);
    expect(result.status, result.stderr).toBe(0);
    expect(result.report.results.map((row: { engine: string }) => row.engine)).toEqual(['loose', 'strict']);
  }, 65_000);

  it.each(['core', 'prompt', 'parser', 'adapter', 'build'])('rejects unavailable artifacts with foreign %s metadata', (version) => {
    const result = probe((header) => { header.versions[version] = 'foreign/999'; }, true);
    expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
  }, 65_000);

  it.each(['core', 'prompt', 'parser', 'adapter', 'build'])('rejects unavailable artifacts missing %s metadata', (version) => {
    const result = probe((header) => { delete header.versions[version]; }, true);
    expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
  }, 65_000);

  it('rejects unavailable artifacts with a foreign split hash', () => {
    const result = probe((header) => { header.splitHash = 'foreign'; }, true);
    expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
  }, 65_000);
});
