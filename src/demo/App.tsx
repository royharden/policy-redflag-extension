import { useMemo, useState } from 'react';
import {
  analyze,
  analyzeBaseline,
  buildExtractionPrompt,
  CATEGORIES,
  CATEGORY_BY_ID,
  compareBaselines,
  completeChat,
  completeOnDevice,
  CORPUS_PROVENANCE,
  defaultSettings,
  formatRate,
  matchingRulebookId,
  ModelRequestError,
  parseModelFlags,
  RECORDED_DRAFT,
  RULEBOOKS,
  SAMPLE_FIXTURE,
  splitByRanges,
  type AnalyzeResult,
  type CategoryId,
  type ModelSettings,
} from '../core';

const appName = import.meta.env.VITE_APP_NAME || 'Policy Red Flag';
const sampleText = SAMPLE_FIXTURE?.text ?? '';

export function App() {
  const initial = defaultSettings();
  const [text, setText] = useState(sampleText);
  const [enabled, setEnabled] = useState<CategoryId[]>(initial.enabledCategoryIds);
  const [rulebookId, setRulebookId] = useState(initial.rulebookId);
  const [baseline, setBaseline] = useState<AnalyzeResult | null>(null);
  const [draftText, setDraftText] = useState(RECORDED_DRAFT);
  const [draft, setDraft] = useState<AnalyzeResult | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [model, setModel] = useState<ModelSettings>(initial.model);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelResult, setModelResult] = useState<AnalyzeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [buffer, setBuffer] = useState<AnalyzeResult | null>(null);
  const report = useMemo(() => compareBaselines(), []);

  function applyRulebook(id: string) {
    const book = RULEBOOKS.find((item) => item.id === id);
    setRulebookId(id);
    if (book) setEnabled([...book.categoryIds]);
  }

  function toggleCategory(id: CategoryId) {
    const next = enabled.includes(id) ? enabled.filter((item) => item !== id) : [...enabled, id];
    setEnabled(next);
    setRulebookId(matchingRulebookId(next));
  }

  function scanBaseline() {
    const result = analyzeBaseline(text, enabled);
    setModelResult(null);
    setModelError(null);
    setBaseline(result);
    setBuffer(result);
  }

  function checkDraft() {
    const parsed = parseModelFlags(draftText, 'recorded');
    if (parsed.error) {
      setDraft(null);
      setDraftError(parsed.error);
      return;
    }
    setDraftError(null);
    const result = analyze({ text, enabledCategoryIds: enabled, candidates: parsed.candidates });
    setDraft(result);
    setBuffer(result);
  }

  async function runModel(mode: 'https' | 'on-device') {
    setBusy(true);
    setModelError(null);
    setModelResult(null);
    try {
      const prompt = buildExtractionPrompt(text, enabled);
      const raw =
        mode === 'on-device'
          ? await completeOnDevice(prompt)
          : await completeChat({ endpoint: model.endpoint, apiKey: model.apiKey, model: model.model }, prompt);
      const parsed = parseModelFlags(raw, 'model');
      if (parsed.error) {
        setModelError(parsed.error);
        return;
      }
      const result = analyze({ text, enabledCategoryIds: enabled, candidates: parsed.candidates });
      setModelResult(result);
      setBuffer(result);
    } catch (error) {
      const message =
        error instanceof ModelRequestError || error instanceof Error
          ? error.message
          : 'The model request failed. No flags were invented.';
      setModelError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header>
        <p className="eyebrow">Terms and privacy</p>
        <h1>{appName}</h1>
        <p className="lede">
          The baseline runs in this page. Each kept flag is a verbatim slice of the text, with character offsets.
          A quote that is not in the text is dropped. A model runs only when you ask, and a missing key does not
          invent flags.
        </p>
      </header>
      <main className="stack">
        <div className="layout">
          <section>
            <h2>Policy text</h2>
            <label htmlFor="rulebook">Rulebook</label>
            <select
              id="rulebook"
              value={RULEBOOKS.some((item) => item.id === rulebookId) ? rulebookId : 'custom'}
              onChange={(event) => {
                if (event.target.value !== 'custom') applyRulebook(event.target.value);
              }}
            >
              {RULEBOOKS.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
            <div className="checks">
              {CATEGORIES.map((category) => (
                <label key={category.id}>
                  <input
                    type="checkbox"
                    checked={enabled.includes(category.id)}
                    onChange={() => toggleCategory(category.id)}
                  />{' '}
                  {category.label}
                </label>
              ))}
            </div>
            <label htmlFor="policy">Text buffer</label>
            <textarea id="policy" value={text} onChange={(event) => setText(event.target.value)} />
            <div className="actions">
              <button type="button" className="secondary" onClick={() => setText(sampleText)}>
                Load sample
              </button>
              <button type="button" onClick={scanBaseline}>
                Scan with baseline
              </button>
            </div>
            <label htmlFor="draft">Recorded model draft</label>
            <textarea id="draft" value={draftText} onChange={(event) => setDraftText(event.target.value)} />
            <div className="actions">
              <button type="button" onClick={checkDraft}>
                Check recorded draft
              </button>
            </div>
            <p className="note">The draft is checked against the text buffer. It does not call a network.</p>
          </section>
          <div className="stack">
            <section>
              <h2>Baseline</h2>
              {enabled.length === 0 ? <p>No categories are selected, so nothing can be flagged.</p> : null}
              {baseline ? <ResultView text={text} result={baseline} /> : <p>Scan the buffer to see flags and highlights.</p>}
            </section>
            <section>
              <h2>Recorded draft</h2>
              {draftError ? <p className="error">{draftError}</p> : null}
              {draft ? <ResultView text={text} result={draft} /> : <p>Check the draft to see a kept quote and a dropped quote.</p>}
            </section>
          </div>
        </div>

        <section>
          <h2>Optional model</h2>
          <p className="note">
            The key stays in this page's memory and is cleared on refresh. It is not a Vite variable and it is not
            sent to a project server. A remote endpoint must be https. Localhost and 127.0.0.1 may use http. Other
            private and metadata hosts are blocked. The provider may still reject the browser with CORS.
          </p>
          <label htmlFor="endpoint">HTTPS chat-completions URL</label>
          <input
            id="endpoint"
            value={model.endpoint}
            autoComplete="off"
            onChange={(event) => setModel({ ...model, endpoint: event.target.value })}
          />
          <label htmlFor="model-name">Model name</label>
          <input
            id="model-name"
            value={model.model}
            autoComplete="off"
            onChange={(event) => setModel({ ...model, model: event.target.value })}
          />
          <label htmlFor="api-key">API key</label>
          <input
            id="api-key"
            type="password"
            value={model.apiKey}
            autoComplete="off"
            onChange={(event) => setModel({ ...model, apiKey: event.target.value })}
          />
          <div className="actions">
            <button type="button" disabled={busy} onClick={() => void runModel('https')}>
              Run hosted model
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void runModel('on-device')}>
              Run on-device model
            </button>
          </div>
          {modelError ? <p className="error">{modelError}</p> : null}
          {modelResult ? <ResultView text={text} result={modelResult} /> : null}
        </section>

        {buffer ? (
          <section>
            <h2>Highlight buffer</h2>
            <p className="note">Marks show the latest baseline, recorded draft, or model result.</p>
            <BufferView text={text} result={buffer} />
          </section>
        ) : null}

        <section>
          <h2>Synthetic evaluation</h2>
          <p className="note">{CORPUS_PROVENANCE}</p>
          <p className="note">
            Strict recall is below 100% because one arbitration clause is a paraphrase. Loose precision is lower
            because short keywords hit a bulletin that is not a policy clause. This is not a live model score.
          </p>
          {report.missingQuotes.length > 0 ? (
            <p className="error">Gold quotes missing from their texts: {report.missingQuotes.join('; ')}</p>
          ) : null}
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Strict precision</th>
                <th>Strict recall</th>
                <th>Loose precision</th>
                <th>Loose recall</th>
              </tr>
            </thead>
            <tbody>
              {report.strict.perCategory.map((row) => {
                const loose = report.loose.perCategory.find((item) => item.categoryId === row.categoryId);
                return (
                  <tr key={row.categoryId}>
                    <td>{CATEGORY_BY_ID[row.categoryId].label}</td>
                    <td>{formatRate(row.precision)}</td>
                    <td>{formatRate(row.recall)}</td>
                    <td>{formatRate(loose?.precision ?? null)}</td>
                    <td>{formatRate(loose?.recall ?? null)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th>Micro</th>
                <td>{formatRate(report.strict.micro.precision)}</td>
                <td>{formatRate(report.strict.micro.recall)}</td>
                <td>{formatRate(report.loose.micro.precision)}</td>
                <td>{formatRate(report.loose.micro.recall)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      </main>
    </>
  );
}

function ResultView({ text, result }: { text: string; result: AnalyzeResult }) {
  return (
    <>
      <p className="grade">
        <strong>{result.grade.letter}</strong>
        <span>
          {result.grade.score}/100 from {result.flags.length} kept {result.flags.length === 1 ? 'flag' : 'flags'}
        </span>
      </p>
      {result.flags.length === 0 ? <p>No kept flags for the selected categories.</p> : null}
      {result.flags.map((flag) => (
        <article className="flag" key={`${flag.source}-${flag.categoryId}-${flag.start}`}>
          <h3>
            {CATEGORY_BY_ID[flag.categoryId].label} · {flag.severity}
          </h3>
          <blockquote>{flag.quote}</blockquote>
          <p className="meta">
            Characters {flag.start}–{flag.end} of {text.length}. {flag.matchCount === 1 ? 'One match in the buffer.' : `${flag.matchCount} matches; the first is stored.`} Source: {flag.source}.
          </p>
          <p>{flag.note}</p>
        </article>
      ))}
      {result.dropped.length > 0 ? (
        <div className="dropped">
          <h3>Dropped</h3>
          <ul>
            {result.dropped.map((item, index) => (
              <li key={`${item.reason}-${item.categoryId}-${index}`}>
                {item.reason}: {item.quote.trim() || '(empty quote)'}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function BufferView({ text, result }: { text: string; result: AnalyzeResult }) {
  const parts = splitByRanges(
    text,
    result.flags.map((flag) => ({ start: flag.start, end: flag.end, categoryId: flag.categoryId })),
  );
  return (
    <pre className="buffer">
      {parts.map((part, index) =>
        part.categories.length > 0 ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
      )}
    </pre>
  );
}
