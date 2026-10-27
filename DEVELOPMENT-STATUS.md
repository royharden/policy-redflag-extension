# Development status

## Latest independent review and runtime checkpoint — 2026-10-26

Full acceptance is **blocked**, not complete. Product candidate 2eeb9c9 includes evaluation fixes ce9b011/31d6a43, mixed-engine evidence fix ebc482e and the independent RV suites. Clean INT and RV runs each passed all 130 tests in 14 files with no exclusions/skips, real TypeScript and both builds. V0 install/build scope and V2 evaluation scope have independent PASS.

- V2 now checks core, prompt, parser, adapter and actual extension-manifest build identity before accepting ordinary or unavailable artifacts. Partial labels fail explicitly rather than becoming unknown negatives. Gold groups/hashes/anchors/floors and missing/failed-target handling pass independent regressions. No rules or frozen labels were tuned after held-out results.
- The real Chrome lab ran rules, recorded candidates, semantic audit and rulebook invalidation. Combining rules with recorded evidence now visibly preserves expansion and two repeated occurrences; scoring predictions remain independent of display folding.
- Exact shipped page-agent.js ran against the actual synthetic fixture DOM using a synthetic message adapter: body/footer/details capture; nav/hidden/form exclusions; native-details reveal; virtual-separator Jump/highlights; idempotence; word-mutation staleness; release and 200000-unit truncation all passed. This is scoped DOM evidence, not extension authorization or worker/panel integration.
- The unpacked service worker and eval.html loaded in disposable Chrome 148; eval.html verified and loaded all 33 bundled frozen items and reported manifest build 0.2.0. The LanguageModel API exists, but no activation, model download or actual inference was performed. Quality remains unmeasured.
- Chrome refused CDP Extensions.triggerAction with -32000 `Method not allowed`. No bypass or synthetic activeTab grant was used. Actual toolbar capture, side-panel Jump, real two-tab/navigation/Clear/reopen/session/worker-suspension remain unverified.
- Independent V1-r2 is RETURN for the remaining platform evidence, while confirming the display fix and green combined tests/builds. A subsequent V1 review must request HIGH effort after two returns. Final full-plan acceptance and master integration have not occurred.

Evidence/verdicts and the specific operator requirement are in the outer agentops/full-20261026 records and ROY-20261026-toolbar-platform.md / ROY-20261026-rv-extension-journey.md. No SQL/database applies. Independent second labelling/expanded real-world evaluation, capable-device model measurements, Bolt import and distribution remain unvalidated or outside this run's authorization. No publication or credentials were used.

Historical checkpoints below are preserved; their pending/old test counts are superseded only by the explicit current receipts above.

---

## FULL-mode validation — 2026-10-26

Dirty Mode was closed by Roy at 4:50 PM ET. S12-INT reuses baseline 155ddd9 in FULL-INT on full/int. Independent S12-RV acceptance is required before integration to master.

- Frozen graph: package-lock.json committed in 8b56d81; registry URLs/integrities checked. `npm ci --ignore-scripts --no-audit --no-fund` exited 0.
- `npm run typecheck`: exit 0 with installed declared TypeScript. `npm test`: exit 0, 49 tests in six files.
- `npm run build` and `npm run build:extension`: exit 0. Extension assets include the worker, bridge, panel and evaluation document. Rebuild after gold preparation includes eval-data manifest and both splits.
- `npm run eval:prepare`: exit 0, 33 original groups/documents, dev 24 and held-out 9. `npm run eval -- --split dev`, then held-out: exit 0. Frozen inputs and script-generated held-out reports committed in 8dd602b. No held-out tuning.
- The held-out report is self-authored regression evidence. Arbitration, unilateral change and liability have zero held-out support. Real model results, independent second labelling and expansion to 40/80 remain unvalidated.
- Local lab starts on claimed loopback port 22801. Headless browser configuration and a subsequent local-page navigation both failed with connection timeout (Windows error 10060). Offline doctor completed with nine passes, one unrelated stale-state warning and no failures; no global repair or cleanup was attempted. Real unpacked toolbar/side-panel/lifecycle journeys have not passed.
- V0/V2 review packages are in the outer agentops/full-20261026/to-rv directory. No full-mode acceptance or master merge yet. Reviewer console is blocked by Daybreak; delivery was refused before typing.
- Follow-up fc8191c: shortened the inherited 141-character manifest description to fit Chrome's 132-character limit. Clean `npm test -- --maxWorkers=1 --minWorkers=1` exited 0: 57 tests in eight files, including manifest constraints and isolated fake-model unavailable/capacity/cancel/chunk behavior. Separate corrected `npm run build:extension` exited 0. An earlier surrounding command was interrupted after its passing test summary and before the build; the clean rerun supersedes that interrupted command's exit status.

The historical construction ledger below is preserved. Its “not run” statements are superseded only by the specific execution evidence above; all other deferred checks remain pending.

---

Updated 2026-10-24 by S12-INT (Claude Code, Opus 5.5). Construction ran in **Dirty Mode**: static checks only. No application code, test, build or script was executed; only the no-emit type check and syntax check below ran.

## What was checked

- An already-installed TypeScript 6.0.3 was borrowed read-only from another project. It ran `tsc --noEmit` (strict, `noUnused*`) over `src/core`, `src/extension`, `tests` and `scripts`, with stub declarations for vitest, CSS imports and the Node APIs. Exit 0.
- The lab (`src/demo`) was checked only against crude React stubs. The core API usage type-checks; the remaining errors came from the stubs themselves.
- `node --check extension/page-agent.js` passed.
- All seven packages (P1-P7) passed static review by separate reviewer subagents. The outer `STATUS.md` holds the review log.

The project declares TypeScript ^5.6.3, React 18, Vite 5 and Vitest 2. None of them are installed.

## Deferred validation (one ledger)

| Area | Not yet done | Later step |
|---|---|---|
| Dependencies and Git | install, lockfile, real `npm run typecheck` | one authorized `npm install`, review the lockfile, then `npm ci`; `vite-node` is declared for the eval scripts |
| Tests | `npm test` has never run; expectations were traced by hand only | run, fix real failures |
| Builds | `npm run build`, `npm run build:extension` | check `dist-extension/` paths: `background.js`, `page-agent.js`, `extension/sidepanel.html`, `extension/eval.html`, `chunks/`, `eval-data/` |
| MV3 behavior | never loaded unpacked | PLAN.md section 8 journey plus selected public-page sampling on `/fixtures/acme-terms.html`; restricted pages, two tabs, same- and cross-origin navigation, tab close, Clear |
| Capture and evidence | native details, virtual separators, highlights, mutation staleness in a real DOM | DOM fixtures, then real Chrome |
| Retention | session quota, LRU eviction, worker suspension, reopen revalidation | storage, network and lifecycle audit (no disk policy text) |
| Local model | Prompt API shape, download, context measurement, cancel, hardware | a capable Chrome, plus the unavailable and error paths |
| Evaluation | `eval:prepare` and `eval` never ran; `eval/gold` and `results/` do not exist | prepare, validate dev, freeze, then score held-out; a real `eval.html` export |
| Dataset rights | UNFAIR-ToS mapping is proposed only | verify the revision, licence and redistribution, then attribute |
| Labels | single self-authored labeller with rule exposure | second labeller, new text, expand to 40/80 |
| Accuracy | none measured | results/ from real runs only |
| Bolt | import and web build untested | inspect-and-prepare only (see BOLT-HANDOFF.md) |
| Distribution | none | separate authorization; no store submission |

## Known limitations

- Strict rules are regex heuristics. Negation is clause-scoped and per reason, but it can still misfire on unusual phrasing.
- The seed (`eval/seeds/s12-seed-v1.json`) was written after the rules, by the same author. Treat its results as regression evidence only.
- Frames, shadow DOM, lazy-loaded content, PDFs and non-English text are outside coverage.
