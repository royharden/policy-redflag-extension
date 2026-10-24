# Evaluation

The numbers in the demo are computed from `src/core/fixtures.ts` by `compareBaselines()`. They compare two local baselines on the same gold spans:

- **Strict** patterns look for multi-word clause shapes. A short negation window (`not`, `never`, `no`, `neither`) before the match suppresses a hit when the sentence is a refusal.
- **Loose** patterns are single keywords. They are the comparison baseline, not the default scan.

A gold span matches a prediction when they overlap in the same document and category. Each gold span pairs with at most one prediction. Precision and recall are reported per category and as a micro average. A category with no gold and no predictions shows `n/a`.

## What this set can show

The hobby-box sample plants one obvious sentence for each category, plus a second liability sentence. A separate note describes arbitration without using the word, so strict recall on the whole set is below 100%. A community bulletin uses words like share, renew, license, modify, and liability without being those clauses, so loose precision is lower than strict precision. Negated promises ("we do not require binding arbitration", "we will never sell your personal information") are in the set so the strict scan can be checked for those false hits.

The strict patterns were written for these sentences. A high strict score here is a smoke check, not evidence about real policies.

## What this set is not

| Source | Why it is not in the repo |
|---|---|
| LexGLUE UNFAIR-ToS (CC BY 4.0) | Covers arbitration, unilateral change, and liability language, not auto-renewal or broad content licences. Not vendored in this pass. |
| CUAD (CC BY 4.0) | Commercial contracts, not consumer terms. Not vendored. |
| OPP-115 | The annotation files are research / non-commercial. They are not redistributed. |
| ToS;DR browser extension | AGPL-3.0. Not used as code. |

A later labelled run has to record the licence, the split, and the per-category counts before anyone quotes a model score. Recorded JSON in the demo is a quote-or-drop example, not a model measurement.

Provenance string in code: hand-written synthetic policies created for this repository on 2026-10-23.
