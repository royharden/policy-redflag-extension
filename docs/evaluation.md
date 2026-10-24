# Evaluation

Nothing here has been measured yet. All numbers come from `scripts/evaluate.ts`. That script is the only writer of `results/results.json` and `results/results.md`, and the README and the web lab only read those files.

## Data

- **Rubric:** [eval/LABELLING.md](../eval/LABELLING.md) (`rubric/1`). It covers whole-clause anchors, negation, exclusions and import mapping.
- **Seed:** `eval/seeds/s12-seed-v1.json` is original synthetic text in 33 grouped documents.
  - Positives: 23 `auto_renewal`, 20 `data_sale_or_share` and 20 `broad_content_license`.
  - Counted hard negatives: at least 40 for each of those three categories.
  - The other three categories have smoke coverage only.
  - Exposure: the seed was written after the rules, by the same author.
- **Northwind** fixtures in `src/core/fixtures.ts` are smoke data for tests and the lab's fixture picker. They are never used as accuracy data.
- **Imports:** `npm run eval:prepare -- --import …` accepts only an approved local file, given with `--source-name`, `--revision`, `--licence`, `--attribution`, an approved `--sha256` (checked before parsing) and `--redistribution-approved`. UNFAIR-ToS maps only arbitration, unilateral change and limitation of liability. "Contract by using" is never mapped. Do not vendor OPP-115, CUAD or any unlicensed material.

## Freezing

`eval:prepare` splits the data 70/30 into dev and held-out, by group, with seed `S12-20261023`. It writes the split files and `MANIFEST.json`, which records sources, hashes, groups, counts, completeness and exposure. Once the held-out hash is frozen, changing that file aborts preparation unless `--refreeze` is passed. Invalid anchors, unknown labels, split leakage or hash mismatches abort both preparation and scoring.

## Engines and rows

- `loose` is the keyword baseline and `strict` is the shipped rules. Both run uncapped.
- `on-device:<reported id or unknown>` comes only from a real `extension/eval.html` export (`model-run.jsonl`) that matches the manifest, split and core versions. A run on unsupported hardware produces an unavailable status artifact, and that row is not measured.
- `strict-union-on-device` appears when a real model run exists.

## Metrics

- Per category: TP, FP, FN, support, precision, recall and F1, plus micro and macro averages. Undefined denominators are shown as `undefined`, never as 0%.
- Matching is maximum-cardinality and one-to-one within each item and category.
- **detection:** a prediction that overlaps a labelled unit.
- **exact:** equal original offsets.
- **relaxed:** IoU ≥ 0.5. This threshold was frozen before any run.
- Ambiguous quote-only predictions count as one unit, which may match through any recorded occurrence.
- Failed or missing model items stay in the full target set.
- The report adds a group-bootstrap interval for detection micro-F1 and an error audit.

Sampled-set precision is not real-world prevalence precision. Freeze settings before held-out runs, and never tune on held-out results.
