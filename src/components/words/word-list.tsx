'use client'

import Link from 'next/link'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { BookmarkButton } from './bookmark-button'

export type WordListItem = {
  id: string
  lemma: string
  translation: string | null
  bookmarked: boolean
  wrongCount: number
  mapStatus: 'approved' | 'draft' | 'none'
}

export type ListDirection = 'en_ko' | 'ko_en'

/** Rows past which the list gets its own scrollbar instead of growing the page. */
const SCROLL_AFTER = 8

/**
 * A paper vocabulary notebook, on a screen.
 *
 * The half a student is testing themselves on stays covered until they tap,
 * which is the whole point of a 단어장 — a list showing both columns is a list
 * you read, not one you learn from.
 *
 * Every row used to be a bordered card, so twenty-five words came out as
 * twenty-five boxes and the eye followed the boxes. Rows are separated by a
 * hairline and their own spacing now; the words are the only shapes left.
 */
export function WordList({
  items,
  direction,
  emptyHint,
}: {
  items: WordListItem[]
  direction: ListDirection
  emptyHint?: string
}) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)

  if (!items.length) {
    return (
      <p className="py-12 text-center text-[0.8125rem] leading-relaxed text-ink-3 break-keep">
        {emptyHint ?? '표시할 단어가 없어요.'}
      </p>
    )
  }

  const toggle = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 pb-1.5">
        <p className="numeral text-xs text-ink-3">
          {items.length}개
          <span className="ml-1.5">
            {showAll
              ? '모두 펼침'
              : direction === 'en_ko'
                ? '뜻 가림'
                : '단어 가림'}
          </span>
        </p>
        <button
          type="button"
          onClick={() => {
            setShowAll((on) => !on)
            setRevealed(new Set())
          }}
          className="text-xs text-ink-2 transition hover:text-ink"
        >
          {showAll ? '모두 가리기' : '모두 보기'}
        </button>
      </div>

      {/* Past a screenful the list scrolls in its own region so the header, the
          action and the pager stay reachable without a long scroll. */}
      <ul
        className={cn(
          'divide-y divide-line-soft border-t border-line',
          items.length > SCROLL_AFTER && 'max-h-[58vh] overflow-y-auto overscroll-contain',
        )}
      >
        {items.map((item) => {
          const front = direction === 'en_ko' ? item.lemma : (item.translation ?? '—')
          const back = direction === 'en_ko' ? (item.translation ?? '—') : item.lemma
          const open = showAll || revealed.has(item.id)

          return (
            <li key={item.id} className="flex items-center gap-2 py-2.5">
              <button
                type="button"
                onClick={() => toggle(item.id)}
                aria-expanded={open}
                className="flex min-w-0 flex-1 items-baseline gap-3 text-left"
              >
                <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-ink break-keep">
                  {front}
                </span>
                {/* The covered half is drawn, not left blank: a bar the width of
                    the answer says "there is something here" and keeps the row
                    from changing height when it opens. */}
                {open ? (
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-2 break-keep">
                    {back}
                  </span>
                ) : (
                  <span className="flex flex-1 items-center">
                    <span aria-hidden className="h-1.5 w-16 rounded-full bg-line" />
                    <span className="sr-only">
                      {direction === 'en_ko' ? '뜻 가려짐' : '단어 가려짐'}
                    </span>
                  </span>
                )}
              </button>

              {item.wrongCount > 0 ? (
                <span
                  className="numeral shrink-0 text-[0.6875rem] text-data-weak"
                  title={`${item.wrongCount}번 틀렸어요`}
                >
                  {item.wrongCount}회 틀림
                </span>
              ) : null}

              {/* Published maps only. A draft is a curator's business and the
                  맵 tab is where they see it. */}
              {item.mapStatus === 'approved' ? (
                <Link
                  href={`/words/${item.id}`}
                  onClick={(event) => event.stopPropagation()}
                  className="shrink-0 rounded-chip px-1.5 py-0.5 text-[0.6875rem] text-ink-3 transition hover:bg-sunken hover:text-ink-2"
                >
                  맵
                </Link>
              ) : null}

              <BookmarkButton vocabularyId={item.id} bookmarked={item.bookmarked} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
