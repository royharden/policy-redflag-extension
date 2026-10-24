// Policy Red Flag page bridge. Injected into frame 0 only, after a toolbar click (activeTab).
// Plain JS, no imports. Node references stay inside this bridge; only serializable text, offsets and
// segment IDs leave it. Page text is data: nothing here executes or follows page content.
(() => {
  const CHANNEL = 'policy-redflag';
  const PROTOCOL_VERSION = 1;
  const BRIDGE_VERSION = 'bridge/1';
  const EXTRACTION_VERSION = 'body-walk/1';
  const CAP = 200000;
  const HIGHLIGHT = 'policy-redflag';
  const HIGHLIGHT_CURRENT = 'policy-redflag-current';
  const root = globalThis;

  // Idempotent reinjection: a second injection of the same version does nothing. A different version
  // leaves the old bridge in place; the worker sees the version mismatch on ping and asks for recapture.
  if (root.__policyRedflagBridge) return;

  const nonce =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  const EXCLUDED_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'CANVAS',
    'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'NAV', 'HEAD', 'MATH',
  ]);
  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'LI', 'UL', 'OL', 'DL', 'DT', 'DD', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'TR', 'TD', 'TH',
    'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'PRE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'DETAILS', 'SUMMARY',
    'FIGURE', 'FIGCAPTION', 'ADDRESS', 'FORM', 'FIELDSET', 'HR', 'CAPTION',
  ]);
  const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

  /** scanId -> { segments: [{id,start,end,virtual,collapsed,node,text}], text, revision } */
  const captures = new Map();
  /** Nodes and elements this bridge created (style element). Mutations inside them are ignored. */
  const artifacts = new WeakSet();
  let revision = 0;
  let stale = false;
  let observer = null;
  /** Text nodes and block elements that hold captured evidence; mutations elsewhere are not evidence. */
  let capturedNodes = new WeakSet();
  let capturedBlocks = new Set();

  function isExcludedElement(element) {
    const tag = element.tagName.toUpperCase();
    if (EXCLUDED_TAGS.has(tag)) return true;
    if (element.getAttribute('role') === 'navigation') return true;
    if (element.isContentEditable) return true;
    if (artifacts.has(element)) return true;
    return false;
  }

  /** Hidden by its own styling. A closed native <details> is NOT checked here (handled separately). */
  function isHiddenElement(element) {
    if (element.hidden) return true;
    const style = getComputedStyle(element);
    return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse';
  }

  /** The closed <details> that hides this node (node not inside that details' own <summary>). */
  function closedDetailsFor(node) {
    let element = node.parentElement;
    while (element && element !== document.body) {
      if (element.tagName === 'DETAILS' && !element.open) {
        const summary = element.querySelector(':scope > summary');
        if (!summary || !summary.contains(node)) return element;
      }
      element = element.parentElement;
    }
    return null;
  }

  function blockOf(node) {
    let element = node.parentElement;
    while (element && element !== document.body) {
      if (BLOCK_TAGS.has(element.tagName)) return element;
      element = element.parentElement;
    }
    return document.body;
  }

  function headingOf(node) {
    let element = node.parentElement;
    while (element && element !== document.body) {
      if (HEADING_TAGS.has(element.tagName)) return element;
      element = element.parentElement;
    }
    return null;
  }

  function ensureStyle() {
    if (document.getElementById('policy-redflag-style')) return;
    const style = document.createElement('style');
    style.id = 'policy-redflag-style';
    style.textContent =
      `::highlight(${HIGHLIGHT}) { background-color: #f6dc8a; color: inherit; }` +
      `::highlight(${HIGHLIGHT_CURRENT}) { background-color: #f0a33c; color: inherit; }`;
    artifacts.add(style);
    (document.head || document.documentElement).appendChild(style);
  }

  function capture(scanId) {
    if (!document.body) return { ok: false, code: 'no_body', reason: 'This page has no document body to read.' };
    const segments = [];
    const sections = [];
    let text = '';
    let truncated = false;
    let lastBlock = null;
    let collapsedSegments = 0;
    let currentHeading = null;
    let virtualCount = 0;
    const hiddenCache = new Map();

    const hidden = (element) => {
      if (hiddenCache.has(element)) return hiddenCache.get(element);
      const value = isHiddenElement(element);
      hiddenCache.set(element, value);
      return value;
    };

    const addVirtual = (value) => {
      if (text.length + value.length > CAP) {
        truncated = true;
        return false;
      }
      const start = text.length;
      text += value;
      segments.push({ id: `v${virtualCount++}`, start, end: text.length, virtual: true, text: value });
      return true;
    };

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (isExcludedElement(node) || hidden(node)) return NodeFilter.FILTER_REJECT;
          return node.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
        return node.nodeValue && /\S/.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });

    let index = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.ELEMENT_NODE) {
        // <br>: an explicit virtual line separator.
        if (text.length > 0 && !text.endsWith('\n') && !addVirtual('\n')) break;
        continue;
      }
      const block = blockOf(node);
      if (text.length > 0 && block !== lastBlock && !text.endsWith('\n')) {
        if (!addVirtual('\n')) break;
      }
      lastBlock = block;
      const heading = headingOf(node);
      if (heading && heading !== currentHeading) {
        currentHeading = heading;
        const label = (heading.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (sections.length) sections[sections.length - 1].end = text.length;
        sections.push({ id: `h${sections.length}`, label: label || 'Untitled section', start: text.length, end: text.length });
      }
      const value = node.nodeValue || '';
      const room = CAP - text.length;
      if (room <= 0) {
        truncated = true;
        break;
      }
      const slice = value.length > room ? value.slice(0, room) : value;
      const start = text.length;
      text += slice;
      const collapsed = Boolean(closedDetailsFor(node));
      if (collapsed) collapsedSegments += 1;
      segments.push({ id: `n${index++}`, start, end: text.length, virtual: false, collapsed, node, text: slice });
      if (slice.length !== value.length) {
        truncated = true;
        break;
      }
    }
    if (sections.length) sections[sections.length - 1].end = text.length;

    // Keep only the latest capture's node map: one scan per tab.
    captures.clear();
    captures.set(scanId, { segments, text, revision });
    capturedNodes = new WeakSet();
    capturedBlocks = new Set();
    for (const segment of segments) {
      if (segment.virtual) continue;
      capturedNodes.add(segment.node);
      capturedBlocks.add(blockOf(segment.node));
    }
    stale = false;
    ensureStyle();
    startObserver();

    return {
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      bridgeVersion: BRIDGE_VERSION,
      extractionVersion: EXTRACTION_VERSION,
      nonce,
      revision,
      url: location.href,
      title: document.title,
      text,
      truncated,
      collapsedSegments,
      segments: segments.map(({ id, start, end, virtual, collapsed }) =>
        virtual ? { id, start, end, virtual: true } : { id, start, end, virtual: false, collapsed },
      ),
      sections: sections.filter((section) => section.end > section.start),
    };
  }

  function insideArtifact(node) {
    let current = node;
    while (current) {
      if (artifacts.has(current)) return true;
      current = current.parentNode;
    }
    return false;
  }

  function hasText(node) {
    return Boolean(node.textContent && /\S/.test(node.textContent));
  }

  function markStale() {
    if (stale) return;
    stale = true;
    revision += 1;
    try {
      chrome.runtime.sendMessage({ channel: CHANNEL, type: 'bridge-stale', nonce, revision }).catch(() => {});
    } catch {
      // The extension may have been reloaded; the panel will ask for recapture.
    }
  }

  /** Added content counts only inside a block that holds captured text, and only if it would be captured. */
  function addsEvidenceText(parent, added) {
    if (!hasText(added)) return false;
    let element = parent && parent.nodeType === Node.ELEMENT_NODE ? parent : parent && parent.parentElement;
    let block = null;
    for (let current = element; current && current !== document.body; current = current.parentElement) {
      if (isExcludedElement(current) || isHiddenElement(current)) return false;
      if (!block && BLOCK_TAGS.has(current.tagName)) block = current;
    }
    if (added.nodeType === Node.ELEMENT_NODE && (isExcludedElement(added) || isHiddenElement(added))) return false;
    return capturedBlocks.has(block || document.body);
  }

  function capturedNodeDisconnected() {
    for (const entry of captures.values()) {
      for (const segment of entry.segments) if (!segment.virtual && !segment.node.isConnected) return true;
    }
    return false;
  }

  function startObserver() {
    if (observer || !document.body) return;
    // Attributes are not observed: opening <details> or style changes do not rewrite evidence. Only changes
    // to captured text, removal of captured nodes, or new eligible text inside a captured block mark stale;
    // late banners, scripts, nav or hidden content elsewhere do not.
    observer = new MutationObserver((records) => {
      let removedSomething = false;
      for (const record of records) {
        if (insideArtifact(record.target)) continue;
        if (record.type === 'characterData') {
          if (capturedNodes.has(record.target) && record.oldValue !== record.target.nodeValue) return markStale();
          continue;
        }
        for (const added of record.addedNodes) {
          if (!insideArtifact(added) && addsEvidenceText(record.target, added)) return markStale();
        }
        if (record.removedNodes.length) removedSomething = true;
      }
      if (removedSomething && capturedNodeDisconnected()) markStale();
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
  }

  /** Reconstruct [start,end) from current node text plus recorded virtual separators. */
  function project(entry, start, end) {
    let out = '';
    for (const segment of entry.segments) {
      if (segment.end <= start || segment.start >= end) continue;
      let value;
      if (segment.virtual) value = segment.text;
      else {
        if (!segment.node.isConnected) return null;
        value = (segment.node.nodeValue || '').slice(0, segment.text.length);
        if (value !== segment.text) return null;
      }
      const low = Math.max(start, segment.start) - segment.start;
      const high = Math.min(end, segment.end) - segment.start;
      out += value.slice(low, high);
    }
    return out;
  }

  function rangesFor(entry, start, end) {
    const ranges = [];
    for (const segment of entry.segments) {
      if (segment.virtual || segment.end <= start || segment.start >= end) continue;
      const range = document.createRange();
      range.setStart(segment.node, Math.max(start, segment.start) - segment.start);
      range.setEnd(segment.node, Math.min(end, segment.end) - segment.start);
      ranges.push(range);
    }
    return ranges;
  }

  function collapsedDetails(entry, start, end) {
    const found = new Set();
    for (const segment of entry.segments) {
      if (segment.virtual || !segment.collapsed || segment.end <= start || segment.start >= end) continue;
      let element = segment.node.parentElement;
      while (element && element !== document.body) {
        if (element.tagName === 'DETAILS' && !element.open) found.add(element);
        element = element.parentElement;
      }
    }
    return [...found];
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function rangeVisible(range) {
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const node = range.startContainer;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return false;
    return typeof element.checkVisibility === 'function' ? element.checkVisibility({ visibilityProperty: true }) : true;
  }

  async function jump(message) {
    const entry = captures.get(message.scanId);
    if (!entry) return { ok: false, code: 'missing_map', reason: 'This page no longer has the scan map. Click the toolbar icon to capture again.' };
    if (stale) return { ok: false, code: 'stale', reason: 'The page text changed after capture. Click the toolbar icon to capture again.' };
    const { start, end, expected } = message;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > entry.text.length || start >= end) {
      return { ok: false, code: 'bad_offsets', reason: 'Those offsets are not in this capture.' };
    }
    if (entry.text.slice(start, end) !== expected || project(entry, start, end) !== expected) {
      markStale();
      return { ok: false, code: 'stale', reason: 'The quoted text is no longer on the page. Click the toolbar icon to capture again.' };
    }
    const toOpen = collapsedDetails(entry, start, end);
    for (const details of toOpen) details.open = true;
    if (toOpen.length) {
      // Re-validate after opening: a page handler may rewrite words when details toggle.
      await nextFrame();
      if (stale || project(entry, start, end) !== expected) {
        markStale();
        return { ok: false, code: 'stale', reason: 'Opening that section changed its text. Click the toolbar icon to capture again.' };
      }
    }
    const ranges = rangesFor(entry, start, end);
    if (!ranges.length) return { ok: false, code: 'no_range', reason: 'That quote is made of separators only.' };
    const first = ranges[0];
    const anchor = first.startContainer.parentElement;
    if (anchor) anchor.scrollIntoView({ block: 'center', inline: 'nearest' });
    const all = [];
    for (const other of message.others || []) {
      if (Number.isInteger(other.start) && Number.isInteger(other.end) && project(entry, other.start, other.end) === entry.text.slice(other.start, other.end)) {
        all.push(...rangesFor(entry, other.start, other.end));
      }
    }
    let painted = 'highlight';
    if (root.Highlight && root.CSS && CSS.highlights) {
      CSS.highlights.set(HIGHLIGHT, new Highlight(...all));
      CSS.highlights.set(HIGHLIGHT_CURRENT, new Highlight(...ranges));
    } else {
      const selection = getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(first);
      }
      painted = 'selection';
    }
    await nextFrame();
    return { ok: true, painted, openedDetails: toOpen.length, visible: ranges.some(rangeVisible) };
  }

  function release() {
    captures.clear();
    if (root.CSS && CSS.highlights) {
      CSS.highlights.delete(HIGHLIGHT);
      CSS.highlights.delete(HIGHLIGHT_CURRENT);
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    return { ok: true };
  }

  root.__policyRedflagBridge = { version: BRIDGE_VERSION, nonce };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only this extension's own worker/pages can reach a content script; check the ID anyway.
    if (!message || message.channel !== CHANNEL || sender.id !== chrome.runtime.id) return undefined;
    if (message.protocolVersion !== PROTOCOL_VERSION) {
      sendResponse({ ok: false, code: 'protocol_mismatch', reason: 'Extension and page bridge versions differ. Capture again.' });
      return undefined;
    }
    if (message.type === 'ping') {
      sendResponse({ ok: true, bridgeVersion: BRIDGE_VERSION, nonce, stale, revision, scanIds: [...captures.keys()] });
      return undefined;
    }
    if (message.nonce !== undefined && message.nonce !== nonce) {
      sendResponse({ ok: false, code: 'document_mismatch', reason: 'This is a different page document. Capture again.' });
      return undefined;
    }
    if (message.type === 'capture') {
      sendResponse(capture(String(message.scanId)));
      return undefined;
    }
    if (message.type === 'jump') {
      jump(message).then(sendResponse, () => sendResponse({ ok: false, code: 'error', reason: 'Jump failed on this page.' }));
      return true;
    }
    if (message.type === 'release') {
      sendResponse(release());
      return undefined;
    }
    sendResponse({ ok: false, code: 'unknown_command' });
    return undefined;
  });

  return { bridgeVersion: BRIDGE_VERSION, nonce };
})();
