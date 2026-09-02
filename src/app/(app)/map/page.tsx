import Link from 'next/link'
import { Suspense } from 'react'
import { requireActor } from '@/lib/auth/session'
import { listStudyWords, mapCounts } from '@/lib/data/library'
import { listRecommendedWords } from '@/lib/data/personal'
import { EmptyState, Input, Pager, PageHeader, TabBar, TabLink } from '@/components/ui'
import { BookmarkButton } from '@/components/words/bookmark-button'

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
 */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string }>
}) {
  const { tab, q, page } = await searchParams
  const actor = await requireActor()
  const isCurator = actor.role === 'teacher' || actor.role === 'admin'
  const query = q?.trim() ?? ''
  const view = resolveView(tab, isCurator)
  const pageIndex = Math.max(0, Number(page ?? 0) || 0)

  // Only the list on screen is fetched. Loading all four to take their lengths
  // meant four full scans to render one of them; the tab counts are one query.
  const [words, counts] = await Promise.all([
    listStudyWords({
      userId: actor.id,
      scope: SCOPE_OF[view],
      savedOnly: view === 'saved',
      query,
      page: pageIndex,
    }),
    mapCounts(actor.id),
  ])

  return (
    <div className="animate-rise">
      <PageHeader title="맵" subtitle="Brain Map이 있는 단어만 모여 있어요" />

      {/* Streamed: the list is what the tab is for, and it should not wait on
          a strip that is empty most of the time. */}
      {view === 'published' ? (
        <Suspense fallback={null}>
          <Recommended userId={actor.id} />
        </Suspense>
      ) : null}

      <form action="/map" className="mb-4">
        {tab ? <input type="hidden" name="tab" value={tab} /> : null}
        <Input
          name="q"
          defaultValue={query}
          placeholder="단어 검색"
          aria-label="맵 검색"
        />
      </form>

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

              <BookmarkButton vocabularyId={word.id} bookmarked={word.bookmarked} />
            </li>
          ))}
        </ul>
      )}

      <Pager
        page={words.page}
        pageCount={words.pageCount}
        total={words.total}
        href={(next) => href({ tab, q: query, page: next ? String(next) : undefined })}
      />
    </div>
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

function href(params: { tab?: string; q?: string; page?: string }): string {
  const search = new URLSearchParams()
  if (params.tab) search.set('tab', params.tab)
  if (params.q) search.set('q', params.q)
  if (params.page) search.set('page', params.page)
  const rest = search.toString()
  return rest ? `/map?${rest}` : '/map'
}
