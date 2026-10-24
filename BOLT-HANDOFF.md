# Bolt infrastructure handoff: Policy Red Flag

Dirty Mode construction — runtime unverified. This file is the provisioning inventory. It is not a claim that Bolt, Chrome, or a model provider has been exercised.

## Target and readiness

- Repository / branch / prepared revision: local git only, no remote. Branch `main` after the construction commits. Do not treat a commit hash in this file as the revision; use the clone you import.
- App root: repository root (the inner `policy-redflag-extension` folder).
- Database: none.
- Target: no database. Do not create a Bolt Database or a Supabase project for this app.
- Existing baseline / applied migrations: none. No SQL files.
- Hosting: Bolt hosting can serve the Vite demo later. The Chrome extension is not a Bolt host target.
- Publication: prepare only. Do not publish.
- Bolt action: inspect and prepare only.
- Status: implementation present in source; infrastructure not required; runtime unverified.
- Owner prerequisites: GitHub access if the repo is imported later. No database connection. A model key is optional and is typed by the user, not entered as a Bolt server secret.

## Build and connection

| Item | Exact command or configuration name |
|---|---|
| Runtime / package manager | Node 22+ recommended. npm. No lockfile committed yet. |
| Frozen install / dev | After a lockfile exists: `npm ci` then `npm run dev`. Until then, install is not frozen. |
| Build / output | `npm run build` writes the demo to `dist/`. `npm run build:extension` writes the extension to `dist-extension/`. |
| Type/lint/tests | `npm run typecheck`, `npm test`. Not run in Dirty Mode. |
| Client file / public env names | No Supabase client. Optional public name: `VITE_APP_NAME`. |
| Missing config behavior | The demo renders and the baseline scan runs with no environment file. |

## Database

Not required. Do not add a database to make the import succeed.

- Access model: not applicable. Scans stay in the browser. The extension uses `chrome.storage.session` for the last page and `chrome.storage.local` for the rulebook and optional model key.
- Ownership checks: not applicable.
- Extensions/RPC permissions/Realtime: not required.
- Seeds: synthetic policies live in `src/core/fixtures.ts`. They are source, not database seed.
- Retry rule: not applicable.

## Functions

Not required. There is no `supabase/functions` directory. Do not deploy a proxy. A hosted model is called from the browser only when the user supplies an endpoint and a key.

- CORS/preflight: not applicable for a project backend. Provider CORS can block the demo; that must surface as an error.
- Identity/ownership and abuse controls: `src/core/model.ts` rejects non-HTTPS remote hosts, metadata hosts, and private addresses other than localhost / 127.0.0.1 / ::1.
- Paid API limits: not required. There is no project-paid key. The user brings their own key.
- Webhooks: not required.
- Platform credentials: none.

## Server secrets to enter through settings

Not required. Do not create a server secret for the model. Never add a `VITE_` API key.

| Name | Consumer | Required / optional | Owner source |
|---|---|---|---|
| None | — | — | — |

Missing-secret behavior: `completeChat` throws `ModelRequestError` when the key, model name, or endpoint is missing or rejected. The UI shows that message and does not create flags.

## Auth, storage, and external steps

- Auth providers/confirmation: not required.
- Site URL and callback/recovery routes: not required.
- Buckets: not required.
- Realtime: not required.
- Scheduled/long jobs: not required.
- Outside services: optional. Chrome `LanguageModel` for on-device mode. An OpenAI-compatible HTTPS chat-completions URL only if the user types one. Chrome Web Store listing is out of scope.
- Real integrations: optional user-supplied model endpoint. Explicit demos: recorded JSON draft in the demo, strict baseline, synthetic corpus. Stubs that pretend a model succeeded: none.

## Acceptance checks and receipts

| Check | Expected result | Outcome / receipt |
|---|---|---|
| Import/install/build | Demo build produces `dist/` after install | Pending. Not run. |
| Schema | No database | Not required. |
| Function round trip | No edge function | Not required. |
| Auth/isolation | No accounts | Not required. |
| Missing secret | Blank model key does not call the network and shows an actionable error | Pending. Covered by `tests/model.test.ts`, which has not been executed. |
| Uploads | None | Not required. |
| Webhooks | None | Not required. |
| Jobs | None | Not required. |
| Publish | Not requested | Not run. |
| Extension load | Unpacked `dist-extension` scans one https page from the toolbar click | Pending. |
| Quote drop | Recorded draft keeps `binding arbitration` and drops `this quote is not in the policy` on the sample | Pending. Source path is the demo button "Check recorded draft". |

## One prompt after GitHub import

### Inspect and prepare only

> Read BOLT-HANDOFF.md and inspect the imported source at the intended branch/revision. This app has no database, no SQL migrations, and no edge functions. Do not create a database, apply migrations, deploy functions, enter secrets, or publish. Confirm `npm run dev` serves the React demo and that a baseline scan works on the built-in sample without any API key. Do not describe unexecuted checks as complete. Leave the Chrome extension build (`npm run build:extension`) as a local unpacked-load step; Bolt hosting is only for the demo.
