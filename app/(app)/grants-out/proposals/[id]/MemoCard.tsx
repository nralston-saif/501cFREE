'use client'

import { useCallback, useState, useTransition } from 'react'
import { startMemo, updateMemo, revalidateProposal } from '@/lib/actions/grants-out'
import {
  MEMO_SECTION_FIELDS,
  MEMO_HEADER_FIELDS,
  type MemoSectionKey,
  type MemoHeaderKey,
} from '@/lib/grants/memo'
import { useAutosave, type AutosaveStatus } from '@/lib/hooks/useAutosave'
import { useToast } from '@/components/Toast'
import type { ProposalMemo } from '@/lib/supabase/types/database'
import { unwrap } from '@/lib/actions/result'

type MemoKey = MemoSectionKey | MemoHeaderKey
type AnswerMap = Partial<Record<MemoKey, string>>

const ALL_KEYS: readonly MemoKey[] = [
  ...MEMO_HEADER_FIELDS.map(([key]) => key),
  ...MEMO_SECTION_FIELDS.map(([key]) => key),
]

function answersFromMemo(memo: ProposalMemo | null): AnswerMap {
  const out: AnswerMap = {}
  if (!memo) return out
  for (const key of ALL_KEYS) {
    const value = memo[key]
    if (typeof value === 'string') out[key] = value
  }
  return out
}

const STATUS_LABELS: Record<AutosaveStatus, string> = {
  idle: '',
  dirty: 'Unsaved changes…',
  saving: 'Saving…',
  saved: 'All changes saved',
  error: 'Couldn’t save — retrying',
}

export default function MemoCard({
  proposalId,
  memo,
  startedByName,
  lastEditedByName,
  draft = null,
}: {
  proposalId: string
  memo: ProposalMemo | null
  startedByName: string | null
  lastEditedByName: string | null
  /** AI research drafts keyed by section/header column — shown for review, never auto-saved. */
  draft?: AnswerMap | null
}) {
  const [editing, setEditing] = useState(false)
  const [answers, setAnswers] = useState<AnswerMap>(answersFromMemo(memo))
  // Text that "Use draft" overwrote, kept for one-click undo per field.
  const [replaced, setReplaced] = useState<AnswerMap>({})
  const [isPending, startTransition] = useTransition()
  const [closing, setClosing] = useState(false)
  const { showToast } = useToast()

  const saveAnswers = useCallback(
    async (snapshot: AnswerMap) => {
      const formData = new FormData()
      for (const key of ALL_KEYS) {
        formData.set(key, snapshot[key] ?? '')
      }
      // No revalidate while typing — a single revalidateProposal runs on Done
      unwrap(await updateMemo(proposalId, formData, { revalidate: false }))
    },
    [proposalId]
  )

  const { status: saveStatus, flush } = useAutosave(answers, saveAnswers, {
    enabled: editing,
  })

  const answered = MEMO_SECTION_FIELDS.reduce(
    (acc, [key]) => acc + ((answers[key] ?? '').trim().length > 0 ? 1 : 0),
    0
  )
  const total = MEMO_SECTION_FIELDS.length
  const complete = answered === total

  const handleStart = () => {
    startTransition(async () => {
      try {
        unwrap(await startMemo(proposalId))
        setEditing(true)
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not start memo', 'error')
      }
    })
  }

  const handleDone = async () => {
    setClosing(true)
    try {
      await flush()
      unwrap(await revalidateProposal(proposalId))
      setEditing(false)
      showToast('Memo saved', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save memo', 'error')
    } finally {
      setClosing(false)
    }
  }

  const handleUseDraft = (key: MemoKey) => {
    const value = draft?.[key]
    if (!value) return
    const current = answers[key] ?? ''
    if (current.trim() && current !== value) {
      const ok = window.confirm(
        'Replace your text with the original AI draft?\n\nYour edits to this field will be overwritten. You can undo right after.'
      )
      if (!ok) return
      setReplaced((prev) => ({ ...prev, [key]: current }))
    }
    setAnswers((prev) => ({ ...prev, [key]: value }))
  }

  const handleUseAllDrafts = () => {
    if (!draft) return
    const overwriting = ALL_KEYS.filter((key) => {
      const value = draft[key]
      const current = answers[key] ?? ''
      return !!value && current.trim().length > 0 && current !== value
    })
    if (overwriting.length > 0) {
      const ok = window.confirm(
        `This will overwrite your text in ${overwriting.length} ${
          overwriting.length === 1 ? 'field' : 'fields'
        } with the original AI drafts. Continue?`
      )
      if (!ok) return
      setReplaced((prev) => {
        const next = { ...prev }
        for (const key of overwriting) next[key] = answers[key]
        return next
      })
    }
    setAnswers((prev) => {
      const next = { ...prev }
      for (const key of ALL_KEYS) {
        const value = draft[key]
        if (value) next[key] = value
      }
      return next
    })
  }

  const handleUndoReplace = (key: MemoKey) => {
    const previous = replaced[key]
    if (previous === undefined) return
    setAnswers((prev) => ({ ...prev, [key]: previous }))
    setReplaced((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const draftBox = (key: MemoKey) => (
    <>
      {replaced[key] !== undefined && (answers[key] ?? '') === draft?.[key] && (
        <p className="mt-1 text-xs text-gray-500">
          Replaced your text with the AI draft.{' '}
          <button
            type="button"
            onClick={() => handleUndoReplace(key)}
            className="font-medium text-gray-700 underline hover:text-gray-900"
          >
            Undo
          </button>
        </p>
      )}
      {draft?.[key] && draft[key] !== (answers[key] ?? '') ? (
        <div className="mt-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              AI draft
            </span>
            <button
              type="button"
              onClick={() => handleUseDraft(key)}
              className="text-xs font-medium text-gray-600 hover:text-gray-900"
            >
              Use draft
            </button>
          </div>
          <p className="text-xs text-gray-600 whitespace-pre-wrap">{draft[key]}</p>
        </div>
      ) : null}
    </>
  )

  if (!memo) {
    return (
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-gray-900">Grant memorandum</h3>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          A shared memo with the {total} memorandum sections plus header fields for the
          generated PDF. All sections must be drafted before a decision can be recorded.
        </p>
        <button
          type="button"
          onClick={handleStart}
          disabled={isPending}
          className="btn btn-primary"
        >
          {isPending ? 'Starting…' : 'Start memorandum'}
        </button>
      </div>
    )
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-medium text-gray-900">Grant memorandum</h3>
        <div className="flex items-center gap-3">
          {editing && saveStatus !== 'idle' && (
            <span
              className={`text-xs ${
                saveStatus === 'error' ? 'text-red-600' : 'text-gray-400'
              }`}
            >
              {STATUS_LABELS[saveStatus]}
            </span>
          )}
          <span
            className={`text-xs tabular-nums ${
              complete ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            {answered}/{total} sections
          </span>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="btn btn-secondary text-xs"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400 mb-4">
        Started by {startedByName ?? 'unknown'} · Last edited by{' '}
        {lastEditedByName ?? 'unknown'}
      </p>

      {editing ? (
        <div className="space-y-5">
          {draft && (
            <div className="flex items-center justify-between rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <p className="text-xs text-gray-600">
                AI research drafts are shown under each field. Review before using — you are
                the approval step.
              </p>
              <button
                type="button"
                onClick={handleUseAllDrafts}
                className="btn btn-secondary text-xs shrink-0 ml-3"
              >
                Use all drafts
              </button>
            </div>
          )}

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
              Header fields
            </h4>
            <div className="space-y-4">
              {MEMO_HEADER_FIELDS.map(([key, label, hint]) => (
                <div key={key}>
                  <label
                    htmlFor={`memo-${key}`}
                    className="block text-xs font-medium text-gray-700 mb-1"
                  >
                    {label}
                    <span className="ml-1.5 font-normal text-gray-400">{hint}</span>
                  </label>
                  <textarea
                    id={`memo-${key}`}
                    rows={key === 'header_structure' || key === 'header_decision' ? 3 : 1}
                    value={answers[key] ?? ''}
                    onChange={(e) =>
                      setAnswers((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    className="input"
                  />
                  {draftBox(key)}
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
              Sections
            </h4>
            <div className="space-y-5">
              {MEMO_SECTION_FIELDS.map(([key, heading], index) => (
                <div key={key}>
                  <label
                    htmlFor={`memo-${key}`}
                    className="block text-xs font-medium text-gray-700 mb-1"
                  >
                    {index + 1}. {heading}
                  </label>
                  <textarea
                    id={`memo-${key}`}
                    rows={5}
                    value={answers[key] ?? ''}
                    onChange={(e) =>
                      setAnswers((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    className="input"
                  />
                  {draftBox(key)}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleDone}
              disabled={closing}
              className="btn btn-primary"
            >
              {closing ? 'Saving…' : 'Done'}
            </button>
            <span className="text-xs text-gray-400">Changes save automatically.</span>
          </div>
        </div>
      ) : (
        <dl className="space-y-4">
          {MEMO_HEADER_FIELDS.map(([key, label]) => {
            const value = (answers[key] ?? '').trim()
            if (!value) return null
            return (
              <div key={key}>
                <dt className="text-xs font-medium text-gray-700">{label}</dt>
                <dd className="text-sm mt-0.5 whitespace-pre-wrap text-gray-900">{value}</dd>
              </div>
            )
          })}
          {MEMO_SECTION_FIELDS.map(([key, heading], index) => {
            const value = (answers[key] ?? '').trim()
            return (
              <div key={key}>
                <dt className="text-xs font-medium text-gray-700">
                  {index + 1}. {heading}
                </dt>
                <dd
                  className={`text-sm mt-0.5 whitespace-pre-wrap ${
                    value ? 'text-gray-900' : 'text-gray-400 italic'
                  }`}
                >
                  {value || 'Not yet drafted'}
                </dd>
              </div>
            )
          })}
        </dl>
      )}
    </div>
  )
}
