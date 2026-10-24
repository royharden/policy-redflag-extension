interface LanguageModelSession {
  prompt(input: string): Promise<string>;
  destroy?: () => void;
}

interface LanguageModelApi {
  availability(options?: unknown): Promise<string>;
  create(options?: unknown): Promise<LanguageModelSession>;
}

/** Chrome's built-in Prompt API. A missing model is an error, not a made-up flag list. */
export async function completeOnDevice(prompt: string): Promise<string> {
  const api = (globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel;
  if (!api) {
    throw new Error(
      'On-device LanguageModel is not in this browser. Use the baseline, or save an https endpoint and a key.',
    );
  }
  const availability = await api.availability({
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  });
  if (availability === 'unavailable' || availability === 'no') {
    throw new Error(
      `On-device model is ${availability}. Install the model in Chrome, or use the baseline.`,
    );
  }
  const session = await api.create({
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    temperature: 0,
  });
  try {
    const text = await session.prompt(prompt);
    if (!text.trim()) {
      throw new Error('The on-device model returned an empty message. No flags were invented.');
    }
    return text;
  } finally {
    session.destroy?.();
  }
}
