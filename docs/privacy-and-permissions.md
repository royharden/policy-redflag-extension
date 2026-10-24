# Privacy, permissions and limits

## Permissions

The manifest asks for exactly four permissions: `activeTab`, `scripting`, `storage` and `sidePanel`. It has no host permissions, no content scripts declared in the manifest, no `externally_connectable` entry, no remote code and no `downloads` permission.

- **activeTab + scripting.** A page is read only when you click the toolbar icon on it. The extension then injects `page-agent.js` into that tab's top frame. Nothing else in the panel grants access to a page.
- **sidePanel.** This shows results next to the page.
- **storage.** Scans go in `chrome.storage.session`. Settings go in `chrome.storage.local`: your category choices and your local-model opt-in. No API keys or policy text are stored.

## What is stored and for how long

| Data | Where | Cleared when |
|---|---|---|
| Captured text, sections, findings (one scan per tab, ≤3 tabs, ≤6 MiB) | `chrome.storage.session`, trusted extension contexts only | you press Clear, the tab navigates or closes, or the browser or extension restarts; the least recently used scan is evicted to make room |
| Page node map and highlights | memory of the page bridge only | Clear, a new capture, or navigation |
| Settings | `chrome.storage.local` | you change them or uninstall |

Closing the panel keeps a completed scan. Reopening the panel checks that the page bridge is still the same document before Jump is offered. The extension keeps no history and no origin cache, writes no logs of policy text and sends no telemetry.

## Network

The rules check and the web lab make no network requests. The optional on-device model runs in Chrome. Chrome may download the model once when you activate it; your policy text is never sent anywhere. There is no hosted model, no API key field and no proxy. An older hosted client is kept in the source, unused, in `src/core/legacy/`.

## Not covered

The capture skips frames, shadow DOM, lazy-loaded text, form field values, navigation, hidden text and content behind custom (non-`<details>`) accordions. It also skips text past the 200,000-unit cap (UTF-16 code units), and it does not capture PDFs or images. The rules cover English text only. "All captured text checked" refers only to what was captured.

## Not legal advice

Findings are a reading aid. A verified quote proves the text is present. It does not prove the category, the explanation or the clause's enforceability.
