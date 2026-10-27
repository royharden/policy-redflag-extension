# Measured results (held-out)

Generated 2026-10-27T01:58:42.340Z by scripts/evaluate.ts. Manifest 5a4881e5c360c5c6…, split 949f6024eba477ec…, core core/1, rules rules-strict/1.

## Limitations

- Written after the strict rules by the same author. Self-authored bias; held-out results are regression evidence only. Imported items (if any) were not used to write the rules.
- Detection counts a prediction overlapping a labelled unit; exact needs equal offsets; relaxed needs IoU >= 0.5.
- Ambiguous quote-only predictions are one unit that may match through any recorded occurrence.
- A located quote proves text presence, not category correctness; wrong-category real quotes count as FP/FN here.
- On-device model: not measured (no validated eval.html model-run.jsonl was supplied).

## loose

Attempted 9 item(s). Status: {"complete":9}. Detection micro-F1 group-bootstrap 95% interval: 63.4%–77.2%.

### detection

| Category | Support | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| arbitration | 0 | 0 | 0 | 0 | undefined | undefined | undefined |
| unilateral_change | 0 | 0 | 0 | 0 | undefined | undefined | undefined |
| liability_cap | 0 | 0 | 0 | 0 | undefined | undefined | undefined |
| data_sale_or_share | 4 | 4 | 3 | 0 | 57.1% | 100% | 72.7% |
| auto_renewal | 9 | 8 | 2 | 1 | 80% | 88.9% | 84.2% |
| broad_content_license | 8 | 6 | 7 | 2 | 46.2% | 75% | 57.1% |
| **micro** | 21 | 18 | 12 | 3 | 60% | 85.7% | 70.6% |
| **macro** (3 defined) | | | | | 61.1% | 88% | 71.4% |

### exact

| Category | Support | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| arbitration | 0 | 0 | 0 | 0 | undefined | undefined | undefined |
| unilateral_change | 0 | 0 | 0 | 0 | undefined | undefined | undefined |
| liability_cap | 0 | 0 | 0 | 0 | undefined | undefined | undefined |
| data_sale_or_share | 4 | 4 | 3 | 0 | 57.1% | 100% | 72.7% |
| auto_renewal | 9 | 8 | 2 | 1 | 80% | 88.9% | 84.2% |
| broad_content_license | 8 | 6 | 7 | 2 | 46.2% | 75% | 57.1% |
| **micro** | 21 | 18 | 12 | 3 | 60% | 85.7% | 70.6% |
| **macro** (3 defined) | | | | | 61.1% | 88% | 71.4% |

### relaxed

| Category | Support | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| arbitration | 0 | 0 | 0 | 0 | undefined | undefined | undefined |
| unilateral_change | 0 | 0 | 0 | 0 | undefined | undefined | undefined |
| liability_cap | 0 | 0 | 0 | 0 | undefined | undefined | undefined |
| data_sale_or_share | 4 | 4 | 3 | 0 | 57.1% | 100% | 72.7% |
| auto_renewal | 9 | 8 | 2 | 1 | 80% | 88.9% | 84.2% |
| broad_content_license | 8 | 6 | 7 | 2 | 46.2% | 75% | 57.1% |
| **micro** | 21 | 18 | 12 | 3 | 60% | 85.7% | 70.6% |
| **macro** (3 defined) | | | | | 61.1% | 88% | 71.4% |

Error audit (first examples; overlap-based listing): 12 FP, 3 FN.

- FP seed:bill-06 [auto_renewal] Our servers are powered by renewable energy.
- FP seed:bill-08 [broad_content_license] Lifetime licences are paid once and never billed again.
- FP seed:bill-09 [auto_renewal] Perpetual software licences purchased outright do not require renewal.
- FP seed:bill-09 [broad_content_license] Perpetual software licences purchased outright do not require renewal.
- FP seed:priv-04 [data_sale_or_share] Profiles for children are never used for advertising and are not shared.
- FP seed:priv-04 [data_sale_or_share] You can share a show link with a friend by text message.
- FP seed:priv-09 [data_sale_or_share] We do not sell personal information as defined by applicable law.
- FP seed:cont-07 [broad_content_license] Buyers receive a license to your design only after paying for it.
- FP seed:cont-08 [broad_content_license] The license we take to your review ends when you delete it.
- FP seed:cont-09 [broad_content_license] Stickers are licensed to you for use inside Chatterbox only.
- FP seed:cont-10 [broad_content_license] We take only the license needed to show your portfolio to visitors.
- FP seed:cont-10 [broad_content_license] You can choose a licence for each artwork that visitors must follow.
- FN seed:bill-06 [auto_renewal] You must give at least 60 days notice before the end of the term to cancel your plan.
- FN seed:cont-08 [broad_content_license] Reviews may be sublicensed to the businesses you review for use in their advertising.
- FN seed:cont-09 [broad_content_license] The rights you grant in your messages are perpetual and may be sublicensed to our affiliates.

## strict

Attempted 9 item(s). Status: {"complete":9}. Detection micro-F1 group-bootstrap 95% interval: 43.5%–70.6%.

### detection

| Category | Support | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| arbitration | 0 | 0 | 0 | 0 | undefined | undefined | undefined |
| unilateral_change | 0 | 0 | 0 | 0 | undefined | undefined | undefined |
| liability_cap | 0 | 0 | 0 | 0 | undefined | undefined | undefined |
| data_sale_or_share | 4 | 2 | 0 | 2 | 100% | 50% | 66.7% |
| auto_renewal | 9 | 5 | 0 | 4 | 100% | 55.6% | 71.4% |
| broad_content_license | 8 | 2 | 0 | 6 | 100% | 25% | 40% |
| **micro** | 21 | 9 | 0 | 12 | 100% | 42.9% | 60% |
| **macro** (3 defined) | | | | | 100% | 43.5% | 59.4% |

### exact

| Category | Support | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| arbitration | 0 | 0 | 0 | 0 | undefined | undefined | undefined |
| unilateral_change | 0 | 0 | 0 | 0 | undefined | undefined | undefined |
| liability_cap | 0 | 0 | 0 | 0 | undefined | undefined | undefined |
| data_sale_or_share | 4 | 2 | 0 | 2 | 100% | 50% | 66.7% |
| auto_renewal | 9 | 5 | 0 | 4 | 100% | 55.6% | 71.4% |
| broad_content_license | 8 | 2 | 0 | 6 | 100% | 25% | 40% |
| **micro** | 21 | 9 | 0 | 12 | 100% | 42.9% | 60% |
| **macro** (3 defined) | | | | | 100% | 43.5% | 59.4% |

### relaxed

| Category | Support | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| arbitration | 0 | 0 | 0 | 0 | undefined | undefined | undefined |
| unilateral_change | 0 | 0 | 0 | 0 | undefined | undefined | undefined |
| liability_cap | 0 | 0 | 0 | 0 | undefined | undefined | undefined |
| data_sale_or_share | 4 | 2 | 0 | 2 | 100% | 50% | 66.7% |
| auto_renewal | 9 | 5 | 0 | 4 | 100% | 55.6% | 71.4% |
| broad_content_license | 8 | 2 | 0 | 6 | 100% | 25% | 40% |
| **micro** | 21 | 9 | 0 | 12 | 100% | 42.9% | 60% |
| **macro** (3 defined) | | | | | 100% | 43.5% | 59.4% |

Error audit (first examples; overlap-based listing): 0 FP, 12 FN.

- FN seed:bill-06 [auto_renewal] You must give at least 60 days notice before the end of the term to cancel your plan.
- FN seed:bill-06 [auto_renewal] We remind you by email two weeks before any renewal and you can turn renewal off in settings.
- FN seed:bill-08 [auto_renewal] After the first year, your plan renews at the regular price instead of the promotional price.
- FN seed:bill-09 [auto_renewal] We may adjust maintenance fees at renewal by up to the change in the consumer price index.
- FN seed:priv-04 [data_sale_or_share] We share your viewing history with advertising partners to show you targeted ads on other sites.
- FN seed:priv-09 [data_sale_or_share] Contact information of your users may be disclosed to our reseller partners.
- FN seed:cont-07 [broad_content_license] You grant Penstroke an irrevocable license to use your designs in our marketing, with the right to sublicense those rights to agencies.
- FN seed:cont-08 [broad_content_license] By submitting a review you grant us a perpetual and irrevocable license to use it in any media.
- FN seed:cont-08 [broad_content_license] Reviews may be sublicensed to the businesses you review for use in their advertising.
- FN seed:cont-09 [broad_content_license] The rights you grant in your messages are perpetual and may be sublicensed to our affiliates.
- FN seed:cont-10 [broad_content_license] You grant us a worldwide, sublicensable license to reproduce the artwork in your portfolio.
- FN seed:cont-10 [broad_content_license] Uploaded artwork may be used under the license you grant to fine-tune our AI style models.
