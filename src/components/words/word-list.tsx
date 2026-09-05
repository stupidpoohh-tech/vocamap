'use client'

import Link from 'next/link'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { BookmarkButton } from './bookmark-button'
import { SpeakButton } from './speak-button'

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
  showMap = true,
  openMap = false,
  wordQuery = '',
}: {
  items: WordListItem[]
  direction: ListDirection
  emptyHint?: string
  /** Off when the list is already only mapped words — a badge on every row
   *  says nothing the heading has not said once. */
  showMap?: boolean
  /**
   * On a list of nothing but mapped words, the word itself opens its map.
   * Tapping a row on that list and having it merely uncover the meaning is the
   * wrong answer to the question the list is answering.
   */
  openMap?: boolean
  /** Carried into the word page so it knows which list it was opened from. */
  wordQuery?: string
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

          const toMap = openMap && item.mapStatus === 'approved'

          return (
            <li key={item.id} className="flex items-center gap-2 py-2.5">
              <span className="flex min-w-0 flex-1 items-baseline gap-3">
                {/* Two targets, not one. The word opens its map where there is
                    a map to open; the covered half always uncovers. One button
                    doing both meant a list of maps you could not get into. */}
                {toMap ? (
                  <Link
                    href={`/words/${item.id}${wordQuery}`}
                    /* On this list, opening the map is what the row is for, so
                       the rows on screen are fetched in full before the tap
                       rather than after it: measured on a throttled phone,
                       380ms of waiting becomes 90ms. Only here — on the 전체
                       list a tap uncovers the meaning instead, and prefetching
                       every row there would be work nobody asked for. */
                    prefetch
                    className="min-w-0 flex-1 truncate text-[0.9375rem] text-ink underline decoration-line underline-offset-4 transition hover:text-brand hover:decoration-brand break-keep"
                  >
                    {front}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggle(item.id)}
                    aria-expanded={open}
                    className="min-w-0 flex-1 truncate text-left text-[0.9375rem] text-ink break-keep"
                  >
                    {front}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => toggle(item.id)}
                  aria-expanded={open}
                  className="flex min-w-0 flex-1 items-center text-left"
                >
                  {/* The covered half is drawn, not left blank: a bar the width
                      of the answer says "there is something here" and keeps the
                      row from changing height when it opens. */}
                  {open ? (
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-2 break-keep">
                      {back}
                    </span>
                  ) : (
                    <>
                      <span aria-hidden className="h-1.5 w-16 rounded-full bg-line" />
                      <span className="sr-only">
                        {direction === 'en_ko' ? '뜻 가려짐' : '단어 가려짐'}
                      </span>
                    </>
                  )}
                </button>
              </span>

              {item.wrongCount > 0 ? (
                <span
                  className="numeral shrink-0 text-[0.6875rem] text-data-weak"
                  title={`${item.wrongCount}번 틀렸어요`}
                >
                  {item.wrongCount}회 틀림
                </span>
              ) : null}

              {/* The last three are columns, not a queue of whatever this row
                  happens to have. Only some words carry a map and the speaker
                  is hidden while the English is, so anything laid out in
                  sequence made every row's icons land somewhere different. The
                  optional one goes first and each keeps a slot of its own
                  width, so the speaker and the star stay in the same place all
                  the way down the list. */}
              {showMap ? (
                <span className="flex w-7 shrink-0 items-center justify-center">
                  {/* Published maps only. A draft is a curator's working copy
                      and the 검수 screen is where they see it. */}
                  {item.mapStatus === 'approved' ? (
                    <Link
                      href={`/words/${item.id}${wordQuery}`}
                      onClick={(event) => event.stopPropagation()}
                      className="rounded-chip px-1 py-0.5 text-[0.6875rem] text-ink-3 transition hover:bg-sunken hover:text-ink-2"
                    >
                      맵
                    </Link>
                  ) : null}
                </span>
              ) : null}

              <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                {/* Only once the English is on screen. In 한영 the word is the
                    answer the student is trying to recall, and a speaker that
                    reads it out is a button that gives it away. */}
                {direction === 'en_ko' || open ? <SpeakButton text={item.lemma} /> : null}
              </span>

              <BookmarkButton vocabularyId={item.id} bookmarked={item.bookmarked} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
