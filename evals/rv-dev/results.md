# Measured results (dev)

Generated 2026-10-27T01:58:38.560Z by scripts/evaluate.ts. Manifest 5a4881e5c360c5c6…, split fd719b27fdcdc0ea…, core core/1, rules rules-strict/1.

## Limitations

- Written after the strict rules by the same author. Self-authored bias; held-out results are regression evidence only. Imported items (if any) were not used to write the rules.
- Detection counts a prediction overlapping a labelled unit; exact needs equal offsets; relaxed needs IoU >= 0.5.
- Ambiguous quote-only predictions are one unit that may match through any recorded occurrence.
- A located quote proves text presence, not category correctness; wrong-category real quotes count as FP/FN here.
- On-device model: not measured (no validated eval.html model-run.jsonl was supplied).

## loose

Attempted 24 item(s). Status: {"complete":24}. Detection micro-F1 group-bootstrap 95% interval: 46.8%–60.7%.

### detection

| Category | Support | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| arbitration | 4 | 4 | 3 | 0 | 57.1% | 100% | 72.7% |
| unilateral_change | 3 | 2 | 2 | 1 | 50% | 66.7% | 57.1% |
| liability_cap | 3 | 3 | 1 | 0 | 75% | 100% | 85.7% |
| data_sale_or_share | 16 | 12 | 17 | 4 | 41.4% | 75% | 53.3% |
| auto_renewal | 14 | 5 | 6 | 9 | 45.5% | 35.7% | 40% |
| broad_content_license | 12 | 9 | 14 | 3 | 39.1% | 75% | 51.4% |
| **micro** | 52 | 35 | 43 | 17 | 44.9% | 67.3% | 53.8% |
| **macro** (6 defined) | | | | | 51.4% | 75.4% | 60.1% |

### exact

| Category | Support | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| arbitration | 4 | 4 | 3 | 0 | 57.1% | 100% | 72.7% |
| unilateral_change | 3 | 2 | 2 | 1 | 50% | 66.7% | 57.1% |
| liability_cap | 3 | 3 | 1 | 0 | 75% | 100% | 85.7% |
| data_sale_or_share | 16 | 12 | 17 | 4 | 41.4% | 75% | 53.3% |
| auto_renewal | 14 | 5 | 6 | 9 | 45.5% | 35.7% | 40% |
| broad_content_license | 12 | 9 | 14 | 3 | 39.1% | 75% | 51.4% |
| **micro** | 52 | 35 | 43 | 17 | 44.9% | 67.3% | 53.8% |
| **macro** (6 defined) | | | | | 51.4% | 75.4% | 60.1% |

### relaxed

| Category | Support | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| arbitration | 4 | 4 | 3 | 0 | 57.1% | 100% | 72.7% |
| unilateral_change | 3 | 2 | 2 | 1 | 50% | 66.7% | 57.1% |
| liability_cap | 3 | 3 | 1 | 0 | 75% | 100% | 85.7% |
| data_sale_or_share | 16 | 12 | 17 | 4 | 41.4% | 75% | 53.3% |
| auto_renewal | 14 | 5 | 6 | 9 | 45.5% | 35.7% | 40% |
| broad_content_license | 12 | 9 | 14 | 3 | 39.1% | 75% | 51.4% |
| **micro** | 52 | 35 | 43 | 17 | 44.9% | 67.3% | 53.8% |
| **macro** (6 defined) | | | | | 51.4% | 75.4% | 60.1% |

Error audit (first examples; overlap-based listing): 43 FP, 17 FN.

- FP seed:bill-01 [auto_renewal] Day passes are a one-time purchase and never renew.
- FP seed:bill-01 [auto_renewal] Prepaid ten-class packs expire after six months and are not renewed or recharged.
- FP seed:bill-02 [auto_renewal] Monthly plans do not renew automatically; you choose whether to buy another month.
- FP seed:bill-02 [auto_renewal] Students can renew their verification each school year to keep the discount.
- FP seed:bill-03 [auto_renewal] You can renew an expired permit at the front desk if you want one again.
- FP seed:bill-07 [data_sale_or_share] We may change the cover price of single issues sold in shops.
- FP seed:bill-10 [broad_content_license] Classroom licences are purchased by schools for one school year and expire in June.
- FP seed:bill-10 [auto_renewal] Parents can renew a lost password from the sign-in screen.
- FP seed:priv-01 [data_sale_or_share] Do not share your membership barcode with other people.
- FP seed:priv-01 [data_sale_or_share] You can share your workout streak with friends from the app if you choose.
- FP seed:priv-02 [data_sale_or_share] We will never sell your notes or the personal information in your account.
- FP seed:priv-02 [data_sale_or_share] We may disclose information when a court order requires it.
- FP seed:priv-03 [broad_content_license] Your personal data may be sold to third parties as part of our data licensing program.
- FP seed:priv-03 [data_sale_or_share] We do not share your personal information with advertisers.
- FP seed:priv-05 [data_sale_or_share] We never sell your personal information to anyone.
- FN seed:bill-01 [auto_renewal] If you do not cancel before your billing date, we will charge the card on file for the next month.
- FN seed:bill-03 [auto_renewal] Annual permits can only be cancelled by sending written notice by certified mail to our office.
- FN seed:bill-03 [auto_renewal] Permits continue to bill each quarter until we receive your cancellation.
- FN seed:bill-04 [auto_renewal] After your free trial ends, your plan converts to a paid subscription that recurs monthly.
- FN seed:bill-04 [auto_renewal] To cancel, you must call our retention team during business hours.
- FN seed:bill-05 [auto_renewal] An early termination fee of 25 dollars applies if you cancel within the first three months of your plan.
- FN seed:bill-07 [auto_renewal] Print subscriptions continue to be billed every issue until you tell us to stop.
- FN seed:bill-07 [auto_renewal] Cancellation requests are accepted only by telephone and no refunds are given for issues already shipped.
- FN seed:bill-10 [auto_renewal] To cancel a subscription bought on our website, you must email support and wait for written confirmation.
- FN seed:priv-02 [data_sale_or_share] Advertising networks may receive your device identifiers and browsing activity from our apps.
- FN seed:priv-03 [data_sale_or_share] We may provide your personal information to data brokers who combine it with other sources.
- FN seed:priv-07 [data_sale_or_share] We rent our subscriber list, including your name and mailing address, to other publishers.
- FN seed:priv-08 [data_sale_or_share] We transfer your personal information to our parent company and its affiliates for their marketing.
- FN seed:cont-04 [broad_content_license] We may transfer or sublicense the rights in your posts to any successor of our business.
- FN seed:cont-05 [broad_content_license] You grant us the right to use the videos you upload to develop and train our artificial intelligence models.

## strict

Attempted 24 item(s). Status: {"complete":24}. Detection micro-F1 group-bootstrap 95% interval: 71.1%–90%.

### detection

| Category | Support | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| arbitration | 4 | 4 | 0 | 0 | 100% | 100% | 100% |
| unilateral_change | 3 | 3 | 0 | 0 | 100% | 100% | 100% |
| liability_cap | 3 | 3 | 0 | 0 | 100% | 100% | 100% |
| data_sale_or_share | 16 | 10 | 0 | 6 | 100% | 62.5% | 76.9% |
| auto_renewal | 14 | 6 | 0 | 8 | 100% | 42.9% | 60% |
| broad_content_license | 12 | 10 | 0 | 2 | 100% | 83.3% | 90.9% |
| **micro** | 52 | 36 | 0 | 16 | 100% | 69.2% | 81.8% |
| **macro** (6 defined) | | | | | 100% | 81.4% | 88% |

### exact

| Category | Support | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| arbitration | 4 | 4 | 0 | 0 | 100% | 100% | 100% |
| unilateral_change | 3 | 3 | 0 | 0 | 100% | 100% | 100% |
| liability_cap | 3 | 3 | 0 | 0 | 100% | 100% | 100% |
| data_sale_or_share | 16 | 10 | 0 | 6 | 100% | 62.5% | 76.9% |
| auto_renewal | 14 | 6 | 0 | 8 | 100% | 42.9% | 60% |
| broad_content_license | 12 | 10 | 0 | 2 | 100% | 83.3% | 90.9% |
| **micro** | 52 | 36 | 0 | 16 | 100% | 69.2% | 81.8% |
| **macro** (6 defined) | | | | | 100% | 81.4% | 88% |

### relaxed

| Category | Support | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| arbitration | 4 | 4 | 0 | 0 | 100% | 100% | 100% |
| unilateral_change | 3 | 3 | 0 | 0 | 100% | 100% | 100% |
| liability_cap | 3 | 3 | 0 | 0 | 100% | 100% | 100% |
| data_sale_or_share | 16 | 10 | 0 | 6 | 100% | 62.5% | 76.9% |
| auto_renewal | 14 | 6 | 0 | 8 | 100% | 42.9% | 60% |
| broad_content_license | 12 | 10 | 0 | 2 | 100% | 83.3% | 90.9% |
| **micro** | 52 | 36 | 0 | 16 | 100% | 69.2% | 81.8% |
| **macro** (6 defined) | | | | | 100% | 81.4% | 88% |

Error audit (first examples; overlap-based listing): 0 FP, 16 FN.

- FN seed:bill-01 [auto_renewal] If you do not cancel before your billing date, we will charge the card on file for the next month.
- FN seed:bill-02 [auto_renewal] Quillnote Pro is billed annually and renews at the then-current list price.
- FN seed:bill-03 [auto_renewal] Annual permits can only be cancelled by sending written notice by certified mail to our office.
- FN seed:bill-04 [auto_renewal] After your free trial ends, your plan converts to a paid subscription that recurs monthly.
- FN seed:bill-04 [auto_renewal] To cancel, you must call our retention team during business hours.
- FN seed:bill-07 [auto_renewal] Print subscriptions continue to be billed every issue until you tell us to stop.
- FN seed:bill-07 [auto_renewal] Cancellation requests are accepted only by telephone and no refunds are given for issues already shipped.
- FN seed:bill-10 [auto_renewal] To cancel a subscription bought on our website, you must email support and wait for written confirmation.
- FN seed:priv-01 [data_sale_or_share] We share your contact details with partner gyms so they can send you their own offers.
- FN seed:priv-02 [data_sale_or_share] Advertising networks may receive your device identifiers and browsing activity from our apps.
- FN seed:priv-05 [data_sale_or_share] We may sell or rent your name, address and order history to other food brands.
- FN seed:priv-07 [data_sale_or_share] We rent our subscriber list, including your name and mailing address, to other publishers.
- FN seed:priv-08 [data_sale_or_share] We may sell de-identified browsing data together with your account email to research firms.
- FN seed:priv-10 [data_sale_or_share] Parent email addresses may be sold to companies that sell school supplies.
- FN seed:cont-02 [broad_content_license] By posting a story you give Wordloft an irrevocable license to publish, adapt and translate it.
