# Policy Red Flag

Policy Red Flag is a Chrome (Manifest V3) extension, plus a small web lab, for reviewing a Terms of Service or Privacy page you choose. A keyless rules check flags six kinds of consumer red-flag clauses. Every finding shows the original quote, its section and a Jump link to the place on the page. An opt-in on-device model (Chrome's built-in Prompt API) can add findings where the hardware supports it.

It does not grade terms, score them or give legal advice. A verified quote proves the text is on the page. It does not prove the category is right or that the clause is enforceable. No findings never means the terms are safe.

> **Status: source written, nothing executed.** This build was made in Dirty Mode: static checks only. No dependencies have been installed. No lockfile exists. Tests, type checks with the declared TypeScript, both builds, the unpacked extension, the on-device model and the evaluation scripts have not run. See [DEVELOPMENT-STATUS.md](DEVELOPMENT-STATUS.md).

## Categories

| ID | Flags | Reasons |
|---|---|---|
| `auto_renewal` | recurring billing, renewal price changes, cancellation hurdles | `auto_renews`, `price_change_on_renewal`, `cancel_hurdle` |
| `arbitration` | binding arbitration, class-action and jury waivers | `binding_arbitration`, `class_action_waiver`, `jury_waiver` |
| `unilateral_change` | provider amendment rights, change-by-posting | `modify_any_time`, `notice_by_posting` |
| `data_sale_or_share` | sale, third-party sharing, advertising sharing | `sale`, `sharing_third_party`, `sharing_advertising` |
| `liability_cap` | monetary caps, damages exclusions (not bare AS IS) | `damages_cap`, `exclusion_of_damages` |
| `broad_content_license` | perpetual/irrevocable, sublicensable, AI training of your content | `perpetual_irrevocable`, `sublicensable`, `ai_training` |

Presets: `consumer-core` (all six), `dispute-and-liability`, `privacy-sale` and `billing-and-content`. Any other toggle set is "custom".

## How it works

1. You click the toolbar icon. The side panel opens, and the extension injects `page-agent.js` into the top frame of that tab only (`activeTab`). Only http and https pages are supported.
2. The bridge captures the eligible page body. It excludes scripts, form fields, editable areas, navigation and hidden text. Text inside closed native `<details>` is included. Capture is capped at 200,000 characters.
3. The strict rules emit whole sentences (or clauses), with negation scoped to each reason and clause. The shared validator then accepts only evidence it can locate exactly.
4. The panel shows findings, coverage, Diagnostics (rejected candidates) and a Clear button. Jump re-checks the live page, opens a collapsed section if needed and highlights the quote. If the text has changed, Jump says so and asks you to capture again.
5. The optional on-device model runs in the side panel, never in the worker. Its quotes go through the same validator. Unsupported hardware is reported as unavailable.

Scan data stays in `chrome.storage.session`: one scan per tab, at most three tabs and 6 MiB. It is cleared by Clear, navigation, closing the tab, or a browser or extension restart. Only your settings persist. See [docs/privacy-and-permissions.md](docs/privacy-and-permissions.md).

## Layout

```text
src/core/        shared TypeScript: contracts, normalization, validator, rules, parser, prompt, metrics, gold format,
                 on-device adapter (imported only by extension pages); grade.ts and legacy/ are retained but unused
src/extension/   service worker, side panel, local-model controls, eval.html runner, message/storage protocol
extension/       manifest.json, page-agent.js (bridge), sidepanel.html, eval.html
src/demo/        React paste/fixture lab (no tab access, no live inference)
public/fixtures/ acme-terms.html: the synthetic page for the extension validation journey
eval/            LABELLING.md rubric, seeds/ (original synthetic seed); gold/ is written by eval:prepare
scripts/         prepare-gold.ts, evaluate.ts
tests/           focused Vitest source (not executed)
```

## Commands (none have been run)

From this folder:

```text
npm install              # first authorized install creates package-lock.json; review it, then use npm ci
npm run typecheck
npm test
npm run dev              # web lab; the fixture page is at /fixtures/acme-terms.html
npm run build            # web lab -> dist/
npm run build:extension  # extension -> dist-extension/ (load unpacked in Chrome)
npm run eval:prepare     # freeze eval/gold/ from the local seed (and any approved local import)
npm run eval -- --split dev
npm run eval -- --split held-out --model-run path/to/model-run.jsonl
```

Measured numbers exist only in `results/results.json` and `results/results.md`, which `scripts/evaluate.ts` writes. Until those files exist, quality is **not measured**. The on-device model stays **not measured** until a real `extension/eval.html` export has been validated.

## Licence

MIT (see [LICENSE](LICENSE)). The code, fixtures and seed text are original. See [NOTICE](NOTICE).
