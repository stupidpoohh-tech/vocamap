'use client'

import { useOptimistic, useTransition } from 'react'
import { cn } from '@/lib/utils'
import { setBookmark } from '@/app/(app)/actions'

/**
 * One tap to say "I don't know this one".
 *
 * This is how a student marks a word while reading a set, so it has to be a
 * single tap in the row itself — anything that opens a screen would not survive
 * twenty words.
 *
 * Drawn as a mark, not as a control. It used to be a bordered pill sitting in a
 * bordered card inside a bordered list, and three nested outlines around one
 * star is exactly the noise that buries the vocabulary next to it.
 */
export function BookmarkButton({
  vocabularyId,
  bookmarked,
  size = 'sm',
}: {
  vocabularyId: string
  bookmarked: boolean
  size?: 'sm' | 'lg'
}) {
  const [optimistic, setOptimistic] = useOptimistic(bookmarked)
  const [, startTransition] = useTransition()

  return (
    <button
      type="button"
      aria-pressed={optimistic}
      aria-label={optimistic ? '보관함에서 빼기' : '모르는 단어로 보관함에 담기'}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        startTransition(async () => {
          setOptimistic(!optimistic)
          await setBookmark(vocabularyId, !optimistic)
        })
      }}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-chip transition',
        size === 'lg' ? 'px-2 py-1 text-xs' : 'p-1.5',
        // The filled state is the only place colour appears in a row, which is
        // what makes a page of saved words readable at a glance.
        optimistic ? 'text-brand' : 'text-ink-3 hover:text-ink-2',
      )}
    >
      <span aria-hidden className="text-sm leading-none">
        {optimistic ? '★' : '☆'}
      </span>
      {size === 'lg' ? (optimistic ? '담았어요' : '모르는 단어') : null}
    </button>
  )
}
