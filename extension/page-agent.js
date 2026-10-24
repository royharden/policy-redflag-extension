(() => {
  const CHANNEL = 'policy-redflag';
  const root = globalThis;
  if (root.__policyRedflagInstalled) return;
  root.__policyRedflagInstalled = true;

  const state = { segments: [], text: '' };
  const CAP = 200000;

  function blocked(node) {
    const parent = node.parentElement;
    if (!parent) return true;
    return Boolean(parent.closest('script, style, noscript, textarea'));
  }

  function ensureStyle() {
    if (document.getElementById('policy-redflag-style')) return;
    const style = document.createElement('style');
    style.id = 'policy-redflag-style';
    style.textContent = '::highlight(policy-redflag) { background-color: #f0c14d; color: CanvasText; }';
    (document.head || document.documentElement).appendChild(style);
  }

  function extract() {
    if (!document.body) return { ok: false, reason: 'This page has no document body to read.' };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return blocked(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    let text = '';
    const segments = [];
    let lastBlock = null;
    let truncated = false;
    while (walker.nextNode()) {
      if (text.length >= CAP) {
        truncated = true;
        break;
      }
      const node = walker.currentNode;
      const value = node.nodeValue || '';
      if (!value) continue;
      const block = node.parentElement
        ? node.parentElement.closest('p, div, li, h1, h2, h3, h4, tr, section, article, blockquote')
        : null;
      if (text.length > 0 && block !== lastBlock) {
        if (text.length + 1 >= CAP) {
          truncated = true;
          break;
        }
        text += '\n';
      }
      lastBlock = block;
      const room = CAP - text.length;
      const slice = value.length > room ? value.slice(0, room) : value;
      const start = text.length;
      text += slice;
      segments.push({ start, end: text.length, node });
      if (slice.length !== value.length) {
        truncated = true;
        break;
      }
    }
    state.text = text;
    state.segments = segments;
    ensureStyle();
    return {
      ok: true,
      href: location.href,
      title: document.title,
      text,
      truncated,
    };
  }

  function rangesFor(start, end) {
    const ranges = [];
    for (const segment of state.segments) {
      const low = Math.max(start, segment.start);
      const high = Math.min(end, segment.end);
      if (low >= high) continue;
      const range = document.createRange();
      range.setStart(segment.node, low - segment.start);
      range.setEnd(segment.node, high - segment.start);
      ranges.push(range);
    }
    return ranges;
  }

  function paint(items, scroll) {
    const ranges = [];
    for (const item of items) ranges.push(...rangesFor(item.start, item.end));
    if (!ranges.length) return { ok: false, reason: 'Those offsets are not in the extracted text.' };
    if (scroll) {
      const node = ranges[0].startContainer;
      const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      if (element) element.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    const HighlightApi = globalThis.Highlight;
    if (!HighlightApi || !globalThis.CSS || !CSS.highlights) {
      return {
        ok: false,
        reason: 'This browser has no CSS Highlight API. Jump still scrolls when a text node was found.',
      };
    }
    CSS.highlights.set('policy-redflag', new HighlightApi(...ranges));
    return { ok: true, painted: ranges.length };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.channel !== CHANNEL) return undefined;
    if (message.type === 'extract') {
      sendResponse(extract());
      return true;
    }
    if (message.type === 'highlight') {
      sendResponse(paint(message.ranges || [], Boolean(message.scroll)));
      return true;
    }
    return undefined;
  });
})();
