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

/**
 * A paper vocabulary notebook, on a screen.
 *
 * The half a student is testing themselves on is covered until they tap, which
 * is the whole point of a 단어장 — a list that shows both columns is a list you
 * read, not one you learn from. Which half is covered follows the direction, so
 * the same list drills 영→한 and 한→영 without becoming two screens.
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
      <div className="card px-6 py-10 text-center text-sm text-muted break-keep">
        {emptyHint ?? '표시할 단어가 없어요.'}
      </div>
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
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-xs text-muted">
          {items.length}개
          {showAll
            ? ' · 모두 펼쳤어요'
            : direction === 'en_ko'
              ? ' · 뜻을 가렸어요'
              : ' · 단어를 가렸어요'}
        </p>
        <button
          type="button"
          onClick={() => {
            setShowAll((on) => !on)
            setRevealed(new Set())
          }}
          className="text-xs font-semibold text-brand"
        >
          {showAll ? '모두 가리기' : '모두 보기'}
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const front = direction === 'en_ko' ? item.lemma : (item.translation ?? '—')
          const back = direction === 'en_ko' ? (item.translation ?? '—') : item.lemma
          const open = showAll || revealed.has(item.id)

          return (
            <li key={item.id} className="card flex items-center gap-3 px-4 py-3">
              <button
                type="button"
                onClick={() => toggle(item.id)}
                aria-expanded={open}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold break-keep">{front}</span>
                  {/* The covered state is drawn, not left blank: a bar the same
                      height as the text says "there is something here" and keeps
                      the row from changing height when it opens. */}
                  {open ? (
                    <span className="mt-0.5 block h-5 truncate text-sm leading-5 text-muted">
                      {back}
                    </span>
                  ) : (
                    <span className="mt-0.5 flex h-5 items-center">
                      <span aria-hidden className="h-2 w-20 rounded-full bg-line" />
                      <span className="sr-only">
                        {direction === 'en_ko' ? '뜻 가려짐' : '단어 가려짐'}
                      </span>
                    </span>
                  )}
                </span>
                {!open ? (
                  <span className="shrink-0 rounded-md bg-line/50 px-2 py-0.5 text-[11px] font-medium text-muted">
                    보기
                  </span>
                ) : null}
              </button>

              {item.wrongCount > 0 ? (
                <span
                  className="shrink-0 text-[11px] font-semibold text-bad tabular-nums"
                  title={`${item.wrongCount}번 틀렸어요`}
                >
                  ✕{item.wrongCount}
                </span>
              ) : null}

              {/* Published maps only. A draft is a curator's business and the
                  맵 tab is where they see it — a student meeting "검수 대기"
                  here would just be shown a door they cannot open. */}
              {item.mapStatus === 'approved' ? (
                <Link
                  href={`/words/${item.id}`}
                  onClick={(event) => event.stopPropagation()}
                  className="shrink-0 rounded-full border border-brand/40 px-2.5 py-1 text-[11px] font-semibold text-brand transition hover:bg-brand-soft"
                >
                  MAP
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
