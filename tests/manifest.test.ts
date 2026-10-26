import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));

describe('unpacked extension manifest', () => {
  it('keeps the description within Chrome’s 132-character limit', () => {
    // Regression: the inherited 141-character description exceeded the manifest contract.
    expect(manifest.description.length).toBeLessThanOrEqual(132);
  });

  it('keeps toolbar-only capture and the four authorized permissions', () => {
    expect(manifest.manifest_version).toBe(3);
    expect([...manifest.permissions].sort()).toEqual(['activeTab', 'scripting', 'sidePanel', 'storage'].sort());
    expect(manifest.action.default_popup).toBeUndefined();
    for (const key of ['host_permissions', 'optional_host_permissions', 'content_scripts', 'externally_connectable']) {
      expect(manifest[key]).toBeUndefined();
    }
  });
});
