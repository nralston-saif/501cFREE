'use client'

import DemoAiBadge from '@/components/DemoAiBadge'
import DemoSampleNote from '@/components/DemoSampleNote'
import { useDemoRun } from '@/components/useDemoRun'
import { DEMO_DELAY_MS, DEMO_NOTES } from '@/lib/ai/demo-label'
import type { DemoResearchReport } from '@/lib/ai/demo-scripts'

/**
 * The AI research panel in demo mode without a key: a few seconds of
 * "Researching… (demo)", then the whole pre-written report inline. Built in
 * the browser by `build` (lib/ai/demo-scripts.ts); no request, nothing saved.
 */
export default function DemoResearchPanel({
  subjectName,
  description,
  build,
}: {
  subjectName: string
  /** What the feature does in a real installation (shown before the first run) */
  description: string
  build: () => DemoResearchReport
}) {
  const { running, result, run } = useDemoRun<DemoResearchReport>(DEMO_DELAY_MS.research)

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-2 gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium text-gray-900">AI research</h3>
          {result && <DemoAiBadge />}
        </div>
        <button
          type="button"
          onClick={() => run(build)}
          disabled={running}
          className="btn btn-secondary text-xs"
        >
          {running ? 'Researching… (demo)' : result ? 'Re-run research' : 'Research & draft memo'}
        </button>
      </div>

      {running ? (
        <p className="text-sm text-gray-500 animate-pulse">
          Researching {subjectName} and drafting the memo… (demo)
        </p>
      ) : result ? (
        <div className="space-y-4">
          <DemoSampleNote badge={false}>{DEMO_NOTES.research}</DemoSampleNote>
          {result.header && result.header.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Suggested header</p>
              <dl className="space-y-1">
                {result.header.map((h) => (
                  <div key={h.label} className="text-sm">
                    <dt className="inline font-medium text-gray-700">{h.label}: </dt>
                    <dd className="inline text-gray-700">{h.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <ol className="space-y-3">
            {result.sections.map((s, i) => (
              <li key={s.label}>
                <p className="text-sm font-medium text-gray-900">
                  {i + 1}. {s.label}
                </p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap mt-0.5">{s.answer}</p>
              </li>
            ))}
          </ol>
          {result.open_questions.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                Flagged for confirmation
              </p>
              <ul className="list-disc pl-5 space-y-0.5">
                {result.open_questions.map((q) => (
                  <li key={q} className="text-sm text-amber-800">
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.sources.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Sources</p>
              <ul className="space-y-0.5">
                {result.sources.map((s) => (
                  <li key={s.url} className="text-sm break-words">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-gray-700 hover:text-gray-900 underline"
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          {description} In this demo, the button shows a pre-written sample report instead: no web
          research runs and nothing is saved.
        </p>
      )}
    </div>
  )
}
