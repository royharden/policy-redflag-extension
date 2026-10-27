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
  it.each(['prompt', 'parser', 'adapter', 'build'])('rejects a mismatched %s version', (version) => {
    const root = process.cwd();
    const temp = mkdtempSync(path.join(tmpdir(), 's12-rv-model-'));
    const manifestText = readFileSync(path.join(root, 'eval/gold/MANIFEST.json'), 'utf8');
    const manifest = JSON.parse(manifestText);
    const header = {
      recordType: 'header', format: 'model-run/1',
      manifestHash: createHash('sha256').update(manifestText).digest('hex'),
      splitName: 'dev', splitHash: manifest.splits.dev.sha256,
      versions: { core: CORE_VERSION, prompt: PROMPT_VERSION, parser: PARSER_VERSION, adapter: ADAPTER_VERSION, build: '0.1.0', [version]: 'foreign/999' },
      modelIdentity: 'synthetic-contract-probe',
    };
    const run = path.join(temp, 'model-run.jsonl');
    writeFileSync(run, `${JSON.stringify(header)}\n`);
    const result = spawnSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/evaluate.ts', '--', '--split', 'dev', '--model-run', run, '--out', path.join(temp, 'results')], { cwd: root, encoding: 'utf8', timeout: 60_000 });
    expect(result.error).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
  }, 65_000);
});
