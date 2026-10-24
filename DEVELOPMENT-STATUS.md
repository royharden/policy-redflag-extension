# Development status

Dirty Mode construction — runtime unverified. 2026-10-23.

The demo and the extension source are written. Nobody has installed dependencies, run Vitest, started Vite, built `dist-extension`, or loaded the extension.

## Deferred checks

| Item | Later step |
|---|---|
| Lockfile and install | Add a lockfile with `npm install`, then use `npm ci`. |
| `npm test`, `tsc --noEmit`, `npm run build`, `npm run build:extension` | Run after install. A failed check is not a pass. |
| Extension output paths | Confirm `dist-extension/manifest.json`, `background.js`, `page-agent.js`, and `extension/sidepanel.html` line up, including the side-panel script URL from `base: './'`. |
| Service-worker chunks | Confirm Chrome loads the ES module chunks next to `background.js`. |
| Page offsets | Scan a fixture HTML page and confirm the highlight covers the quote. The extractor does not enter iframes. |
| `activeTab` after the click | If a panel jump fails on a page that just scanned, add an optional host permission. Do not start with a permanent `<all_urls>` content script. |
| `LanguageModel` and hosted CORS | Try one on-device session and one HTTPS call. A 401 or CORS error must stay an error. |
| Real labelled data | Licence review before adding UNFAIR-ToS, CUAD, or anything from OPP-115. |

The grade weights are a product choice. They sum to 100 so a page that hits every category scores 0. They are not a legal rating.
