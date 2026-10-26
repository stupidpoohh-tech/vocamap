'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button, PageHeader, TabBar, TabButton } from '@/components/ui'
import { ReviewList, type ReviewWord } from '@/components/words/review-list'
import { estimatedRetention, isDue } from '@/lib/learning/scheduler'
import { cardFor, isBookmarked, read, wrongCount, type Saved } from '@/learning/store'

/**
 * 복습 — 잊어가는 곡선이 보이는 화면.
 *
 * 단어 목록을 또 한 번 보여주는 곳이 아니다. 다른 화면이 못 보여주는 것은
 * 일정이다: 오늘 돌아온 것, 돌아올 것, 그리고 나를 이긴 적 있는 것.
 *
 * 예전에는 탭이 주소에 있었고(`?tab=upcoming`), 그래서 이 화면은 주소마다
 * 서버에서 만들어졌다. 지금은 세 탭이 모두 같은 기록에서 나오므로 주소를
 * 쓸 이유가 없다 — 화면은 한 번 구워지고, 탭은 브라우저가 바꾼다.
 *
 * "틀린 단어"는 일정이 아니라 답한 기록에서 온다. FSRS 가 카드를 내려 앉힌
 * 것은 "네가 이걸 틀렸다"와 다른 말이고, 그 목록이 있는 이유는 후자다.
 */

type Bucket = 'now' | 'upcoming' | 'wrong'

export type DeskWord = { slug: string; lemma: string; ko: string; hasMap: boolean }

export function ReviewDesk({ words }: { words: DeskWord[] }) {
  const [bucket, setBucket] = useState<Bucket>('now')
  /**
   * 기록은 첫 그림에 넣지 않는다. 이 화면의 HTML 은 모두에게 같은 것이
   * 구워져 있고, 기록은 이 폰에만 있다.
   */
  const [saved, setSaved] = useState<Saved | null>(null)
  // 지금 몇 시인지도 브라우저가 정한다. 구워 둔 HTML 에 시각을 박아 두면
  // 그것은 빌드한 때이고, 며칠 지난 "지금"이 된다.
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setSaved(read())
    setNow(new Date())
  }, [])

  const rows = useMemo<ReviewWord[]>(() => {
    if (!saved || !now) return []
    return words.map((w) => {
      const forward = cardFor(saved, w.slug, 'en_ko')
      const back = cardFor(saved, w.slug, 'ko_en')
      const cards = [forward, back].filter((c): c is NonNullable<typeof c> => c !== null)
      // 먼저 돌아오는 쪽이 그 단어의 날짜다. 한 방향만 해 뒀으면 그 쪽이다.
      const dueAt = cards.length
        ? new Date(Math.min(...cards.map((c) => c.dueAt.getTime())))
        : null
      // 약한 쪽이 그 단어의 기억이다. 한쪽만 붙들고 있는 것은 외운 것이 아니다.
      const retention = cards.length
        ? Math.min(...cards.map((c) => estimatedRetention(c, now)))
        : null
      return {
        slug: w.slug,
        lemma: w.lemma,
        translation: w.ko || null,
        bookmarked: isBookmarked(saved, w.slug),
        wrongCount: wrongCount(saved, w.slug),
        hasMap: w.hasMap,
        dueAt,
        retention,
      }
    })
  }, [words, saved, now])

  const buckets = useMemo(() => {
    if (!now) return { now: [], upcoming: [], wrong: [] } as Record<Bucket, ReviewWord[]>
    const due: ReviewWord[] = []
    const upcoming: ReviewWord[] = []
    for (const row of rows) {
      // 한 번도 안 본 단어는 '지금 복습'에 들어가지 않는다 — 복습이 아니라
      // 처음 만나는 것이고, 시험이 그것을 함께 데려간다.
      if (!row.dueAt) continue
      ;(row.dueAt.getTime() <= now.getTime() ? due : upcoming).push(row)
    }
    const by = (a: ReviewWord, b: ReviewWord) =>
      (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0)
    return {
      now: due.sort(by),
      upcoming: upcoming.sort(by),
      wrong: rows.filter((r) => r.wrongCount > 0).sort((a, b) => b.wrongCount - a.wrongCount),
    }
  }, [rows, now])

  /** 시험이 실제로 물을 것. 새 단어도 같은 자리에서 함께 나온다. */
  const fresh = useMemo(() => {
    if (!saved) return 0
    return words.filter((w) => {
      const card = cardFor(saved, w.slug, 'en_ko')
      return !card
    }).length
  }, [words, saved])

  const list = buckets[bucket]
  const dueCount = buckets.now.length

  return (
    <div className="animate-rise">
      <PageHeader
        title="복습"
        subtitle={SUBTITLE[bucket]}
        action={
          <Action bucket={bucket} due={dueCount} fresh={fresh} wrong={buckets.wrong.length} />
        }
      />

      {/* 오늘의 숫자를 카드가 아니라 글자 한 줄로. 숫자 둘에 상자가 필요하지
          않고, 위의 버튼이 이미 그 숫자에 대한 답이다. */}
      {bucket === 'now' ? (
        <p className="mb-6 flex items-baseline gap-1.5 break-keep">
          {dueCount > 0 ? (
            <>
              <span className="numeral text-[1.75rem] font-semibold leading-none text-ink">
                {dueCount}
              </span>
              <span className="text-sm text-ink-2">단어 복습</span>
              {fresh > 0 ? (
                <span className="numeral ml-1 text-xs text-ink-3">새 단어 {fresh}개 함께</span>
              ) : null}
            </>
          ) : (
            <span className="text-[0.8125rem] leading-relaxed text-ink-3">
              {fresh > 0
                ? `지금 복습할 단어는 없어요. 오늘은 새 단어 ${fresh}개로 시작해요.`
                : '지금 복습할 단어가 없어요. 단어 탭에서 세트를 공부하면 여기에 쌓여요.'}
            </span>
          )}
        </p>
      ) : null}

      <TabBar>
        <TabButton active={bucket === 'now'} onClick={() => setBucket('now')} count={dueCount}>
          지금 복습
        </TabButton>
        <TabButton
          active={bucket === 'upcoming'}
          onClick={() => setBucket('upcoming')}
          count={buckets.upcoming.length}
        >
          예정
        </TabButton>
        <TabButton
          active={bucket === 'wrong'}
          onClick={() => setBucket('wrong')}
          count={buckets.wrong.length}
        >
          틀린 단어
        </TabButton>
      </TabBar>

      <ReviewList
        items={list}
        now={now ?? new Date(0)}
        emptyHint={saved ? EMPTY[bucket] : '기록을 읽고 있어요…'}
        showWrongCount={bucket === 'wrong'}
        onBookmarkChange={() => setSaved(read())}
      />
    </div>
  )
}

function Action({
  bucket,
  due,
  fresh,
  wrong,
}: {
  bucket: Bucket
  due: number
  fresh: number
  wrong: number
}) {
  if (bucket === 'wrong') {
    return wrong > 0 ? (
      <Link href="/study/session?scope=wrong">
        <Button>틀린 단어 시험</Button>
      </Link>
    ) : null
  }
  // 예보에는 누를 것이 없다.
  if (bucket === 'upcoming') return null
  if (due === 0 && fresh === 0) return null
  return (
    <Link href="/study/session?scope=due">
      {/* 어느 쪽이든 같은 시험이다. 한 번도 본 적 없는 단어를 "복습하자"고
          부르지 않기 위해 이름만 바꾼다. */}
      <Button>{due > 0 ? '복습 시작' : '새 단어 시작'}</Button>
    </Link>
  )
}

const SUBTITLE: Record<Bucket, string> = {
  now: '기억이 흐려질 때쯤 다시 만나요',
  upcoming: '다음에 만날 날짜예요',
  wrong: '틀린 적 있는 단어예요',
}

const EMPTY: Record<Bucket, string> = {
  now: '지금 복습할 단어가 없어요. 단어 탭에서 세트를 공부하면 여기에 쌓여요.',
  upcoming: '아직 예정된 복습이 없어요. 시험을 한 번 보면 다음 날짜가 잡혀요.',
  wrong: '아직 틀린 단어가 없어요. 시험을 보면 틀린 단어가 여기에 모여요.',
}
