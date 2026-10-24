# Policy Red Flag

A local scanner for six kinds of terms and privacy clauses: arbitration and class waiver, unilateral change, liability cap, data sale or sharing, auto-renewal, and broad content licence.

The baseline runs in the browser. Every kept flag is a verbatim slice of the text buffer, with character offsets. A model quote is kept only when it is a whitespace-normalized, case-sensitive substring of that same buffer. Anything else is dropped. There is no fuzzy match.

This repository was built in Dirty Mode. **Tests, the dev server, the production build, and the unpacked extension have not been run.**

## What is built

- `src/core` — rulebooks, strict and loose baselines, quote check, grade, per-category precision/recall, and the hosted-model client.
- `src/demo` — Vite + React page. Paste text, choose a rulebook, scan, check a recorded JSON draft, and read the synthetic evaluation table.
- `extension/` and `src/extension` — Manifest V3 side panel. The toolbar click is the only page-read. It uses `activeTab` and injects `page-agent.js` on demand. There is no content script on every site.
- `tests/` — Vitest files for the core. Not executed.

## What is not here

No database, accounts, Supabase project, or edge functions. No lockfile yet. No model API key in the repo. Optional keys are typed into the page (memory only) or stored in `chrome.storage.local` by the extension. A missing key produces an error and does not invent flags.

The synthetic corpus in `src/core/fixtures.ts` is original sample text. UNFAIR-ToS, CUAD, and OPP-115 are not included. See `docs/evaluation.md`.

## Demo, after a later install

```bash
npm ci
npm test
npm run dev
```

`npm ci` needs a lockfile, which is not committed yet. Until that exists, `npm install` is the install that can create one. The page works with no `.env`. Copy `.env.example` only to change the public title.

Load the sample, leave Consumer core selected, and choose **Scan with baseline**. Then choose **Check recorded draft**. One quote from the sample should stay, and `this quote is not in the policy` should be dropped.

## Extension, after a later build

```bash
npm run build:extension
```

Load `dist-extension` as an unpacked extension. Open an http or https page and click the toolbar icon. Browser pages and the Chrome Web Store cannot be scripted. The side panel cannot grant `activeTab` by itself.

Hosted model calls need the optional host permission Chrome prompts for, and the endpoint must allow the request. On-device mode uses Chrome's `LanguageModel` when that browser has it.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Demo only. Not the extension. |
| `npm run build` | Typecheck and demo build to `dist/`. |
| `npm run build:extension` | Extension package to `dist-extension/`. |
| `npm test` | Vitest. Not run in the construction pass. |

## Privacy

A baseline scan does not leave the browser. Page text is sent only if you run a hosted model, and then only to the URL you typed. On-device mode uses the browser's built-in model. The grade is a weighted count of categories, not a legal opinion.
