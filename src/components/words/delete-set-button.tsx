'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { removeWordSet } from '@/app/(app)/teacher/actions'

/**
 * Removing a set from the shelf.
 *
 * Two steps, like deleting a word, but the warning says the opposite thing:
 * this one is *safe*. A set is a grouping, and the words in it stay in the
 * library with their maps and every student's history. Saying so is the point
 * of the confirmation — without it a teacher has to guess whether deleting
 * "2주차" also deletes the twenty words they spent an evening typing.
 */
export function DeleteSetButton({ setId, title }: { setId: string; title: string }) {
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!asking) {
    return (
      <button
        type="button"
        onClick={(event) => {
          // The row is a link into the set.
          event.preventDefault()
          setAsking(true)
        }}
        aria-label={`${title} 세트 삭제`}
        className="shrink-0 rounded-chip px-1.5 py-0.5 text-[0.6875rem] text-ink-3 transition hover:bg-bad-soft hover:text-bad"
      >
        삭제
      </button>
    )
  }

  return (
    <span className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-[0.6875rem]">
      <span className="text-ink-3 break-keep">세트만 지워요. 단어는 그대로 남아요.</span>
      <button
        type="button"
        disabled={pending}
        onClick={(event) => {
          event.preventDefault()
          startTransition(async () => {
            setError(null)
            const result = await removeWordSet({ setId })
            if (!result.ok) {
              setError(result.message)
              return
            }
            setAsking(false)
            router.refresh()
          })
        }}
        className="rounded-chip px-1.5 py-0.5 font-medium text-bad transition hover:bg-bad-soft disabled:opacity-50"
      >
        {pending ? '삭제 중' : '삭제'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={(event) => {
          event.preventDefault()
          setAsking(false)
        }}
        className="rounded-chip px-1.5 py-0.5 text-ink-3 transition hover:text-ink-2"
      >
        취소
      </button>
      {error ? <span className="text-bad">{error}</span> : null}
    </span>
  )
}
