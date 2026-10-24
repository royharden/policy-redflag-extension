import { useMemo, useState } from 'react';
import {
  ACME_TERMS_TEXT,
  analyze,
  CATEGORIES,
  CATEGORY_BY_ID,
  CORPUS,
  CORPUS_PROVENANCE,
  deriveSections,
  formatRate,
  fullCoverage,
  itemErrorRejections,
  matchingRulebookId,
  orderedCategories,
  parseFlagsResponse,
  reasonLabel,
  RECORDED_DRAFT,
  RULEBOOKS,
  RULES_VERSION,
  scanStrict,
  SEMANTIC_AUDIT_DRAFT,
  splitByRanges,
  type CategoryId,
  type Finding,
  type ScanResult,
} from '../core';

// The web lab never reads browser tabs and never runs live inference. It checks pasted or fixture
// text with the same shared core the extension uses.

const appName = import.meta.env.VITE_APP_NAME || 'Policy Red Flag';

/** Measured results exist only after scripts/evaluate.ts has run; until then this map is empty. */
const measured = import.meta.glob('../../results/results.json', { eager: true, import: 'default' }) as Record<string, MeasuredResults>;

interface MeasuredResults {
  generatedAt: string;
  split: string;
  manifest: { sha256: string };
  limitations: string[];
  results: {
    engine: string;
    attempted: number;
    scores: Record<string, { micro: { precision: number | null; recall: number | null; f1: number | null; support: number } }>;
  }[];
}

const FIXTURES = [
  { id: 'acme', label: 'ACME Cloud Notes terms (demo, all six categories)', text: ACME_TERMS_TEXT },
  ...CORPUS.map((fixture) => ({ id: fixture.id, label: `Northwind smoke: ${fixture.title}`, text: fixture.text })),
];

type Mode = 'rules' | 'recorded' | 'semantic';

export function App() {
  const [text, setText] = useState(ACME_TERMS_TEXT);
  const [revision, setRevision] = useState(0);
  const [enabled, setEnabled] = useState<CategoryId[]>(CATEGORIES.map((category) => category.id));
  const [draftText, setDraftText] = useState(RECORDED_DRAFT);
  const [mode, setMode] = useState<Mode>('rules');
  const [fixtureId, setFixtureId] = useState('acme');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const presetId = matchingRulebookId(enabled);

  const snapshot = useMemo(() => ({ scanId: `lab-${revision}`, revision, text, sections: deriveSections(text) }), [text, revision]);

  // Paste edits or category changes invalidate the current view.
  function invalidate() {
    setResult(null);
    setError(null);
  }

  function edit(next: string, fromFixture = '') {
    setFixtureId(fromFixture);
    setText(next);
    setRevision((value) => value + 1);
    invalidate();
  }

  function setCategories(next: CategoryId[]) {
    setEnabled(orderedCategories(next));
    invalidate();
  }

  function run(nextMode: Mode) {
    setMode(nextMode);
    setError(null);
    const rules = scanStrict(text, enabled);
    if (nextMode === 'rules') {
      setResult(
        analyze({ snapshot, enabledCategoryIds: enabled, candidates: rules, requestedEngines: ['rules'], coverage: [fullCoverage('rules', RULES_VERSION, text.length)] }).result,
      );
      return;
    }
    const raw = nextMode === 'semantic' ? SEMANTIC_AUDIT_DRAFT : draftText;
    const parsed = parseFlagsResponse(raw, { engine: 'recorded', engineVersion: 'recorded/1', acceptOffsets: true });
    if (!parsed.ok) {
      setResult(null);
      setError(`${parsed.code}: ${parsed.detail}`);
      return;
    }
    setResult(
      analyze({
        snapshot,
        enabledCategoryIds: enabled,
        candidates: [...rules, ...parsed.candidates],
        extraRejections: itemErrorRejections(parsed.itemErrors, 'recorded'),
        requestedEngines: ['rules', 'recorded'],
        coverage: [fullCoverage('rules', RULES_VERSION, text.length), fullCoverage('recorded', 'recorded/1', text.length)],
      }).result,
    );
  }

  return (
    <>
      <header>
        <p className="eyebrow">Terms and privacy</p>
        <h1>{appName}</h1>
        <p className="lede">
          A keyless rules check for six kinds of consumer red-flag clauses. Every finding shows its original quote and where it is.
          A verified quote proves the text is there, not that the category is right or that a clause is enforceable. No findings
          never means the terms are safe. This is not legal advice.
        </p>
      </header>
      <main className="stack">
        <div className="layout">
          <section>
            <h2>Policy text</h2>
            <label htmlFor="fixture">Load a fixture</label>
            <select id="fixture" value={fixtureId} onChange={(event) => edit(FIXTURES.find((item) => item.id === event.target.value)?.text ?? '', event.target.value)}>
              <option value="" disabled>
                Edited text
              </option>
              {FIXTURES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <p className="note">Northwind fixtures are smoke data written alongside the rules. {CORPUS_PROVENANCE}</p>
            <label htmlFor="rulebook">Rulebook</label>
            <select
              id="rulebook"
              value={presetId}
              onChange={(event) => {
                const book = RULEBOOKS.find((item) => item.id === event.target.value);
                if (book) setCategories([...book.categoryIds]);
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
                    onChange={() =>
                      setCategories(enabled.includes(category.id) ? enabled.filter((id) => id !== category.id) : [...enabled, category.id])
                    }
                  />{' '}
                  {category.label}
                </label>
              ))}
            </div>
            <label htmlFor="policy">Text</label>
            <textarea id="policy" value={text} onChange={(event) => edit(event.target.value)} />
            <div className="actions">
              <button type="button" onClick={() => run('rules')}>
                Check with rules
              </button>
            </div>
            <label htmlFor="draft">Recorded candidates (JSON)</label>
            <textarea id="draft" value={draftText} onChange={(event) => {
                setDraftText(event.target.value);
                invalidate();
              }}
            />
            <div className="actions">
              <button type="button" onClick={() => run('recorded')}>
                Rules + recorded candidates
              </button>
              <button type="button" className="secondary" onClick={() => run('semantic')}>
                Semantic-audit example
              </button>
            </div>
            <p className="note">
              Recorded candidates are checked against the text with the same validator the extension uses. They are not a model
              run and make no network call. The default file shows a full real quote (accepted), a fabricated quote and a real
              prefix with an invented ending (both rejected), a short fragment (expanded to its sentence) and a repeated quote
              (ambiguous).
            </p>
          </section>
          <div className="stack">
            <section>
              <h2>{mode === 'rules' ? 'Rules' : mode === 'semantic' ? 'Semantic-audit example' : 'Rules + recorded'}</h2>
              {mode === 'semantic' && result?.findings.some((item) => item.categoryId === 'arbitration' && item.provenance.some((p) => p.engine === 'recorded')) ? (
                <p className="note">
                  This recorded candidate quotes real text under the wrong category. Grounding accepts it because the quote is real;
                  only a semantic label can catch the error. That is why every card says the category is not verified.
                </p>
              ) : null}
              {error ? <p className="error">{error}</p> : null}
              {result ? <ResultView text={text} result={result} /> : <p>Run a check to see findings.</p>}
            </section>
          </div>
        </div>

        {result && result.findings.length ? (
          <section>
            <h2>Text with findings marked</h2>
            <BufferView text={text} findings={result.findings} />
          </section>
        ) : null}

        <EvaluationView />
      </main>
    </>
  );
}

function provenance(finding: Finding): string {
  return [...new Set(finding.provenance.map((item) => (item.engine === 'rules' ? 'Rules' : item.engine === 'recorded' ? 'Recorded' : item.engine)))].join(' + ');
}

function ResultView({ text, result }: { text: string; result: ScanResult }) {
  if (result.state === 'no_categories') return <p className="error">No categories selected. Nothing was checked — this is not a safety result.</p>;
  return (
    <>
      <p className="meta">
        All {text.length.toLocaleString()} characters checked by the rules. {result.findings.length} finding(s) shown
        {result.findingLimitReached ? ` (display limit reached; ${result.counts.accepted} accepted)` : ''}.
      </p>
      {result.findings.length === 0 ? <p>No findings for the selected categories. This does not mean the terms are safe.</p> : null}
      {result.findings.map((finding) => (
        <article className="flag" key={finding.id}>
          <h3>{CATEGORY_BY_ID[finding.categoryId].label}</h3>
          <p className="meta">{finding.reasonCodes.map(reasonLabel).join(' · ')}</p>
          <p className="badge">Quote verified — category not verified.</p>
          <blockquote>{finding.quote}</blockquote>
          <p>{finding.explanation}</p>
          <p className="meta">
            {finding.sectionLabel ? `Section: ${finding.sectionLabel}. ` : ''}
            {provenance(finding)}. Characters {finding.occurrences[0]?.start}–{finding.occurrences[0]?.end}.
            {finding.ambiguous ? ` The same quote appears ${finding.occurrences.length} times; each occurrence is listed, none is chosen silently.` : ''}
            {finding.expanded ? ' A shorter quote was expanded to its full sentence.' : ''}
          </p>
        </article>
      ))}
      <details className="dropped">
        <summary>Diagnostics ({result.rejections.length} rejected)</summary>
        <p className="meta">
          Candidates {result.counts.candidates} · accepted {result.counts.accepted} · rejected {result.counts.rejected} · expanded{' '}
          {result.counts.expanded} · ambiguous {result.counts.ambiguous}
        </p>
        <ul>
          {result.rejections.slice(0, 50).map((item, index) => (
            <li key={`${item.code}-${index}`}>
              <code>{item.code}</code> {item.engine}: {item.preview || '(empty)'}
              {item.detail ? ` — ${item.detail}` : ''}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

function BufferView({ text, findings }: { text: string; findings: readonly Finding[] }) {
  const parts = splitByRanges(
    text,
    findings.flatMap((finding) => finding.occurrences.map((item) => ({ start: item.start, end: item.end, categoryId: finding.categoryId }))),
  );
  return (
    <pre className="buffer">
      {parts.map((part, index) => (part.categories.length > 0 ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>))}
    </pre>
  );
}

function EvaluationView() {
  const report = Object.values(measured)[0];
  return (
    <section>
      <h2>Evaluation</h2>
      {!report ? (
        <p>
          Not measured. Numbers appear here only after <code>npm run eval:prepare</code> and <code>npm run eval</code> write
          results/results.json. The on-device model stays not measured until a real eval.html run is exported and validated.
        </p>
      ) : (
        <>
          <p className="note">
            Generated {report.generatedAt} on the {report.split} split (manifest {report.manifest.sha256.slice(0, 12)}…). Detection
            scores below; see results/results.md for exact and relaxed localization, uncertainty and the error audit.
          </p>
          <ul className="note">
            {report.limitations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <table>
            <thead>
              <tr>
                <th>Engine</th>
                <th>Support</th>
                <th>Precision</th>
                <th>Recall</th>
                <th>F1</th>
              </tr>
            </thead>
            <tbody>
              {report.results.map((row) => {
                const micro = row.scores.detection?.micro;
                return (
                  <tr key={row.engine}>
                    <td>{row.engine}</td>
                    <td>{micro?.support ?? 'undefined'}</td>
                    <td>{formatRate(micro?.precision ?? null)}</td>
                    <td>{formatRate(micro?.recall ?? null)}</td>
                    <td>{formatRate(micro?.f1 ?? null)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
