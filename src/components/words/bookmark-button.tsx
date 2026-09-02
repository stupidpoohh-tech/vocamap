'use client'

import { useOptimistic, useTransition } from 'react'
import { cn } from '@/lib/utils'
import { setBookmark } from '@/app/(app)/actions'

/**
 * One tap to put a word into the vault, or take it out.
 *
 * Optimistic because it sits in a long list — waiting on a round trip before
 * the star fills makes rapid picking feel broken.
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
      aria-label={optimistic ? '보관함에서 빼기' : '보관함에 저장'}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        startTransition(async () => {
          setOptimistic(!optimistic)
          await setBookmark(vocabularyId, !optimistic)
        })
      }}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full border font-semibold transition',
        size === 'lg' ? 'px-3 py-1.5 text-xs' : 'px-2.5 py-1 text-xs',
        optimistic
          ? 'border-brand bg-brand-soft text-brand'
          : 'border-line bg-surface text-muted hover:border-brand hover:text-brand',
      )}
    >
      <span aria-hidden>{optimistic ? '★' : '☆'}</span>
      {size === 'lg' ? (optimistic ? '저장됨' : '저장하기') : null}
    </button>
  )
}
