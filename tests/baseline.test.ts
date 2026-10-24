import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analyze';
import { detectBaseline } from '../src/core/baseline';
import { CATEGORY_IDS } from '../src/core/types';
import { CORPUS } from '../src/core/fixtures';

function flagsFor(id: string, mode: 'strict' | 'loose') {
  const fixture = CORPUS.find((item) => item.id === id);
  if (!fixture) throw new Error(`missing fixture ${id}`);
  return analyze({
    text: fixture.text,
    enabledCategoryIds: CATEGORY_IDS,
    candidates: detectBaseline(fixture.text, mode),
  }).flags;
}

describe('baseline', () => {
  it('hits every category on the hobby-box terms', () => {
    const categories = new Set(flagsFor('member-box', 'strict').map((flag) => flag.categoryId));
    expect([...categories].sort()).toEqual([...CATEGORY_IDS].sort());
  });

  it('does not flag negated promises', () => {
    expect(flagsFor('near-miss', 'strict')).toEqual([]);
  });

  it('misses an arbitration paraphrase that avoids the planted phrases', () => {
    expect(flagsFor('paraphrase-arbitration', 'strict').map((flag) => flag.categoryId)).not.toContain('arbitration');
    expect(flagsFor('paraphrase-arbitration', 'loose')).toEqual([]);
  });

  it('leaves the bulletin clean while the loose baseline fires', () => {
    expect(flagsFor('loose-bulletin', 'strict')).toEqual([]);
    expect(flagsFor('loose-bulletin', 'loose').length).toBeGreaterThanOrEqual(4);
  });
});
