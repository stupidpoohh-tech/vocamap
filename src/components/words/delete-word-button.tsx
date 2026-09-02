'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { removeWord } from '@/app/(app)/admin/[id]/edit-actions'

/**
 * Removing a word straight from a list.
 *
 * Deliberately two steps and deliberately quiet: this is unrecoverable — the
 * word's map and every student's cards and answer history go with it — so it
 * must not be a thing you can hit while scanning. Collapsed it is grey text;
 * expanded it says exactly what it costs before the button that does it.
 */
export function DeleteWordButton({
  vocabularyId,
  lemma,
  hasMap,
}: {
  vocabularyId: string
  lemma: string
  hasMap: boolean
}) {
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        aria-label={`${lemma} 삭제`}
        className="shrink-0 rounded-chip px-1.5 py-0.5 text-[0.6875rem] text-ink-3 transition hover:bg-bad-soft hover:text-bad"
      >
        삭제
      </button>
    )
  }

  return (
    <span className="flex shrink-0 items-center gap-2 text-[0.6875rem]">
      <span className="text-ink-3 break-keep">
        {hasMap ? '맵과 학습 기록까지' : '학습 기록까지'} 지울까요?
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null)
            const result = await removeWord({ vocabularyId })
            if (!result.ok) {
              setError(result.message)
              return
            }
            setAsking(false)
            router.refresh()
          })
        }
        className="rounded-chip px-1.5 py-0.5 font-medium text-bad transition hover:bg-bad-soft disabled:opacity-50"
      >
        {pending ? '삭제 중' : '삭제'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => setAsking(false)}
        className="rounded-chip px-1.5 py-0.5 text-ink-3 transition hover:text-ink-2"
      >
        취소
      </button>
      {error ? <span className="text-bad">{error}</span> : null}
    </span>
  )
}
