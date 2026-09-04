import Link from 'next/link'
import { Suspense } from 'react'
import { getViewer } from '@/lib/auth/session'
import { listStudyWords, listWordSets, mapCounts, wordSetName } from '@/lib/data/library'
import { listRecommendedWords } from '@/lib/data/personal'
import { Button, EmptyState, Input, Pager, PageHeader, TabBar, TabLink } from '@/components/ui'
import { BookmarkButton } from '@/components/words/bookmark-button'
import { DeleteWordButton } from '@/components/words/delete-word-button'

/**
 * SCREEN 3 — the maps.
 *
 * Only words that actually have a Brain Map. The study book holds every word;
 * this holds the few that earned an expansion, which is the whole premise —
 * drill most words, expand the ones that fight back. Mixing the two lists is
 * what made the map feel like a menu of everything.
 *
 * Curators get two extra lists so the generation queue stays reachable: this is
 * the only screen that knows which words still lack a map.
 *
 * Browsed set by set, like the study book. Words live under sets either way, so
 * a flat list of every mapped word was the same dictionary problem one screen
 * over: a student could not tell which of them were this week's. The shelf only
 * counts words whose map is published, so a set with none does not appear.
 *
 * The other tabs stay flat. "저장한 맵" and the curator queues are selections
 * that cut across sets — grouping them by set would hide the thing they select
 * for.
 */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; set?: string; page?: string }>
}) {
  const { tab, q, set, page } = await searchParams
  const actor = await getViewer()
  const isCurator = actor.role === 'teacher' || actor.role === 'admin'
  const query = q?.trim() ?? ''
  const view = resolveView(tab, isCurator)
  const pageIndex = Math.max(0, Number(page ?? 0) || 0)

  // `set=none` is the bucket of mapped words no set contains — without it they
  // would be unreachable the moment the maps are browsed set by set.
  const unassigned = set === 'none'
  const setId = unassigned ? undefined : set
  const insideSet = Boolean(set)
  // The shelf is the default view of the published tab only. A search is
  // someone hunting one word who does not know which set it is in.
  const browsing = view === 'published' && !insideSet && !query

  const counts = await mapCounts(actor.id)

  if (browsing) {
    return (
      <div className="animate-rise">
        <PageHeader title="맵" subtitle="Brain Map이 있는 단어만 모여 있어요" />

        <Suspense fallback={null}>
          <Recommended userId={actor.id} />
        </Suspense>

        <SearchForm query={query} />
        <Tabs view={view} counts={counts} query={query} isCurator={isCurator} />

        <Suspense fallback={null}>
          <Shelf userId={actor.id} role={actor.role} />
        </Suspense>
      </div>
    )
  }

  const words = await listStudyWords({
    userId: actor.id,
    scope: SCOPE_OF[view],
    savedOnly: view === 'saved',
    setId,
    unassigned,
    query,
    page: pageIndex,
  })
  const setTitle = setId ? await wordSetName(setId) : unassigned ? '세트에 없는 단어' : null

  // A test over this set's mapped words only, and asked the way mapped words
  // are asked: a blank in a real sentence, a collocation, a word family. The
  // 단어 tab's test over the same set covers every word in it and asks all of
  // them for a translation, so this is a different test, not a shorter one.
  const testHref = mapTestHref(setId, unassigned)

  return (
    <div className="animate-rise">
      {insideSet ? (
        <>
          <Link href="/map" className="text-[0.8125rem] text-ink-3 transition hover:text-ink-2">
            ← 맵
          </Link>
          <PageHeader
            title={setTitle ?? '맵'}
            subtitle="이 세트에서 맵이 있는 단어예요"
            action={
              words.total > 0 && !query ? (
                <Link href={testHref}>
                  <Button>맵 시험 보기</Button>
                </Link>
              ) : null
            }
          />
        </>
      ) : (
        <PageHeader title="맵" subtitle="Brain Map이 있는 단어만 모여 있어요" />
      )}

      <SearchForm query={query} tab={tab} set={set} />
      {insideSet ? null : (
        <Tabs view={view} counts={counts} query={query} isCurator={isCurator} />
      )}

      {words.words.length === 0 ? (
        <EmptyState title={EMPTY[view].title} hint={EMPTY[view].hint} />
      ) : (
        <ul
          className={
            words.words.length > 8
              ? 'max-h-[58vh] divide-y divide-line-soft overflow-y-auto overscroll-contain border-t border-line'
              : 'divide-y divide-line-soft border-t border-line'
          }
        >
          {words.words.map((word) => (
            <li key={word.id} className="flex items-center gap-3 py-3">
              <Link href={`/words/${word.id}`} className="group min-w-0 flex-1">
                <span className="block truncate text-[0.9375rem] text-ink group-hover:text-brand">
                  {word.lemma}
                </span>
                <span className="mt-0.5 block truncate text-[0.8125rem] text-ink-3">
                  {word.translation ?? '—'}
                </span>
              </Link>

              {/* Only what is true of this row and not of every other one. The
                  tab already says whether these maps are published or waiting,
                  so a badge repeating it on all twenty-five rows says nothing. */}
              {word.wrongCount > 0 ? (
                <span className="numeral shrink-0 text-[0.6875rem] text-data-weak">
                  {word.wrongCount}회 틀림
                </span>
              ) : null}

              {/* Curators only. A student has no business deleting the shared
                  library, and the row is the only place a word with no map can
                  be reached from. */}
              {isCurator ? (
                <DeleteWordButton
                  vocabularyId={word.id}
                  lemma={word.lemma}
                  hasMap={word.mapStatus !== 'none'}
                />
              ) : null}

              <BookmarkButton vocabularyId={word.id} bookmarked={word.bookmarked} />
            </li>
          ))}
        </ul>
      )}

      <Pager
        page={words.page}
        pageCount={words.pageCount}
        total={words.total}
        href={(next) => href({ tab, q: query, set, page: next ? String(next) : undefined })}
      />

      {/* The same test as the one beside the title, at the end of the words —
          because working through a set's maps ends at the bottom of the list,
          and that is where being tested on them belongs. Only once the list is
          long enough to have scrolled that title away: on a set of three, two
          filled buttons a thumb apart are one button too many. */}
      {insideSet && words.words.length > 8 && !query ? (
        <Link href={testHref} className="mt-6 block">
          <Button size="lg" className="w-full">
            이 세트 맵 시험 보기
          </Button>
        </Link>
      ) : null}
    </div>
  )
}

/** The search box, shared by the shelf and the lists it opens into. */
function SearchForm({ query, tab, set }: { query: string; tab?: string; set?: string }) {
  return (
    <form action="/map" className="mb-4">
      {tab ? <input type="hidden" name="tab" value={tab} /> : null}
      {set ? <input type="hidden" name="set" value={set} /> : null}
      <Input name="q" defaultValue={query} placeholder="단어 검색" aria-label="맵 검색" />
    </form>
  )
}

function Tabs({
  view,
  counts,
  query,
  isCurator,
}: {
  view: MapView
  counts: Awaited<ReturnType<typeof mapCounts>>
  query: string
  isCurator: boolean
}) {
  return (
    <TabBar>
      <TabLink href={href({ q: query })} active={view === 'published'} count={counts.published}>
        전체 맵
      </TabLink>
      <TabLink href={href({ tab: 'saved', q: query })} active={view === 'saved'} count={counts.saved}>
        저장한 맵
      </TabLink>
      {isCurator ? (
        <>
          <TabLink
            href={href({ tab: 'pending', q: query })}
            active={view === 'pending'}
            count={counts.pending}
          >
            검수 대기
          </TabLink>
          <TabLink
            href={href({ tab: 'missing', q: query })}
            active={view === 'missing'}
            count={counts.missing}
          >
            맵 없음
          </TabLink>
        </>
      ) : null}
    </TabBar>
  )
}

/**
 * The sets that have something to open.
 *
 * A set with no published map is not shown at all — on this screen it is an
 * empty room, and the study tab already lists it as a set of words.
 */
async function Shelf({ userId, role }: { userId: string; role: string }) {
  const sets = (await listWordSets(userId)).filter((set) => set.mappedCount > 0)

  if (!sets.length) {
    return (
      <EmptyState
        title="아직 공개된 맵이 없어요"
        hint={
          role === 'student'
            ? '자주 틀리는 단어가 생기면 선생님이 그 단어의 Brain Map을 만들어 줘요.'
            : '단어의 맵을 만들고 검수에서 승인하면 그 단어가 속한 세트가 여기에 나타나요.'
        }
      />
    )
  }

  return (
    <ul className="divide-y divide-line-soft border-t border-line">
      {sets.map((set) => (
        <li key={set.id ?? 'none'}>
          <Link
            href={`/map?set=${set.id ?? 'none'}`}
            className="group flex items-center gap-4 py-3.5 transition"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="truncate text-[0.9375rem] text-ink group-hover:text-brand">
                  {set.title}
                </span>
                {set.assigned ? (
                  <span className="shrink-0 text-[0.6875rem] text-brand">배정</span>
                ) : null}
              </span>
            </span>

            {/* Maps in this set, not words: that is what this screen is for,
                and the study tab is one tap away for the word count. */}
            <span className="numeral shrink-0 text-right text-xs text-ink-3">
              <span className="text-ink-2">{set.mappedCount}</span>개
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

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

const SCOPE_OF = {
  published: 'mapped',
  saved: 'mapped',
  pending: 'mapPending',
  missing: 'mapMissing',
} as const

type MapView = 'published' | 'saved' | 'pending' | 'missing'

function resolveView(tab: string | undefined, isCurator: boolean): MapView {
  if (tab === 'saved') return 'saved'
  // A student cannot be shown drafts or the generation queue, whatever the URL
  // says — the tab is a view, not an authorisation.
  if (isCurator && (tab === 'pending' || tab === 'missing')) return tab
  return 'published'
}

const EMPTY: Record<MapView, { title: string; hint: string }> = {
  published: {
    title: '아직 공개된 맵이 없어요',
    hint: '자주 틀리는 단어가 생기면 선생님이 그 단어의 Brain Map을 만들어 줘요.',
  },
  saved: {
    title: '저장한 맵이 없어요',
    hint: '전체 맵에서 ☆ 을 누르면 여기에 모여요.',
  },
  pending: {
    title: '검수 대기 중인 맵이 없어요',
    hint: '초안을 만들면 여기에 쌓이고, 검수 탭에서 승인할 수 있어요.',
  },
  missing: {
    title: '모든 단어에 맵이 있어요',
    hint: '새 단어를 올리면 여기에 나타나요.',
  },
}

/**
 * The set's own test, over its mapped words.
 *
 * `set=none` is a place on this screen, not an id — the test names that bucket
 * `unassigned`, so the two do not share a query builder.
 */
function mapTestHref(setId: string | undefined, unassigned: boolean): string {
  if (setId) return `/study/session?scope=mapped&set=${setId}`
  if (unassigned) return '/study/session?scope=mapped&unassigned=1'
  return '/study/session?scope=mapped'
}

function href(params: { tab?: string; q?: string; set?: string; page?: string }): string {
  const search = new URLSearchParams()
  if (params.tab) search.set('tab', params.tab)
  if (params.q) search.set('q', params.q)
  if (params.set) search.set('set', params.set)
  if (params.page) search.set('page', params.page)
  const rest = search.toString()
  return rest ? `/map?${rest}` : '/map'
}
