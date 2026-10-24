# Labelling rubric (rubric version `rubric/1`)

This rubric defines what a positive label means for the six stable categories. It applies to the original synthetic seed in `eval/seeds/` and to any separately approved imported dataset. Labels say whether a clause expresses a practice. They are not legal judgements about enforceability.

## Honest exposure note (read first)

The first seed (`s12-seed/1`) was written on 2026-10-23 by the same agent that wrote the strict rules, after those rules existed. It is not independent of the rules, and it carries self-authored bias: the phrasing of positives and negatives was chosen by someone who knew the patterns. Held-out numbers from this seed show regression behavior only. They are not evidence of real-world quality. An independent second labeller and new source text are validation work (PLAN.md section 7).

## Unit and anchor

- The labelled unit is one clause or sentence. In the seed, every unit is one line of the document, and the gold span is the whole unit (its zero-based, end-exclusive UTF-16 offsets in the item text).
- Anchor the whole clause, not a trigger word. A positive label never covers a fragment such as "automatically renews". It covers the sentence that contains it.
- One unit can carry several labels: several categories, or several reasons in one category. Scoring is per category. Reasons are reported, but detection is not scored per reason.

## Categories and reasons

| Category | Positive when the clause says… | Reasons |
|---|---|---|
| `auto_renewal` | a paid plan recurs unless cancelled; the renewal price can change; cancelling has a contextual hurdle (phone/mail only, notice period, fee, no refund on cancel) | `auto_renews`, `price_change_on_renewal`, `cancel_hurdle` |
| `arbitration` | disputes go to binding/individual arbitration; class or collective actions are waived; a jury trial is waived | `binding_arbitration`, `class_action_waiver`, `jury_waiver` |
| `unilateral_change` | the provider may amend the terms on its own; changes take effect by posting or continued use **together with** an amendment right | `modify_any_time`, `notice_by_posting` |
| `data_sale_or_share` | the provider sells personal information; shares it with third parties for their own or unspecified purposes; shares it for advertising/marketing | `sale`, `sharing_third_party`, `sharing_advertising` |
| `liability_cap` | a monetary cap on liability; an explicit exclusion of damages or liability | `damages_cap`, `exclusion_of_damages` |
| `broad_content_license` | a perpetual or irrevocable licence to user content; a sublicensable licence to user content; use of user content to train AI/ML **with** a content-rights grant | `perpetual_irrevocable`, `sublicensable`, `ai_training` |

## Negatives and exclusions (label nothing)

- Negated practices: "we do not sell", "will not automatically renew", "we never share". Scope negation to the practice it governs. "If you do not cancel, it renews" is still positive. "We do not sell your data, but we share it with partners" is negative for `sale` and positive for `sharing_third_party`.
- Bare warranty disclaimers (AS IS, no warranty) without a damages exclusion or cap.
- Cookie-use, data-retention, security and account/password-sharing notices, unless they also express a target practice.
- Disclosure to processors acting only on the provider's behalf under contract, disclosure required by law, and aggregated or de-identified statistics.
- A licence the provider grants to the user (software licence), a user's own choice to share or license content, a limited licence that ends on deletion, and training on non-user data.
- Assent by use alone ("by using the service you agree") is not `unilateral_change`. Never map "contract by using" to an amendment right.
- Choice of law and jurisdiction clauses are not `arbitration`.

## Ambiguity and mixed cases

- If a unit is genuinely ambiguous, label it by the rubric's most literal reading and add the unit ID to `ambiguous` in the seed document. Ambiguous units stay in scoring and are counted in the report.
- If a hard negative is deliberately close to a category, list that category in the unit's hard-negative field. This marks it as a counted hard negative. It is still an ordinary negative for scoring.

## Source-label mapping (imports)

Imports run only through `scripts/prepare-gold.ts --import`. They need an approved local path, an exact revision, a licence and attribution, and redistribution authority, and they are recorded in `MANIFEST.json`.

For UNFAIR-ToS, the proposed mapping covers directly supported labels only. Verify the label names and indices against the actual revision before use:

| UNFAIR-ToS label | Mapped to | Reason |
|---|---|---|
| Arbitration | `arbitration` | `unspecified` |
| Unilateral change | `unilateral_change` | `unspecified` |
| Limitation of liability | `liability_cap` | `unspecified` |
| Contract by using | **excluded** | never mapped to amendment |
| Unilateral termination, Content removal, Choice of law, Jurisdiction | **excluded** | not a target category |

Imported items are evaluated only for the mapped categories. A missing annotation in an incompletely labelled source is not automatically a negative: `evaluatedCategories` lists exactly the categories whose absence counts as negative. Do not vendor OPP-115, CUAD, or any restricted or unlicensed material.

## Annotation completeness

Each item records `evaluatedCategories` and `labelCompleteness`:

- `complete`: every listed category was checked on every unit. A missing label is a negative.
- `partial`: only the listed categories were checked. Other categories are excluded from scoring for that item.

## Freezing

The split is 70/30 dev/held-out by group, with seed `S12-20261023`. All units, paraphrases and variants in one seed document share a group. Held-out file hashes are frozen in `MANIFEST.json` before any new tuning. Do not tune rules, prompts or budgets on held-out results.
