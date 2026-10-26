'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { dueLabel } from '@/lib/learning/scheduler'
import { BookmarkButton } from './bookmark-button'
import { SpeakButton } from './speak-button'

/** 복습 화면의 한 줄. 기록이 브라우저에 있으므로 여기서 만들어 넘긴다. */
export type ReviewWord = {
  slug: string
  lemma: string
  translation: string | null
  bookmarked: boolean
  wrongCount: number
  hasMap: boolean
  /** 두 방향 중 먼저 돌아오는 날. 한 번도 답하지 않았으면 `null` 이다. */
  dueAt: Date | null
  /** 0–1, 약한 쪽. 한 번도 답하지 않았으면 `null` 이다. */
  retention: number | null
}

/**
 * The review desk's rows.
 *
 * Not the study book's row: nothing is covered here. This list is not a drill —
 * the test is the drill — it is the schedule, so both halves of the word are on
 * screen and the right-hand column carries the only two facts the schedule
 * knows: when the word comes back, and how much of it is expected to survive
 * until then.
 *
 * The strength figure is tinted once, and only downwards. A word holding at 90%
 * needs no colour to say so; a word at 40% is the reason to open the screen.
 */
export function ReviewList({
  items,
  now,
  emptyHint,
  showWrongCount = false,
  onBookmarkChange,
}: {
  items: ReviewWord[]
  now: Date
  emptyHint: string
  /** On the mistake list, how often it beat you says more than a forecast. */
  showWrongCount?: boolean
  /** 별이 눌렸다. 담은 것 수를 세는 쪽에 알린다. */
  onBookmarkChange?: (next: boolean) => void
}) {
  if (!items.length) {
    return (
      <p className="py-12 text-center text-[0.8125rem] leading-relaxed text-ink-3 break-keep">
        {emptyHint}
      </p>
    )
  }

  return (
    <ul
      className={cn(
        'divide-y divide-line-soft border-t border-line',
        items.length > 8 && 'max-h-[58vh] overflow-y-auto overscroll-contain',
      )}
    >
      {items.map((word) => (
        <li key={word.slug} className="flex items-center gap-3 py-3">
          <Link href={`/words/${word.slug}`} className="group min-w-0 flex-1">
            <span className="block truncate text-[0.9375rem] text-ink group-hover:text-brand">
              {word.lemma}
            </span>
            <span className="mt-0.5 block truncate text-[0.8125rem] text-ink-3">
              {word.translation ?? '—'}
            </span>
          </Link>

          {/* Columns, in the same order as the study book's rows: what only
              some words have first, then the two that every row keeps a place
              for. */}
          <span className="w-16 shrink-0 text-right">
            <span className="numeral block text-xs text-ink-2">{dueLabel(word.dueAt, now)}</span>
            {showWrongCount && word.wrongCount > 0 ? (
              <span className="numeral mt-0.5 block text-[0.6875rem] text-data-weak">
                {word.wrongCount}회 틀림
              </span>
            ) : word.retention !== null ? (
              <span
                className={cn(
                  'numeral mt-0.5 block text-[0.6875rem]',
                  word.retention < 0.6 ? 'text-warn' : 'text-ink-3',
                )}
              >
                {/* Never 100. FSRS's curve does not reach certainty, and a
                    screen that says it has is telling the student not to come
                    back. */}
                기억 {Math.min(99, Math.round(word.retention * 100))}%
              </span>
            ) : null}
          </span>

          <span className="flex w-7 shrink-0 items-center justify-center">
            {word.hasMap ? (
              <Link
                href={`/words/${word.slug}`}
                className="rounded-chip px-1 py-0.5 text-[0.6875rem] text-ink-3 transition hover:bg-sunken hover:text-ink-2"
              >
                맵
              </Link>
            ) : null}
          </span>

          <span className="flex h-8 w-8 shrink-0 items-center justify-center">
            <SpeakButton text={word.lemma} />
          </span>

          <BookmarkButton
            slug={word.slug}
            bookmarked={word.bookmarked}
            onChange={onBookmarkChange}
          />
        </li>
      ))}
    </ul>
  )
}
