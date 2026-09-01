'use client'

import { useState, useTransition } from 'react'
import { flagImportant } from '../../actions'

/**
 * Lets a teacher promote a word they can see the student struggling with. The
 * flag reaches the student as a Brain Map recommendation immediately, without
 * waiting for the failure thresholds to trip.
 */
export function FlagButton({
  studentId,
  vocabularyId,
}: {
  studentId: string
  vocabularyId: string
}) {
  const [flagged, setFlagged] = useState(false)
  const [pending, startTransition] = useTransition()

  return (
    <button
      type="button"
      disabled={pending || flagged}
      onClick={() =>
        startTransition(async () => {
          await flagImportant(studentId, vocabularyId)
          setFlagged(true)
        })
      }
      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
        flagged
          ? 'border-warn bg-warn-soft text-warn'
          : 'border-line text-muted hover:border-warn hover:text-warn'
      }`}
    >
      {flagged ? '★ 지정됨' : '중요 지정'}
    </button>
  )
}
