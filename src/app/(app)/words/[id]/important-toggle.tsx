'use client'

import { useOptimistic, useTransition } from 'react'
import { toggleImportant } from './actions'

/**
 * Marking a word important is one of the two ways a Brain Map gets recommended
 * without waiting for failures (the other being a teacher's flag), so it is a
 * one-tap control on the word itself rather than buried in a menu.
 */
export function ImportantToggle({
  vocabularyId,
  isImportant,
}: {
  vocabularyId: string
  isImportant: boolean
}) {
  const [optimistic, setOptimistic] = useOptimistic(isImportant)
  const [, startTransition] = useTransition()

  return (
    <button
      type="button"
      aria-pressed={optimistic}
      onClick={() =>
        startTransition(async () => {
          setOptimistic(!optimistic)
          await toggleImportant(vocabularyId, !optimistic)
        })
      }
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
        optimistic
          ? 'border-warn bg-warn-soft text-warn'
          : 'border-line bg-surface text-muted hover:border-warn hover:text-warn'
      }`}
    >
      <span aria-hidden>{optimistic ? '★' : '☆'}</span>
      중요 단어
    </button>
  )
}
