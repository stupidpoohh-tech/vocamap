import Link from 'next/link'
import { requireActor } from '@/lib/auth/session'
import { listReviewWords, reviewCounts, type ReviewBucket } from '@/lib/data/review'
import { getTodaySummary } from '@/lib/data/study'
import { Button, Pager, PageHeader, TabBar, TabLink } from '@/components/ui'
import { ReviewList } from '@/components/words/review-list'

/**
 * SCREEN 2 — 복습.
 *
 * This used to be a second word list: starred words on one tab, wrong words on
 * the other. But the star already has two homes — 단어 has a 담은 단어 tab and
 * 맵 has 저장한 맵 — and a third copy of the same list taught nobody anything.
 *
 * What no other screen can show is the forgetting curve. FSRS is already
 * scheduling every card; this is where that schedule becomes visible: what has
 * come back round today, what is coming, and what has beaten the student before.
 * The one action is starting the review it is describing.
 *
 * "틀린 단어" stays, read from the answer log rather than from the FSRS card. A
 * card's lapse count says the scheduler demoted it; it does not say "you got
 * this one wrong", which is the only thing that list is for.
 */
export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>
}) {
  const { tab, page } = await searchParams
  const actor = await requireActor()
  const bucket: ReviewBucket = tab === 'upcoming' ? 'upcoming' : tab === 'wrong' ? 'wrong' : 'now'
  const pageIndex = Math.max(0, Number(page ?? 0) || 0)
  const now = new Date()

  const [words, counts, summary] = await Promise.all([
    listReviewWords({ userId: actor.id, bucket, page: pageIndex, now }),
    reviewCounts(actor.id, { now }),
    getTodaySummary(actor.id, { now }),
  ])

  // What "복습 시작" will actually ask. New words ride along in the same
  // session — FSRS introduces and reviews in one sitting — but they are not on
  // the curve yet and so are not in any of the three lists below. Saying so is
  // the difference between a screen that adds up and one that shows "18문제"
  // above a tab reading "지금 복습 0".
  const hasSession = summary.dueCount > 0 || summary.newCount > 0

  return (
    <div className="animate-rise">
      <PageHeader
        title="복습"
        subtitle={SUBTITLE[bucket]}
        // One action, and it belongs to the tab you are on: the due list starts
        // today's review, the wrong list drills the mistakes, and the upcoming
        // list is a forecast — there is nothing to press on a forecast.
        action={
          <Action
            bucket={bucket}
            due={summary.dueCount}
            fresh={summary.newCount}
            wrong={counts.wrong}
          />
        }
      />

      {/* The day's numbers as a line of type, not a card. Two counts do not
          need a box, and the button above is already the answer to them.
          Only on the due tab: on a forecast, or on the mistake list, a headline
          count of today's session is a claim with no button under it. */}
      {bucket === 'now' ? (
        <p className="mb-6 flex items-baseline gap-1.5 break-keep">
          {summary.dueCount > 0 ? (
            <>
              <span className="numeral text-[1.75rem] font-semibold leading-none text-ink">
                {summary.dueCount}
              </span>
              <span className="text-sm text-ink-2">문제 복습</span>
              {summary.newCount > 0 ? (
                <span className="numeral ml-1 text-xs text-ink-3">
                  새 단어 {summary.newCount}문제 함께
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-[0.8125rem] leading-relaxed text-ink-3">
              {hasSession
                ? `지금 복습할 단어는 없어요. 오늘은 새 단어 ${summary.newCount}문제로 시작해요.`
                : '지금 복습할 단어가 없어요. 단어 탭에서 세트를 공부하면 여기에 쌓여요.'}
            </span>
          )}
        </p>
      ) : null}

      <TabBar>
        <TabLink href={href({})} active={bucket === 'now'} count={counts.now}>
          지금 복습
        </TabLink>
        <TabLink
          href={href({ tab: 'upcoming' })}
          active={bucket === 'upcoming'}
          count={counts.upcoming}
        >
          예정
        </TabLink>
        <TabLink href={href({ tab: 'wrong' })} active={bucket === 'wrong'} count={counts.wrong}>
          틀린 단어
        </TabLink>
      </TabBar>

      <ReviewList
        items={words.words}
        now={now}
        emptyHint={EMPTY[bucket]}
        showWrongCount={bucket === 'wrong'}
      />

      <Pager
        page={words.page}
        pageCount={words.pageCount}
        total={words.total}
        href={(next) => href({ tab, page: next ? String(next) : undefined })}
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
  bucket: ReviewBucket
  due: number
  fresh: number
  wrong: number
}) {
  if (bucket === 'wrong') {
    return wrong > 0 ? (
      <Link href="/study/session?scope=wrong&from=vault">
        <Button>틀린 단어 시험</Button>
      </Link>
    ) : null
  }
  if (bucket === 'upcoming') return null
  if (due === 0 && fresh === 0) return null
  return (
    <Link href="/study/session?scope=due&from=vault">
      {/* The same session either way; the label says which of the two it is
          about to be, so a student is not told to "review" words they have
          never seen. */}
      <Button>{due > 0 ? '복습 시작' : '새 단어 시작'}</Button>
    </Link>
  )
}

const SUBTITLE: Record<ReviewBucket, string> = {
  now: '기억이 흐려질 때쯤 다시 만나요',
  upcoming: '다음에 만날 날짜예요',
  wrong: '틀린 적 있는 단어예요',
}

const EMPTY: Record<ReviewBucket, string> = {
  now: '지금 복습할 단어가 없어요. 단어 탭에서 세트를 공부하면 여기에 쌓여요.',
  upcoming: '아직 예정된 복습이 없어요. 시험을 한 번 보면 다음 날짜가 잡혀요.',
  wrong: '아직 틀린 단어가 없어요. 시험을 보면 틀린 단어가 여기에 모여요.',
}

function href(params: { tab?: string; page?: string }): string {
  const search = new URLSearchParams()
  if (params.tab) search.set('tab', params.tab)
  if (params.page) search.set('page', params.page)
  const rest = search.toString()
  return rest ? `/vault?${rest}` : '/vault'
}
