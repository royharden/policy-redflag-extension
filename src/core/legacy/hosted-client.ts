/**
 * RETAINED HISTORICAL MODULE — UNREACHABLE.
 * Grok's hosted BYOK chat-completions client, moved here verbatim from src/core/model.ts on 2026-10-23
 * (original in git baseline 20fc85e). PLAN.md section 2 puts hosted inference/BYOK out of scope:
 * nothing imports this file, it is not exported from src/core/index.ts, and the manifest no longer has
 * optional host permissions. Do not wire it back in without a new scope decision from Roy.
 */
export class ModelRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelRequestError';
  }
}

export interface ChatSettings {
  endpoint: string;
  apiKey: string;
  model: string;
}

const BLOCKED_HOSTS = new Set(['metadata.google.internal', 'metadata.google', 'instance-data']);

export function assertModelEndpoint(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ModelRequestError('Model endpoint must be a full URL.');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (local) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ModelRequestError('A local model endpoint must use http or https.');
    }
    return url;
  }
  if (url.protocol !== 'https:') {
    throw new ModelRequestError('A remote model endpoint must use https.');
  }
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.internal') || isBlockedAddress(host)) {
    throw new ModelRequestError(
      'That host is blocked. Use a public https endpoint, or http://127.0.0.1 or http://localhost for a local model.',
    );
  }
  return url;
}

function isBlockedAddress(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const parts = match.slice(1).map((part) => Number(part));
  if (parts.some((part) => part > 255)) return true;
  const first = parts[0] ?? 0;
  const second = parts[1] ?? 0;
  if (first === 10 || first === 127 || first === 0) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  return false;
}

export function endpointPermissionPattern(endpoint: string): string {
  const url = assertModelEndpoint(endpoint);
  return `${url.protocol}//${url.host}/*`;
}

function readContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
        return (part as { text: string }).text;
      }
      return '';
    })
    .join('');
}

export async function completeChat(
  settings: ChatSettings,
  prompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!settings.apiKey.trim()) {
    throw new ModelRequestError(
      'Add an API key to run a hosted model. The key stays in this browser. A baseline scan does not need a key.',
    );
  }
  if (!settings.model.trim()) {
    throw new ModelRequestError('Add a model name for the hosted endpoint.');
  }
  const url = assertModelEndpoint(settings.endpoint);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${settings.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) {
      throw new ModelRequestError(
        `The model endpoint returned HTTP ${response.status}. Check the URL, model name, and key. No flags were invented.`,
      );
    }
    const body = await response.text();
    if (body.length > 100_000) {
      throw new ModelRequestError('The model response was too large to accept. No flags were invented.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new ModelRequestError('The model endpoint did not return JSON. No flags were invented.');
    }
    const content = (parsed as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
    const text = readContent(content);
    if (!text.trim()) {
      throw new ModelRequestError('The model returned an empty message. No flags were invented.');
    }
    return text;
  } catch (error) {
    if (error instanceof ModelRequestError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ModelRequestError('The model request timed out after 30 seconds. No flags were invented.');
    }
    throw new ModelRequestError('The model request failed before any flags were accepted.');
  } finally {
    clearTimeout(timer);
  }
}
