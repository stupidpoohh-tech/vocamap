import Link from 'next/link'
import { Suspense } from 'react'
import { getViewer } from '@/lib/auth/session'
import { getTodaySummary } from '@/lib/data/study'
import {
  listStudyWords,
  listWordSets,
  wordSetName,
} from '@/lib/data/library'
import { Button, EmptyState, Input, Pager, PageHeader, TabBar, TabLink } from '@/components/ui'
import { WordList, type ListDirection } from '@/components/words/word-list'
import { SkeletonLine } from '@/components/ui/skeleton'
import { GuestNote } from '@/components/guest-note'

/**
 * SCREEN 1 — the study book, browsed set by set.
 *
 * A flat list of every word a tutor has ever uploaded is a dictionary, not a
 * study book: a student cannot tell which twenty words are this week's. So the
 * shelf comes first and a set opens into its own word list, which is where the
 * covering, the starring and the test all live.
 *
 * Search is the exception. Someone hunting one word does not know which set it
 * is in, so a query skips the shelf and answers across everything.
 */
export default async function StudyPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; set?: string; dir?: string; page?: string }>
}) {
  const { q, set, dir, page } = await searchParams
  const actor = await getViewer()
  const query = q?.trim() ?? ''
  const direction: ListDirection = dir === 'ko_en' ? 'ko_en' : 'en_ko'

  // `set=none` is the bucket of words no set contains — without it they would
  // be unreachable the moment the book is browsed set by set.
  const unassigned = set === 'none'
  const setId = unassigned ? undefined : set
  const setParam = unassigned ? 'none' : setId
  const insideSet = Boolean(set)
  const browsing = !insideSet && !query

  // One focal point per view. On the shelf that is today's session; inside a
  // set it is that set's own test. Showing both put two filled buttons on one
  // screen and made the reader pick which one the app meant.
  return (
    <div className="animate-rise">
      {browsing ? (
        <>
          <PageHeader title="단어" subtitle="세트를 열어 단어를 보고, 모르는 단어를 담아요" />

          {actor.isGuest ? (
            <GuestNote next="/study">
              지금은 게스트로 보고 있어요. 담은 단어와 복습 기록을 남기려면
            </GuestNote>
          ) : (
            /* Streamed on its own so the shelf below does not wait on it: the
               counts and the words are independent questions. */
            <Suspense fallback={<DueStripSkeleton />}>
              <DueStrip userId={actor.id} direction={direction} />
            </Suspense>
          )}

          <form action="/study" className="mb-5">
            <Input
              name="q"
              defaultValue=""
              placeholder="영어 단어 또는 한국어 뜻으로 검색"
              aria-label="단어 검색"
            />
          </form>

          <Shelf userId={actor.id} role={actor.role} />
        </>
      ) : (
        <>
          <Link
            href={query && setParam ? `/study?set=${setParam}` : '/study'}
            className="mb-4 inline-block text-[0.8125rem] text-ink-3 transition hover:text-ink-2"
          >
            ← {query && setParam ? '세트로' : '세트 목록'}
          </Link>

          <WordsView
            userId={actor.id}
            role={actor.role}
            query={query}
            setId={setId}
            unassigned={unassigned}
            direction={direction}
            page={Math.max(0, Number(page ?? 0) || 0)}
          />
        </>
      )}
    </div>
  )
}

/* ───────────────────────────── today's numbers ──────────────────────────── */

/**
 * What is waiting for you today, and the one action that clears it.
 *
 * This used to be a bordered box holding two numbers at the same size as their
 * labels — a card built for a single fact, with no way to tell which number
 * mattered. It is a line of type now: the count leads at size, its unit and
 * label trail behind it, and the button is the screen's one filled control.
 */
async function DueStrip({ userId, direction }: { userId: string; direction: ListDirection }) {
  const summary = await getTodaySummary(userId)
  const total = summary.dueCount + summary.newCount

  if (total === 0) {
    return (
      <p className="mb-7 min-h-[2.75rem] text-[0.8125rem] leading-relaxed text-ink-3 break-keep">
        오늘 복습할 단어가 없어요. 아래에서 세트를 열어 시험 볼 수 있어요.
      </p>
    )
  }

  return (
    <div className="mb-7 flex min-h-[2.75rem] items-center justify-between gap-4">
      <p className="flex items-baseline gap-1.5 break-keep">
        <span className="numeral text-[1.75rem] font-semibold leading-none text-ink">{total}</span>
        <span className="text-sm text-ink-2">문제</span>
        <span className="numeral ml-1 text-xs text-ink-3">
          복습 {summary.dueCount} · 새 단어 {summary.newCount}
        </span>
      </p>
      <Link href={`/study/session?scope=due&dir=${direction}`} className="shrink-0">
        <Button>시험 시작</Button>
      </Link>
    </div>
  )
}

/** The same height as the real strip, so nothing below it moves when it lands. */
function DueStripSkeleton() {
  return (
    <div className="mb-7 flex min-h-[2.75rem] items-center">
      <SkeletonLine className="w-32" />
    </div>
  )
}

/* ─────────────────────────────── the shelf ─────────────────────────────── */

async function Shelf({ userId, role }: { userId: string; role: string }) {
  const sets = await listWordSets(userId)

  if (!sets.length) {
    return (
      <EmptyState
        title="아직 단어 세트가 없어요"
        hint={
          role === 'student'
            ? '선생님이 단어를 올리면 여기에 세트로 나타나요.'
            : '교사 탭의 "단어 가져오기"로 세트를 만들면 여기에 나타나요.'
        }
      />
    )
  }

  return (
    <ul className="divide-y divide-line-soft border-t border-line">
      {sets.map((set) => (
        <li key={set.id ?? 'none'}>
          <Link
            href={`/study?set=${set.id ?? 'none'}`}
            className="group flex items-center gap-4 py-3.5 transition"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="truncate text-[0.9375rem] text-ink group-hover:text-brand">
                  {set.title}
                </span>
                {/* Assignment is the one thing here worth a mark, and it is a
                    word rather than a coloured pill. */}
                {set.assigned ? (
                  <span className="shrink-0 text-[0.6875rem] text-brand">배정</span>
                ) : null}
              </span>
              {set.description ? (
                <span className="mt-0.5 block truncate text-[0.8125rem] text-ink-3">
                  {set.description}
                </span>
              ) : null}
            </span>

            {/* Progress first, because the question the shelf answers is
                "which one do I do today" — and a set already worked through
                is not it. A set never opened says only its size. */}
            <span className="numeral shrink-0 text-right text-xs text-ink-3">
              {set.studiedCount > 0 ? (
                <span className={set.studiedCount >= set.wordCount ? 'text-good' : 'text-ink-2'}>
                  {set.studiedCount}/{set.wordCount}
                </span>
              ) : (
                <>
                  <span className="text-ink-2">{set.wordCount}</span>개
                </>
              )}
              {set.savedCount > 0 ? <span className="ml-1.5">담음 {set.savedCount}</span> : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/* ───────────────────────── one set, or a search ───────────────────────── */

async function WordsView({
  userId,
  role,
  query,
  setId,
  unassigned,
  direction,
  page,
}: {
  userId: string
  role: string
  query: string
  setId?: string
  unassigned: boolean
  direction: ListDirection
  page: number
}) {
  const [words, title] = await Promise.all([
    listStudyWords({ userId, scope: 'all', setId, unassigned, query, page }),
    setId ? wordSetName(setId) : Promise.resolve(unassigned ? '세트에 없는 단어' : null),
  ])

  const setParam = setId ?? (unassigned ? 'none' : undefined)
  const testHref = buildHref('/study/session', {
    scope: 'all',
    dir: direction,
    set: setId,
    unassigned: unassigned ? '1' : undefined,
  })

  return (
    <>
      <PageHeader
        title={query ? `"${query}" 검색 결과` : (title ?? '단어')}
        subtitle={query ? undefined : '모르는 단어는 ☆ 을 눌러 보관함에 담아요'}
        // The set's own test is this view's single action, so it sits with the
        // title rather than as a second full-width button under the tabs.
        action={
          words.total > 0 && !query ? (
            <Link href={testHref}>
              <Button>시험 보기</Button>
            </Link>
          ) : null
        }
      />

      <TabBar>
        <TabLink
          href={buildHref('/study', { q: query, set: setParam, dir: 'en_ko' })}
          active={direction === 'en_ko'}
        >
          영어 → 한국어
        </TabLink>
        <TabLink
          href={buildHref('/study', { q: query, set: setParam, dir: 'ko_en' })}
          active={direction === 'ko_en'}
        >
          한국어 → 영어
        </TabLink>
      </TabBar>

      <WordList
        items={words.words}
        direction={direction}
        emptyHint={
          query
            ? '다른 표현으로 찾아보세요.'
            : role === 'student'
              ? '이 세트에는 아직 단어가 없어요.'
              : '교사 탭에서 이 세트에 단어를 담아 주세요.'
        }
      />

      <Pager
        page={words.page}
        pageCount={words.pageCount}
        total={words.total}
        href={(next) =>
          buildHref('/study', {
            q: query,
            set: setParam,
            dir: direction,
            page: next ? String(next) : undefined,
          })
        }
      />

      {/* The same test as the one beside the title, at the end of the words.
          Studying a set is working down the list, so the moment to be tested is
          when you reach the bottom of it — and after the pager, because every
          page of the set is part of the set. */}
      {words.total > 0 && !query ? (
        <Link href={testHref} className="mt-6 block">
          <Button size="lg" className="w-full">
            이 세트 시험 보기
          </Button>
        </Link>
      ) : null}
    </>
  )
}

function buildHref(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  const rest = search.toString()
  return rest ? `${path}?${rest}` : path
}
