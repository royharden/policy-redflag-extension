# Development status

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
