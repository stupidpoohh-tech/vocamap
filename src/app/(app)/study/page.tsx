import Link from 'next/link'
import { Suspense } from 'react'
import { getViewer } from '@/lib/auth/session'
import { getTodaySummary } from '@/lib/data/study'
import {
  listStudyWords,
  listWordSets,
  setScopeCounts,
  vaultCounts,
  wordSetName,
} from '@/lib/data/library'
import { listRecommendedWords } from '@/lib/data/personal'
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
 * The starred words are the shelf's second tab. They used to live one tab over
 * in 보관함, which is now the review schedule — and a star belongs beside the
 * words it was put on, in the same list with the same covering, rather than in
 * a screen about dates.
 *
 * The maps live here too, as a filter inside the set rather than a tab of their
 * own. A map is a property of a word, and the row already says which words have
 * one; a second screen listing the same sets and the same words, minus the ones
 * without a map, was a copy of this one wearing a different name.
 *
 * Search is the exception. Someone hunting one word does not know which set it
 * is in, so a query skips the shelf and answers across everything.
 */
export default async function StudyPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    set?: string
    dir?: string
    page?: string
    tab?: string
    view?: string
  }>
}) {
  const { q, set, dir, page, tab, view } = await searchParams
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
  const saved = browsing && tab === 'saved'
  const mapsOnly = view === 'map'
  const pageIndex = Math.max(0, Number(page ?? 0) || 0)

  // One focal point per view. On the shelf that is today's session; inside a
  // set it is that set's own test. Showing both put two filled buttons on one
  // screen and made the reader pick which one the app meant.
  return (
    <div className="animate-rise">
      {browsing ? (
        <>
          <PageHeader
            title="단어"
            subtitle={
              saved ? '☆ 을 눌러 담아 둔 단어예요' : '세트를 열어 단어를 보고, 모르는 단어를 담아요'
            }
          />

          {/* Today's queue belongs to the shelf, not to the starred list: on
              that tab the words on screen are the subject, and a second filled
              button pointing elsewhere is a question the reader has to answer
              before they can read anything. */}
          {saved ? null : actor.isGuest ? (
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

          {/* The words that keep going wrong, and so are the ones worth
              opening a map on. This used to be the first thing on the 맵 tab;
              with that tab gone it belongs on the shelf, where a student
              decides what to do next. */}
          {saved ? null : (
            <Suspense fallback={null}>
              <Recommended userId={actor.id} />
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

          <Suspense fallback={null}>
            <ShelfArea
              userId={actor.id}
              role={actor.role}
              saved={saved}
              direction={direction}
              page={pageIndex}
            />
          </Suspense>
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
            page={pageIndex}
            mapsOnly={mapsOnly}
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

/**
 * The shelf and the starred list, under one pair of tabs.
 *
 * Both are fetched here rather than in the page so the tab bar streams with the
 * list it labels — the counts and the rows are one question, and splitting them
 * showed a tab bar above an empty space.
 */
async function ShelfArea({
  userId,
  role,
  saved,
  direction,
  page,
}: {
  userId: string
  role: string
  saved: boolean
  direction: ListDirection
  page: number
}) {
  const [counts, words] = await Promise.all([
    vaultCounts(userId),
    saved ? listStudyWords({ userId, scope: 'saved', page }) : Promise.resolve(null),
  ])

  return (
    <>
      <TabBar>
        <TabLink href="/study" active={!saved}>
          세트
        </TabLink>
        <TabLink href="/study?tab=saved" active={saved} count={counts.saved}>
          담은 단어
        </TabLink>
      </TabBar>

      {saved && words ? (
        <>
          {/* Which way round the list is covered is a display option, not a
              destination, so it reads as two words rather than a second tab
              bar. */}
          <div className="mb-1 flex justify-end gap-3 text-xs">
            <DirectionLink href="/study?tab=saved&dir=en_ko" active={direction === 'en_ko'}>
              영 → 한
            </DirectionLink>
            <DirectionLink href="/study?tab=saved&dir=ko_en" active={direction === 'ko_en'}>
              한 → 영
            </DirectionLink>
          </div>

          <WordList
            items={words.words}
            direction={direction}
            emptyHint="세트를 열고 모르는 단어의 ☆ 을 누르면 여기에 담겨요."
          />

          <Pager
            page={words.page}
            pageCount={words.pageCount}
            total={words.total}
            href={(next) =>
              buildHref('/study', {
                tab: 'saved',
                dir: direction,
                page: next ? String(next) : undefined,
              })
            }
          />

          {words.total > 0 ? (
            <Link href={`/study/session?scope=saved&dir=${direction}`} className="mt-6 block">
              <Button size="lg" className="w-full">
                담은 단어 시험 보기
              </Button>
            </Link>
          ) : null}
        </>
      ) : (
        <Shelf userId={userId} role={role} />
      )}
    </>
  )
}

function DirectionLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={active ? 'text-ink' : 'text-ink-3 transition hover:text-ink-2'}
    >
      {children}
    </Link>
  )
}

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
              {/* Which sets have maps to open. The 맵 tab's shelf used to be
                  the only place that said so; now the count says it here and
                  the 맵 filter inside the set is one tap away. */}
              {set.mappedCount > 0 ? <span className="ml-1.5">맵 {set.mappedCount}</span> : null}
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
  mapsOnly,
}: {
  userId: string
  role: string
  query: string
  setId?: string
  unassigned: boolean
  direction: ListDirection
  page: number
  /** The 맵 filter: the same set, narrowed to the words that carry a map. */
  mapsOnly: boolean
}) {
  const [words, counts, title] = await Promise.all([
    listStudyWords({
      userId,
      scope: mapsOnly ? 'mapped' : 'all',
      setId,
      unassigned,
      query,
      page,
    }),
    setScopeCounts({ setId, unassigned, query }),
    setId ? wordSetName(setId) : Promise.resolve(unassigned ? '세트에 없는 단어' : null),
  ])

  const setParam = setId ?? (unassigned ? 'none' : undefined)
  const viewParam = mapsOnly ? 'map' : undefined
  // Two different tests over the same set. The map test asks the way mapped
  // words can be asked — a blank in a real sentence, a collocation, a word
  // family — so it is not the whole-set test with fewer words in it.
  const testHref = buildHref('/study/session', {
    scope: mapsOnly ? 'mapped' : 'all',
    dir: direction,
    set: setId,
    unassigned: unassigned ? '1' : undefined,
  })
  const listHref = (params: Record<string, string | undefined>) =>
    buildHref('/study', { q: query, set: setParam, view: viewParam, dir: direction, ...params })

  return (
    <>
      <PageHeader
        title={query ? `"${query}" 검색 결과` : (title ?? '단어')}
        subtitle={
          query
            ? undefined
            : mapsOnly
              ? '이 세트에서 맵이 있는 단어예요'
              : '모르는 단어는 ☆ 을 눌러 보관함에 담아요'
        }
        // The set's own test is this view's single action, so it sits with the
        // title rather than as a second full-width button under the tabs.
        action={
          words.total > 0 && !query ? (
            <Link href={testHref}>
              <Button>{mapsOnly ? '맵 시험 보기' : '시험 보기'}</Button>
            </Link>
          ) : null
        }
      />

      {/* What the list is of — the tabs. Which way round it is covered is a
          display option and reads as two words, not as a second tab bar; it
          used to have the tabs to itself, which said the direction was the
          bigger choice on this screen. It is not. */}
      {counts.mapped > 0 ? (
        <TabBar>
          <TabLink href={listHref({ view: undefined })} active={!mapsOnly} count={counts.all}>
            전체
          </TabLink>
          <TabLink href={listHref({ view: 'map' })} active={mapsOnly} count={counts.mapped}>
            맵
          </TabLink>
        </TabBar>
      ) : null}

      <div className="mb-1 flex justify-end gap-3 text-xs">
        <DirectionLink href={listHref({ dir: 'en_ko' })} active={direction === 'en_ko'}>
          영 → 한
        </DirectionLink>
        <DirectionLink href={listHref({ dir: 'ko_en' })} active={direction === 'ko_en'}>
          한 → 영
        </DirectionLink>
      </div>

      <WordList
        items={words.words}
        direction={direction}
        // Every row on the 맵 tab has one, so the badge would be saying the
        // heading's job twenty times over.
        showMap={!mapsOnly}
        emptyHint={
          query
            ? '다른 표현으로 찾아보세요.'
            : mapsOnly
              ? '이 세트에는 아직 맵이 있는 단어가 없어요.'
              : role === 'student'
                ? '이 세트에는 아직 단어가 없어요.'
                : '교사 탭에서 이 세트에 단어를 담아 주세요.'
        }
      />

      <Pager
        page={words.page}
        pageCount={words.pageCount}
        total={words.total}
        href={(next) => listHref({ page: next ? String(next) : undefined })}
      />

      {/* The same test as the one beside the title, at the end of the words.
          Studying a set is working down the list, so the moment to be tested is
          when you reach the bottom of it — and after the pager, because every
          page of the set is part of the set. */}
      {words.total > 0 && !query ? (
        <Link href={testHref} className="mt-6 block">
          <Button size="lg" className="w-full">
            {mapsOnly ? '이 세트 맵 시험 보기' : '이 세트 시험 보기'}
          </Button>
        </Link>
      ) : null}
    </>
  )
}

/**
 * The words that keep beating this student, straight to their maps.
 *
 * A line of links rather than a card: it is a suggestion, and the shelf below
 * it is what the screen is for.
 */
async function Recommended({ userId }: { userId: string }) {
  const words = await listRecommendedWords(userId, 5)
  if (!words.length) return null

  return (
    <section className="mb-5">
      <p className="text-xs text-ink-3">자주 틀려서 깊이 볼 만한 단어</p>
      <ul className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {words.map((word) => (
          <li key={word.vocabularyId}>
            <Link
              href={`/words/${word.vocabularyId}`}
              className="text-[0.9375rem] text-ink underline decoration-line underline-offset-4 transition hover:decoration-brand"
            >
              {word.lemma}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function buildHref(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  const rest = search.toString()
  return rest ? `${path}?${rest}` : path
}
