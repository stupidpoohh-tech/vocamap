'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button, EmptyState, Input, TabBar, TabButton } from '@/components/ui'
import { WordList, type ListDirection, type WordListItem } from '@/components/words/word-list'
import { dueNow, isBookmarked, read, wrongCount, type Saved } from '@/learning/store'

/**
 * 단어 목록 — 고르고 거르는 일을 전부 브라우저에서 한다.
 *
 * 예전에는 세트·검색·방향·탭이 모두 주소의 물음표 뒤에 붙었고, 하나 누를
 * 때마다 서버가 화면을 처음부터 다시 그렸다. 그 한 번이 CPU 15~23ms 였다.
 * 이제 목록은 빌드할 때 한 번 구워져 통째로 내려오고, 여기서 걸러 보여 준다.
 * 누르는 즉시 바뀌고 서버는 아무 일도 하지 않는다.
 *
 * 237개를 한꺼번에 내려보내는 것이 많아 보이지만 글자로 20KB 남짓이다.
 * 페이지를 넘길 때마다 왕복하는 것보다 싸고, 검색이 즉시 듣는다.
 */

export type BrowserWord = {
  slug: string
  lemma: string
  ko: string
  sets: string[]
  hasMap: boolean
}

export function StudyBrowser({
  words,
  sets,
}: {
  words: BrowserWord[]
  /** 세트 이름, 파일에 적힌 순서 그대로. */
  sets: string[]
}) {
  const [set, setSet] = useState<string | null>(null)
  const [direction, setDirection] = useState<ListDirection>('en_ko')
  const [query, setQuery] = useState('')
  const [onlySaved, setOnlySaved] = useState(false)

  /**
   * 개인 기록은 첫 그림에 넣지 않는다.
   *
   * 이 화면의 HTML 은 모두에게 같은 것이 미리 구워져 있다. 담아 둔 표시는
   * 이 폰에만 있는 것이라, 붙는 시점이 브라우저가 깨어난 뒤다. 서버가 그린
   * 것과 다른 것을 처음부터 그리면 React 가 화면을 거부한다.
   */
  const [saved, setSaved] = useState<Saved | null>(null)
  useEffect(() => setSaved(read()), [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return words.filter((w) => {
      if (set && !w.sets.includes(set)) return false
      if (onlySaved && !(saved && isBookmarked(saved, w.slug))) return false
      if (!q) return true
      return w.lemma.toLowerCase().includes(q) || w.ko.toLowerCase().includes(q)
    })
  }, [words, set, onlySaved, query, saved])

  const items: WordListItem[] = visible.map((w) => ({
    id: w.slug,
    lemma: w.lemma,
    translation: w.ko || null,
    bookmarked: saved ? isBookmarked(saved, w.slug) : false,
    wrongCount: saved ? wrongCount(saved, w.slug) : 0,
    mapStatus: w.hasMap ? 'approved' : 'none',
  }))

  const due = saved ? dueNow(saved, visible.map((w) => w.slug), direction).length : 0
  const savedCount = saved ? saved.bookmarks.length : 0

  return (
    <>
      <TabBar>
        <TabButton active={!set && !onlySaved} onClick={() => { setSet(null); setOnlySaved(false) }}>
          전체
        </TabButton>
        {sets.map((name) => (
          <TabButton
            key={name}
            active={set === name && !onlySaved}
            onClick={() => { setSet(name); setOnlySaved(false) }}
          >
            {name}
          </TabButton>
        ))}
        <TabButton active={onlySaved} onClick={() => { setOnlySaved(true); setSet(null) }} count={savedCount}>
          담은 것
        </TabButton>
      </TabBar>

      {/* 볼 때가 된 것이 있으면 시험으로 바로 건너뛸 수 있게. 기록이 없는
          첫 방문에는 아무것도 뜨지 않는다 — 셀 것이 없기 때문이다. */}
      {due > 0 ? (
        <Link href={`/study/session?scope=due&dir=${direction}`} className="mb-4 block">
          <div className="flex items-center justify-between rounded-control bg-sunken px-4 py-3">
            <span className="text-[0.9375rem]">
              오늘 볼 단어 <span className="numeral font-semibold">{due}</span>개
            </span>
            <span className="text-[0.8125rem] text-ink-3">시험 보기 →</span>
          </div>
        </Link>
      ) : null}

      <div className="mb-3 flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="영어 단어 또는 한국어 뜻으로 검색"
          className="flex-1"
        />
        <Button
          variant="secondary"
          onClick={() => setDirection(direction === 'en_ko' ? 'ko_en' : 'en_ko')}
          className="shrink-0"
        >
          {direction === 'en_ko' ? '영 → 한' : '한 → 영'}
        </Button>
      </div>

      {items.length ? (
        <>
          <WordList
            items={items}
            direction={direction}
            total={items.length}
            // 별은 자기 상태만 알고, '담은 것' 수와 걸러내기는 여기서 센다.
            onBookmarkChange={() => setSaved(read())}
          />
          {visible.length ? (
            <Link
              href={`/study/session?${set ? `set=${encodeURIComponent(set)}&` : ''}dir=${direction}`}
              className="mt-6 block"
            >
              <Button size="lg" className="w-full">
                {set ?? (onlySaved ? '담은 것' : '전체')} 시험 보기 ({items.length}개)
              </Button>
            </Link>
          ) : null}
        </>
      ) : (
        <EmptyState
          title={query ? '찾는 단어가 없어요' : onlySaved ? '담아 둔 단어가 없어요' : '단어가 없어요'}
          hint={onlySaved ? '목록에서 북마크를 누르면 여기에 모입니다.' : undefined}
        />
      )}
    </>
  )
}
