# Bolt handoff: Policy Red Flag

Updated 2026-10-24. **Inspect-and-prepare only.** Nothing has been imported, built or published.

## What Bolt hosts

Bolt hosts only the **web lab** (React + Vite) and the static fixture page `public/fixtures/acme-terms.html`. The Chrome extension (`npm run build:extension` → `dist-extension/`) is a local unpacked-load step. Bolt does not load extensions, and it does not establish on-device model support.

## Infrastructure

- Database: **none.** No Supabase, SQL, migrations, edge functions, auth, buckets, realtime or scheduled jobs.
- Secrets: **none.** `.env.example` has one optional public label, `VITE_APP_NAME`. There is no provider key, endpoint or proxy.
- Outside services: none. The web lab makes no network calls and never runs live inference.

## Source identity

- The local Git repository is in this folder, on branch `master`, with no remote. Record the final local revision with `git log -1` at handoff time. Bolt import needs a pushed repository, which has **not** been authorized or created. Record the actual repository, branch and revision at import time; none exists yet, and none is invented here.
- `package.json` declares the dependency ranges. **No lockfile exists yet.** The first authorized install creates one and must be reviewed.

## Commands and outputs

| Command | Output | Status |
|---|---|---|
| `npm install` (first time), then `npm ci` | `node_modules/`, `package-lock.json` | not run |
| `npm run typecheck` / `npm test` | — | not run |
| `npm run dev` | lab at `/`, fixture at `/fixtures/acme-terms.html` | not run |
| `npm run build` | `dist/` (lab + fixtures) | not run |
| `npm run build:extension` | `dist-extension/` | not run; not for Bolt |
| `npm run eval:prepare`, `npm run eval` | `eval/gold/`, `results/` | not run |

## Acceptance checks (all pending)

| Check | Expected |
|---|---|
| Install/build | `dist/` builds from a reviewed lockfile |
| Lab journey | ACME fixture → "Check with rules" shows all six categories with quotes, no grade; "Rules + recorded candidates" accepts the full quote, rejects the fabricated and prefix-plus-fiction quotes in Diagnostics, expands the fragment and marks the repeated quote ambiguous; "Semantic-audit example" accepts a real quote under the wrong category and explains why |
| Evaluation view | Shows "Not measured" until `results/results.json` exists |
| No backend | No database or function is created |

## Prompt after an authorized GitHub import

> INSPECT-AND-PREPARE-ONLY. Read BOLT-HANDOFF.md and README.md, and inspect the imported source at the recorded branch and revision. This app has no database, migrations, edge functions or secrets. Do not create any of them, do not enter keys and do not publish. Run a clean install, `npm run typecheck`, `npm test` and `npm run build`, and report the real output. Confirm that `npm run dev` serves the lab and `/fixtures/acme-terms.html`, and walk through the lab journey in this file. Report any unexecuted check as not done. Leave the Chrome extension as a local unpacked-load step.
